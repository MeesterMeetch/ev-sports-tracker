import { Router } from "express";
import type { IRouter } from "express";
import { fetchSports, fetchMultiSportOdds, fetchOdds } from "../lib/odds";
import { fetchTodayStarters } from "../lib/starters";
import {
  americanToImpliedProb,
  deVig2Way,
  calcEVPercent,
  quarterKelly,
  breakEvenOddsForEV,
  extractPinnacleProbs,
} from "../lib/ev-math";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ACTIVE_SPORTS = [
  "americanfootball_nfl",
  "americanfootball_ncaaf",
  "basketball_nba",
  "basketball_ncaab",
  "baseball_mlb",
  "icehockey_nhl",
  "tennis_atp",
  "golf_pga_championship",
  "soccer_usa_mls",
];

router.get("/odds/sports", async (req, res): Promise<void> => {
  try {
    const { data } = await fetchSports();
    const filtered = data
      .filter((s) => s.active && ACTIVE_SPORTS.some((k) => s.key.startsWith(k.split("_")[0])))
      .map((s) => ({
        key: s.key,
        title: s.title,
        active: s.active,
        hasOdds: !s.has_outrights,
      }));
    res.json(filtered);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch sports");
    res.status(500).json({ error: "Failed to fetch sports" });
  }
});

router.get("/odds/games", async (req, res): Promise<void> => {
  const sport = typeof req.query.sport === "string" ? req.query.sport : "";
  const markets = typeof req.query.markets === "string" ? req.query.markets : "h2h,spreads,totals";

  try {
    let games;
    if (sport) {
      const result = await fetchOdds(sport, markets);
      games = result.data;
    } else {
      const todaySports = ["americanfootball_nfl", "baseball_mlb", "basketball_nba", "icehockey_nhl"];
      const result = await fetchMultiSportOdds(todaySports, markets);
      games = result.games;
    }

    const cutoff = Date.now() - 10 * 60 * 1000;
    const response = games.filter((g) => new Date(g.commence_time).getTime() >= cutoff).map((g) => ({
      id: g.id,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      sport: g.sport_key,
      commenceTime: g.commence_time,
      bookmakers: g.bookmakers.map((b) => ({
        key: b.key,
        title: b.title,
        markets: b.markets.map((m) => ({
          key: m.key,
          outcomes: m.outcomes.map((o) => ({
            name: o.name,
            price: o.price,
            point: o.point ?? null,
          })),
        })),
      })),
    }));

    res.json(response);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch games");
    res.status(500).json({ error: "Failed to fetch games" });
  }
});

