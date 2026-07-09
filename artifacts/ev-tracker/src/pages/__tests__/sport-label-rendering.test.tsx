import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Games from "../games";
import * as apiClient from "@workspace/api-client-react";
import type { GameWithOdds, Sport } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return {
    ...mod,
    useListGames: vi.fn(),
    getListGamesQueryKey: vi.fn((params?: Record<string, string>) => [
      "/api/odds/games",
      ...(params ? [params] : []),
    ]),
    useListSports: vi.fn(),
    useAnalyzeGame: vi.fn(),
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
  }) =>
    React.createElement(
      SelectCtx.Provider,
      { value: { value, onValueChange } },
      children
    ),

  SelectTrigger: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLButtonElement> & {
    children?: React.ReactNode;
  }) => React.createElement("button", { type: "button", ...props }, children),

  SelectContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(
      "div",
      { "data-testid": "select-content" },
      children
    ),

  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children?: React.ReactNode;
  }) => {
    const ctx = React.useContext(SelectCtx);
    return React.createElement(
      "div",
      {
        role: "option",
        "data-value": value,
        onClick: () => ctx.onValueChange?.(value),
      },
      children
    );
  },

  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement("span", null, placeholder),
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

function makeGame(overrides: Partial<GameWithOdds> = {}): GameWithOdds {
  return {
    id: "game-1",
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    sport: "basketball_nba",
    commenceTime: new Date().toISOString(),
    bookmakers: [],
    ...overrides,
  };
}

function makeActiveSport(key: string, title: string): Sport {
  return { key, title, active: true };
}

function renderGames() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Games />
    </QueryClientProvider>
  );
}

describe("Games page — sport label rendering", () => {
  const useListGames = vi.mocked(apiClient.useListGames);
  const useListSports = vi.mocked(apiClient.useListSports);
  const useAnalyzeGame = vi.mocked(apiClient.useAnalyzeGame);

  beforeEach(() => {
    vi.clearAllMocks();
    useAnalyzeGame.mockReturnValue(
      makeMutationResult() as ReturnType<typeof apiClient.useAnalyzeGame>
    );
  });

  it("renders a human-readable label for a well-known sport key", () => {
    useListSports.mockReturnValue(
      makeQueryResult([
        makeActiveSport("basketball_nba", "NBA Basketball"),
      ]) as ReturnType<typeof apiClient.useListSports>
    );
    useListGames.mockReturnValue(
      makeQueryResult([
        makeGame({ sport: "basketball_nba" }),
      ]) as ReturnType<typeof apiClient.useListGames>
    );

    renderGames();

    expect(screen.getByText("NBA")).toBeInTheDocument();
    expect(screen.queryByText("basketball_nba")).not.toBeInTheDocument();
  });

  it("renders the last segment uppercased for an unknown underscore-separated sport key", () => {
    useListSports.mockReturnValue(
      makeQueryResult([
        makeActiveSport("basketball_euroleague", "Basketball Euroleague"),
      ]) as ReturnType<typeof apiClient.useListSports>
    );
    useListGames.mockReturnValue(
      makeQueryResult([
        makeGame({ sport: "basketball_euroleague" }),
      ]) as ReturnType<typeof apiClient.useListGames>
    );

    renderGames();

    expect(screen.getByText("EUROLEAGUE")).toBeInTheDocument();
    expect(
      screen.queryByText("basketball_euroleague")
    ).not.toBeInTheDocument();
  });

  it("never renders any raw underscore-separated string when multiple unknown sports are present", () => {
    const unknownSports: Sport[] = [
      makeActiveSport("cricket_odi", "Cricket ODI"),
      makeActiveSport("rugby_super_league", "Rugby Super League"),
      makeActiveSport("esports_lol_worlds", "LoL Worlds"),
    ];
    const games: GameWithOdds[] = [
      makeGame({ id: "g1", sport: "cricket_odi" }),
      makeGame({ id: "g2", sport: "rugby_super_league" }),
      makeGame({ id: "g3", sport: "esports_lol_worlds" }),
    ];

    useListSports.mockReturnValue(
      makeQueryResult(unknownSports) as ReturnType<typeof apiClient.useListSports>
    );
    useListGames.mockReturnValue(
      makeQueryResult(games) as ReturnType<typeof apiClient.useListGames>
    );

    const { container } = renderGames();

    const rawKeyPattern = /\b\w+_\w+\b/;
    expect(container.textContent).not.toMatch(rawKeyPattern);

    expect(screen.getByText("ODI")).toBeInTheDocument();
    expect(screen.getByText("LEAGUE")).toBeInTheDocument();
    expect(screen.getByText("WORLDS")).toBeInTheDocument();
  });

  it("renders a single-segment key entirely uppercased with no underscores", () => {
    useListSports.mockReturnValue(
      makeQueryResult([
        makeActiveSport("mma", "MMA"),
      ]) as ReturnType<typeof apiClient.useListSports>
    );
    useListGames.mockReturnValue(
      makeQueryResult([
        makeGame({ sport: "mma" }),
      ]) as ReturnType<typeof apiClient.useListGames>
    );

    const { container } = renderGames();

    expect(screen.getAllByText("MMA").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bmma\b/);
  });
});
