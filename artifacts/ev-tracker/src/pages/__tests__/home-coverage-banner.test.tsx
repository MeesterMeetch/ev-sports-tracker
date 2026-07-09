import { describe, it, expect, vi, beforeEach, afterEach, createContext, useContext } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Home from "../home";
import * as apiClient from "@workspace/api-client-react";
import type { SharpCoverage, EvBet, Sport } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return {
    ...mod,
    useGetEvCard: vi.fn(),
    getGetEvCardQueryKey: vi.fn((params?: Record<string, string>) => [
      "/api/odds/ev-card",
      ...(params ? [params] : []),
    ]),
    useGetNearMisses: vi.fn(),
    getGetNearMissesQueryKey: vi.fn((params?: Record<string, string>) => [
      "/api/odds/near-misses",
      ...(params ? [params] : []),
    ]),
    useListSports: vi.fn(),
    useListStarters: vi.fn(),
    useCreateBet: vi.fn(),
    useListBets: vi.fn(),
    getListBetsQueryKey: vi.fn(() => ["/api/bets"]),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

type SelectCtx = { value?: string; onValueChange?: (v: string) => void };
const SelectCtx = React.createContext<SelectCtx>({});

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode }) =>
    React.createElement(SelectCtx.Provider, { value: { value, onValueChange } }, children),

  SelectTrigger: ({ children, ...props }: React.HTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
    React.createElement("button", { type: "button", ...props }, children),

  SelectContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "select-content" }, children),

  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => {
    const ctx = React.useContext(SelectCtx);
    return React.createElement(
      "div",
      { role: "option", "data-value": value, onClick: () => ctx.onValueChange?.(value) },
      children
    );
  },

  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement("span", null, placeholder),
}));

const ALL_SPORTS_COVERAGE: SharpCoverage = {
  gamesEvaluated: 10,
  gamesWithSharpH2H: 9,
  gamesWithSharpSpreads: 8,
  gamesWithSharpTotals: 7,
};

const REFRESHED_COVERAGE: SharpCoverage = {
  gamesEvaluated: 14,
  gamesWithSharpH2H: 13,
  gamesWithSharpSpreads: 12,
  gamesWithSharpTotals: 11,
};

const NBA_COVERAGE: SharpCoverage = {
  gamesEvaluated: 3,
  gamesWithSharpH2H: 3,
  gamesWithSharpSpreads: 1,
  gamesWithSharpTotals: 2,
};

const NFL_ZERO_H2H_COVERAGE: SharpCoverage = {
  gamesEvaluated: 8,
  gamesWithSharpH2H: 0,
  gamesWithSharpSpreads: 6,
  gamesWithSharpTotals: 5,
};

function makeH2HBet(): EvBet {
  return {
    gameId: "nfl-game-1",
    homeTeam: "Chiefs",
    awayTeam: "Eagles",
    sport: "americanfootball_nfl",
    market: "h2h",
    selection: "Chiefs",
    bookmaker: "draftkings",
    americanOdds: -115,
    noVigProb: 0.535,
    estimatedProb: 0.535,
    evPercent: 3.2,
    kellyFraction: 0.03,
    suggestedUnits: 1,
    commenceTime: new Date().toISOString(),
  };
}

const MOCK_SPORTS: Sport[] = [
  { key: "americanfootball_nfl", title: "NFL Football", active: true },
  { key: "basketball_nba", title: "Basketball NBA", active: true },
  { key: "baseball_mlb", title: "MLB Baseball", active: true },
];

function makeEvCardResponse(coverage: SharpCoverage, bets: EvBet[] = []) {
  return {
    date: new Date().toISOString().split("T")[0],
    bets,
    nearMisses: [],
    hasBets: bets.length > 0,
    requestsRemaining: 100,
    quotaExhausted: false,
    sharpCoverage: coverage,
  };
}

function makeQueryResult<T>(data: T) {
  return {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    isFetching: false,
    isSuccess: true,
    refetch: vi.fn().mockResolvedValue({}),
    queryKey: [],
  };
}

function makeMutationResult() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    reset: vi.fn(),
    data: undefined,
    error: null,
    variables: undefined,
    status: "idle" as const,
    context: undefined,
    failureCount: 0,
    failureReason: null,
    isIdle: true,
    isPaused: false,
    submittedAt: 0,
  };
}

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Home />
    </QueryClientProvider>
  );
}

