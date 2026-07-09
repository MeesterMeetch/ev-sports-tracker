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

const SPREADS_BET = {
  gameId: "nba-game-1",
  homeTeam: "Lakers",
  awayTeam: "Celtics",
  sport: "basketball_nba",
  market: "spreads",
  selection: "Lakers",
  bookmaker: "FanDuel",
  americanOdds: -110,
  noVigProb: 0.52,
  estimatedProb: 0.54,
  evPercent: 2.8,
  kellyFraction: 0.025,
  suggestedUnits: 1,
  commenceTime: new Date(Date.now() + 3_600_000).toISOString(),
};

const TOTALS_BET = {
  gameId: "mlb-game-1",
  homeTeam: "Yankees",
  awayTeam: "Red Sox",
  sport: "baseball_mlb",
  market: "totals",
  selection: "Over 8.5",
  bookmaker: "BetMGM",
  americanOdds: -115,
  noVigProb: 0.54,
  estimatedProb: 0.56,
  evPercent: 3.1,
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

const NBA_ZERO_SPREADS_CARD = makeEvCard(
  {
    gamesEvaluated: 10,
    gamesWithSharpH2H: 9,
    gamesWithSharpSpreads: 0,
    gamesWithSharpTotals: 7,
  },
  [SPREADS_BET],
);

const MLB_ZERO_TOTALS_CARD = makeEvCard(
  {
    gamesEvaluated: 6,
    gamesWithSharpH2H: 5,
    gamesWithSharpSpreads: 4,
    gamesWithSharpTotals: 0,
  },
  [TOTALS_BET],
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
    } else if (sport === "basketball_nba") {
      route.fulfill({ json: NBA_ZERO_SPREADS_CARD });
    } else if (sport === "baseball_mlb") {
      route.fulfill({ json: MLB_ZERO_TOTALS_CARD });
    } else {
      route.fulfill({ json: ALL_SPORTS_CARD });
    }
  });
}

const NBA_ZERO_SPREADS_AND_TOTALS_CARD = makeEvCard(
  {
    gamesEvaluated: 10,
    gamesWithSharpH2H: 9,
    gamesWithSharpSpreads: 0,
    gamesWithSharpTotals: 0,
  },
  [
    { ...SPREADS_BET },
    { ...TOTALS_BET, gameId: "nba-game-2", sport: "basketball_nba", homeTeam: "Warriors", awayTeam: "Suns", selection: "Over 220.5" },
  ],
);

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

  test("red 'No sharp lines' warning appears for spreads when NBA has 0 spreads sharp-line games", async ({ page }) => {
    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "NBA Basketball", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-spreads"]')).toHaveText("0/10", { timeout: 10_000 });

    await expect(page.locator('[data-testid="warning-spreads"]')).toBeVisible();
    await expect(page.locator('[data-testid="warning-spreads"]')).toContainText("No sharp lines");
    await expect(page.locator('[data-testid="warning-spreads"]')).toContainText("Spreads EV is unreliable for this market");
  });

  test("spreads zero-coverage warning uses red border styling", async ({ page }) => {
    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "NBA Basketball", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-spreads"]')).toHaveText("0/10", { timeout: 10_000 });

    const warning = page.locator('[data-testid="warning-spreads"]');
    await expect(warning).toHaveClass(/border-red-500/);
  });

  test("no warning-h2h or warning-totals shown when only spreads coverage is zero for NBA", async ({ page }) => {
    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "NBA Basketball", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-spreads"]')).toHaveText("0/10", { timeout: 10_000 });

    await expect(page.locator('[data-testid="warning-h2h"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="warning-totals"]')).not.toBeVisible();
  });

  test("red 'No sharp lines' warning appears for totals when MLB has 0 totals sharp-line games", async ({ page }) => {
    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "MLB Baseball", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-totals"]')).toHaveText("0/6", { timeout: 10_000 });

    await expect(page.locator('[data-testid="warning-totals"]')).toBeVisible();
    await expect(page.locator('[data-testid="warning-totals"]')).toContainText("No sharp lines");
    await expect(page.locator('[data-testid="warning-totals"]')).toContainText("Totals EV is unreliable for this market");
  });

  test("totals zero-coverage warning uses red border styling", async ({ page }) => {
    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "MLB Baseball", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-totals"]')).toHaveText("0/6", { timeout: 10_000 });

    const warning = page.locator('[data-testid="warning-totals"]');
    await expect(warning).toHaveClass(/border-red-500/);
  });

  test("no warning-h2h or warning-spreads shown when only totals coverage is zero for MLB", async ({ page }) => {
    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "MLB Baseball", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-totals"]')).toHaveText("0/6", { timeout: 10_000 });

    await expect(page.locator('[data-testid="warning-h2h"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="warning-spreads"]')).not.toBeVisible();
  });
});

