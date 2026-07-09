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

vi.mock("../lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { fetchMultiSportOdds } from "../lib/odds";
const mockFetchMultiSportOdds = fetchMultiSportOdds as ReturnType<typeof vi.fn>;

import { logger } from "../lib/logger";
const mockLoggerWarn = logger.warn as ReturnType<typeof vi.fn>;

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

  it("returns 200 with valid finite evPercent values when no sharp book is present (retail-only h2h)", async () => {
    // Only retail books — no LowVig or BetOnline — forces the h2h loop to use
    // buildConsensusH2H. This test confirms the route stays clean: no crash, no
    // NaN/Infinity evPercent, correct response shape.
    const gameRetailOnly = {
      id: "game-retail-only-h2h",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
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
          // FanDuel has TeamA at a juicy price vs the consensus → should surface as +EV
          key: "fanduel",
          title: "FanDuel",
          last_update: recentUpdate,
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "TeamA", price: 120 },
                { name: "TeamB", price: -140 },
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
      makeOddsApiResponse([gameRetailOnly])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    expect(res.body).toHaveProperty("bets");
    expect(res.body).toHaveProperty("nearMisses");
    expect(res.body).toHaveProperty("hasBets");
    expect(Array.isArray(res.body.bets)).toBe(true);
    expect(Array.isArray(res.body.nearMisses)).toBe(true);

    const allBets = [...res.body.bets, ...res.body.nearMisses];

    // At least one outcome should be surfaced (FanDuel TeamA is +EV vs consensus)
    expect(allBets.length).toBeGreaterThan(0);

    // Core guarantee: no NaN or Infinity evPercent values
    for (const bet of allBets) {
      expect(Number.isFinite(bet.evPercent)).toBe(true);
      expect(bet.evPercent).not.toBeNaN();
      expect(bet.sharpBook).toBe("Consensus");
    }

    // Verify the +EV bet from FanDuel is present and correctly attributed
    const fanduelBet = res.body.bets.find(
      (b: { bookmaker: string; selection: string }) =>
        b.bookmaker === "FanDuel" && b.selection === "TeamA"
    );
    expect(fanduelBet).toBeDefined();
    expect(fanduelBet.evPercent).toBeGreaterThan(0);
    expect(Number.isFinite(fanduelBet.evPercent)).toBe(true);
  });

  it("returns empty bets and nearMisses when all retail books post identical h2h odds", async () => {
    // When every retail book agrees on -110/-110, the consensus no-vig probability
    // equals each book's own implied probability, so evPercent is ≤ 0 for every
    // outcome. The route must return a valid empty shape without crashing and all
    // intermediate evPercent values that would be computed must be finite.
    const gameAllIdenticalH2H = {
      id: "game-all-identical-h2h",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
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
                { name: "TeamA", price: -110 },
                { name: "TeamB", price: -110 },
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
      makeOddsApiResponse([gameAllIdenticalH2H])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    // Valid response shape
    expect(res.body).toHaveProperty("bets");
    expect(res.body).toHaveProperty("nearMisses");
    expect(res.body).toHaveProperty("hasBets");
    expect(Array.isArray(res.body.bets)).toBe(true);
    expect(Array.isArray(res.body.nearMisses)).toBe(true);

    // No EV opportunity — all books agree, so nothing should surface
    expect(res.body.bets).toHaveLength(0);
    expect(res.body.nearMisses).toHaveLength(0);
    expect(res.body.hasBets).toBe(false);

    // Sanity-check the math: -110/-110 symmetric market has evPercent < 0 for both sides
    const { americanToImpliedProb, deVig2Way, calcEVPercent } = await import("../lib/ev-math");
    const p = americanToImpliedProb(-110);
    const { p1: noVigP } = deVig2Way(p, p);
    const evPct = calcEVPercent(noVigP, -110);
    expect(Number.isFinite(evPct)).toBe(true);
    expect(evPct).toBeLessThanOrEqual(0);
  });

  it("returns empty bets and nearMisses when all retail books post the same lopsided h2h odds", async () => {
    // Unlike the symmetric -110/-110 case, a lopsided -150/+130 market gives the
    // two sides unequal weight in the consensus de-vig calculation. When every
    // retail book agrees on the same lopsided line, the consensus equals each
    // book's own de-vigged probabilities, so both sides are ≤ 0 EV (the vig).
    // The route must return a clean empty shape without crashing.
    const lopsidedH2HMarket = {
      key: "h2h",
      outcomes: [
        { name: "TeamA", price: -150 },
        { name: "TeamB", price: 130 },
      ],
    };
    const gameAllLopsidedH2H = {
      id: "game-all-lopsided-h2h",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [lopsidedH2HMarket],
        },
        {
          key: "fanduel",
          title: "FanDuel",
          last_update: recentUpdate,
          markets: [lopsidedH2HMarket],
        },
        {
          key: "betmgm",
          title: "BetMGM",
          last_update: recentUpdate,
          markets: [lopsidedH2HMarket],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameAllLopsidedH2H])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    // Valid response shape
    expect(res.body).toHaveProperty("bets");
    expect(res.body).toHaveProperty("nearMisses");
    expect(res.body).toHaveProperty("hasBets");
    expect(Array.isArray(res.body.bets)).toBe(true);
    expect(Array.isArray(res.body.nearMisses)).toBe(true);

    // No EV opportunity — all books agree on the lopsided line, nothing surfaces
    expect(res.body.bets).toHaveLength(0);
    expect(res.body.nearMisses).toHaveLength(0);
    expect(res.body.hasBets).toBe(false);

    // Sanity-check the math for BOTH sides of the asymmetric market: the
    // favorite (-150) and the underdog (+130) must each be finite and ≤ 0 EV
    // against the consensus their own prices create.
    const { americanToImpliedProb, deVig2Way, calcEVPercent } = await import("../lib/ev-math");
    const pFav = americanToImpliedProb(-150);
    const pDog = americanToImpliedProb(130);
    const { p1: noVigFav, p2: noVigDog } = deVig2Way(pFav, pDog);
    const evFav = calcEVPercent(noVigFav, -150);
    const evDog = calcEVPercent(noVigDog, 130);
    expect(Number.isFinite(evFav)).toBe(true);
    expect(evFav).toBeLessThanOrEqual(0);
    expect(Number.isFinite(evDog)).toBe(true);
    expect(evDog).toBeLessThanOrEqual(0);
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
    // LowVig posts Over only; Under line is missing from the sharp book.
    // When DraftKings' Over is evaluated: found1 (Over in sharp) exists, but
    // found2 (Under in sharp) is null — the warn fires and the outcome is skipped.
    // When DraftKings' Under is evaluated: found1 is null → silent skip.
    // Net result: no totals bets, no totals near-misses, one explicit warn.
    mockLoggerWarn.mockClear();

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

    // The skip must be explicit (warned), not silent.
    // Exactly one outcome reaches found2=null (the Over side; Under short-circuits
    // at found1=null). Verify ≥1 warn with the expected message was emitted.
    const missingOtherSideWarns = mockLoggerWarn.mock.calls.filter(
      (args: unknown[]) =>
        typeof args[1] === "string" &&
        args[1].includes("sharp book missing other-side outcome")
    );
    expect(missingOtherSideWarns.length).toBeGreaterThanOrEqual(1);
    const warnMeta = missingOtherSideWarns[0]![0] as Record<string, unknown>;
    expect(warnMeta["missingOtherSide"]).toBe("Under");
  });

  it("skips totals bets when retail and sharp points differ (exact match required)", async () => {
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
      .get("/api/odds/ev-card?minEv=0")
      .expect(200);

    const totalsBets = [...res.body.bets, ...res.body.nearMisses].filter(
      (b: { market: string }) => b.market === "totals"
    );

    // A half point on a total is worth several percent of win probability, so
    // probabilities must never be borrowed from a different sharp line.
    expect(totalsBets).toHaveLength(0);

    const skipWarnings = mockLoggerWarn.mock.calls.filter((args: unknown[]) =>
      typeof args[1] === "string" &&
      args[1].includes("exact point match required")
    );
    expect(skipWarnings.length).toBeGreaterThanOrEqual(1);
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

  it("drops totals bets when retail and sharp points differ by 1.5 (exact match required)", async () => {
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
              // Sharp book posted at 47.5; retail is at 46 (diff = 1.5).
              // Under the old spread-style tolerance this was evaluated;
              // totals now require an exact point match.
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
      .get("/api/odds/ev-card?minEv=0")
      .expect(200);

    const allTotals = [...res.body.bets, ...res.body.nearMisses].filter(
      (b: { market: string }) => b.market === "totals"
    );
    expect(allTotals).toHaveLength(0);
  });

  it("stays clean (200, no NaN/Infinity) when exactly one retail book provides h2h data", async () => {
    // buildConsensusH2H must handle n=1 without crashing or producing NaN/Infinity.
    // With a single book the consensus equals its own de-vigged probabilities, so
    // no outcome will be +EV vs the reference it creates — but the response shape
    // must still be valid and sharpBook must be "Consensus".
    const gameSingleBook = {
      id: "game-single-retail-h2h",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "TeamA", price: -130 },
                { name: "TeamB", price: 110 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameSingleBook])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    expect(res.body).toHaveProperty("bets");
    expect(res.body).toHaveProperty("nearMisses");
    expect(Array.isArray(res.body.bets)).toBe(true);
    expect(Array.isArray(res.body.nearMisses)).toBe(true);

    // Core guarantee: no NaN or Infinity evPercent values regardless of bet count.
    const allBets = [...res.body.bets, ...res.body.nearMisses];
    for (const bet of allBets) {
      expect(Number.isFinite(bet.evPercent)).toBe(true);
      expect(bet.evPercent).not.toBeNaN();
      expect(bet.sharpBook).toBe("Consensus");
    }
  });

  it("produces no h2h output (not a crash) when the only retail book has spreads/totals but no h2h market", async () => {
    // buildConsensusH2H skips bookmakers without an h2h market, returning an
    // empty consensus map. With no sharp book present either, the h2h scan has
    // no reference line at all and must silently skip the game — not crash and
    // not emit garbage h2h entries derived from a missing market.
    const gameNoH2H = {
      id: "game-single-book-no-h2h",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "spreads",
              outcomes: [
                { name: "TeamA", price: -110, point: -1.5 },
                { name: "TeamB", price: -110, point: 1.5 },
              ],
            },
            {
              key: "totals",
              outcomes: [
                { name: "Over", price: -110, point: 8.5 },
                { name: "Under", price: -110, point: 8.5 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(makeOddsApiResponse([gameNoH2H]));

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    // Valid response shape — the route must not crash.
    expect(res.body).toHaveProperty("bets");
    expect(res.body).toHaveProperty("nearMisses");
    expect(Array.isArray(res.body.bets)).toBe(true);
    expect(Array.isArray(res.body.nearMisses)).toBe(true);

    // Core guarantee: with a single retail book and no valid h2h anywhere,
    // NO market has a sharp/consensus reference line — the scan must produce
    // no output at all for this game, across every market.
    expect(res.body.bets).toHaveLength(0);
    expect(res.body.nearMisses).toHaveLength(0);
    expect(res.body.hasBets).toBe(false);
  });

  it("produces no h2h output (not a crash) when the only retail book's h2h market has the wrong outcome count", async () => {
    // A malformed h2h market with a single outcome must be skipped by
    // buildConsensusH2H (it requires exactly two outcomes), leaving no
    // consensus reference — same silent-skip guarantee as a missing market.
    const gameMalformedH2H = {
      id: "game-single-book-one-outcome-h2h",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: futureTime,
      home_team: "TeamA",
      away_team: "TeamB",
      bookmakers: [
        {
          key: "draftkings",
          title: "DraftKings",
          last_update: recentUpdate,
          markets: [
            {
              key: "h2h",
              outcomes: [{ name: "TeamA", price: -130 }],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(
      makeOddsApiResponse([gameMalformedH2H])
    );

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card")
      .expect(200);

    expect(Array.isArray(res.body.bets)).toBe(true);
    expect(Array.isArray(res.body.nearMisses)).toBe(true);

    const allEntries = [...res.body.bets, ...res.body.nearMisses];
    const h2hEntries = allEntries.filter(
      (b: { market: string }) => b.market === "h2h"
    );
    expect(h2hEntries).toHaveLength(0);
    expect(res.body.hasBets).toBe(res.body.bets.length > 0);
  });
});

// ---------------------------------------------------------------------------
// pointDiff > MAX_POINT_DIFF (1.5) — bets must be skipped, not silently misfired
// ---------------------------------------------------------------------------

describe("GET /api/odds/ev-card – skips bets when pointDiff exceeds MAX_POINT_DIFF", () => {
  beforeEach(() => {
    mockFetchMultiSportOdds.mockReset();
    mockLoggerWarn.mockReset();
  });

  it("drops spread bets (not crash) when retail and sharp points differ by 2.0", async () => {
    const game = {
      id: "game-spreads-overdiff",
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
              // Retail at -5.5 → pointDiff = 2.0 from sharp -3.5 → must be skipped
              outcomes: [
                { name: "TeamA", price: 115, point: -5.5 },
                { name: "TeamB", price: -135, point: 5.5 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(makeOddsApiResponse([game]));

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card?minEv=0")
      .expect(200);

    const spreadBets = res.body.bets.filter(
      (b: { market: string }) => b.market === "spreads"
    );
    const spreadNearMisses = res.body.nearMisses.filter(
      (b: { market: string }) => b.market === "spreads"
    );
    expect(spreadBets).toHaveLength(0);
    expect(spreadNearMisses).toHaveLength(0);
  });

  it("drops spread bets when retail and sharp points differ by 3.0", async () => {
    const game = {
      id: "game-spreads-3pt-diff",
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
              // Retail at -6.5 → pointDiff = 3.0 from sharp -3.5 → must be skipped
              outcomes: [
                { name: "TeamA", price: 115, point: -6.5 },
                { name: "TeamB", price: -135, point: 6.5 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(makeOddsApiResponse([game]));

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card?minEv=0")
      .expect(200);

    const allSpread = [...res.body.bets, ...res.body.nearMisses].filter(
      (b: { market: string }) => b.market === "spreads"
    );
    expect(allSpread).toHaveLength(0);
  });

  it("drops totals bets (not crash) when retail and sharp totals differ by 2.0", async () => {
    const game = {
      id: "game-totals-overdiff",
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
              // Retail at 11.5 → pointDiff = 2.0 from sharp 9.5 → must be skipped
              outcomes: [
                { name: "Over", price: 115, point: 11.5 },
                { name: "Under", price: -135, point: 11.5 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(makeOddsApiResponse([game]));

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card?minEv=0")
      .expect(200);

    const totalsBets = res.body.bets.filter(
      (b: { market: string }) => b.market === "totals"
    );
    const totalsNearMisses = res.body.nearMisses.filter(
      (b: { market: string }) => b.market === "totals"
    );
    expect(totalsBets).toHaveLength(0);
    expect(totalsNearMisses).toHaveLength(0);
  });

  it("drops totals bets when retail and sharp totals differ by 3.5", async () => {
    const game = {
      id: "game-totals-3pt5-diff",
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
              // Retail at 13 → pointDiff = 3.5 from sharp 9.5 → must be skipped
              outcomes: [
                { name: "Over", price: 115, point: 13 },
                { name: "Under", price: -135, point: 13 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(makeOddsApiResponse([game]));

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card?minEv=0")
      .expect(200);

    const allTotals = [...res.body.bets, ...res.body.nearMisses].filter(
      (b: { market: string }) => b.market === "totals"
    );
    expect(allTotals).toHaveLength(0);
  });

  it("skips (not crash) all spread bets when both sides independently exceed MAX_POINT_DIFF by different amounts", async () => {
    // TeamA: retail -6.0 vs sharp -3.5 → pointDiff 2.5 (> 1.5)
    // TeamB: retail  8.0 vs sharp  3.5 → pointDiff 4.5 (> 1.5)
    // Both sides are independently over the threshold with asymmetric diffs —
    // the scan must skip both via the found1 guard and return 200 with no spread output.
    const game = {
      id: "game-spreads-both-overdiff",
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
              // TeamA retail at -6.0 → diff 2.5 > MAX_POINT_DIFF
              // TeamB retail at  8.0 → diff 4.5 > MAX_POINT_DIFF
              outcomes: [
                { name: "TeamA", price: 110, point: -6.0 },
                { name: "TeamB", price: -130, point: 8.0 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(makeOddsApiResponse([game]));

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card?minEv=0")
      .expect(200);

    const spreadBets = res.body.bets.filter(
      (b: { market: string }) => b.market === "spreads"
    );
    const spreadNearMisses = res.body.nearMisses.filter(
      (b: { market: string }) => b.market === "spreads"
    );
    // Both sides exceed MAX_POINT_DIFF — neither should appear in output
    expect(spreadBets).toHaveLength(0);
    expect(spreadNearMisses).toHaveLength(0);

    // Verify the skip is explicit (logged), not silent — one warn per skipped side
    const skipWarnings = mockLoggerWarn.mock.calls.filter((args: unknown[]) =>
      typeof args[1] === "string" &&
      args[1].includes("point diff exceeds MAX_POINT_DIFF")
    );
    expect(skipWarnings.length).toBeGreaterThanOrEqual(2);

    const warnedSelections = skipWarnings.map(
      (args: unknown[]) => (args[0] as { selection: string }).selection
    );
    expect(warnedSelections).toContain("TeamA");
    expect(warnedSelections).toContain("TeamB");
  });

  it("skips (not crash) all totals bets when both Over and Under independently exceed MAX_POINT_DIFF by different amounts", async () => {
    // Over:  retail 12.0 vs sharp 9.5 → pointDiff 2.5 (> 1.5)
    // Under: retail 14.0 vs sharp 9.5 → pointDiff 4.5 (> 1.5)
    // Both sides exceed the threshold by different magnitudes (asymmetric).
    // The scan must skip each via the found1 guard on its own iteration and
    // return 200 with no totals bets or near-misses.
    const game = {
      id: "game-totals-both-overdiff",
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
              // Over retail at 12.0 → diff 2.5 > MAX_POINT_DIFF
              // Under retail at 14.0 → diff 4.5 > MAX_POINT_DIFF
              outcomes: [
                { name: "Over", price: 115, point: 12.0 },
                { name: "Under", price: -135, point: 14.0 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(makeOddsApiResponse([game]));

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card?minEv=0")
      .expect(200);

    const totalsBets = res.body.bets.filter(
      (b: { market: string }) => b.market === "totals"
    );
    const totalsNearMisses = res.body.nearMisses.filter(
      (b: { market: string }) => b.market === "totals"
    );
    // Both sides exceed MAX_POINT_DIFF — neither should appear in output
    expect(totalsBets).toHaveLength(0);
    expect(totalsNearMisses).toHaveLength(0);

    // Verify the skip is explicit (logged), not silent — one warn per skipped side
    const skipWarnings = mockLoggerWarn.mock.calls.filter((args: unknown[]) =>
      typeof args[1] === "string" &&
      args[1].includes("exact point match required")
    );
    expect(skipWarnings.length).toBeGreaterThanOrEqual(2);

    const warnedSelections = skipWarnings.map(
      (args: unknown[]) => (args[0] as { selection: string }).selection
    );
    expect(warnedSelections).toContain("Over");
    expect(warnedSelections).toContain("Under");
  });

  it("still surfaces h2h bets from the same game even when spread/totals are dropped due to point diff", async () => {
    const game = {
      id: "game-mixed-overdiff",
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
              key: "h2h",
              outcomes: [
                { name: "TeamA", price: 115 },
                { name: "TeamB", price: -135 },
              ],
            },
            {
              key: "spreads",
              // Spread diff = 2.0 → skipped
              outcomes: [
                { name: "TeamA", price: 115, point: -5.5 },
                { name: "TeamB", price: -135, point: 5.5 },
              ],
            },
          ],
        },
      ],
    };

    mockFetchMultiSportOdds.mockResolvedValue(makeOddsApiResponse([game]));

    const res = await supertest(makeTestApp())
      .get("/api/odds/ev-card?minEv=0")
      .expect(200);

    const h2hBets = [...res.body.bets, ...res.body.nearMisses].filter(
      (b: { market: string }) => b.market === "h2h"
    );
    const spreadBets = [...res.body.bets, ...res.body.nearMisses].filter(
      (b: { market: string }) => b.market === "spreads"
    );

    expect(h2hBets.length).toBeGreaterThan(0);
    expect(spreadBets).toHaveLength(0);
  });
});
