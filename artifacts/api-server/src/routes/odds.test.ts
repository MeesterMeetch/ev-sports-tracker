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

function makeOddsApiResponse(games: object[]) {
  return { games, requestsRemaining: 450 };
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
});
