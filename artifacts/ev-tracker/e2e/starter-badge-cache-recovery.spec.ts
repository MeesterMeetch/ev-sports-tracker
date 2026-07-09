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

const MOCK_NHL_SPORTS = [
  { key: "icehockey_nhl", title: "NHL Ice Hockey", active: true },
];

const NHL_BET = {
  gameId: "nhl-game-1",
  homeTeam: "Edmonton Oilers",
  awayTeam: "Toronto Maple Leafs",
  sport: "icehockey_nhl",
  market: "h2h",
  selection: "Edmonton Oilers",
  bookmaker: "FanDuel",
  americanOdds: -120,
  noVigProb: 0.55,
  estimatedProb: 0.58,
  evPercent: 4.1,
  kellyFraction: 0.03,
  suggestedUnits: 1,
  commenceTime: new Date(Date.now() + 3_600_000).toISOString(),
};

const NHL_EV_CARD_WITH_BET = {
  date: new Date().toISOString().split("T")[0],
  bets: [NHL_BET],
  nearMisses: [],
  hasBets: true,
  requestsRemaining: 100,
  quotaExhausted: false,
  sharpCoverage: {
    gamesEvaluated: 3,
    gamesWithSharpH2H: 3,
    gamesWithSharpSpreads: 2,
    gamesWithSharpTotals: 2,
  },
};

const CONFIRMED_GOALIE_STARTER: Record<string, unknown> = {
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
};

test.describe("Goalie badge — NHL cache recovery after outage", () => {
  test("goalie badge reappears after NHL API recovers and the error cache clears, without a page reload", async ({ page }) => {
    await page.clock.install({ time: Date.now() });

    // Outage: the API server's NHL fetch failed and it has no cached data, so
    // /api/odds/starters serves an empty list (the server swallows upstream
    // errors and caches the empty result for only 90 s).
    let startersPayload: unknown[] = [];

    await page.route("**/api/odds/sports", (route) =>
      route.fulfill({ json: MOCK_NHL_SPORTS }),
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
      route.fulfill({ json: NHL_EV_CARD_WITH_BET }),
    );

    await page.goto("/");
    await page.waitForSelector('[data-testid="select-sport"]', { timeout: 15_000 });

    // During the outage the NHL card falls back to "Goalie TBD" — no badge.
    await expect(page.locator('[data-testid="starter-badge"]')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Goalie TBD').first()).toBeVisible({ timeout: 5_000 });

    // Plant a marker to prove recovery happens WITHOUT a page reload.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__noReloadMarker = true;
    });

    // Recovery: the NHL API is back and the server's 90-second error cache
    // has cleared, so the endpoint now returns a confirmed goalie matchup.
    startersPayload = [CONFIRMED_GOALIE_STARTER];

    // Advance past one frontend polling cycle (60 s interval, 65 s margin) —
    // well within the server's 90-second error-cache window.
    await page.clock.fastForward(65_000);

    await expect(page.locator('[data-testid="starter-badge"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="starter-badge"]')).toContainText("Starting goalies");
    await expect(page.locator('[data-testid="starter-badge"]')).toContainText("Anthony Stolarz");
    await expect(page.locator('[data-testid="starter-badge"]')).toContainText("Stuart Skinner");
    await expect(page.locator('text=Goalie TBD')).not.toBeVisible();

    // The marker must still be present — the badge re-rendered in place.
    const markerSurvived = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__noReloadMarker === true,
    );
    expect(markerSurvived).toBe(true);
  });

  test("unconfirmed goalies upgrade to a confirmed badge on a later poll", async ({ page }) => {
    await page.clock.install({ time: Date.now() });

    // Recovery aftermath: schedule is back but goalies not yet confirmed.
    let startersPayload: unknown[] = [
      { ...CONFIRMED_GOALIE_STARTER, homeStarter: null, awayStarter: null, confirmed: false },
    ];

    await page.route("**/api/odds/sports", (route) =>
      route.fulfill({ json: MOCK_NHL_SPORTS }),
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
      route.fulfill({ json: NHL_EV_CARD_WITH_BET }),
    );

    await page.goto("/");
    await page.waitForSelector('[data-testid="select-sport"]', { timeout: 15_000 });

    await expect(page.locator("text=Goalie unconfirmed").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="starter-badge"]')).not.toBeVisible();

    // Goalies get confirmed upstream; the next poll upgrades the badge.
    startersPayload = [CONFIRMED_GOALIE_STARTER];

    await page.clock.fastForward(65_000);

    await expect(page.locator('[data-testid="starter-badge"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="starter-badge"]')).toContainText("Starting goalies");
    await expect(page.locator("text=Goalie unconfirmed")).not.toBeVisible();
  });
});

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
