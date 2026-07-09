import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Home from "../home";
import * as apiClient from "@workspace/api-client-react";
import type { EvBet, GameStarter, SharpCoverage } from "@workspace/api-client-react";

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
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: React.ReactNode;
  }) => React.createElement(SelectCtx.Provider, { value: { value, onValueChange } }, children),
  SelectTrigger: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
    React.createElement("button", { type: "button", ...props }, children),
  SelectContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "select-content" }, children),
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => {
    const ctx = React.useContext(SelectCtx);
    return React.createElement(
      "div",
      { role: "option", "data-value": value, onClick: () => ctx.onValueChange?.(value) },
      children,
    );
  },
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement("span", null, placeholder),
}));

const EMPTY_COVERAGE: SharpCoverage = {
  gamesEvaluated: 0,
  gamesWithSharpH2H: 0,
  gamesWithSharpSpreads: 0,
  gamesWithSharpTotals: 0,
};

function makeBet(overrides: Partial<EvBet> = {}): EvBet {
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
    evPercent: 5.2,
    kellyFraction: 0.03,
    suggestedUnits: 1,
    commenceTime: new Date(Date.now() + 3_600_000).toISOString(),
    confidence: 3,
    ...overrides,
  };
}

function makeStarter(overrides: Partial<GameStarter> = {}): GameStarter {
  return {
    homeTeam: "New York Yankees",
    awayTeam: "Boston Red Sox",
    sport: "baseball_mlb",
    homeStarter: "Gerrit Cole",
    awayStarter: "Chris Sale",
    homeStarterEra: null,
    homeStarterWhip: null,
    awayStarterEra: null,
    awayStarterWhip: null,
    starterType: "pitcher",
    confirmed: false,
    ...overrides,
  };
}

function makeEvCardResponse(bets: EvBet[]) {
  return {
    date: new Date().toISOString().split("T")[0],
    bets,
    nearMisses: [],
    hasBets: bets.length > 0,
    requestsRemaining: 100,
    quotaExhausted: false,
    sharpCoverage: EMPTY_COVERAGE,
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
  } as unknown;
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
    </QueryClientProvider>,
  );
}

describe("StarterBadge – ERA/WHIP display when MLB Stats API is slow or unavailable", () => {
  const useGetEvCard = vi.mocked(apiClient.useGetEvCard);
  const useGetNearMisses = vi.mocked(apiClient.useGetNearMisses);
  const useListSports = vi.mocked(apiClient.useListSports);
  const useListStarters = vi.mocked(apiClient.useListStarters);
  const useCreateBet = vi.mocked(apiClient.useCreateBet);
  const useListBets = vi.mocked(apiClient.useListBets);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    useListSports.mockReturnValue(
      makeQueryResult([
        { key: "baseball_mlb", title: "MLB Baseball", active: true },
      ]) as ReturnType<typeof apiClient.useListSports>,
    );
    useListBets.mockReturnValue(
      makeQueryResult([]) as ReturnType<typeof apiClient.useListBets>,
    );
    useCreateBet.mockReturnValue(
      makeMutationResult() as ReturnType<typeof apiClient.useCreateBet>,
    );
    useGetNearMisses.mockReturnValue(
      makeQueryResult([]) as ReturnType<typeof apiClient.useGetNearMisses>,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows ERA and WHIP when confirmed starter has stats from the MLB API", () => {
    const starter = makeStarter({
      confirmed: true,
      homeStarterEra: "3.14",
      homeStarterWhip: "1.05",
      awayStarterEra: "2.90",
      awayStarterWhip: "0.98",
    });
    useListStarters.mockReturnValue(
      makeQueryResult([starter]) as ReturnType<typeof apiClient.useListStarters>,
    );
    useGetEvCard.mockReturnValue(
      makeQueryResult(makeEvCardResponse([makeBet()])) as ReturnType<typeof apiClient.useGetEvCard>,
    );

    renderHome();

    expect(screen.getByText(/ERA 3\.14 \/ WHIP 1\.05/)).toBeInTheDocument();
    expect(screen.getByText(/ERA 2\.90 \/ WHIP 0\.98/)).toBeInTheDocument();
  });

  it("badge still renders when API is slow and stats are unavailable — shows name without ERA/WHIP line", () => {
    const starter = makeStarter({
      confirmed: true,
      homeStarterEra: null,
      homeStarterWhip: null,
      awayStarterEra: null,
      awayStarterWhip: null,
    });
    useListStarters.mockReturnValue(
      makeQueryResult([starter]) as ReturnType<typeof apiClient.useListStarters>,
    );
    useGetEvCard.mockReturnValue(
      makeQueryResult(makeEvCardResponse([makeBet()])) as ReturnType<typeof apiClient.useGetEvCard>,
    );

    renderHome();

    expect(screen.getByText("Confirmed starters")).toBeInTheDocument();
    expect(screen.queryByText(/ERA undefined/)).not.toBeInTheDocument();
    expect(screen.queryByText(/WHIP undefined/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ERA NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/WHIP NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ERA — \/ WHIP —/)).not.toBeInTheDocument();
  });

  it("badge renders 'Probable' state with pitcher name when API returns starters without confirming lineups", () => {
    const starter = makeStarter({
      confirmed: false,
      homeStarterEra: null,
      homeStarterWhip: null,
      awayStarterEra: null,
      awayStarterWhip: null,
    });
    useListStarters.mockReturnValue(
      makeQueryResult([starter]) as ReturnType<typeof apiClient.useListStarters>,
    );
    useGetEvCard.mockReturnValue(
      makeQueryResult(makeEvCardResponse([makeBet()])) as ReturnType<typeof apiClient.useGetEvCard>,
    );

    renderHome();

    const badge = screen.getByText(/Probable:/);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).not.toMatch(/undefined/);
    expect(badge.textContent).not.toMatch(/NaN/);
  });

  it("badge renders 'Pitcher TBD' and does not crash when API timeout returns no starters for the game", () => {
    useListStarters.mockReturnValue(
      makeQueryResult([]) as ReturnType<typeof apiClient.useListStarters>,
    );
    useGetEvCard.mockReturnValue(
      makeQueryResult(makeEvCardResponse([makeBet()])) as ReturnType<typeof apiClient.useGetEvCard>,
    );

    renderHome();

    expect(screen.getByText("Pitcher TBD")).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("shows '—' placeholders in the stat line only when one stat is missing but the other is present", () => {
    const starter = makeStarter({
      confirmed: true,
      homeStarterEra: "2.50",
      homeStarterWhip: null,
      awayStarterEra: null,
      awayStarterWhip: "1.15",
    });
    useListStarters.mockReturnValue(
      makeQueryResult([starter]) as ReturnType<typeof apiClient.useListStarters>,
    );
    useGetEvCard.mockReturnValue(
      makeQueryResult(makeEvCardResponse([makeBet()])) as ReturnType<typeof apiClient.useGetEvCard>,
    );

    renderHome();

    expect(screen.getByText(/ERA 2\.50 \/ WHIP —/)).toBeInTheDocument();
    expect(screen.getByText(/ERA — \/ WHIP 1\.15/)).toBeInTheDocument();
  });
});
