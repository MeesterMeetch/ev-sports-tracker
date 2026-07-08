import { Router } from "express";
import type { IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { fetchMultiSportOdds } from "../lib/odds";
import {
  calcEVPercent,
  quarterKelly,
  deVig2Way,
  americanToImpliedProb,
  extractPinnacleProbs,
} from "../lib/ev-math";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SPORTS = [
  "americanfootball_nfl",
  "baseball_mlb",
  "basketball_nba",
  "icehockey_nhl",
  "americanfootball_ncaaf",
  "basketball_ncaab",
];

function sportLabel(key: string): string {
  const map: Record<string, string> = {
    baseball_mlb: "MLB", basketball_nba: "NBA", americanfootball_nfl: "NFL",
    icehockey_nhl: "NHL", americanfootball_ncaaf: "CFB", basketball_ncaab: "NCAAB",
    tennis_atp: "ATP", soccer_usa_mls: "MLS",
  };
  return map[key] ?? key.split("_").pop()!.toUpperCase();
}

function marketLabel(m: string): string {
  return m === "h2h" ? "ML" : m === "spreads" ? "SP" : "OU";
}

function fmtOdds(o: number): string { return o > 0 ? `+${o}` : `${o}`; }

interface DigestBet {
  sport: string; homeTeam: string; awayTeam: string;
  market: string; selection: string; bookmaker: string;
  americanOdds: number; evPercent: number; suggestedUnits: number; commenceTime: string;
}

async function getTopEvBets(limit = 10): Promise<DigestBet[]> {
  const { games } = await fetchMultiSportOdds(SPORTS, "h2h,spreads,totals");
  const bets: DigestBet[] = [];
  const cutoff = Date.now() - 10 * 60 * 1000;

  for (const game of games) {
    if (new Date(game.commence_time).getTime() < cutoff) continue;
    const pinnacle = extractPinnacleProbs(game.bookmakers as Parameters<typeof extractPinnacleProbs>[0]);

    for (const bookie of game.bookmakers) {
      if (bookie.key === "pinnacle") continue;
      for (const market of bookie.markets) {
        const outcomes = market.outcomes;
        if (outcomes.length !== 2) continue;

        for (const outcome of outcomes) {
          let noVigProb: number | undefined;

          if (market.key === "h2h") {
            noVigProb = pinnacle.h2h.get(outcome.name);
          } else if (market.key === "spreads" || market.key === "totals") {
            const store = market.key === "spreads" ? pinnacle.spreads : pinnacle.totals;
            const pinEntry = store.get(`${outcome.name}_${outcome.point}`);
            const other = outcomes.find((o) => o.name !== outcome.name);
            if (!pinEntry || !other) continue;
            const pinEntry2 = store.get(`${other.name}_${other.point}`);
            if (!pinEntry2) continue;
            const { p1 } = deVig2Way(
              americanToImpliedProb(pinEntry.odds),
              americanToImpliedProb(pinEntry2.odds),
            );
            noVigProb = p1;
          }

          if (!noVigProb) continue;
          const evPct = calcEVPercent(noVigProb, outcome.price);
          if (evPct >= 2.0) {
            bets.push({
              sport: game.sport_key,
              homeTeam: game.home_team,
              awayTeam: game.away_team,
              market: market.key,
              selection: market.key === "totals" ? `${outcome.name} ${outcome.point}` : outcome.name,
              bookmaker: bookie.title,
              americanOdds: outcome.price,
              evPercent: Math.round(evPct * 100) / 100,
              suggestedUnits: quarterKelly(noVigProb, outcome.price),
              commenceTime: game.commence_time,
            });
          }
        }
      }
    }
  }

  bets.sort((a, b) => b.evPercent - a.evPercent);
  const seen = new Set<string>();
  const result: DigestBet[] = [];
  for (const bet of bets) {
    const key = `${bet.sport}|${bet.homeTeam}|${bet.awayTeam}|${bet.market}|${bet.selection}`;
    if (!seen.has(key)) { seen.add(key); result.push(bet); }
  }
  return result.slice(0, limit);
}

function buildHtml(bets: DigestBet[], date: string): string {
  const betsHtml = bets.length === 0
    ? `<p style="text-align:center;color:#6b7280;padding:24px;">No +EV opportunities found right now.</p>`
    : bets.map((bet) => `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:700;background:#f3f4f6;color:#6b7280;padding:2px 6px;border-radius:4px;">${sportLabel(bet.sport)} · ${marketLabel(bet.market)}</span>
          <span style="font-size:18px;font-weight:700;color:#059669;">+${bet.evPercent.toFixed(1)}%</span>
        </div>
        <div style="font-size:14px;font-weight:600;margin-bottom:4px;">${bet.awayTeam} @ ${bet.homeTeam}</div>
        <div style="color:#374151;margin-bottom:4px;">${bet.selection} &nbsp;·&nbsp; <strong>${fmtOdds(bet.americanOdds)}</strong></div>
        <div style="font-size:12px;color:#6b7280;">${bet.bookmaker} · Bet ${bet.suggestedUnits.toFixed(2)}u · ${new Date(bet.commenceTime).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
      </div>`).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#f9fafb;font-family:-apple-system,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
    <div style="background:#111827;padding:22px 24px;">
      <div style="font-size:20px;font-weight:700;color:white;">&#9889; +EV Daily Digest</div>
      <div style="font-size:13px;color:#9ca3af;margin-top:4px;">${date} · ${bets.length} opportunit${bets.length !== 1 ? "ies" : "y"} found</div>
    </div>
    <div style="padding:18px 20px;">${betsHtml}</div>
    <div style="padding:14px;text-align:center;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;">
      EV Sports Tracker · <a href="https://sports-tracker.replit.app" style="color:#6b7280;text-decoration:none;">sports-tracker.replit.app</a>
    </div>
  </div>
</body>
</html>`;
}

router.post("/digest/send", async (req, res): Promise<void> => {
  const to = (req.body?.to as string | undefined)?.trim();
  if (!to) { res.status(400).json({ error: "Email address is required." }); return; }

  try {
    const bets = await getTopEvBets(10);
    const date = new Date().toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });

    const html = buildHtml(bets, date);
    const subject = `+EV Digest — ${bets.length} opportunit${bets.length !== 1 ? "ies" : "y"} · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    const raw = Buffer.from(
      ["MIME-Version: 1.0", `To: ${to}`, `Subject: ${subject}`, "Content-Type: text/html; charset=UTF-8", "", html].join("\r\n")
    ).toString("base64url");

    const connectors = new ReplitConnectors();
    const sendRes = await connectors.proxy("google-mail", "/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });

    if (!sendRes.ok) {
      const text = await sendRes.text();
      logger.error({ status: sendRes.status, text }, "Gmail send failed");
      throw new Error(`Gmail send failed (${sendRes.status})`);
    }

    logger.info({ to, betCount: bets.length }, "Digest email sent");
    res.json({ sent: true, betCount: bets.length, to });
  } catch (err) {
    logger.error({ err }, "Digest send failed");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
