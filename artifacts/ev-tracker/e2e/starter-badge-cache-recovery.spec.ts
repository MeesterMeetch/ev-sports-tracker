import { test, expect } from "@playwright/test";

const MOCK_SPORTS = [
  { key: "baseball_mlb", title: "MLB Baseball", active: true },
];

const MLB_BET = {
  gameId: "mlb-game-1",
  homeTeam: "Yankees",
  awayTeam: "Red Sox",
  sport: "baseball_mlb",
  market: "h2h",
  selection: "Yankees",
  bookmaker: "DraftKings",
  americanOdds: -120,
  noVigProb: 0.545,
  estimatedProb: 0.545,
  evPercent: 3.5,
  kellyFraction: 0.03,
  suggestedUnits: 1,
  commenceTime: new Date(Date.now() + 3_600_000).toISOString(),
};

const EV_CARD_WITH_BET = {
  date: new Date().toISOString().split("T")[0],
  bets: [MLB_BET],
  nearMisses: [],
  hasBets: true,
  requestsRemaining: 100,
  quotaExhausted: false,
  sharpCoverage: {
    gamesEvaluated: 5,
    gamesWithSharpH2H: 5,
    gamesWithSharpSpreads: 4,
    gamesWithSharpTotals: 4,
  },
};

const CONFIRMED_STARTER: Record<string, unknown> = {
  homeTeam: "Yankees",
  awayTeam: "Red Sox",
  sport: "baseball_mlb",
  homeStarter: "Gerrit Cole",
  awayStarter: "Chris Sale",
  homeStarterEra: 3.2,
  homeStarterWhip: 1.05,
  awayStarterEra: 3.8,
  awayStarterWhip: 1.1,
  starterType: "pitcher",
  confirmed: true,
};

test.describe("StarterBadge — cache recovery after outage", () => {
  test("confirmed starter badge reappears after API recovers and cache expires", async ({ page }) => {
    await page.clock.install({ time: Date.now() });

    let startersPayload: unknown[] = [];

    await page.route("**/api/odds/sports", (route) =>
      route.fulfill({ json: MOCK_SPORTS }),
    );

    await page.route("**/api/odds/starters", (route) =>
      route.fulfill({ json: startersPayload }),
    );

    await page.route("**/api/bets", (route) =>
      route.fulfill({ json: [] }),
    );

    await page.route("**/api/odds/near-misses**", (route) =>
      route.fulfill({ json: [] }),
    );

    await page.route("**/api/odds/ev-card**", (route) =>
      route.fulfill({ json: EV_CARD_WITH_BET }),
    );

    await page.goto("/");
    await page.waitForSelector('[data-testid="select-sport"]', { timeout: 15_000 });

    await expect(page.locator('[data-testid="starter-badge"]')).not.toBeVisible({ timeout: 10_000 });

    await expect(page.locator('text=Pitcher TBD').first()).toBeVisible({ timeout: 5_000 });

    startersPayload = [CONFIRMED_STARTER];

    await page.clock.fastForward(65_000);

    await expect(page.locator('[data-testid="starter-badge"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="starter-badge"]')).toContainText("Confirmed starters");
    await expect(page.locator('[data-testid="starter-badge"]')).toContainText("Gerrit Cole");
    await expect(page.locator('[data-testid="starter-badge"]')).toContainText("Chris Sale");
  });

  test("starters refetch interval is at most 2 minutes so recovery is detected quickly", async ({ page }) => {
    await page.clock.install({ time: Date.now() });

    let startersPayload: unknown[] = [];

    await page.route("**/api/odds/sports", (route) =>
      route.fulfill({ json: MOCK_SPORTS }),
    );

    await page.route("**/api/odds/starters", (route) =>
      route.fulfill({ json: startersPayload }),
    );

    await page.route("**/api/bets", (route) =>
      route.fulfill({ json: [] }),
    );

    await page.route("**/api/odds/near-misses**", (route) =>
      route.fulfill({ json: [] }),
    );

    await page.route("**/api/odds/ev-card**", (route) =>
      route.fulfill({ json: EV_CARD_WITH_BET }),
    );

    await page.goto("/");
    await page.waitForSelector('[data-testid="select-sport"]', { timeout: 15_000 });

    await expect(page.locator('[data-testid="starter-badge"]')).not.toBeVisible({ timeout: 10_000 });

    startersPayload = [CONFIRMED_STARTER];

    await page.clock.fastForward(2 * 60 * 1000);

    await expect(page.locator('[data-testid="starter-badge"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="starter-badge"]')).toContainText("Confirmed starters");
  });
});
