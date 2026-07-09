import { americanToDecimal } from "./ev-math";
import type { OddsGame } from "./odds";

/**
 * Price-based CLV: how much better your price was than the closing price on
 * the same line at the same book. Positive means you beat the close.
 * Using the decimal-odds ratio keeps the measure vig-neutral enough for
 * same-book comparisons without needing the other side's closing price.
 */
export function calcClvPercent(betOdds: number, closingOdds: number): number {
  const clv = americanToDecimal(betOdds) / americanToDecimal(closingOdds) - 1;
  return Math.round(clv * 10000) / 100;
}

/** "FanDuel" -> "fanduel", "BetMGM " -> "betmgm" — tolerant title matching. */
export function normalizeBookTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * EV-card totals selections are stored as "Over 9.5"; the API outcome name is
 * just "Over". Strips a trailing numeric token for totals only.
 */
export function baseSelection(market: string, selection: string): string {
  if (market !== "totals") return selection;
  return selection.replace(/\s+-?\d+(\.\d+)?$/, "");
}

export interface BetForCapture {
  market: string;
  selection: string;
  point: number | null;
  bookmaker: string;
}

/**
 * Finds the closing price for a bet inside a fetched event: same bookmaker,
 * same market, same outcome, and the exact same point. If the line has moved
 * off the bet's point, returns null — pricing CLV across different lines
 * isn't apples to apples, and manual entry remains available.
 */
export function findClosingOdds(game: OddsGame, bet: BetForCapture): number | null {
  const wantedBook = normalizeBookTitle(bet.bookmaker);
  const wantedName = baseSelection(bet.market, bet.selection);

  for (const book of game.bookmakers) {
    if (normalizeBookTitle(book.title) !== wantedBook && normalizeBookTitle(book.key) !== wantedBook) continue;
    const market = book.markets.find((m) => m.key === bet.market);
    if (!market) continue;
    for (const outcome of market.outcomes) {
      if (outcome.name !== wantedName) continue;
      if (bet.point != null && outcome.point !== bet.point) continue;
      return outcome.price;
    }
  }
  return null;
}

