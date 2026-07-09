import { test, expect, type Route } from "@playwright/test";

const MOCK_SPORTS = [
  { key: "americanfootball_nfl", title: "NFL Football", active: true },
  { key: "basketball_nba", title: "NBA Basketball", active: true },
  { key: "baseball_mlb", title: "MLB Baseball", active: true },
];

const H2H_BET = {
  gameId: "nfl-game-1",
  homeTeam: "Chiefs",
  awayTeam: "Eagles",
  sport: "americanfootball_nfl",
  market: "h2h",
  selection: "Chiefs",
  bookmaker: "DraftKings",
  americanOdds: -115,
  noVigProb: 0.535,
  estimatedProb: 0.535,
  evPercent: 3.2,
  kellyFraction: 0.03,
  suggestedUnits: 1,
  commenceTime: new Date(Date.now() + 3_600_000).toISOString(),
};

function makeEvCard(coverage: {
  gamesEvaluated: number;
  gamesWithSharpH2H: number;
  gamesWithSharpSpreads: number;
  gamesWithSharpTotals: number;
}, bets: typeof H2H_BET[] = []) {
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

const ALL_SPORTS_CARD = makeEvCard({
  gamesEvaluated: 12,
  gamesWithSharpH2H: 11,
  gamesWithSharpSpreads: 10,
  gamesWithSharpTotals: 9,
});

const NFL_ZERO_H2H_CARD = makeEvCard(
  {
    gamesEvaluated: 8,
    gamesWithSharpH2H: 0,
    gamesWithSharpSpreads: 6,
    gamesWithSharpTotals: 5,
  },
  [H2H_BET],
);

async function setupRoutes(page: import("@playwright/test").Page) {
  await page.route("**/api/odds/sports", (route: Route) =>
    route.fulfill({ json: MOCK_SPORTS }),
  );

  await page.route("**/api/odds/starters", (route: Route) =>
    route.fulfill({ json: [] }),
  );

  await page.route("**/api/bets", (route: Route) =>
    route.fulfill({ json: [] }),
  );

  await page.route("**/api/odds/near-misses**", (route: Route) =>
    route.fulfill({ json: [] }),
  );

  await page.route("**/api/odds/ev-card**", (route: Route) => {
    const url = route.request().url();
    const params = new URL(url).searchParams;
    const sport = params.get("sport");
    if (sport === "americanfootball_nfl") {
      route.fulfill({ json: NFL_ZERO_H2H_CARD });
    } else {
      route.fulfill({ json: ALL_SPORTS_CARD });
    }
  });
}

test.describe("SharpCoverageBanner — sport switch", () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto("/");
    await page.waitForSelector('[data-testid="select-sport"]', { timeout: 15_000 });
    await expect(page.locator('[data-testid="coverage-moneyline"]')).toBeVisible({ timeout: 10_000 });
  });

  test("all-sports view shows adequate h2h coverage with no red warning", async ({ page }) => {
    await expect(page.locator('[data-testid="coverage-moneyline"]')).toHaveText("11/12");
    await expect(page.locator('[data-testid="warning-h2h"]')).not.toBeVisible();
  });

  test("red 'No sharp lines' warning appears when switching to NFL with 0 h2h sharp-line games", async ({ page }) => {
    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "NFL Football", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-moneyline"]')).toHaveText("0/8", { timeout: 10_000 });

    await expect(page.locator('[data-testid="warning-h2h"]')).toBeVisible();
    await expect(page.locator('[data-testid="warning-h2h"]')).toContainText("No sharp lines");
    await expect(page.locator('[data-testid="warning-h2h"]')).toContainText("Moneyline EV is unreliable for this market");
  });

  test("red zero-coverage warning uses red border styling", async ({ page }) => {
    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "NFL Football", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-moneyline"]')).toHaveText("0/8", { timeout: 10_000 });

    const warning = page.locator('[data-testid="warning-h2h"]');
    await expect(warning).toHaveClass(/border-red-500/);
  });

  test("red warning disappears when switching back to all sports with adequate h2h coverage", async ({ page }) => {
    const sportSelect = page.locator('[data-testid="select-sport"]');

    await sportSelect.click();
    await page.getByRole("option", { name: "NFL Football", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-moneyline"]')).toHaveText("0/8", { timeout: 10_000 });
    await expect(page.locator('[data-testid="warning-h2h"]')).toBeVisible();

    await sportSelect.click();
    await page.getByRole("option", { name: "All Sports", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-moneyline"]')).toHaveText("11/12", { timeout: 10_000 });
    await expect(page.locator('[data-testid="warning-h2h"]')).not.toBeVisible();
  });

  test("coverage numbers change from all-sports to NFL-specific values on sport switch", async ({ page }) => {
    await expect(page.locator('[data-testid="coverage-moneyline"]')).toHaveText("11/12");

    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "NFL Football", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-moneyline"]')).toHaveText("0/8", { timeout: 10_000 });
    await expect(page.locator('[data-testid="coverage-spreads"]')).toHaveText("6/8");
    await expect(page.locator('[data-testid="coverage-totals"]')).toHaveText("5/8");
  });
});