describe("Home page — SharpCoverageBanner updates on sport switch", () => {
  const useGetEvCard = vi.mocked(apiClient.useGetEvCard);
  const useGetNearMisses = vi.mocked(apiClient.useGetNearMisses);
  const useListSports = vi.mocked(apiClient.useListSports);
  const useListStarters = vi.mocked(apiClient.useListStarters);
  const useCreateBet = vi.mocked(apiClient.useCreateBet);
  const useListBets = vi.mocked(apiClient.useListBets);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });

    useListSports.mockReturnValue(makeQueryResult(MOCK_SPORTS) as ReturnType<typeof apiClient.useListSports>);
    useListStarters.mockReturnValue(makeQueryResult([]) as ReturnType<typeof apiClient.useListStarters>);
    useListBets.mockReturnValue(makeQueryResult([]) as ReturnType<typeof apiClient.useListBets>);
    useCreateBet.mockReturnValue(makeMutationResult() as ReturnType<typeof apiClient.useCreateBet>);
    useGetNearMisses.mockReturnValue(makeQueryResult([]) as ReturnType<typeof apiClient.useGetNearMisses>);

    useGetEvCard.mockImplementation((params) => {
      const coverage =
        params && "sport" in params && params.sport === "basketball_nba"
          ? NBA_COVERAGE
          : ALL_SPORTS_COVERAGE;
      return makeQueryResult(makeEvCardResponse(coverage)) as ReturnType<typeof apiClient.useGetEvCard>;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows all-sports coverage banner on initial render", () => {
    renderHome();
    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("9/10");
    expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("8/10");
    expect(screen.getByTestId("coverage-totals")).toHaveTextContent("7/10");
  });

  it("calls useGetEvCard with empty params when sport is 'all'", () => {
    renderHome();
    const firstCall = useGetEvCard.mock.calls[0];
    expect(firstCall[0]).toEqual({});
  });

  it("calls useGetEvCard with the correct sport param after switching sport", () => {
    renderHome();

    const nbaOption = screen.getByRole("option", { name: "Basketball NBA" });
    fireEvent.click(nbaOption);

    const sportCalls = useGetEvCard.mock.calls.filter(
      ([params]) => params && "sport" in params && params.sport === "basketball_nba"
    );
    expect(sportCalls.length).toBeGreaterThan(0);
  });

  it("banner reflects fresh sport-scoped coverage after switching sport", () => {
    renderHome();

    const nbaOption = screen.getByRole("option", { name: "Basketball NBA" });
    fireEvent.click(nbaOption);

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("3/3");
    expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("1/3");
    expect(screen.getByTestId("coverage-totals")).toHaveTextContent("2/3");
  });

  it("does not show stale all-sports numbers after switching to a sport with fewer games", () => {
    renderHome();

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("9/10");

    const nbaOption = screen.getByRole("option", { name: "Basketball NBA" });
    fireEvent.click(nbaOption);

    expect(screen.getByTestId("coverage-moneyline")).not.toHaveTextContent("9/10");
    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("3/3");
  });

  it("shows yellow color on spreads after switching to NBA (1/3 = 33% coverage)", () => {
    renderHome();

    const nbaOption = screen.getByRole("option", { name: "Basketball NBA" });
    fireEvent.click(nbaOption);

    expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("1/3");
    expect(screen.getByTestId("coverage-spreads")).toHaveClass("text-red-400");
  });

  it("switching back to all-sports restores the broader coverage numbers", () => {
    renderHome();

    const nbaOption = screen.getByRole("option", { name: "Basketball NBA" });
    fireEvent.click(nbaOption);
    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("3/3");

    const allOption = screen.getByRole("option", { name: "All Sports" });
    fireEvent.click(allOption);

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("9/10");
    expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("8/10");
    expect(screen.getByTestId("coverage-totals")).toHaveTextContent("7/10");
  });

  it("banner reflects new sharpCoverage after manual refresh, not the stale cached values", () => {
    renderHome();

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("9/10");
    expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("8/10");
    expect(screen.getByTestId("coverage-totals")).toHaveTextContent("7/10");

    act(() => { vi.advanceTimersByTime(1000); });

    useGetEvCard.mockImplementation(() =>
      makeQueryResult(makeEvCardResponse(REFRESHED_COVERAGE)) as ReturnType<typeof apiClient.useGetEvCard>
    );

    const refreshButton = screen.getByTitle("Refresh markets");
    fireEvent.click(refreshButton);

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("13/14");
    expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("12/14");
    expect(screen.getByTestId("coverage-totals")).toHaveTextContent("11/14");
  });

  it("banner does not show stale numbers after refresh — old counts are gone", () => {
    renderHome();

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("9/10");

    act(() => { vi.advanceTimersByTime(1000); });

    useGetEvCard.mockImplementation(() =>
      makeQueryResult(makeEvCardResponse(REFRESHED_COVERAGE)) as ReturnType<typeof apiClient.useGetEvCard>
    );

    const refreshButton = screen.getByTitle("Refresh markets");
    fireEvent.click(refreshButton);

    expect(screen.getByTestId("coverage-moneyline")).not.toHaveTextContent("9/10");
    expect(screen.getByTestId("coverage-spreads")).not.toHaveTextContent("8/10");
    expect(screen.getByTestId("coverage-totals")).not.toHaveTextContent("7/10");
  });

  it("refresh does not serve stale coverage for more than one render cycle", () => {
    renderHome();

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("9/10");

    act(() => { vi.advanceTimersByTime(1000); });

    useGetEvCard.mockImplementation(() =>
      makeQueryResult(makeEvCardResponse(REFRESHED_COVERAGE)) as ReturnType<typeof apiClient.useGetEvCard>
    );

    const refreshButton = screen.getByTitle("Refresh markets");
    fireEvent.click(refreshButton);

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("13/14");
    expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("12/14");
    expect(screen.getByTestId("coverage-totals")).toHaveTextContent("11/14");

    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.click(refreshButton);

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("13/14");
    expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("12/14");
    expect(screen.getByTestId("coverage-totals")).toHaveTextContent("11/14");
  });
});

