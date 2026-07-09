import { describe, it, expect, vi, beforeEach } from "vitest";
import supertest from "supertest";
import express from "express";
import pinoHttp from "pino-http";
import { pino } from "pino";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
  },
  betsTable: {},
}));

import { db } from "@workspace/db";
import betsRouter from "./bets";

const mockSelect = db.select as ReturnType<typeof vi.fn>;

function makeTestApp() {
  const app = express();
  const testLogger = pino({ level: "silent" });
  app.use(pinoHttp({ logger: testLogger }));
  app.use(express.json());
  app.use("/api", betsRouter);
  return app;
}

function makeBet(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    gameId: "g1",
    homeTeam: "Home",
    awayTeam: "Away",
    sport: "baseball_mlb",
    market: "h2h",
    selection: "Home",
    point: null,
    bookmaker: "draftkings",
    americanOdds: "110",
    evPercent: "3.5",
    units: "1",
    status: "pending",
    pnl: null,
    commenceTime: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockBets(rows: unknown[]) {
  mockSelect.mockReturnValue({ from: vi.fn().mockResolvedValue(rows) });
}

describe("GET /bets/stats — ROI excludes pending bets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("divides ROI by settled units only, not total units wagered", async () => {
    mockBets([
      makeBet({ id: 1, status: "won", units: "2", pnl: "2.2" }),
      makeBet({ id: 2, status: "lost", units: "2", pnl: "-2" }),
      // Pending bet must not dilute ROI: settled wagered = 4, pnl = 0.2
      makeBet({ id: 3, status: "pending", units: "6", pnl: null }),
    ]);

    const res = await supertest(makeTestApp()).get("/api/bets/stats");
    expect(res.status).toBe(200);
    // ROI = 0.2 / 4 * 100 = 5%, NOT 0.2 / 10 * 100 = 2%
    expect(res.body.roi).toBeCloseTo(5, 5);
    // totalUnitsWagered still reports everything risked, including pending
    expect(res.body.totalUnitsWagered).toBeCloseTo(10, 5);
  });

  it("returns 0 ROI when all bets are pending", async () => {
    mockBets([
      makeBet({ id: 1, status: "pending", units: "3" }),
      makeBet({ id: 2, status: "pending", units: "2" }),
    ]);

    const res = await supertest(makeTestApp()).get("/api/bets/stats");
    expect(res.status).toBe(200);
    expect(res.body.roi).toBe(0);
    expect(res.body.pending).toBe(2);
  });

  it("per-sport wagered excludes pending bets so by-sport ROI matches top-level methodology", async () => {
    mockBets([
      makeBet({ id: 1, sport: "baseball_mlb", status: "won", units: "1", pnl: "0.9" }),
      makeBet({ id: 2, sport: "baseball_mlb", status: "pending", units: "5", pnl: null }),
    ]);

    const res = await supertest(makeTestApp()).get("/api/bets/stats");
    expect(res.status).toBe(200);
    const mlb = res.body.bySport.find((s: { sport: string }) => s.sport === "baseball_mlb");
    expect(mlb).toBeDefined();
    // roi = 0.9 / 1 settled unit = 90%, NOT 0.9 / 6 total units = 15%
    expect(mlb.roi).toBeCloseTo(90, 2);
  });
});
