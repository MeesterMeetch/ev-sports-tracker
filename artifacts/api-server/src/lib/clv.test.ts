import { describe, it, expect } from "vitest";
import { calcClvPercent, normalizeBookTitle, baseSelection, findClosingOdds } from "./clv-math";
import type { OddsGame } from "./odds";

describe("calcClvPercent", () => {
  it("is positive when you beat the close", () => {
    // Bet Over at -102, closed -128: you got a much better price.
    expect(calcClvPercent(-102, -128)).toBeGreaterThan(0);
  });

  it("is negative when the line moved against you", () => {
    expect(calcClvPercent(-128, -102)).toBeLessThan(0);
  });

  it("is zero when price is unchanged", () => {
    expect(calcClvPercent(-110, -110)).toBe(0);
  });

  it("handles positive American odds", () => {
    // Bet +120, closed +100: 2.20/2.00 - 1 = 10%
    expect(calcClvPercent(120, 100)).toBeCloseTo(10, 1);
  });
});

describe("normalizeBookTitle", () => {
  it("normalizes casing, spaces, and punctuation", () => {
    expect(normalizeBookTitle("FanDuel")).toBe("fanduel");
    expect(normalizeBookTitle("BetMGM ")).toBe("betmgm");
    expect(normalizeBookTitle("Caesars Sportsbook")).toBe("caesarssportsbook");
  });
});

describe("baseSelection", () => {
  it("strips the trailing point from totals selections", () => {
    expect(baseSelection("totals", "Over 9.5")).toBe("Over");
    expect(baseSelection("totals", "Under 47")).toBe("Under");
  });

  it("leaves h2h and spread selections untouched", () => {
    expect(baseSelection("h2h", "Cincinnati Reds")).toBe("Cincinnati Reds");
    expect(baseSelection("spreads", "TeamA")).toBe("TeamA");
  });
});

describe("findClosingOdds", () => {
  const game: OddsGame = {
    id: "g1",
    sport_key: "baseball_mlb",
    sport_title: "MLB",
    commence_time: new Date().toISOString(),
    home_team: "TeamA",
    away_team: "TeamB",
    bookmakers: [
      {
        key: "fanduel",
        title: "FanDuel",
        last_update: new Date().toISOString(),
        markets: [
          {
            key: "totals",
            outcomes: [
              { name: "Over", price: -128, point: 9.5 },
              { name: "Under", price: 106, point: 9.5 },
            ],
          },
          {
            key: "h2h",
            outcomes: [
              { name: "TeamA", price: -140 },
              { name: "TeamB", price: 118 },
            ],
          },
        ],
      },
    ],
  };

  it("matches book, market, selection, and exact point", () => {
    expect(
      findClosingOdds(game, { market: "totals", selection: "Over 9.5", point: 9.5, bookmaker: "FanDuel" }),
    ).toBe(-128);
  });

  it("matches h2h by team name with no point", () => {
    expect(
      findClosingOdds(game, { market: "h2h", selection: "TeamB", point: null, bookmaker: "FanDuel" }),
    ).toBe(118);
  });

  it("returns null when the line moved off the bet's point", () => {
    expect(
      findClosingOdds(game, { market: "totals", selection: "Over 10", point: 10, bookmaker: "FanDuel" }),
    ).toBeNull();
  });

  it("returns null when the bookmaker is absent at close", () => {
    expect(
      findClosingOdds(game, { market: "totals", selection: "Over 9.5", point: 9.5, bookmaker: "DraftKings" }),
    ).toBeNull();
  });
});