// The home page auto-refreshes the EV card every 300 s via a countdown
// interval. These tests fast-forward that timer with Playwright's fake clock
// to trigger a genuine background refetch (a second route fulfillment) and
// assert the red zero-coverage warning never flickers away. A MutationObserver
// installed before the refetch records any removal of the warning node, so
// even an instantaneous unmount/remount between polls would be caught.
test.describe("SharpCoverageBanner — background auto-refresh stability", () => {
  async function armFlickerDetector(page: import("@playwright/test").Page, testId: string) {
    await page.evaluate((id) => {
      const w = window as unknown as { __warningRemoved: boolean };
      w.__warningRemoved = false;
      const selector = `[data-testid="${id}"]`;
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of Array.from(m.removedNodes)) {
            if (
              node instanceof HTMLElement &&
              (node.matches(selector) || node.querySelector(selector) !== null)
            ) {
              w.__warningRemoved = true;
            }
          }
        }
        if (!document.querySelector(selector)) {
          w.__warningRemoved = true;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, testId);
  }

  test("warning-spreads stays continuously visible across a background refetch", async ({ page }) => {
    await page.clock.install();
    await setupRoutes(page);

    let nbaRequests = 0;
    await page.route("**/api/odds/ev-card**", (route: Route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get("sport") === "basketball_nba") {
        nbaRequests += 1;
        route.fulfill({
          json: { ...NBA_ZERO_SPREADS_CARD, requestsRemaining: 100 - nbaRequests },
        });
      } else {
        route.fulfill({ json: ALL_SPORTS_CARD });
      }
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="select-sport"]', { timeout: 15_000 });
    await expect(page.locator('[data-testid="coverage-moneyline"]')).toBeVisible({ timeout: 10_000 });

    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "NBA Basketball", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-spreads"]')).toHaveText("0/10", { timeout: 10_000 });
    await expect(page.locator('[data-testid="warning-spreads"]')).toBeVisible();
    expect(nbaRequests).toBe(1);

    await armFlickerDetector(page, "warning-spreads");

    // Fast-forward past the 300 s auto-refresh countdown, firing every
    // interval tick so handleRefresh actually runs.
    await page.clock.runFor(301_000);

    // Wait for the second (background) fulfillment to land.
    await expect.poll(() => nbaRequests, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

    // Warning must still be there, and must never have been removed mid-cycle.
    await expect(page.locator('[data-testid="warning-spreads"]')).toBeVisible();
    await expect(page.locator('[data-testid="coverage-spreads"]')).toHaveText("0/10");
    const removed = await page.evaluate(
      () => (window as unknown as { __warningRemoved: boolean }).__warningRemoved,
    );
    expect(removed, "warning-spreads flickered away during background refetch").toBe(false);
  });

  test("warning-totals stays continuously visible across a background refetch", async ({ page }) => {
    await page.clock.install();
    await setupRoutes(page);

    let mlbRequests = 0;
    await page.route("**/api/odds/ev-card**", (route: Route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get("sport") === "baseball_mlb") {
        mlbRequests += 1;
        route.fulfill({
          json: { ...MLB_ZERO_TOTALS_CARD, requestsRemaining: 100 - mlbRequests },
        });
      } else {
        route.fulfill({ json: ALL_SPORTS_CARD });
      }
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="select-sport"]', { timeout: 15_000 });
    await expect(page.locator('[data-testid="coverage-moneyline"]')).toBeVisible({ timeout: 10_000 });

    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "MLB Baseball", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-totals"]')).toHaveText("0/6", { timeout: 10_000 });
    await expect(page.locator('[data-testid="warning-totals"]')).toBeVisible();
    expect(mlbRequests).toBe(1);

    await armFlickerDetector(page, "warning-totals");

    await page.clock.runFor(301_000);

    await expect.poll(() => mlbRequests, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

    await expect(page.locator('[data-testid="warning-totals"]')).toBeVisible();
    await expect(page.locator('[data-testid="coverage-totals"]')).toHaveText("0/6");
    const removed = await page.evaluate(
      () => (window as unknown as { __warningRemoved: boolean }).__warningRemoved,
    );
    expect(removed, "warning-totals flickered away during background refetch").toBe(false);
  });
});

test.describe("SharpCoverageBanner — combined zero coverage", () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.route("**/api/odds/ev-card**", (route: Route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get("sport") === "basketball_nba") {
        route.fulfill({ json: NBA_ZERO_SPREADS_AND_TOTALS_CARD });
      } else {
        route.fulfill({ json: ALL_SPORTS_CARD });
      }
    });
    await page.goto("/");
    await page.waitForSelector('[data-testid="select-sport"]', { timeout: 15_000 });
    await expect(page.locator('[data-testid="coverage-moneyline"]')).toBeVisible({ timeout: 10_000 });
  });

  test("both red warnings show simultaneously when spreads and totals are both zero-coverage", async ({ page }) => {
    const sportSelect = page.locator('[data-testid="select-sport"]');
    await sportSelect.click();
    await page.getByRole("option", { name: "NBA Basketball", exact: true }).click();

    await expect(page.locator('[data-testid="coverage-spreads"]')).toHaveText("0/10", { timeout: 10_000 });
    await expect(page.locator('[data-testid="coverage-totals"]')).toHaveText("0/10");

    const spreadsWarning = page.locator('[data-testid="warning-spreads"]');
    const totalsWarning = page.locator('[data-testid="warning-totals"]');

    await expect(spreadsWarning).toBeVisible();
    await expect(totalsWarning).toBeVisible();

    await expect(spreadsWarning).toContainText("No sharp lines");
    await expect(spreadsWarning).toContainText("Spreads EV is unreliable for this market");
    await expect(totalsWarning).toContainText("No sharp lines");
    await expect(totalsWarning).toContainText("Totals EV is unreliable for this market");

    await expect(spreadsWarning).toHaveClass(/border-red-500/);
    await expect(totalsWarning).toHaveClass(/border-red-500/);

    await expect(page.locator('[data-testid="warning-h2h"]')).not.toBeVisible();
  });
});
