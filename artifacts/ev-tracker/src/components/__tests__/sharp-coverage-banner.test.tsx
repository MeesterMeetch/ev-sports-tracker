import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SharpCoverageBanner } from "../sharp-coverage-banner";
import type { SharpCoverage, EvBet } from "@workspace/api-client-react";

function makeCoverage(overrides: Partial<SharpCoverage> = {}): SharpCoverage {
  return {
    gamesEvaluated: 10,
    gamesWithSharpH2H: 8,
    gamesWithSharpSpreads: 7,
    gamesWithSharpTotals: 6,
    ...overrides,
  };
}

function makeBet(market: string): EvBet {
  return {
    gameId: "game-1",
    homeTeam: "Team A",
    awayTeam: "Team B",
    sport: "americanfootball_nfl",
    market,
    selection: "Team A",
    bookmaker: "draftkings",
    americanOdds: -110,
    noVigProb: 0.52,
    estimatedProb: 0.54,
    evPercent: 3.8,
    kellyFraction: 0.04,
    suggestedUnits: 1,
    commenceTime: new Date().toISOString(),
  };
}

describe("SharpCoverageBanner", () => {
  describe("visibility", () => {
    it("renders the banner when sharpCoverage is present with gamesEvaluated > 0", () => {
      render(<SharpCoverageBanner coverage={makeCoverage()} />);
      expect(screen.getByText("Sharp coverage")).toBeInTheDocument();
    });

    it("renders nothing when gamesEvaluated is 0", () => {
      const { container } = render(
        <SharpCoverageBanner coverage={makeCoverage({ gamesEvaluated: 0 })} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("coverage stat display", () => {
    it("shows all three market counts with total games evaluated", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({
            gamesEvaluated: 10,
            gamesWithSharpH2H: 8,
            gamesWithSharpSpreads: 5,
            gamesWithSharpTotals: 3,
          })}
        />
      );
      expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("8/10");
      expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("5/10");
      expect(screen.getByTestId("coverage-totals")).toHaveTextContent("3/10");
    });

    it("reflects exact counts passed in props — stats do not bleed across filters", () => {
      const { rerender } = render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 4, gamesWithSharpH2H: 4, gamesWithSharpSpreads: 2, gamesWithSharpTotals: 1 })}
        />
      );
      expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("4/4");
      expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("2/4");
      expect(screen.getByTestId("coverage-totals")).toHaveTextContent("1/4");

      rerender(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 6, gamesWithSharpH2H: 3, gamesWithSharpSpreads: 6, gamesWithSharpTotals: 5 })}
        />
      );
      expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("3/6");
      expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("6/6");
      expect(screen.getByTestId("coverage-totals")).toHaveTextContent("5/6");
    });
  });

  describe("color thresholds", () => {
    it("applies green when coverage ≥ 75%", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 4, gamesWithSharpH2H: 3, gamesWithSharpSpreads: 3, gamesWithSharpTotals: 3 })}
        />
      );
      expect(screen.getByTestId("coverage-moneyline")).toHaveClass("text-green-400");
      expect(screen.getByTestId("coverage-spreads")).toHaveClass("text-green-400");
    });

    it("applies green at exactly 75%", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 8, gamesWithSharpH2H: 6, gamesWithSharpSpreads: 6, gamesWithSharpTotals: 6 })}
        />
      );
      expect(screen.getByTestId("coverage-moneyline")).toHaveClass("text-green-400");
    });

    it("applies yellow when coverage ≥ 40% and < 75%", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 10, gamesWithSharpH2H: 6, gamesWithSharpSpreads: 4, gamesWithSharpTotals: 7 })}
        />
      );
      expect(screen.getByTestId("coverage-moneyline")).toHaveClass("text-yellow-400");
      expect(screen.getByTestId("coverage-spreads")).toHaveClass("text-yellow-400");
    });

    it("applies yellow at exactly 40%", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 10, gamesWithSharpH2H: 4, gamesWithSharpSpreads: 4, gamesWithSharpTotals: 4 })}
        />
      );
      expect(screen.getByTestId("coverage-moneyline")).toHaveClass("text-yellow-400");
    });

    it("applies red when coverage < 40%", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 10, gamesWithSharpH2H: 3, gamesWithSharpSpreads: 1, gamesWithSharpTotals: 0 })}
        />
      );
      expect(screen.getByTestId("coverage-moneyline")).toHaveClass("text-red-400");
      expect(screen.getByTestId("coverage-spreads")).toHaveClass("text-red-400");
      expect(screen.getByTestId("coverage-totals")).toHaveClass("text-red-400");
    });
  });

  describe("low-coverage warnings", () => {
    it("shows a warning for a market that is active in bets and has < 50% coverage", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 10, gamesWithSharpSpreads: 4 })}
          bets={[makeBet("spreads")]}
        />
      );
      expect(screen.getByTestId("warning-spreads")).toBeInTheDocument();
      expect(screen.getByTestId("warning-spreads")).toHaveTextContent(
        "Spreads EV may be unreliable"
      );
    });

    it("does not warn about a market that has ≥ 50% coverage", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 10, gamesWithSharpSpreads: 5 })}
          bets={[makeBet("spreads")]}
        />
      );
      expect(screen.queryByTestId("warning-spreads")).not.toBeInTheDocument();
    });

    it("does not warn about a market that has low coverage but is absent from active bets", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 10, gamesWithSharpSpreads: 2 })}
          bets={[makeBet("h2h")]}
        />
      );
      expect(screen.queryByTestId("warning-spreads")).not.toBeInTheDocument();
    });

    it("shows no warnings when bets prop is omitted", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 10, gamesWithSharpH2H: 1, gamesWithSharpSpreads: 1, gamesWithSharpTotals: 1 })}
        />
      );
      expect(screen.queryByTestId("warning-h2h")).not.toBeInTheDocument();
      expect(screen.queryByTestId("warning-spreads")).not.toBeInTheDocument();
      expect(screen.queryByTestId("warning-totals")).not.toBeInTheDocument();
    });

    it("can warn on multiple markets simultaneously", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 10, gamesWithSharpH2H: 2, gamesWithSharpSpreads: 3 })}
          bets={[makeBet("h2h"), makeBet("spreads")]}
        />
      );
      expect(screen.getByTestId("warning-h2h")).toBeInTheDocument();
      expect(screen.getByTestId("warning-spreads")).toBeInTheDocument();
      expect(screen.queryByTestId("warning-totals")).not.toBeInTheDocument();
    });
  });

  describe("filter simulation — banner shows correct numbers per sport/market slice", () => {
    it("renders sport-filtered coverage (fewer gamesEvaluated) with correct stats", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 3, gamesWithSharpH2H: 3, gamesWithSharpSpreads: 1, gamesWithSharpTotals: 2 })}
          bets={[makeBet("spreads")]}
        />
      );
      expect(screen.getByTestId("coverage-moneyline")).toHaveTextContent("3/3");
      expect(screen.getByTestId("coverage-spreads")).toHaveTextContent("1/3");
      expect(screen.getByTestId("coverage-totals")).toHaveTextContent("2/3");
      expect(screen.getByTestId("warning-spreads")).toBeInTheDocument();
    });

    it("hides warning when market-filtered bets no longer include a low-coverage market", () => {
      render(
        <SharpCoverageBanner
          coverage={makeCoverage({ gamesEvaluated: 10, gamesWithSharpSpreads: 2 })}
          bets={[makeBet("totals")]}
        />
      );
      expect(screen.queryByTestId("warning-spreads")).not.toBeInTheDocument();
    });
  });
});
