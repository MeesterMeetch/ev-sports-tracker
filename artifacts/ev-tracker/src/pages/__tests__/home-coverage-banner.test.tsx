import { describe, it, expect, vi, beforeEach, afterEach, createContext, useContext } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

const NBA_COVERAGE: SharpCoverage = {
  gamesEvaluated: 3,
  gamesWithSharpH2H: 3,
  gamesWithSharpSpreads: 1,
  gamesWithSharpTotals: 2,
};

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
});
