import { describe, it, expect } from "vitest";
import {
  americanToDecimal,
  americanToImpliedProb,
  deVig2Way,
  calcEV,
  calcEVPercent,
  quarterKelly,
  breakEvenOddsForEV,
  extractSharpLineProbs,
  findNearestSharpEntry,
} from "./ev-math";

// ---------------------------------------------------------------------------
// Primitive math helpers
// ---------------------------------------------------------------------------

describe("americanToDecimal", () => {
  it("converts positive american odds", () => {
    expect(americanToDecimal(100)).toBeCloseTo(2.0);
    expect(americanToDecimal(200)).toBeCloseTo(3.0);
  });
  it("converts negative american odds", () => {
    expect(americanToDecimal(-110)).toBeCloseTo(1.909, 2);
    expect(americanToDecimal(-200)).toBeCloseTo(1.5);
  });
});

describe("deVig2Way", () => {
  it("removes vig from a balanced market", () => {
    const p1 = americanToImpliedProb(-110);
    const p2 = americanToImpliedProb(-110);
    const { p1: nv1, p2: nv2 } = deVig2Way(p1, p2);
    expect(nv1).toBeCloseTo(0.5, 5);
    expect(nv2).toBeCloseTo(0.5, 5);
    expect(nv1 + nv2).toBeCloseTo(1.0, 10);
  });
  it("handles asymmetric markets", () => {
    const p1 = americanToImpliedProb(-150);
    const p2 = americanToImpliedProb(130);
    const { p1: nv1, p2: nv2 } = deVig2Way(p1, p2);
    expect(nv1 + nv2).toBeCloseTo(1.0, 10);
    expect(nv1).toBeGreaterThan(nv2);
  });
});

describe("calcEV / calcEVPercent", () => {
  it("returns positive EV for a mispriced favourite", () => {
    const noVigProb = 0.55;
    const ev = calcEV(noVigProb, -100);
    expect(ev).toBeGreaterThan(0);
    expect(calcEVPercent(noVigProb, -100)).toBeCloseTo(ev * 100, 5);
  });
  it("returns negative EV when the price is worse than no-vig", () => {
    const ev = calcEV(0.4, -150);
    expect(ev).toBeLessThan(0);
  });
});

describe("quarterKelly", () => {
  it("returns zero for a negative-EV bet", () => {
    expect(quarterKelly(0.3, -150)).toBe(0);
  });
  it("returns a small positive number for a clear +EV bet", () => {
    const qk = quarterKelly(0.55, -100);
    expect(qk).toBeGreaterThan(0);
  });
});

