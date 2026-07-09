export function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

export function decimalToImpliedProb(decimal: number): number {
  return 1 / decimal;
}

export function americanToImpliedProb(american: number): number {
  return decimalToImpliedProb(americanToDecimal(american));
}

export function deVig2Way(prob1: number, prob2: number): { p1: number; p2: number } {
  const total = prob1 + prob2;
  return { p1: prob1 / total, p2: prob2 / total };
}

export function calcEV(estimatedProb: number, americanOdds: number): number {
  const decimal = americanToDecimal(americanOdds);
  return estimatedProb * (decimal - 1) - (1 - estimatedProb);
}

export function calcEVPercent(estimatedProb: number, americanOdds: number): number {
  return calcEV(estimatedProb, americanOdds) * 100;
}

export function quarterKelly(estimatedProb: number, americanOdds: number): number {
  const decimal = americanToDecimal(americanOdds);
  const b = decimal - 1;
  const q = 1 - estimatedProb;
  const kelly = (estimatedProb * b - q) / b;
  const qk = Math.max(0, kelly * 0.25);
  return Math.round(qk * 10 * 100) / 100;
}

export function breakEvenOddsForEV(estimatedProb: number, targetEvPct: number): number {
  const targetEV = targetEvPct / 100;
  const decimal = (1 + targetEV) / estimatedProb;
  if (!isFinite(decimal) || decimal <= 1) return 0;
  if (decimal >= 2) {
    return Math.round((decimal - 1) * 100);
  } else {
    return Math.round(-100 / (decimal - 1));
  }
}

/**
 * Maximum acceptable point difference between a retail line and its nearest
 * sharp equivalent. Results with a larger pointDiff are unreliable and should
 * be skipped by the EV loop rather than used for probability estimation.
 */
export const MAX_POINT_DIFF = 1.5;

/**
 * Finds the sharp entry for a given team name and point.
 * Tries exact match first; falls back to the entry with the closest point
 * for the same team name when lines have moved between sharp and retail books.
 * Returns null if no entry exists for that team name at all.
 */
export function findNearestSharpEntry(
  map: Map<string, { odds: number; point: number }>,
  name: string,
  point: number,
): { entry: { odds: number; point: number }; pointDiff: number } | null {
  const exact = map.get(`${name}_${point}`);
  if (exact) return { entry: exact, pointDiff: 0 };

  const prefix = `${name}_`;
  let best: { odds: number; point: number } | null = null;
  let bestDist = Infinity;
  for (const [key, entry] of map) {
    if (!key.startsWith(prefix)) continue;
    const dist = Math.abs(entry.point - point);
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best ? { entry: best, pointDiff: bestDist } : null;
}

export interface MarketSource {
  key: string | null;
  label: string;
}

export interface SharpLines {
  h2h: Map<string, number>;
  spreads: Map<string, { odds: number; point: number }>;
  totals: Map<string, { odds: number; point: number }>;
  h2hSource: MarketSource;
  spreadsSource: MarketSource;
  totalsSource: MarketSource;
}

type Bookmaker = { key: string; markets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point?: number }> }> };

const SHARP_BOOKS: Array<{ key: string; label: string }> = [
  { key: "lowvig", label: "LowVig" },
  { key: "betonlineag", label: "BetOnline" },
];

function extractH2HFromBook(book: Bookmaker): Map<string, number> | null {
  const market = book.markets.find((m) => m.key === "h2h");
  if (!market || market.outcomes.length !== 2) return null;
  const [o1, o2] = market.outcomes;
  const p1 = americanToImpliedProb(o1.price);
  const p2 = americanToImpliedProb(o2.price);
  const { p1: nv1, p2: nv2 } = deVig2Way(p1, p2);
  const result = new Map<string, number>();
  result.set(o1.name, nv1);
  result.set(o2.name, nv2);
  return result;
}

function extractSpreadOrTotalFromBook(book: Bookmaker, marketKey: "spreads" | "totals"): Map<string, { odds: number; point: number }> | null {
  const market = book.markets.find((m) => m.key === marketKey);
  if (!market || market.outcomes.length === 0) return null;
  const result = new Map<string, { odds: number; point: number }>();
  for (const o of market.outcomes) {
    result.set(`${o.name}_${o.point}`, { odds: o.price, point: o.point ?? 0 });
  }
  return result.size > 0 ? result : null;
}

function buildConsensusH2H(bookmakers: Bookmaker[]): Map<string, number> {
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const book of bookmakers) {
    const h2hMarket = book.markets.find((m) => m.key === "h2h");
    if (!h2hMarket || h2hMarket.outcomes.length !== 2) continue;
    const [o1, o2] = h2hMarket.outcomes;
    const p1 = americanToImpliedProb(o1.price);
    const p2 = americanToImpliedProb(o2.price);
    sums.set(o1.name, (sums.get(o1.name) ?? 0) + p1);
    sums.set(o2.name, (sums.get(o2.name) ?? 0) + p2);
    counts.set(o1.name, (counts.get(o1.name) ?? 0) + 1);
    counts.set(o2.name, (counts.get(o2.name) ?? 0) + 1);
  }
  const avgProbs = new Map<string, number>();
  for (const [name, sum] of sums) {
    const count = counts.get(name) ?? 1;
    avgProbs.set(name, sum / count);
  }
  const names = Array.from(avgProbs.keys());
  if (names.length === 2) {
    const p1 = avgProbs.get(names[0])!;
    const p2 = avgProbs.get(names[1])!;
    const { p1: nv1, p2: nv2 } = deVig2Way(p1, p2);
    avgProbs.set(names[0], nv1);
    avgProbs.set(names[1], nv2);
  }
  return avgProbs;
}

export function extractSharpLineProbs(bookmakers: Bookmaker[]): SharpLines {
  let h2h = new Map<string, number>();
  let h2hSource: MarketSource = { key: null, label: "Consensus" };

  for (const { key, label } of SHARP_BOOKS) {
    const book = bookmakers.find((b) => b.key === key);
    if (!book) continue;
    const lines = extractH2HFromBook(book);
    if (lines && lines.size > 0) {
      h2h = lines;
      h2hSource = { key, label };
      break;
    }
  }
  if (h2hSource.key === null) {
    h2h = buildConsensusH2H(bookmakers);
  }

  let spreads = new Map<string, { odds: number; point: number }>();
  let spreadsSource: MarketSource = { key: null, label: "" };
  for (const { key, label } of SHARP_BOOKS) {
    const book = bookmakers.find((b) => b.key === key);
    if (!book) continue;
    const lines = extractSpreadOrTotalFromBook(book, "spreads");
    if (lines) {
      spreads = lines;
      spreadsSource = { key, label };
      break;
    }
  }

  let totals = new Map<string, { odds: number; point: number }>();
  let totalsSource: MarketSource = { key: null, label: "" };
  for (const { key, label } of SHARP_BOOKS) {
    const book = bookmakers.find((b) => b.key === key);
    if (!book) continue;
    const lines = extractSpreadOrTotalFromBook(book, "totals");
    if (lines) {
      totals = lines;
      totalsSource = { key, label };
      break;
    }
  }

  return { h2h, spreads, totals, h2hSource, spreadsSource, totalsSource };
}
