import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db, betsTable } from "@workspace/db";
import { fetchEventOdds, type OddsGame } from "./odds";
import { calcClvPercent, findClosingOdds } from "./clv-math";
import { logger } from "./logger";

/**
 * How close to commence time a pending bet becomes eligible for closing-line
 * capture, and how long after start we keep trying (lines shortly after tip
 * are an acceptable proxy if a fetch was missed).
 */
const CAPTURE_BEFORE_MS = 15 * 60 * 1000;
const CAPTURE_AFTER_MS = 30 * 60 * 1000;

/** Hard cap on single-event fetches per capture run. */
const MAX_EVENTS_PER_RUN = 10;

/** Stop capturing when the Odds API quota drops below this floor. */
const MIN_REQUESTS_REMAINING = 100;

let captureRunning = false;

/**
 * Finds pending bets near commence time that don't have a closing line yet,
 * fetches the single event from The Odds API, and writes closingOdds and
 * clvPercent. Fetches are deduped per (sport, game) with only the needed
 * markets requested, so quota cost stays minimal.
 */
export async function captureClosingLines(): Promise<void> {
  if (captureRunning) return;
  captureRunning = true;
  try {
    // commenceTime is stored as an ISO-8601 string, so lexicographic
    // comparison in SQL matches chronological order. Bound the window in the
    // query itself so this never scans the whole bets table.
    const now = Date.now();
    const earliestStart = new Date(now - CAPTURE_AFTER_MS).toISOString();
    const latestStart = new Date(now + CAPTURE_BEFORE_MS).toISOString();
    const due = await db
      .select()
      .from(betsTable)
      .where(
        and(
          eq(betsTable.status, "pending"),
          isNull(betsTable.closingOdds),
          gte(betsTable.commenceTime, earliestStart),
          lte(betsTable.commenceTime, latestStart),
        ),
      );
    if (due.length === 0) return;

    const groups = new Map<string, { sport: string; gameId: string; markets: Set<string>; bets: typeof due }>();
    for (const bet of due) {
      const key = `${bet.sport}|${bet.gameId}`;
      if (!groups.has(key)) groups.set(key, { sport: bet.sport, gameId: bet.gameId, markets: new Set(), bets: [] });
      const g = groups.get(key)!;
      g.markets.add(bet.market);
      g.bets.push(bet);
    }

    let eventsFetched = 0;
    for (const group of groups.values()) {
      if (eventsFetched >= MAX_EVENTS_PER_RUN) {
        logger.warn(
          { cap: MAX_EVENTS_PER_RUN, remainingGroups: groups.size - eventsFetched },
          "clv-capture: per-run event cap reached, deferring rest to next run",
        );
        break;
      }
      let game: OddsGame;
      let requestsRemaining: number | null;
      try {
        const result = await fetchEventOdds(group.sport, group.gameId, Array.from(group.markets).join(","));
        game = result.data;
        requestsRemaining = result.requestsRemaining;
        eventsFetched++;
      } catch (err) {
        logger.warn({ err, gameId: group.gameId, sport: group.sport }, "clv-capture: failed to fetch event odds");
        continue;
      }

      for (const bet of group.bets) {
        const closing = findClosingOdds(game, {
          market: bet.market,
          selection: bet.selection,
          point: bet.point != null ? parseFloat(bet.point) : null,
          bookmaker: bet.bookmaker,
        });
        if (closing == null) {
          logger.info(
            { betId: bet.id, selection: bet.selection, bookmaker: bet.bookmaker },
            "clv-capture: no matching closing line (book missing or line moved off point)",
          );
          continue;
        }
        const clv = calcClvPercent(parseFloat(bet.americanOdds), closing);
        await db
          .update(betsTable)
          .set({ closingOdds: closing, clvPercent: String(clv) })
          .where(eq(betsTable.id, bet.id));
        logger.info({ betId: bet.id, closing, clv }, "clv-capture: closing line recorded");
      }

      if (requestsRemaining != null && requestsRemaining < MIN_REQUESTS_REMAINING) {
        logger.warn(
          { requestsRemaining, floor: MIN_REQUESTS_REMAINING },
          "clv-capture: quota below floor, stopping this run",
        );
        break;
      }
    }
  } catch (err) {
    logger.error({ err }, "clv-capture: run failed");
  } finally {
    captureRunning = false;
  }
}

const CAPTURE_INTERVAL_MS = 5 * 60 * 1000;

export function startClvCapture(): void {
  if (!process.env.ODDS_API_KEY_V2 && !process.env.ODDS_API_KEY) {
    logger.warn("clv-capture: ODDS_API_KEY not set, auto capture disabled");
    return;
  }
  setInterval(() => void captureClosingLines(), CAPTURE_INTERVAL_MS);
  setTimeout(() => void captureClosingLines(), 15 * 1000);
  logger.info({ intervalMinutes: 5 }, "clv-capture: scheduler started");
}
