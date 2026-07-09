import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Tracker from "../tracker";
import * as apiClient from "@workspace/api-client-react";
import type { Bet, BetStats } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return {
    ...mod,
    useListBets: vi.fn(),
    useGetBetStats: vi.fn(),
    useUpdateBet: vi.fn(),
    useDeleteBet: vi.fn(),
    getListBetsQueryKey: vi.fn(() => ["/api/bets"] as const),
    getGetBetStatsQueryKey: vi.fn(() => ["/api/bets/stats"] as const),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "responsive-container" }, children),
  AreaChart: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  BarChart: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  Bar: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  Cell: () => null,
  ReferenceLine: () => null,
}));

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

function makeBet(overrides: Partial<Bet> = {}): Bet {
  return {
    id: 1,
    gameId: "game-1",
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    sport: "basketball_nba",
    market: "spreads",
    selection: "Home FC",
    point: -3.5,
    bookmaker: "draftkings",
    americanOdds: -110,
    evPercent: 3.5,
    units: 1,
    status: "pending",
    pnl: null,
    commenceTime: new Date("2026-07-10T18:00:00Z").toISOString(),
    createdAt: new Date("2026-07-09T10:00:00Z").toISOString(),
    notes: null,
    closingOdds: null,
    clvPercent: null,
    ...overrides,
  };
}

function makeStats(overrides: Partial<BetStats> = {}): BetStats {
  return {
    totalBets: 1,
    wins: 0,
    losses: 0,
    pushes: 0,
    pending: 1,
    roi: 0,
    totalUnitsWagered: 1,
    totalPnl: 0,
    winRate: 0,
    ...overrides,
  };
}

function renderTracker() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Tracker />
    </QueryClientProvider>
  );
}

describe("Tracker page — sport label rendering", () => {
  const useListBets = vi.mocked(apiClient.useListBets);
  const useGetBetStats = vi.mocked(apiClient.useGetBetStats);
  const useUpdateBet = vi.mocked(apiClient.useUpdateBet);
  const useDeleteBet = vi.mocked(apiClient.useDeleteBet);

  beforeEach(() => {
    vi.clearAllMocks();
    useUpdateBet.mockReturnValue(
      makeMutationResult() as ReturnType<typeof apiClient.useUpdateBet>
    );
    useDeleteBet.mockReturnValue(
      makeMutationResult() as ReturnType<typeof apiClient.useDeleteBet>
    );
  });

  it("shows a formatted label in the matchup column for an unknown sport key", () => {
    useListBets.mockReturnValue(
      makeQueryResult([
        makeBet({ sport: "cricket_test_match" }),
      ]) as ReturnType<typeof apiClient.useListBets>
    );
    useGetBetStats.mockReturnValue(
      makeQueryResult(makeStats()) as ReturnType<typeof apiClient.useGetBetStats>
    );

    renderTracker();

    expect(screen.getByText("MATCH")).toBeInTheDocument();
    expect(screen.queryByText("cricket_test_match")).not.toBeInTheDocument();
  });

  it("never shows the raw sport key in the matchup column for well-known sports", () => {
    useListBets.mockReturnValue(
      makeQueryResult([
        makeBet({ id: 1, sport: "basketball_nba" }),
        makeBet({ id: 2, sport: "americanfootball_nfl" }),
      ]) as ReturnType<typeof apiClient.useListBets>
    );
    useGetBetStats.mockReturnValue(
      makeQueryResult(makeStats({ totalBets: 2, pending: 2 })) as ReturnType<typeof apiClient.useGetBetStats>
    );

    renderTracker();

    expect(screen.getAllByText("NBA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NFL").length).toBeGreaterThan(0);
    expect(screen.queryByText("basketball_nba")).not.toBeInTheDocument();
    expect(screen.queryByText("americanfootball_nfl")).not.toBeInTheDocument();
  });

  it("shows the formatted label in the Performance by Sport breakdown for an unknown sport key", () => {
    useListBets.mockReturnValue(
      makeQueryResult([
        makeBet({ sport: "cricket_test_match", status: "won", pnl: 1 }),
      ]) as ReturnType<typeof apiClient.useListBets>
    );
    useGetBetStats.mockReturnValue(
      makeQueryResult(
        makeStats({
          totalBets: 1,
          wins: 1,
          losses: 0,
          pending: 0,
          roi: 100,
          bySport: [{ sport: "cricket_test_match", bets: 1, wins: 1, roi: 100 }],
        })
      ) as ReturnType<typeof apiClient.useGetBetStats>
    );

    renderTracker();

    const matchBadges = screen.getAllByText("MATCH");
    expect(matchBadges.length).toBeGreaterThanOrEqual(2);
  });

  it("shows formatted labels in the bySport table for multiple unknown sport keys", () => {
    useListBets.mockReturnValue(
      makeQueryResult([
        makeBet({ id: 1, sport: "cricket_test_match", status: "won", pnl: 1 }),
        makeBet({ id: 2, sport: "rugby_super_league", status: "lost", pnl: -1 }),
      ]) as ReturnType<typeof apiClient.useListBets>
    );
    useGetBetStats.mockReturnValue(
      makeQueryResult(
        makeStats({
          totalBets: 2,
          wins: 1,
          losses: 1,
          pending: 0,
          bySport: [
            { sport: "cricket_test_match", bets: 1, wins: 1, roi: 100 },
            { sport: "rugby_super_league", bets: 1, wins: 0, roi: -100 },
          ],
        })
      ) as ReturnType<typeof apiClient.useGetBetStats>
    );

    renderTracker();

    // The matchup-column badges and bySport badges both use formatSportKey — verify
    // the formatted labels appear (the bySport table also shows the raw key as a
    // subtitle alongside the badge, which is intentional UI).
    expect(screen.getAllByText("MATCH").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("LEAGUE").length).toBeGreaterThanOrEqual(2);

    // The matchup column (bets table) must never expose the raw key — only the badge.
    const matchupCells = document.querySelectorAll("td:nth-child(2) span.inline-block");
    matchupCells.forEach((badge) => {
      expect(badge.textContent).not.toMatch(/_/);
    });
  });
});