describe("breakEvenOddsForEV", () => {
  it("returns a higher price when a positive targetEvPct is requested", () => {
    const be = breakEvenOddsForEV(0.5, 2);
    expect(be).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// extractSharpLineProbs – the main focus of this test suite
// ---------------------------------------------------------------------------

type Bookmaker = {
  key: string;
  title: string;
  last_update: string;
  markets: Array<{
    key: string;
    outcomes: Array<{ name: string; price: number; point?: number }>;
  }>;
};

function makeH2HBook(
  key: string,
  title: string,
  team1: string,
  price1: number,
  team2: string,
  price2: number,
): Bookmaker {
  return {
    key,
    title,
    last_update: new Date().toISOString(),
    markets: [
      {
        key: "h2h",
        outcomes: [
          { name: team1, price: price1 },
          { name: team2, price: price2 },
        ],
      },
    ],
  };
}

function makeSpreadBook(
  key: string,
  title: string,
  team1: string,
  point1: number,
  price1: number,
  team2: string,
  point2: number,
  price2: number,
): Bookmaker {
  return {
    key,
    title,
    last_update: new Date().toISOString(),
    markets: [
      {
        key: "spreads",
        outcomes: [
          { name: team1, price: price1, point: point1 },
          { name: team2, price: price2, point: point2 },
        ],
      },
    ],
  };
}

describe("extractSharpLineProbs – h2h source cascade", () => {
  it("uses LowVig when present", () => {
    const books: Bookmaker[] = [
      makeH2HBook("lowvig", "LowVig", "TeamA", -110, "TeamB", -110),
      makeH2HBook("draftkings", "DraftKings", "TeamA", -115, "TeamB", -105),
    ];

    const sharp = extractSharpLineProbs(books);

    expect(sharp.h2hSource.key).toBe("lowvig");
    expect(sharp.h2hSource.label).toBe("LowVig");

    const pA = sharp.h2h.get("TeamA");
    const pB = sharp.h2h.get("TeamB");
    expect(pA).toBeDefined();
    expect(pB).toBeDefined();
    expect(pA! + pB!).toBeCloseTo(1.0, 10);
    expect(pA!).toBeCloseTo(0.5, 5);
  });

  it("falls back to BetOnline when LowVig is absent", () => {
    const books: Bookmaker[] = [
      makeH2HBook("betonlineag", "BetOnline", "TeamA", -115, "TeamB", -105),
      makeH2HBook("draftkings", "DraftKings", "TeamA", -120, "TeamB", +100),
    ];

    const sharp = extractSharpLineProbs(books);

    expect(sharp.h2hSource.key).toBe("betonlineag");
    expect(sharp.h2hSource.label).toBe("BetOnline");

    const pA = sharp.h2h.get("TeamA");
    const pB = sharp.h2h.get("TeamB");
    expect(pA! + pB!).toBeCloseTo(1.0, 10);
    expect(pA!).toBeGreaterThan(pB!);
  });

  it("falls back to consensus when no sharp book is present", () => {
    const books: Bookmaker[] = [
      makeH2HBook("draftkings", "DraftKings", "TeamA", -130, "TeamB", +110),
      makeH2HBook("fanduel", "FanDuel", "TeamA", -125, "TeamB", +105),
      makeH2HBook("betmgm", "BetMGM", "TeamA", -120, "TeamB", +100),
    ];

    const sharp = extractSharpLineProbs(books);

    expect(sharp.h2hSource.key).toBeNull();
    expect(sharp.h2hSource.label).toBe("Consensus");

    const pA = sharp.h2h.get("TeamA");
    const pB = sharp.h2h.get("TeamB");
    expect(pA).toBeDefined();
    expect(pB).toBeDefined();
    expect(pA! + pB!).toBeCloseTo(1.0, 8);
    expect(pA!).toBeGreaterThan(pB!);
  });

  it("uses an empty Map when no bookmakers have h2h data", () => {
    const sharp = extractSharpLineProbs([]);

    expect(sharp.h2h.size).toBe(0);
    expect(sharp.h2hSource.key).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findNearestSharpEntry
// ---------------------------------------------------------------------------

describe("findNearestSharpEntry", () => {
  function makeMap(
    entries: Array<{ name: string; point: number; odds: number }>,
  ): Map<string, { odds: number; point: number }> {
    const m = new Map<string, { odds: number; point: number }>();
    for (const e of entries) {
      m.set(`${e.name}_${e.point}`, { odds: e.odds, point: e.point });
    }
    return m;
  }

  it("returns the exact entry with pointDiff 0 when the key matches exactly", () => {
    const map = makeMap([
      { name: "TeamA", point: -3.5, odds: -110 },
      { name: "TeamB", point: 3.5, odds: -110 },
    ]);

    const result = findNearestSharpEntry(map, "TeamA", -3.5);

    expect(result).not.toBeNull();
    expect(result!.pointDiff).toBe(0);
    expect(result!.entry.odds).toBe(-110);
    expect(result!.entry.point).toBe(-3.5);
  });

  it("falls back to the nearest-point entry and returns the correct pointDiff", () => {
    const map = makeMap([
      { name: "TeamA", point: -3.5, odds: -108 },
      { name: "TeamB", point: 3.5, odds: -112 },
    ]);

    // Retail is at -4; sharp is at -3.5 → diff = 0.5
    const result = findNearestSharpEntry(map, "TeamA", -4);

    expect(result).not.toBeNull();
    expect(result!.pointDiff).toBeCloseTo(0.5);
    expect(result!.entry.point).toBe(-3.5);
    expect(result!.entry.odds).toBe(-108);
  });

  it("picks the closest entry when multiple sharp points are available for the same team", () => {
    const map = makeMap([
      { name: "TeamA", point: -2.5, odds: -105 },
      { name: "TeamA", point: -3.5, odds: -110 },
      { name: "TeamA", point: -4.5, odds: -115 },
    ]);

    // Retail at -4 is equidistant between -3.5 and -4.5; either is acceptable,
    // but the function must pick one deterministically and report diff ≤ 0.5.
    const result = findNearestSharpEntry(map, "TeamA", -4);

    expect(result).not.toBeNull();
    expect(result!.pointDiff).toBeCloseTo(0.5);
  });

  it("returns null when no entry exists for the requested team name", () => {
    const map = makeMap([
      { name: "TeamA", point: -3.5, odds: -110 },
    ]);

    const result = findNearestSharpEntry(map, "TeamB", 3.5);

    expect(result).toBeNull();
  });

  it("returns null for an empty map", () => {
    const map = new Map<string, { odds: number; point: number }>();

    expect(findNearestSharpEntry(map, "TeamA", -3.5)).toBeNull();
  });

  it("handles totals-style entries (Over/Under at the same point)", () => {
    const map = makeMap([
      { name: "Over", point: 9.5, odds: -110 },
      { name: "Under", point: 9.5, odds: -110 },
    ]);

    const over = findNearestSharpEntry(map, "Over", 9.5);
    const under = findNearestSharpEntry(map, "Under", 9.5);

    expect(over).not.toBeNull();
    expect(over!.pointDiff).toBe(0);
    expect(under).not.toBeNull();
    expect(under!.pointDiff).toBe(0);
  });

  it("returns the fallback entry when the only sharp point differs by exactly 1.5", () => {
    const map = makeMap([
      { name: "Over", point: 9.5, odds: -110 },
      { name: "Under", point: 9.5, odds: -110 },
    ]);

    // Retail at 8 → diff from 9.5 is 1.5 — must still resolve (not return null)
    const result = findNearestSharpEntry(map, "Over", 8);

    expect(result).not.toBeNull();
    expect(result!.pointDiff).toBeCloseTo(1.5);
    expect(result!.entry.point).toBe(9.5);
  });
});

describe("extractSharpLineProbs – spreads / totals cascade", () => {
  it("picks LowVig for spreads when present", () => {
    const books: Bookmaker[] = [
      makeSpreadBook("lowvig", "LowVig", "TeamA", -3.5, -108, "TeamB", 3.5, -112),
      makeSpreadBook("draftkings", "DraftKings", "TeamA", -3.5, -110, "TeamB", 3.5, -110),
    ];

    const sharp = extractSharpLineProbs(books);

    expect(sharp.spreadsSource.key).toBe("lowvig");
    expect(sharp.spreads.size).toBeGreaterThan(0);
  });

  it("falls back to BetOnline for spreads when LowVig is absent", () => {
    const books: Bookmaker[] = [
      makeSpreadBook("betonlineag", "BetOnline", "TeamA", -3.5, -108, "TeamB", 3.5, -112),
      makeSpreadBook("draftkings", "DraftKings", "TeamA", -3.5, -110, "TeamB", 3.5, -110),
    ];

    const sharp = extractSharpLineProbs(books);

    expect(sharp.spreadsSource.key).toBe("betonlineag");
  });

  it("returns an empty spreads Map when no sharp book has spread data", () => {
    const books: Bookmaker[] = [
      makeH2HBook("draftkings", "DraftKings", "TeamA", -115, "TeamB", -105),
    ];

    const sharp = extractSharpLineProbs(books);

    expect(sharp.spreads.size).toBe(0);
    expect(sharp.spreadsSource.key).toBeNull();
  });
});