describe("Home page — red zero-coverage warning on sport switch", () => {
  const useGetEvCard = vi.mocked(apiClient.useGetEvCard);
  const useGetNearMisses = vi.mocked(apiClient.useGetNearMisses);
  const useListSports = vi.mocked(apiClient.useListSports);
  const useListStarters = vi.mocked(apiClient.useListStarters);
  const useCreateBet = vi.mocked(apiClient.useCreateBet);
  const useListBets = vi.mocked(apiClient.useListBets);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });

    useListSports.mockReturnValue(makeQueryResult(MOCK_SPORTS) as ReturnType<typeof apiClient.useListSports>);
    useListStarters.mockReturnValue(makeQueryResult([]) as ReturnType<typeof apiClient.useListStarters>);
    useListBets.mockReturnValue(makeQueryResult([]) as ReturnType<typeof apiClient.useListBets>);
    useCreateBet.mockReturnValue(makeMutationResult() as ReturnType<typeof apiClient.useCreateBet>);
    useGetNearMisses.mockReturnValue(makeQueryResult([]) as ReturnType<typeof apiClient.useGetNearMisses>);

    useGetEvCard.mockImplementation((params) => {
      if (params && "sport" in params && params.sport === "americanfootball_nfl") {
        return makeQueryResult(
          makeEvCardResponse(NFL_ZERO_H2H_COVERAGE, [makeH2HBet()])
        ) as ReturnType<typeof apiClient.useGetEvCard>;
      }
      return makeQueryResult(
        makeEvCardResponse(ALL_SPORTS_COVERAGE)
      ) as ReturnType<typeof apiClient.useGetEvCard>;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("red warning-h2h appears after switching to a sport with 0 h2h sharp-line games and active h2h bets", () => {
    renderHome();

    expect(screen.queryByTestId("warning-h2h")).not.toBeInTheDocument();

    const nflOption = screen.getByRole("option", { name: "NFL Football" });
    fireEvent.click(nflOption);

    const warning = screen.getByTestId("warning-h2h");
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent("No sharp lines");
    expect(warning).toHaveTextContent("Moneyline EV is unreliable for this market");
  });

  it("red warning-h2h uses red border styling, not amber", () => {
    renderHome();

    const nflOption = screen.getByRole("option", { name: "NFL Football" });
    fireEvent.click(nflOption);

    const warning = screen.getByTestId("warning-h2h");
    expect(warning).toHaveClass("border-red-500/40");
    expect(warning).not.toHaveClass("border-amber-500/40");
  });

  it("coverage-moneyline stat shows 0/8 (red) after switching to zero-h2h sport", () => {
    renderHome();

    const nflOption = screen.getByRole("option", { name: "NFL Football" });
    fireEvent.click(nflOption);

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("0/8");
    expect(screen.getByTestId("coverage-moneyline")).toHaveClass("text-red-400");
  });

  it("red warning disappears when switching back to a sport with adequate h2h coverage", () => {
    renderHome();

    const nflOption = screen.getByRole("option", { name: "NFL Football" });
    fireEvent.click(nflOption);

    expect(screen.getByTestId("warning-h2h")).toBeInTheDocument();

    const allOption = screen.getByRole("option", { name: "All Sports" });
    fireEvent.click(allOption);

    expect(screen.queryByTestId("warning-h2h")).not.toBeInTheDocument();
  });

  it("coverage numbers update away from the zero-h2h values after switching back to all sports", () => {
    renderHome();

    const nflOption = screen.getByRole("option", { name: "NFL Football" });
    fireEvent.click(nflOption);

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("0/8");

    const allOption = screen.getByRole("option", { name: "All Sports" });
    fireEvent.click(allOption);

    expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("9/10");
    expect(screen.getByTestId("coverage-moneyline")).not.toHaveTextContent("0/8");
  });

  it("spreads and totals warnings do not appear when only h2h has zero coverage", () => {
    renderHome();

    const nflOption = screen.getByRole("option", { name: "NFL Football" });
    fireEvent.click(nflOption);

    expect(screen.queryByTestId("warning-spreads")).not.toBeInTheDocument();
    expect(screen.queryByTestId("warning-totals")).not.toBeInTheDocument();
  });
});
