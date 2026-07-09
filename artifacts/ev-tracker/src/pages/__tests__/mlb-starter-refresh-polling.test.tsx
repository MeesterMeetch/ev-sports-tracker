/**
 * Task: Confirm starters refresh automatically in the UI after an MLB outage clears.
 *
 * The API server caches MLB errors for only 90 s, so it re-fetches quickly
 * after the MLB API recovers. These tests verify the frontend side of that
 * contract: the starters query polls on an interval no longer than 90 s, and
 * a poll picks up fresh pitcher data and re-renders the badge WITHOUT any
 * manual page reload or remount.
 *
 * Unlike the other page tests, these do NOT mock the api-client hooks — they
 * exercise the real generated react-query hooks against a stubbed `fetch`,
 * so the refetchInterval behaviour is what's actually under test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Home, { STARTERS_REFETCH_INTERVAL_MS } from "../home";
import type { EvBet, GameStarter, SharpCoverage } from "@workspace/api-client-react";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  SelectTrigger: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
    React.createElement("button", { type: "button", ...props }, children),
  SelectContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) =>
    React.createElement("div", { role: "option", "data-value": value }, children),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement("span", null, placeholder),
}));

const FULL_COVERAGE: SharpCoverage = {
  gamesEvaluated: 1,
  gamesWithSharpH2H: 1,
  gamesWithSharpSpreads: 1,
  gamesWithSharpTotals: 1,
};

function makeMlbBet(overrides: Partial<EvBet> = {}): EvBet {
  return {
    gameId: "mlb-game-1",
    homeTeam: "New York Yankees",
    awayTeam: "Boston Red Sox",
    sport: "baseball_mlb",
    market: "h2h",
    selection: "New York Yankees",
    bookmaker: "fanduel",
    americanOdds: -120,
    noVigProb: 0.55,
    estimatedProb: 0.58,
    evPercent: 4.1,
    kellyFraction: 0.03,
    suggestedUnits: 1,
    commenceTime: new Date(Date.now() + 3_600_000).toISOString(),
    confidence: 3,
    ...overrides,
  };
}

function makePitcherStarter(overrides: Partial<GameStarter> = {}): GameStarter {
  return {
    homeTeam: "New York Yankees",
    awayTeam: "Boston Red Sox",
    sport: "baseball_mlb",
    homeStarter: "Gerrit Cole",
    awayStarter: "Chris Sale",
    homeStarterEra: "3.14",
    homeStarterWhip: "1.05",
    awayStarterEra: "2.90",
    awayStarterWhip: "0.98",
    starterType: "pitcher",
    confirmed: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let startersHandler: () => Response;
let startersFetchCount: number;

function urlOf(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return raw.split("?")[0];
}

function installFetchStub() {
  startersFetchCount = 0;
  const evCard = {
    date: new Date().toISOString().split("T")[0],
    bets: [makeMlbBet()],
    nearMisses: [],
    hasBets: true,
    requestsRemaining: 100,
    quotaExhausted: false,
    sharpCoverage: FULL_COVERAGE,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = urlOf(input);
      switch (path) {
        case "/api/odds/starters":
          startersFetchCount += 1;
          return startersHandler();
        case "/api/odds/sports":
          return jsonResponse([{ key: "baseball_mlb", title: "MLB Baseball", active: true }]);
        case "/api/odds/ev-card":
          return jsonResponse(evCard);
        case "/api/odds/near-misses":
          return jsonResponse([]);
        case "/api/bets":
          return jsonResponse([]);
        default:
          return jsonResponse({ message: `Unexpected request: ${path}` }, 404);
      }
    }),
  );
}

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Home />
    </QueryClientProvider>,
  );
}

async function flushInitialQueries() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advanceOnePollCycle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STARTERS_REFETCH_INTERVAL_MS);
  });
}

describe("MLB pitcher starters auto-refresh after an outage clears", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFetchStub();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("polls starters at an interval within the server's 90-second error-cache window", () => {
    expect(STARTERS_REFETCH_INTERVAL_MS).toBeLessThanOrEqual(90_000);
    expect(STARTERS_REFETCH_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("healthy → outage → recovery: confirmed pitcher badge transitions on each poll without a page reload", async () => {
    // Phase 1 — initial load: MLB API is healthy, confirmed pitchers are available
    startersHandler = () => jsonResponse([makePitcherStarter()]);

    renderHome();
    await flushInitialQueries();

    expect(screen.getByText("Confirmed starters")).toBeInTheDocument();
    expect(screen.queryByText("Pitcher TBD")).not.toBeInTheDocument();
    const fetchesAfterLoad = startersFetchCount;
    expect(fetchesAfterLoad).toBeGreaterThanOrEqual(1);

    // Phase 2 — outage: MLB API goes down, server returns empty starters list
    startersHandler = () => jsonResponse([]);

    await advanceOnePollCycle();

    expect(startersFetchCount).toBeGreaterThan(fetchesAfterLoad);
    expect(screen.getByText("Pitcher TBD")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed starters")).not.toBeInTheDocument();
    const fetchesDuringOutage = startersFetchCount;

    // Phase 3 — recovery: MLB API comes back, confirmed pitchers are returned again
    startersHandler = () => jsonResponse([makePitcherStarter()]);

    await advanceOnePollCycle();

    expect(startersFetchCount).toBeGreaterThan(fetchesDuringOutage);
    expect(screen.getByText("Confirmed starters")).toBeInTheDocument();
    expect(screen.queryByText("Pitcher TBD")).not.toBeInTheDocument();
  });

  it("API error (502) → recovery: confirmed pitcher badge appears on the next poll without a reload", async () => {
    // Outage: starters endpoint returns a server error
    startersHandler = () => jsonResponse({ message: "upstream MLB API down" }, 502);

    renderHome();
    await flushInitialQueries();

    expect(screen.getByText("Pitcher TBD")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed starters")).not.toBeInTheDocument();
    const fetchesDuringOutage = startersFetchCount;
    expect(fetchesDuringOutage).toBeGreaterThanOrEqual(1);

    // Recovery: MLB API comes back with confirmed pitchers
    startersHandler = () => jsonResponse([makePitcherStarter()]);

    await advanceOnePollCycle();

    expect(startersFetchCount).toBeGreaterThan(fetchesDuringOutage);
    expect(screen.getByText("Confirmed starters")).toBeInTheDocument();
    expect(screen.queryByText("Pitcher TBD")).not.toBeInTheDocument();
  });
});
