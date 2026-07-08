import { describe, it, expect, vi, beforeEach } from "vitest";
import supertest from "supertest";
import express from "express";
import pinoHttp from "pino-http";
import { pino } from "pino";
import oddsRouter from "./odds";

vi.mock("../lib/odds", () => ({
  fetchMultiSportOdds: vi.fn(),
  fetchOdds: vi.fn(),
  fetchSports: vi.fn(),
}));

vi.mock("../lib/starters", () => ({
  fetchTodayStarters: vi.fn(),
}));

import { fetchMultiSportOdds } from "../lib/odds";
const mockFetchMultiSportOdds = fetchMultiSportOdds as ReturnType<typeof vi.fn>;

const futureTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const recentUpdate = new Date(Date.now() - 2 * 60 * 1000).toISOString();

function makeTestApp() {
  const app = express();
  const testLogger = pino({ level: "silent" });
  app.use(pinoHttp({ logger: testLogger }));
  app.use(express.json());
  app.use("/api", oddsRouter);
  return app;
}

function makeOddsApiResponse(games: object[], quotaExhausted = false) {
  return { games, requestsRemaining: 450, quotaExhausted };
}

const FIXTURE_GAME_LOWVIG = {
  id: "game-001",
  sport_key: "baseball_mlb",
  sport_title: "MLB",
  commence_time: futureTime,
  home_team: "TeamA",
  away_team: "TeamB",
  bookmakers: [
    {
      key: "lowvig",
      title: "LowVig",
      last_update: recentUpdate,
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "TeamA", price: -110 },
            { name: "TeamB", price: -110 },
          ],
        },
      ],
    },
    {
      key: "draftkings",
      title: "DraftKings",
      last_update: recentUpdate,
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "TeamA", price: 110 },
            { name: "TeamB", price: -130 },
          ],
        },
      ],
    },
  ],
};