router.get("/odds/ev-card", async (req, res): Promise<void> => {
  const sport = typeof req.query.sport === "string" ? req.query.sport : "";
  const minEv = req.query.minEv ? parseFloat(req.query.minEv as string) : 2.0;

  try {
    const sportsToScan = sport
      ? [sport]
      : ["americanfootball_nfl", "baseball_mlb", "basketball_nba", "icehockey_nhl", "americanfootball_ncaaf", "basketball_ncaab"];

    const { games, requestsRemaining } = await fetchMultiSportOdds(sportsToScan, "h2h,spreads,totals");

    const evBets = [];
    const nearMisses = [];
    const cutoff = Date.now() - 10 * 60 * 1000;

    for (const game of games) {
      if (new Date(game.commence_time).getTime() < cutoff) continue;
      const pinnacle = extractPinnacleProbs(game.bookmakers as any);

      for (const bookie of game.bookmakers) {
        if (bookie.key === "pinnacle") continue;

        for (const market of bookie.markets) {
          const outcomes = market.outcomes;

          if (market.key === "h2h" && outcomes.length === 2) {
            for (const outcome of outcomes) {
              const noVigProb = pinnacle.h2h.get(outcome.name);
              if (!noVigProb) continue;

              const evPct = calcEVPercent(noVigProb, outcome.price);
              const pinOdds = game.bookmakers
                .find((b) => b.key === "pinnacle")
                ?.markets.find((m) => m.key === "h2h")
                ?.outcomes.find((o) => o.name === outcome.name)?.price ?? null;

              const bet = {
                gameId: game.id,
                homeTeam: game.home_team,
                awayTeam: game.away_team,
                sport: game.sport_key,
                market: "h2h",
                selection: outcome.name,
                point: null as number | null,
                bookmaker: bookie.title,
                americanOdds: outcome.price,
                noVigProb,
                estimatedProb: noVigProb,
                evPercent: Math.round(evPct * 100) / 100,
                kellyFraction: quarterKelly(noVigProb, outcome.price),
                suggestedUnits: quarterKelly(noVigProb, outcome.price),
                commenceTime: game.commence_time,
                pinnacleOdds: pinOdds,
                confidence: Math.min(5, Math.max(1, Math.round(evPct / 1.5))) as number | null,
                lineAgeMinutes: Math.floor((Date.now() - new Date(bookie.last_update).getTime()) / 60000),
              };

              if (evPct >= minEv) {
                evBets.push(bet);
              } else if (evPct > 0) {
                nearMisses.push({
                  ...bet,
                  breakEvenOdds: breakEvenOddsForEV(noVigProb, minEv),
                });
              }
            }
          } else if (market.key === "spreads" && outcomes.length === 2) {
            for (const outcome of outcomes) {
              const key = `${outcome.name}_${outcome.point}`;
              const pinEntry = pinnacle.spreads.get(key);
              if (!pinEntry) continue;

              const pinOtherOdds = outcomes.find((o) => o.name !== outcome.name);
              if (!pinOtherOdds) continue;

              const pinKey2 = `${pinOtherOdds.name}_${pinOtherOdds.point}`;
              const pinEntry2 = pinnacle.spreads.get(pinKey2);
              if (!pinEntry2) continue;

              const p1 = americanToImpliedProb(pinEntry.odds);
              const p2 = americanToImpliedProb(pinEntry2.odds);
              const { p1: nv } = deVig2Way(p1, p2);

              const evPct = calcEVPercent(nv, outcome.price);
              const bet = {
                gameId: game.id,
                homeTeam: game.home_team,
                awayTeam: game.away_team,
                sport: game.sport_key,
                market: "spreads",
                selection: outcome.name,
                point: outcome.point ?? null,
                bookmaker: bookie.title,
                americanOdds: outcome.price,
                noVigProb: nv,
                estimatedProb: nv,
                evPercent: Math.round(evPct * 100) / 100,
                kellyFraction: quarterKelly(nv, outcome.price),
                suggestedUnits: quarterKelly(nv, outcome.price),
                commenceTime: game.commence_time,
                pinnacleOdds: pinEntry.odds,
                confidence: Math.min(5, Math.max(1, Math.round(evPct / 1.5))) as number | null,
                lineAgeMinutes: Math.floor((Date.now() - new Date(bookie.last_update).getTime()) / 60000),
              };

              if (evPct >= minEv) {
                evBets.push(bet);
              } else if (evPct > 0) {
                nearMisses.push({
                  ...bet,
                  breakEvenOdds: breakEvenOddsForEV(nv, minEv),
                });
              }
            }
          } else if (market.key === "totals" && outcomes.length === 2) {
            for (const outcome of outcomes) {
              const key = `${outcome.name}_${outcome.point}`;
              const pinEntry = pinnacle.totals.get(key);
              if (!pinEntry) continue;

              const other = outcomes.find((o) => o.name !== outcome.name);
              if (!other) continue;

              const pinKey2 = `${other.name}_${other.point}`;
              const pinEntry2 = pinnacle.totals.get(pinKey2);
              if (!pinEntry2) continue;

              const p1 = americanToImpliedProb(pinEntry.odds);
              const p2 = americanToImpliedProb(pinEntry2.odds);
              const { p1: nv } = deVig2Way(p1, p2);

              const evPct = calcEVPercent(nv, outcome.price);
              const bet = {
                gameId: game.id,
                homeTeam: game.home_team,
                awayTeam: game.away_team,
                sport: game.sport_key,
                market: "totals",
                selection: `${outcome.name} ${outcome.point}`,
                point: outcome.point ?? null,
                bookmaker: bookie.title,
                americanOdds: outcome.price,
                noVigProb: nv,
                estimatedProb: nv,
                evPercent: Math.round(evPct * 100) / 100,
                kellyFraction: quarterKelly(nv, outcome.price),
                suggestedUnits: quarterKelly(nv, outcome.price),
                commenceTime: game.commence_time,
                pinnacleOdds: pinEntry.odds,
                confidence: Math.min(5, Math.max(1, Math.round(evPct / 1.5))) as number | null,
                lineAgeMinutes: Math.floor((Date.now() - new Date(bookie.last_update).getTime()) / 60000),
              };

              if (evPct >= minEv) {
                evBets.push(bet);
              } else if (evPct > 0) {
                nearMisses.push({
                  ...bet,
                  breakEvenOdds: breakEvenOddsForEV(nv, minEv),
                });
              }
            }
          }
        }
      }
    }

    evBets.sort((a, b) => b.evPercent - a.evPercent);
    nearMisses.sort((a, b) => b.evPercent - a.evPercent);

    res.json({
      date: new Date().toISOString().split("T")[0],
      bets: evBets,
      nearMisses: nearMisses.slice(0, 10),
      hasBets: evBets.length > 0,
      requestsRemaining,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compute EV card");
    res.status(500).json({ error: "Failed to compute EV card" });
  }
});

router.get("/odds/near-misses", async (req, res): Promise<void> => {
  const sport = typeof req.query.sport === "string" ? req.query.sport : "";
  const minEv = 2.0;

  try {
    const sportsToScan = sport
      ? [sport]
      : ["americanfootball_nfl", "baseball_mlb", "basketball_nba", "icehockey_nhl"];

    const { games } = await fetchMultiSportOdds(sportsToScan, "h2h");
    const nearMisses = [];
    const cutoff = Date.now() - 10 * 60 * 1000;

    for (const game of games) {
      if (new Date(game.commence_time).getTime() < cutoff) continue;
      const pinnacle = extractPinnacleProbs(game.bookmakers as any);

      for (const bookie of game.bookmakers) {
        if (bookie.key === "pinnacle") continue;
        for (const market of bookie.markets) {
          if (market.key !== "h2h" || market.outcomes.length !== 2) continue;
          for (const outcome of market.outcomes) {
            const noVigProb = pinnacle.h2h.get(outcome.name);
            if (!noVigProb) continue;
            const evPct = calcEVPercent(noVigProb, outcome.price);
            if (evPct > 0 && evPct < minEv) {
              nearMisses.push({
                gameId: game.id,
                homeTeam: game.home_team,
                awayTeam: game.away_team,
                sport: game.sport_key,
                market: "h2h",
                selection: outcome.name,
                point: null,
                bookmaker: bookie.title,
                americanOdds: outcome.price,
                evPercent: Math.round(evPct * 100) / 100,
                breakEvenOdds: breakEvenOddsForEV(noVigProb, minEv),
                commenceTime: game.commence_time,
              });
            }
          }
        }
      }
    }

    nearMisses.sort((a, b) => b.evPercent - a.evPercent);
    res.json(nearMisses.slice(0, 3));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch near misses");
    res.status(500).json({ error: "Failed to fetch near misses" });
  }
});

router.get("/odds/starters", async (_req, res): Promise<void> => {
  try {
    const starters = await fetchTodayStarters();
    res.json(starters);
  } catch (err) {
    _req.log.error({ err }, "Failed to fetch starters");
    res.status(500).json({ error: "Failed to fetch starters" });
  }
});

export default router;
