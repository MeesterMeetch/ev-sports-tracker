/**
 * Task: Confirm goalie starters refresh automatically in the UI after an NHL
 * outage clears.
 *
 * The API server caches NHL errors for only 90 s, so it re-fetches quickly
 * after the NHL API recovers. These tests verify the frontend side of that
 * contract: the starters query polls on an interval no longer than 90 s, and
 * a poll picks up fresh goalie data and re-renders the badge WITHOUT any
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

// Radix Select doesn't play well with jsdom; replace with inert elements.
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

const EMPTY_COVERAGE: SharpCoverage = {
  gamesEvaluated: 1,
  gamesWithSharpH2H: 1,
  gamesWithSharpSpreads: 1,
  gamesWithSharpTotals: 1,
};

function makeNhlBet(overrides: Partial<EvBet> = {}): EvBet {
  return {
    gameId: "nhl-game-1",
    homeTeam: "Edmonton Oilers",
    awayTeam: "Toronto Maple Leafs",
    sport: "icehockey_nhl",
    market: "h2h",
    selection: "Edmonton Oilers",
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

function makeGoalieStarter(overrides: Partial<GameStarter> = {}): GameStarter {
  return {
    homeTeam: "Edmonton Oilers",
    awayTeam: "Toronto Maple Leafs",
    sport: "icehockey_nhl",
    homeStarter: "Stuart Skinner",
    awayStarter: "Anthony Stolarz",
    homeStarterEra: null,
    homeStarterWhip: null,
    awayStarterEra: null,
    awayStarterWhip: null,
    starterType: "goalie",
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

/**
 * Mutable per-test handler for GET /api/odds/starters. All other endpoints
 * get stable canned responses so the page renders one NHL h2h bet card.
 */
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
    bets: [makeNhlBet()],
    nearMisses: [],
    hasBets: true,
    requestsRemaining: 100,
    quotaExhausted: false,
    sharpCoverage: EMPTY_COVERAGE,
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
          return jsonResponse([{ key: "icehockey_nhl", title: "NHL", active: true }]);
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

/** Flush the initial fetches triggered on mount. */
async function flushInitialQueries() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Advance past one starters polling cycle. */
async function advanceOnePollCycle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STARTERS_REFETCH_INTERVAL_MS);
  });
}

describe("Goalie starters auto-refresh after an NHL outage clears", () => {
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
    // The server re-fetches upstream NHL data at most 90 s after an outage
    // clears; the UI must poll at least that often to surface it in time.
    expect(STARTERS_REFETCH_INTERVAL_MS).toBeLessThanOrEqual(90_000);
    expect(STARTERS_REFETCH_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("API error → recovery: goalie badge appears on the next poll without a reload", async () => {
    // Outage: the starters endpoint itself errors (route-level failure, e.g.
    // api-server down/restarting). Note: for a pure NHL upstream outage the
    // server swallows the error and returns [] instead — that path is covered
    // by the "empty schedule" test below.
    startersHandler = () => jsonResponse({ message: "upstream NHL API down" }, 502);

    renderHome();
    await flushInitialQueries();

    // During the outage the NHL card falls back to "Goalie TBD".
    expect(screen.getByText("Goalie TBD")).toBeInTheDocument();
    expect(screen.queryByText(/Starting goalies:/)).not.toBeInTheDocument();
    const fetchesDuringOutage = startersFetchCount;
    expect(fetchesDuringOutage).toBeGreaterThanOrEqual(1);

    // Recovery: the endpoint now returns a confirmed goalie matchup.
    startersHandler = () => jsonResponse([makeGoalieStarter()]);

    // No reload, no remount — just let one polling cycle elapse.
    await advanceOnePollCycle();

    expect(startersFetchCount).toBeGreaterThan(fetchesDuringOutage);
    expect(
      screen.getByText(/Starting goalies: Anthony Stolarz vs\. Stuart Skinner/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Goalie TBD")).not.toBeInTheDocument();
  });

  it("empty schedule → games appear: badge shows up on the next poll without a reload", async () => {
    // Outage aftermath: server returns an empty starters list (no cached data).
    startersHandler = () => jsonResponse([]);

    renderHome();
    await flushInitialQueries();

    expect(screen.getByText("Goalie TBD")).toBeInTheDocument();

    // NHL schedule becomes available again — first as unconfirmed goalies.
    startersHandler = () => jsonResponse([makeGoalieStarter({ confirmed: false })]);
    await advanceOnePollCycle();

    expect(
      screen.getByText(/Goalie unconfirmed — check ~30 min before puck drop/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Goalie TBD")).not.toBeInTheDocument();

    // Then the goalies are confirmed — the badge upgrades on the next poll.
    startersHandler = () => jsonResponse([makeGoalieStarter()]);
    await advanceOnePollCycle();

    expect(
      screen.getByText(/Starting goalies: Anthony Stolarz vs\. Stuart Skinner/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Goalie unconfirmed/)).not.toBeInTheDocument();
  });
});
