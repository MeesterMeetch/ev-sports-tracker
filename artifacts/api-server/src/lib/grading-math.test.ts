import { describe, it, expect } from "vitest";
import { gradeBet, calcPnl } from "./grading-math";
import type { ScoresGame } from "./odds";

const makeGame = (home: number, away: number, completed = true): ScoresGame => ({
  id: "g1",
  sport_key: "baseball_mlb",
  commence_time: new Date().toISOString(),
  completed,
  home_team: "TeamA",
  away_team: "TeamB",
  scores: [
    { name: "TeamA", score: String(home) },
    { name: "TeamB", score: String(away) },
  ],
});

const bet = (overrides: Partial<Parameters<typeof gradeBet>[0]>) => ({
  market: "h2h",
  selection: "TeamA",
  point: null,
  homeTeam: "TeamA",
  awayTeam: "TeamB",
  ...overrides,
});

describe("gradeBet h2h", () => {
  it("grades winner and loser", () => {
    expect(gradeBet(bet({}), makeGame(5, 3))).toBe("won");
    expect(gradeBet(bet({ selection: "TeamB" }), makeGame(5, 3))).toBe("lost");
  });

  it("pushes on a tie", () => {
    expect(gradeBet(bet({}), makeGame(3, 3))).toBe("push");
  });

  it("returns null when selection matches neither team", () => {
    expect(gradeBet(bet({ selection: "TeamC" }), makeGame(5, 3))).toBeNull();
  });
});

describe("gradeBet spreads", () => {
  it("covers, fails to cover, and pushes on the number", () => {
    const g = makeGame(24, 20);
    expect(gradeBet(bet({ market: "spreads", selection: "TeamB", point: 6.5 }), g)).toBe("won");
    expect(gradeBet(bet({ market: "spreads", selection: "TeamB", point: 3.5 }), g)).toBe("lost");
    expect(gradeBet(bet({ market: "spreads", selection: "TeamB", point: 4 }), g)).toBe("push");
    expect(gradeBet(bet({ market: "spreads", selection: "TeamA", point: -3.5 }), g)).toBe("won");
    expect(gradeBet(bet({ market: "spreads", selection: "TeamA", point: -4.5 }), g)).toBe("lost");
  });

  it("returns null without a point", () => {
    expect(gradeBet(bet({ market: "spreads", point: null }), makeGame(24, 20))).toBeNull();
  });
});

describe("gradeBet totals", () => {
  it("grades over, under, and exact-landing pushes", () => {
    const g = makeGame(5, 4); // total 9
    expect(gradeBet(bet({ market: "totals", selection: "Over 8.5", point: 8.5 }), g)).toBe("won");
    expect(gradeBet(bet({ market: "totals", selection: "Under 8.5", point: 8.5 }), g)).toBe("lost");
    expect(gradeBet(bet({ market: "totals", selection: "Over 9", point: 9 }), g)).toBe("push");
    expect(gradeBet(bet({ market: "totals", selection: "Under 9.5", point: 9.5 }), g)).toBe("won");
  });
});

describe("gradeBet guards", () => {
  it("returns null for incomplete games or missing scores", () => {
    expect(gradeBet(bet({}), makeGame(5, 3, false))).toBeNull();
    expect(gradeBet(bet({}), { ...makeGame(5, 3), scores: null })).toBeNull();
  });

  it("returns null for unknown markets", () => {
    expect(gradeBet(bet({ market: "player_props" }), makeGame(5, 3))).toBeNull();
  });
});

describe("calcPnl", () => {
  it("pays positive American odds correctly", () => {
    expect(calcPnl("won", 150, 1)).toBe(1.5);
  });

  it("pays negative American odds correctly", () => {
    expect(calcPnl("won", -120, 1.2)).toBe(1);
  });

  it("loses the stake and refunds pushes", () => {
    expect(calcPnl("lost", -110, 2)).toBe(-2);
    expect(calcPnl("push", -110, 2)).toBe(0);
  });
});
