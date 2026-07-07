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

export interface PinnacleLines {
  h2h: Map<string, number>;
  spreads: Map<string, { odds: number; point: number }>;
  totals: Map<string, { odds: number; point: number }>;
}

export function extractPinnacleProbs(bookmakers: Array<{ key: string; markets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point?: number }> }> }>): PinnacleLines {
  const pinnacle = bookmakers.find((b) => b.key === "pinnacle");
  const result: PinnacleLines = { h2h: new Map(), spreads: new Map(), totals: new Map() };
  if (!pinnacle) return result;

  for (const market of pinnacle.markets) {
    if (market.key === "h2h" && market.outcomes.length === 2) {
      const [o1, o2] = market.outcomes;
      const p1 = americanToImpliedProb(o1.price);
      const p2 = americanToImpliedProb(o2.price);
      const { p1: nv1, p2: nv2 } = deVig2Way(p1, p2);
      result.h2h.set(o1.name, nv1);
      result.h2h.set(o2.name, nv2);
    } else if (market.key === "spreads") {
      for (const o of market.outcomes) {
        result.spreads.set(`${o.name}_${o.point}`, { odds: o.price, point: o.point ?? 0 });
      }
    } else if (market.key === "totals") {
      for (const o of market.outcomes) {
        result.totals.set(`${o.name}_${o.point}`, { odds: o.price, point: o.point ?? 0 });
      }
    }
  }
  return result;
}