describe("GET /api/odds/ev-card", () => {
  beforeEach(() => {
    mockFetchMultiSportOdds.mockReset();
  });

  it("returns 200 with bets/nearMisses/hasBets shape", async () => {
    mockFetchMultiSportOdds.mockResolvedValue(makeOddsApiResponse([]));

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    expect(res.body).toHaveProperty("bets");
    expect(res.body).toHaveProperty("nearMisses");
    expect(res.body).toHaveProperty("hasBets");
    expect(res.body).toHaveProperty("date");
    expect(res.body).toHaveProperty("requestsRemaining");
    expect(Array.isArray(res.body.bets)).toBe(true);
    expect(Array.isArray(res.body.nearMisses)).toBe(true);
  });

  it("surfaces a +EV bet when retail price beats the LowVig sharp line", async () => {
    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([FIXTURE_GAME_LOWVIG])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    expect(res.body.hasBets).toBe(true);
    expect(res.body.bets.length).toBeGreaterThan(0);

    const bet = res.body.bets[0];
    expect(bet.evPercent).toBeGreaterThanOrEqual(2.0);
    expect(bet.bookmaker).toBe("DraftKings");
    expect(bet.sharpBook).toBe("LowVig");
    expect(bet.market).toBe("h2h");
    expect(bet.noVigProb).toBeCloseTo(0.5, 3);
  });

  it("sets sharpBook to LowVig when LowVig is the source", async () => {
    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([FIXTURE_GAME_LOWVIG])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    const allBets = [...res.body.bets, ...res.body.nearMisses];
    for (const bet of allBets) {
      expect(bet.sharpBook).toBe("LowVig");
    }
  });

  it("falls back to BetOnline when LowVig is absent", async () => {
    const gameWithBetOnline = {
      ...FIXTURE_GAME_LOWVIG,
      id: "game-002",
      bookmakers: FIXTURE_GAME_LOWVIG.bookmakers.map((b) =>
        b.key === "lowvig"
          ? { ...b, key: "betonlineag", title: "BetOnline" }
          : b
      ),
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameWithBetOnline])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    const allBets = [...res.body.bets, ...res.body.nearMisses];
    expect(allBets.length).toBeGreaterThan(0);
    for (const bet of allBets) {
      expect(bet.sharpBook).toBe("BetOnline");
    }
  });

  it("uses consensus label when no sharp book is present", async () => {
    const gameConsensus = {
      ...FIXTURE_GAME_LOWVIG,
      id: "game-003",
      bookmakers: [
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "TeamA", price: -110 },
                { name: "TeamB", price: -110 },
              ],
            },
          ],
        },
        {
          key: "fanduel",
          title: "FanDuel",
          last_update: recentUpdate,
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "TeamA", price: 115 },
                { name: "TeamB", price: -135 },
              ],
            },
          ],
        },
        {
          key: "betmgm",
          title: "BetMGM",
          last_update: recentUpdate,
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "TeamA", price: -110 },
                { name: "TeamB", price: -110 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameConsensus])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    const allBets = [...res.body.bets, ...res.body.nearMisses];
    for (const bet of allBets) {
      expect(bet.sharpBook).toBe("Consensus");
    }
  });

  it("surfaces near-misses when EV is positive but below minEv threshold", async () => {
    const gameNearMiss = {
      ...FIXTURE_GAME_LOWVIG,
      id: "game-004",
      bookmakers: [
        {
          key: "lowvig",
          title: "LowVig",
          last_update: recentUpdate,
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "TeamA", price: -110 },
                { name: "TeamB", price: -110 },
              ],
            },
          ],
        },
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "TeamA", price: 101 },
                { name: "TeamB", price: -121 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameNearMiss])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card?minEv=2")
      .expect(200);

    const evBet = res.body.bets.find(
      (b: { selection: string }) => b.selection === "TeamA"
    );
    const nearMiss = res.body.nearMisses.find(
      (b: { selection: string }) => b.selection === "TeamA"
    );

    expect(evBet).toBeUndefined();
    expect(nearMiss).toBeDefined();
    expect(nearMiss.evPercent).toBeGreaterThan(0);
    expect(nearMiss.evPercent).toBeLessThan(2.0);
    expect(nearMiss).toHaveProperty("breakEvenOdds");
  });

  it("excludes games whose commence_time is in the past (>10 min ago)", async () => {
    const pastGame = {
      ...FIXTURE_GAME_LOWVIG,
      id: "game-past",
      commence_time: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([pastGame])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    expect(res.body.bets.length).toBe(0);
    expect(res.body.nearMisses.length).toBe(0);
    expect(res.body.hasBets).toBe(false);
  });

  it("returns 500 when fetchMultiSportOdds throws", async () => {
    mockFetchMultiSportOdds.mockRejectedValue(new Error("Odds API down"));

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(500);

    expect(res.body).toHaveProperty("error");
  });

  it("returns quotaExhausted: false when all sports fetch successfully", async () => {
    mockFetchMultiSportOdds.mockResolvedValue(makeOddsApiResponse([], false));

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    expect(res.body.quotaExhausted).toBe(false);
  });

  it("returns quotaExhausted: true and partial bets when some sports hit the quota mid-scan", async () => {
    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([FIXTURE_GAME_LOWVIG], true)
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    expect(res.body.quotaExhausted).toBe(true);
    expect(res.body.hasBets).toBe(true);
    expect(res.body.bets.length).toBeGreaterThan(0);
  });

  it("surfaces a spreads +EV bet when retail point matches the sharp-book point", async () => {
    const gameSpreadEV = {
      id: "game-spreads-001",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "lowvig",
          title: "LowVig",
          last_update: recentUpdate,
          markets: [
            {
              key: "spreads",
              outcomes: [
                { name: "TeamA", price: -110, point: -3.5 },
                { name: "TeamB", price: -110, point: 3.5 },
              ],
            },
          ],
        },
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "spreads",
              outcomes: [
                { name: "TeamA", price: 110, point: -3.5 },
                { name: "TeamB", price: -130, point: 3.5 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameSpreadEV])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    expect(res.body.hasBets).toBe(true);
    const spreadBet = res.body.bets.find(
      (b: { market: string; selection: string }) =>
        b.market === "spreads" && b.selection === "TeamA"
    );
    expect(spreadBet).toBeDefined();
    expect(spreadBet.market).toBe("spreads");
    expect(spreadBet.point).toBe(-3.5);
    expect(spreadBet.evPercent).toBeGreaterThanOrEqual(2.0);
    expect(spreadBet.bookmaker).toBe("DraftKings");
    expect(spreadBet.sharpBook).toBe("LowVig");
    expect(spreadBet.noVigProb).toBeCloseTo(0.5, 3);
  });

  it("surfaces a totals near-miss when EV is positive but below minEv threshold", async () => {
    const gameTotalsNearMiss = {
      id: "game-totals-001",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "lowvig",
          title: "LowVig",
          last_update: recentUpdate,
          markets: [
            {
              key: "totals",
              outcomes: [
                { name: "Over", price: -110, point: 9.5 },
                { name: "Under", price: -110, point: 9.5 },
              ],
            },
          ],
        },
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "totals",
              outcomes: [
                { name: "Over", price: 101, point: 9.5 },
                { name: "Under", price: -121, point: 9.5 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameTotalsNearMiss])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card?minEv=2")
      .expect(200);

    const evBet = res.body.bets.find(
      (b: { market: string }) => b.market === "totals"
    );
    const nearMiss = res.body.nearMisses.find(
      (b: { market: string; selection: string }) =>
        b.market === "totals" && b.selection === "Over 9.5"
    );

    expect(evBet).toBeUndefined();
    expect(nearMiss).toBeDefined();
    expect(nearMiss.evPercent).toBeGreaterThan(0);
    expect(nearMiss.evPercent).toBeLessThan(2.0);
    expect(nearMiss.point).toBe(9.5);
    expect(nearMiss.sharpBook).toBe("LowVig");
    expect(nearMiss).toHaveProperty("breakEvenOdds");
  });

  it("skips a spread outcome (not crash) when the sharp book has only one side posted", async () => {
    const gameOneSidedSpread = {
      id: "game-one-sided-spread",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "lowvig",
          title: "LowVig",
          last_update: recentUpdate,
          markets: [
            {
              key: "spreads",
              // Only TeamA posted — TeamB line missing from sharp book
              outcomes: [{ name: "TeamA", price: -110, point: -3.5 }],
            },
          ],
        },
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "spreads",
              outcomes: [
                { name: "TeamA", price: 110, point: -3.5 },
                { name: "TeamB", price: -130, point: 3.5 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameOneSidedSpread])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    // No spread bets — de-vig requires both sides; one-sided sharp data is an
    // explicit logged skip, not a silent drop or crash.
    const spreadBets = res.body.bets.filter(
      (b: { market: string }) => b.market === "spreads"
    );
    const spreadNearMisses = res.body.nearMisses.filter(
      (b: { market: string }) => b.market === "spreads"
    );
    expect(spreadBets).toHaveLength(0);
    expect(spreadNearMisses).toHaveLength(0);
  });

  it("skips a totals outcome (not crash) when the sharp book has only one side posted", async () => {
    const gameOneSidedTotals = {
      id: "game-one-sided-totals",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "lowvig",
          title: "LowVig",
          last_update: recentUpdate,
          markets: [
            {
              key: "totals",
              // Only Over posted — Under line missing from sharp book
              outcomes: [{ name: "Over", price: -110, point: 8.5 }],
            },
          ],
        },
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "totals",
              outcomes: [
                { name: "Over", price: 105, point: 8.5 },
                { name: "Under", price: -125, point: 8.5 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameOneSidedTotals])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    // No totals bets — de-vig requires both sides; one-sided sharp data is an
    // explicit logged skip, not a silent drop or crash.
    const totalsBets = res.body.bets.filter(
      (b: { market: string }) => b.market === "totals"
    );
    const totalsNearMisses = res.body.nearMisses.filter(
      (b: { market: string }) => b.market === "totals"
    );
    expect(totalsBets).toHaveLength(0);
    expect(totalsNearMisses).toHaveLength(0);
  });

  it("evaluates totals bets using the nearest sharp line when retail and sharp points differ", async () => {
    const gameTotalsMismatch = {
      id: "game-totals-mismatch",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "lowvig",
          title: "LowVig",
          last_update: recentUpdate,
          markets: [
            {
              key: "totals",
              outcomes: [
                { name: "Over", price: -110, point: 9.5 },
                { name: "Under", price: -110, point: 9.5 },
              ],
            },
          ],
        },
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "totals",
              outcomes: [
                { name: "Over", price: 110, point: 9 },
                { name: "Under", price: -130, point: 9 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameTotalsMismatch])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    const totalsBets = [...res.body.bets, ...res.body.nearMisses].filter(
      (b: { market: string }) => b.market === "totals"
    );

    expect(totalsBets.length).toBeGreaterThan(0);
    const overBet = totalsBets.find(
      (b: { selection: string }) => b.selection === "Over 9"
    );
    expect(overBet).toBeDefined();
    expect(overBet.evPercent).toBeGreaterThan(0);
    expect(overBet.sharpBook).toBe("LowVig");
    expect(overBet.point).toBe(9);
  });

  it("evaluates spread bets using the nearest sharp line when retail and sharp points differ", async () => {
    const gameMismatchedPoints = {
      id: "game-spreads-mismatch",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "lowvig",
          title: "LowVig",
          last_update: recentUpdate,
          markets: [
            {
              key: "spreads",
              outcomes: [
                { name: "TeamA", price: -110, point: -3.5 },
                { name: "TeamB", price: -110, point: 3.5 },
              ],
            },
          ],
        },
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "spreads",
              outcomes: [
                { name: "TeamA", price: 110, point: -4.5 },
                { name: "TeamB", price: -130, point: 4.5 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameMismatchedPoints])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    const spreadBets = res.body.bets.filter(
      (b: { market: string }) => b.market === "spreads"
    );

    expect(spreadBets.length).toBeGreaterThan(0);
    const teamABet = spreadBets.find(
      (b: { selection: string }) => b.selection === "TeamA"
    );
    expect(teamABet).toBeDefined();
    expect(teamABet.evPercent).toBeGreaterThan(0);
    expect(teamABet.sharpBook).toBe("LowVig");
    expect(teamABet.point).toBe(-4.5);
  });

  it("does not drop spread bets when retail and sharp points differ by exactly 1.5", async () => {
    const gameMaxDiffSpread = {
      id: "game-spreads-maxdiff",
      sport_key: "americanfootball_nfl",
      sport_title: "NFL",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "lowvig",
          title: "LowVig",
          last_update: recentUpdate,
          markets: [
            {
              key: "spreads",
              // Sharp book posted at -3; retail is at -4.5 (diff = 1.5)
              outcomes: [
                { name: "TeamA", price: -110, point: -3 },
                { name: "TeamB", price: -110, point: 3 },
              ],
            },
          ],
        },
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "spreads",
              outcomes: [
                { name: "TeamA", price: 115, point: -4.5 },
                { name: "TeamB", price: -135, point: 4.5 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameMaxDiffSpread])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    const allSpread = [...res.body.bets, ...res.body.nearMisses].filter(
      (b: { market: string }) => b.market === "spreads"
    );
    // The bet must be evaluated (not silently dropped), and the retail point retained
    expect(allSpread.length).toBeGreaterThan(0);
    const teamAEntry = allSpread.find(
      (b: { selection: string }) => b.selection === "TeamA"
    );
    expect(teamAEntry).toBeDefined();
    expect(teamAEntry.point).toBe(-4.5);
    expect(teamAEntry.sharpBook).toBe("LowVig");
  });

  it("does not drop totals bets when retail and sharp points differ by exactly 1.5", async () => {
    const gameMaxDiffTotals = {
      id: "game-totals-maxdiff",
      sport_key: "americanfootball_nfl",
      sport_title: "NFL",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "lowvig",
          title: "LowVig",
          last_update: recentUpdate,
          markets: [
            {
              key: "totals",
              // Sharp book posted at 47.5; retail is at 46 (diff = 1.5)
              outcomes: [
                { name: "Over", price: -110, point: 47.5 },
                { name: "Under", price: -110, point: 47.5 },
              ],
            },
          ],
        },
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "totals",
              outcomes: [
                { name: "Over", price: 115, point: 46 },
                { name: "Under", price: -135, point: 46 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameMaxDiffTotals])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    const allTotals = [...res.body.bets, ...res.body.nearMisses].filter(
      (b: { market: string }) => b.market === "totals"
    );
    // The bet must be evaluated (not silently dropped), and the retail point retained
    expect(allTotals.length).toBeGreaterThan(0);
    const overEntry = allTotals.find(
      (b: { selection: string }) => b.selection === "Over 46"
    );
    expect(overEntry).toBeDefined();
    expect(overEntry.point).toBe(46);
    expect(overEntry.sharpBook).toBe("LowVig");
  });
});
