import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchMultiSportOdds } from "./odds";

const makeGame = (sportKey: string) => ({
  id: `game-${sportKey}`,
  sport_key: sportKey,
  sport_title: sportKey,
  commence_time: new Date(Date.now() + 3600 * 1000).toISOString(),
  home_team: "Home",
  away_team: "Away",
  bookmakers: [],
});

function mockFetchResponse(body: unknown, status = 200, remaining = "400") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k === "x-requests-remaining" ? remaining : null) },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

describe("fetchMultiSportOdds – quota handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.ODDS_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ODDS_API_KEY;
    delete process.env.ODDS_API_KEY_V2;
  });

  it("returns all games and quotaExhausted: false when every sport succeeds", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse([makeGame("baseball_mlb")]) as Response)
      .mockResolvedValueOnce(mockFetchResponse([makeGame("basketball_nba")]) as Response);

    const result = await fetchMultiSportOdds(["baseball_mlb", "basketball_nba"]);

    expect(result.games).toHaveLength(2);
    expect(result.quotaExhausted).toBe(false);
    expect(result.requestsRemaining).toBe(400);
  });

  it("returns partial games and quotaExhausted: true when a 429 is received mid-scan", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse([makeGame("baseball_mlb")]) as Response)
      .mockResolvedValueOnce(mockFetchResponse("quota exceeded", 429) as Response);

    const result = await fetchMultiSportOdds(["baseball_mlb", "basketball_nba"]);

    expect(result.games).toHaveLength(1);
    expect(result.games[0].sport_key).toBe("baseball_mlb");
    expect(result.quotaExhausted).toBe(true);
  });

  it("returns partial games and quotaExhausted: true when OUT_OF_USAGE_CREDITS is returned", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse([makeGame("baseball_mlb")]) as Response)
      .mockResolvedValueOnce(mockFetchResponse("OUT_OF_USAGE_CREDITS", 422) as Response);

    const result = await fetchMultiSportOdds(["baseball_mlb", "basketball_nba"]);

    expect(result.games).toHaveLength(1);
    expect(result.quotaExhausted).toBe(true);
  });

  it("throws when quota is exhausted on the very first sport (no partial games)", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse("OUT_OF_USAGE_CREDITS", 422) as Response)
      .mockResolvedValueOnce(mockFetchResponse("OUT_OF_USAGE_CREDITS", 422) as Response);

    await expect(
      fetchMultiSportOdds(["baseball_mlb", "basketball_nba"])
    ).rejects.toThrow(/quota exhausted/i);
  });

  it("returns quotaExhausted: false and empty games when all sports return empty arrays", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse([]) as Response)
      .mockResolvedValueOnce(mockFetchResponse([]) as Response);

    const result = await fetchMultiSportOdds(["baseball_mlb", "basketball_nba"]);

    expect(result.games).toHaveLength(0);
    expect(result.quotaExhausted).toBe(false);
  });
});
