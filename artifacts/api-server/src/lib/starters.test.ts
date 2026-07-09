import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchTodayStarters, _resetMlbStarterCache, _resetNhlStarterCache } from "./starters";

const TODAY = new Date().toLocaleDateString("en-CA");

function mlbResponse(games: object[]) {
  return {
    dates: [{ games }],
  };
}

interface PitcherStats { era: string; whip: string; }

function makeSeasonStats(stats: PitcherStats) {
  return [
    {
      type: { displayName: "season" },
      group: { displayName: "pitching" },
      splits: [{ stat: { era: stats.era, whip: stats.whip } }],
    },
  ];
}

function makeGame(opts: {
  homeName: string;
  awayName: string;
  homeProbable?: string;
  awayProbable?: string;
  homeConfirmed?: string;
  awayConfirmed?: string;
  homeProbableStats?: PitcherStats;
  awayProbableStats?: PitcherStats;
}) {
  return {
    teams: {
      home: {
        team: { name: opts.homeName },
        ...(opts.homeProbable
          ? {
              probablePitcher: {
                fullName: opts.homeProbable,
                ...(opts.homeProbableStats
                  ? { stats: makeSeasonStats(opts.homeProbableStats) }
                  : {}),
              },
            }
          : {}),
      },
      away: {
        team: { name: opts.awayName },
        ...(opts.awayProbable
          ? {
              probablePitcher: {
                fullName: opts.awayProbable,
                ...(opts.awayProbableStats
                  ? { stats: makeSeasonStats(opts.awayProbableStats) }
                  : {}),
              },
            }
          : {}),
      },
    },
    ...(opts.homeConfirmed || opts.awayConfirmed
      ? {
          lineups: {
            ...(opts.homeConfirmed
              ? { homePitchers: [{ person: { fullName: opts.homeConfirmed } }] }
              : {}),
            ...(opts.awayConfirmed
              ? { awayPitchers: [{ person: { fullName: opts.awayConfirmed } }] }
              : {}),
          },
        }
      : {}),
  };
}

function mockFetch(mlbBody: object, nhlBody: object = { gameWeek: [] }) {
  return vi.fn((url: string) => {
    const urlStr = String(url);
    if (urlStr.includes("statsapi.mlb.com")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mlbBody),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(nhlBody),
    });
  });
}

describe("fetchMlbStarters – confirmed starter badge resilience", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetMlbStarterCache();
  });

  it("sets confirmed=true and uses lineup pitcher when lineups field is present", async () => {
    const game = makeGame({
      homeName: "New York Yankees",
      awayName: "Boston Red Sox",
      homeProbable: "Gerrit Cole",
      awayProbable: "Chris Sale",
      homeConfirmed: "Gerrit Cole",
    });
    vi.stubGlobal("fetch", mockFetch(mlbResponse([game])));

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(1);
    expect(mlb[0].confirmed).toBe(true);
    expect(mlb[0].homeStarter).toBe("Gerrit Cole");
    expect(mlb[0].awayStarter).toBe("Chris Sale");
  });

  it("sets confirmed=false and falls back to probablePitcher when lineups field is absent", async () => {
    const game = makeGame({
      homeName: "Los Angeles Dodgers",
      awayName: "San Francisco Giants",
      homeProbable: "Clayton Kershaw",
      awayProbable: "Logan Webb",
    });
    vi.stubGlobal("fetch", mockFetch(mlbResponse([game])));

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(1);
    expect(mlb[0].confirmed).toBe(false);
    expect(mlb[0].homeStarter).toBe("Clayton Kershaw");
    expect(mlb[0].awayStarter).toBe("Logan Webb");
  });

  it("sets confirmed=false and both starters to null when lineups and probablePitcher are both absent", async () => {
    const game = makeGame({
      homeName: "Chicago Cubs",
      awayName: "St. Louis Cardinals",
    });
    vi.stubGlobal("fetch", mockFetch(mlbResponse([game])));

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(1);
    expect(mlb[0].confirmed).toBe(false);
    expect(mlb[0].homeStarter).toBeNull();
    expect(mlb[0].awayStarter).toBeNull();
  });

  it("returns empty array when MLB API is down (non-ok response)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          return Promise.resolve({ ok: false, status: 503 });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(0);
  });

  it("returns empty array when MLB API throws a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          return Promise.reject(new Error("ECONNREFUSED"));
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(0);
  });

  it("handles a mix of confirmed and probable pitchers in the same response", async () => {
    const confirmedGame = makeGame({
      homeName: "Houston Astros",
      awayName: "Texas Rangers",
      homeProbable: "Justin Verlander",
      awayProbable: "Jacob deGrom",
      homeConfirmed: "Justin Verlander",
      awayConfirmed: "Jacob deGrom",
    });
    const probableGame = makeGame({
      homeName: "Tampa Bay Rays",
      awayName: "Toronto Blue Jays",
      homeProbable: "Shane McClanahan",
      awayProbable: "Kevin Gausman",
    });
    vi.stubGlobal("fetch", mockFetch(mlbResponse([confirmedGame, probableGame])));

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(2);

    const astros = mlb.find((s) => s.homeTeam === "Houston Astros");
    expect(astros?.confirmed).toBe(true);
    expect(astros?.homeStarter).toBe("Justin Verlander");

    const rays = mlb.find((s) => s.homeTeam === "Tampa Bay Rays");
    expect(rays?.confirmed).toBe(false);
    expect(rays?.homeStarter).toBe("Shane McClanahan");
  });
});

describe("fetchMlbStarters – ERA/WHIP stat fallback resilience", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetMlbStarterCache();
  });

  it("populates ERA and WHIP when confirmed starter matches probable and stats are present", async () => {
    const game = makeGame({
      homeName: "New York Yankees",
      awayName: "Boston Red Sox",
      homeProbable: "Gerrit Cole",
      awayProbable: "Chris Sale",
      homeConfirmed: "Gerrit Cole",
      awayConfirmed: "Chris Sale",
      homeProbableStats: { era: "3.14", whip: "1.05" },
      awayProbableStats: { era: "2.90", whip: "0.98" },
    });
    vi.stubGlobal("fetch", mockFetch(mlbResponse([game])));

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(1);
    expect(mlb[0].confirmed).toBe(true);
    expect(mlb[0].homeStarterEra).toBe("3.14");
    expect(mlb[0].homeStarterWhip).toBe("1.05");
    expect(mlb[0].awayStarterEra).toBe("2.90");
    expect(mlb[0].awayStarterWhip).toBe("0.98");
  });

  it("returns null ERA/WHIP (not undefined/NaN) when probable pitcher has no stats field", async () => {
    const game = makeGame({
      homeName: "Los Angeles Dodgers",
      awayName: "San Francisco Giants",
      homeProbable: "Clayton Kershaw",
      awayProbable: "Logan Webb",
      homeConfirmed: "Clayton Kershaw",
      awayConfirmed: "Logan Webb",
    });
    vi.stubGlobal("fetch", mockFetch(mlbResponse([game])));

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(1);
    expect(mlb[0].confirmed).toBe(true);
    expect(mlb[0].homeStarterEra).toBeNull();
    expect(mlb[0].homeStarterWhip).toBeNull();
    expect(mlb[0].awayStarterEra).toBeNull();
    expect(mlb[0].awayStarterWhip).toBeNull();
  });

  it("returns null ERA/WHIP when probable pitcher stats array exists but splits is empty", async () => {
    const game = {
      teams: {
        home: {
          team: { name: "Chicago Cubs" },
          probablePitcher: {
            fullName: "Marcus Stroman",
            stats: [
              {
                type: { displayName: "season" },
                group: { displayName: "pitching" },
                splits: [],
              },
            ],
          },
        },
        away: {
          team: { name: "St. Louis Cardinals" },
          probablePitcher: { fullName: "Miles Mikolas" },
        },
      },
      lineups: {
        homePitchers: [{ person: { fullName: "Marcus Stroman" } }],
        awayPitchers: [{ person: { fullName: "Miles Mikolas" } }],
      },
    };
    vi.stubGlobal("fetch", mockFetch(mlbResponse([game])));

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(1);
    expect(mlb[0].confirmed).toBe(true);
    expect(mlb[0].homeStarterEra).toBeNull();
    expect(mlb[0].homeStarterWhip).toBeNull();
  });

  it("suppresses ERA/WHIP for unconfirmed probable starters (stats available but not yet confirmed)", async () => {
    const game = makeGame({
      homeName: "Houston Astros",
      awayName: "Texas Rangers",
      homeProbable: "Justin Verlander",
      awayProbable: "Jacob deGrom",
      homeProbableStats: { era: "2.75", whip: "0.92" },
      awayProbableStats: { era: "3.50", whip: "1.10" },
    });
    vi.stubGlobal("fetch", mockFetch(mlbResponse([game])));

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(1);
    expect(mlb[0].confirmed).toBe(false);
    expect(mlb[0].homeStarterEra).toBeNull();
    expect(mlb[0].homeStarterWhip).toBeNull();
    expect(mlb[0].awayStarterEra).toBeNull();
    expect(mlb[0].awayStarterWhip).toBeNull();
  });

  it("returns null ERA/WHIP and no crash when MLB API times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          return Promise.reject(
            Object.assign(new DOMException("The operation was aborted.", "AbortError"), {
              name: "AbortError",
            }),
          );
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(0);
  });

  it("nulls out ERA/WHIP when the confirmed lineup pitcher differs from the probable (stats not transferred)", async () => {
    const game = makeGame({
      homeName: "Atlanta Braves",
      awayName: "Miami Marlins",
      homeProbable: "Spencer Strider",
      awayProbable: "Sandy Alcantara",
      homeConfirmed: "Dylan Dodd",
      awayConfirmed: "Sandy Alcantara",
      homeProbableStats: { era: "1.85", whip: "0.82" },
      awayProbableStats: { era: "2.28", whip: "0.95" },
    });
    vi.stubGlobal("fetch", mockFetch(mlbResponse([game])));

    const starters = await fetchTodayStarters();
    const mlb = starters.filter((s) => s.sport === "baseball_mlb");

    expect(mlb).toHaveLength(1);
    expect(mlb[0].confirmed).toBe(true);
    expect(mlb[0].homeStarter).toBe("Dylan Dodd");
    expect(mlb[0].homeStarterEra).toBeNull();
    expect(mlb[0].homeStarterWhip).toBeNull();
    expect(mlb[0].awayStarter).toBe("Sandy Alcantara");
    expect(mlb[0].awayStarterEra).toBe("2.28");
    expect(mlb[0].awayStarterWhip).toBe("0.95");
  });
});

describe("fetchMlbStarters – cache TTL behaviour", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetMlbStarterCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetMlbStarterCache();
  });

  it("caches a successful non-empty response and does not re-fetch within the normal TTL", async () => {
    const game = makeGame({
      homeName: "New York Yankees",
      awayName: "Boston Red Sox",
      homeProbable: "Gerrit Cole",
      awayProbable: "Chris Sale",
    });
    const fetchMock = mockFetch(mlbResponse([game]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchTodayStarters();
    const mlbCallCount = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("statsapi.mlb.com")
    ).length;

    vi.advanceTimersByTime(4 * 60 * 1000);

    await fetchTodayStarters();
    const mlbCallCountAfter = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("statsapi.mlb.com")
    ).length;

    expect(mlbCallCount).toBe(1);
    expect(mlbCallCountAfter).toBe(1);
  });

  it("re-fetches after the normal 5-minute TTL expires for a successful response", async () => {
    const game = makeGame({
      homeName: "New York Yankees",
      awayName: "Boston Red Sox",
      homeProbable: "Gerrit Cole",
      awayProbable: "Chris Sale",
    });
    const fetchMock = mockFetch(mlbResponse([game]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchTodayStarters();

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    await fetchTodayStarters();
    const mlbCallCount = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("statsapi.mlb.com")
    ).length;

    expect(mlbCallCount).toBe(2);
  });

  it("uses a short 90-second TTL when the MLB API returns an error, not the full 5-minute TTL", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          callCount++;
          return Promise.resolve({ ok: false, status: 503 });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    await fetchTodayStarters();
    expect(callCount).toBe(1);

    vi.advanceTimersByTime(91 * 1000);

    await fetchTodayStarters();
    expect(callCount).toBe(2);
  });

  it("still returns stale empty data within the 90-second error window (no extra fetch)", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          callCount++;
          return Promise.resolve({ ok: false, status: 503 });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    await fetchTodayStarters();
    vi.advanceTimersByTime(60 * 1000);
    const result = await fetchTodayStarters();

    expect(callCount).toBe(1);
    expect(result.filter((s) => s.sport === "baseball_mlb")).toHaveLength(0);
  });

  it("returns fresh starters after the API recovers once the error TTL expires", async () => {
    let apiDown = true;
    const game = makeGame({
      homeName: "Houston Astros",
      awayName: "Texas Rangers",
      homeProbable: "Justin Verlander",
      awayProbable: "Jacob deGrom",
      homeConfirmed: "Justin Verlander",
      awayConfirmed: "Jacob deGrom",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          if (apiDown) return Promise.resolve({ ok: false, status: 503 });
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mlbResponse([game])),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    const before = await fetchTodayStarters();
    expect(before.filter((s) => s.sport === "baseball_mlb")).toHaveLength(0);

    apiDown = false;
    vi.advanceTimersByTime(91 * 1000);

    const after = await fetchTodayStarters();
    const mlb = after.filter((s) => s.sport === "baseball_mlb");
    expect(mlb).toHaveLength(1);
    expect(mlb[0].confirmed).toBe(true);
    expect(mlb[0].homeStarter).toBe("Justin Verlander");
  });

  it("uses the short 90-second TTL when the API returns HTTP 200 with empty dates (not just on errors)", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          callCount++;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ dates: [] }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    await fetchTodayStarters();
    expect(callCount).toBe(1);

    vi.advanceTimersByTime(91 * 1000);

    await fetchTodayStarters();
    expect(callCount).toBe(2);
  });

  it("returns fresh starters after recovery from a 200-but-empty response within 90 seconds", async () => {
    let emptyResponse = true;
    const game = makeGame({
      homeName: "Los Angeles Dodgers",
      awayName: "San Francisco Giants",
      homeProbable: "Clayton Kershaw",
      awayProbable: "Logan Webb",
      homeConfirmed: "Clayton Kershaw",
      awayConfirmed: "Logan Webb",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          if (emptyResponse) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ dates: [] }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mlbResponse([game])),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    const before = await fetchTodayStarters();
    expect(before.filter((s) => s.sport === "baseball_mlb")).toHaveLength(0);

    emptyResponse = false;
    vi.advanceTimersByTime(91 * 1000);

    const after = await fetchTodayStarters();
    const mlb = after.filter((s) => s.sport === "baseball_mlb");
    expect(mlb).toHaveLength(1);
    expect(mlb[0].confirmed).toBe(true);
    expect(mlb[0].homeStarter).toBe("Clayton Kershaw");
  });
});

describe("fetchMlbStarters – last-known-good fallback during outage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetMlbStarterCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetMlbStarterCache();
  });

  it("serves last-known-good starters when the API fails after a prior successful fetch", async () => {
    const game = makeGame({
      homeName: "New York Yankees",
      awayName: "Boston Red Sox",
      homeProbable: "Gerrit Cole",
      awayProbable: "Chris Sale",
      homeConfirmed: "Gerrit Cole",
      awayConfirmed: "Chris Sale",
    });

    let apiDown = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          if (apiDown) return Promise.reject(new Error("ECONNREFUSED"));
          return Promise.resolve({ ok: true, json: () => Promise.resolve(mlbResponse([game])) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    const first = await fetchTodayStarters();
    expect(first.filter((s) => s.sport === "baseball_mlb")).toHaveLength(1);

    apiDown = true;
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    const duringOutage = await fetchTodayStarters();
    const mlb = duringOutage.filter((s) => s.sport === "baseball_mlb");
    expect(mlb).toHaveLength(1);
    expect(mlb[0].homeStarter).toBe("Gerrit Cole");
    expect(mlb[0].confirmed).toBe(true);
  });

  it("still re-fetches within the short error TTL when serving last-known-good (no extra fetches inside the window)", async () => {
    const game = makeGame({
      homeName: "New York Yankees",
      awayName: "Boston Red Sox",
      homeProbable: "Gerrit Cole",
      awayProbable: "Chris Sale",
    });

    let callCount = 0;
    let apiDown = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          callCount++;
          if (apiDown) return Promise.reject(new Error("ECONNREFUSED"));
          return Promise.resolve({ ok: true, json: () => Promise.resolve(mlbResponse([game])) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    await fetchTodayStarters();
    expect(callCount).toBe(1);

    apiDown = true;
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    await fetchTodayStarters();
    expect(callCount).toBe(2);

    vi.advanceTimersByTime(60 * 1000);
    await fetchTodayStarters();
    expect(callCount).toBe(2);
  });

  it("returns fresh starters once the API recovers after the error TTL expires while serving last-known-good", async () => {
    const oldGame = makeGame({
      homeName: "New York Yankees",
      awayName: "Boston Red Sox",
      homeProbable: "Gerrit Cole",
      awayProbable: "Chris Sale",
      homeConfirmed: "Gerrit Cole",
      awayConfirmed: "Chris Sale",
    });
    const newGame = makeGame({
      homeName: "New York Yankees",
      awayName: "Boston Red Sox",
      homeProbable: "Clarke Schmidt",
      awayProbable: "Chris Sale",
      homeConfirmed: "Clarke Schmidt",
      awayConfirmed: "Chris Sale",
      homeProbableStats: { era: "3.50", whip: "1.12" },
    });

    let apiDown = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          if (apiDown) return Promise.reject(new Error("ECONNREFUSED"));
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mlbResponse([apiDown ? oldGame : newGame])),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    await fetchTodayStarters();

    apiDown = true;
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await fetchTodayStarters();

    apiDown = false;
    vi.advanceTimersByTime(91 * 1000);

    const after = await fetchTodayStarters();
    const mlb = after.filter((s) => s.sport === "baseball_mlb");
    expect(mlb).toHaveLength(1);
    expect(mlb[0].homeStarter).toBe("Clarke Schmidt");
    expect(mlb[0].confirmed).toBe(true);
  });

  it("does not fall back to last-known-good when the API returns a 200-but-empty response (explicit no games today)", async () => {
    const game = makeGame({
      homeName: "Houston Astros",
      awayName: "Texas Rangers",
      homeProbable: "Justin Verlander",
      awayProbable: "Jacob deGrom",
    });

    let returnEmpty = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("statsapi.mlb.com")) {
          if (returnEmpty) return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(mlbResponse([game])) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
      }),
    );

    const first = await fetchTodayStarters();
    expect(first.filter((s) => s.sport === "baseball_mlb")).toHaveLength(1);

    returnEmpty = true;
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    const second = await fetchTodayStarters();
    expect(second.filter((s) => s.sport === "baseball_mlb")).toHaveLength(0);
  });
});

function nhlScheduleResponse(games: Array<{ id: number; homeTeam: object; awayTeam: object }>) {
  return { gameWeek: [{ games }] };
}

function makeNhlGame(opts: { id: number; homeName: string; awayName: string }) {
  return {
    id: opts.id,
    homeTeam: { name: { default: opts.homeName } },
    awayTeam: { name: { default: opts.awayName } },
  };
}

function makeNhlBoxscore(homeStarter: string | null, awayStarter: string | null) {
  return {
    playerByGameStats: {
      homeTeam: {
        goalies: homeStarter ? [{ name: { default: homeStarter }, starter: true }] : [],
      },
      awayTeam: {
        goalies: awayStarter ? [{ name: { default: awayStarter }, starter: true }] : [],
      },
    },
  };
}

function mockNhlFetch(
  scheduleBody: object,
  boxscoreBody: object = makeNhlBoxscore(null, null),
) {
  return vi.fn((url: string) => {
    const urlStr = String(url);
    if (urlStr.includes("statsapi.mlb.com")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
    }
    if (urlStr.includes("schedule/now")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(scheduleBody) });
    }
    if (urlStr.includes("boxscore")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(boxscoreBody) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

describe("fetchNhlGames – cache TTL behaviour", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetMlbStarterCache();
    _resetNhlStarterCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetMlbStarterCache();
    _resetNhlStarterCache();
  });

  it("caches a successful non-empty response and does not re-fetch within the normal TTL", async () => {
    const schedule = nhlScheduleResponse([makeNhlGame({ id: 1, homeName: "Toronto Maple Leafs", awayName: "Boston Bruins" })]);
    const fetchMock = mockNhlFetch(schedule, makeNhlBoxscore("Ilya Samsonov", "Jeremy Swayman"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchTodayStarters();
    const scheduleCallCount = () =>
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("schedule/now")).length;

    expect(scheduleCallCount()).toBe(1);

    vi.advanceTimersByTime(4 * 60 * 1000);
    await fetchTodayStarters();

    expect(scheduleCallCount()).toBe(1);
  });

  it("re-fetches after the normal 5-minute TTL expires for a successful response", async () => {
    const schedule = nhlScheduleResponse([makeNhlGame({ id: 1, homeName: "Toronto Maple Leafs", awayName: "Boston Bruins" })]);
    const fetchMock = mockNhlFetch(schedule, makeNhlBoxscore("Ilya Samsonov", "Jeremy Swayman"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchTodayStarters();

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await fetchTodayStarters();

    const scheduleCallCount = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("schedule/now")
    ).length;
    expect(scheduleCallCount).toBe(2);
  });

  it("uses a short 90-second TTL when the NHL API returns an error, not the full 5-minute TTL", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("statsapi.mlb.com")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
        }
        if (urlStr.includes("schedule/now")) {
          callCount++;
          return Promise.resolve({ ok: false, status: 503 });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );

    await fetchTodayStarters();
    expect(callCount).toBe(1);

    vi.advanceTimersByTime(91 * 1000);
    await fetchTodayStarters();
    expect(callCount).toBe(2);
  });

  it("still returns stale empty data within the 90-second error window (no extra fetch)", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("statsapi.mlb.com")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
        }
        if (urlStr.includes("schedule/now")) {
          callCount++;
          return Promise.resolve({ ok: false, status: 503 });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );

    await fetchTodayStarters();
    vi.advanceTimersByTime(60 * 1000);
    const result = await fetchTodayStarters();

    expect(callCount).toBe(1);
    expect(result.filter((s) => s.sport === "icehockey_nhl")).toHaveLength(0);
  });

  it("returns fresh starters after the API recovers once the error TTL expires", async () => {
    let apiDown = true;
    const schedule = nhlScheduleResponse([makeNhlGame({ id: 1, homeName: "Toronto Maple Leafs", awayName: "Boston Bruins" })]);

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("statsapi.mlb.com")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
        }
        if (urlStr.includes("schedule/now")) {
          if (apiDown) return Promise.resolve({ ok: false, status: 503 });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(schedule) });
        }
        if (urlStr.includes("boxscore")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(makeNhlBoxscore("Ilya Samsonov", "Jeremy Swayman")) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );

    const before = await fetchTodayStarters();
    expect(before.filter((s) => s.sport === "icehockey_nhl")).toHaveLength(0);

    apiDown = false;
    vi.advanceTimersByTime(91 * 1000);

    const after = await fetchTodayStarters();
    const nhl = after.filter((s) => s.sport === "icehockey_nhl");
    expect(nhl).toHaveLength(1);
    expect(nhl[0].confirmed).toBe(true);
    expect(nhl[0].homeStarter).toBe("Ilya Samsonov");
  });

  it("uses the short 90-second TTL when the API returns HTTP 200 with empty gameWeek (not just on errors)", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("statsapi.mlb.com")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
        }
        if (urlStr.includes("schedule/now")) {
          callCount++;
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );

    await fetchTodayStarters();
    expect(callCount).toBe(1);

    vi.advanceTimersByTime(91 * 1000);
    await fetchTodayStarters();
    expect(callCount).toBe(2);
  });

  it("returns fresh starters after recovery from a 200-but-empty response within 90 seconds", async () => {
    let emptyResponse = true;
    const schedule = nhlScheduleResponse([makeNhlGame({ id: 1, homeName: "Toronto Maple Leafs", awayName: "Boston Bruins" })]);

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("statsapi.mlb.com")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
        }
        if (urlStr.includes("schedule/now")) {
          if (emptyResponse) return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(schedule) });
        }
        if (urlStr.includes("boxscore")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(makeNhlBoxscore("Ilya Samsonov", "Jeremy Swayman")) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );

    const before = await fetchTodayStarters();
    expect(before.filter((s) => s.sport === "icehockey_nhl")).toHaveLength(0);

    emptyResponse = false;
    vi.advanceTimersByTime(91 * 1000);

    const after = await fetchTodayStarters();
    const nhl = after.filter((s) => s.sport === "icehockey_nhl");
    expect(nhl).toHaveLength(1);
    expect(nhl[0].homeStarter).toBe("Ilya Samsonov");
  });
});

describe("fetchNhlGames – last-known-good fallback during outage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetMlbStarterCache();
    _resetNhlStarterCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetMlbStarterCache();
    _resetNhlStarterCache();
  });

  it("serves last-known-good starters when the API fails after a prior successful fetch", async () => {
    const schedule = nhlScheduleResponse([makeNhlGame({ id: 1, homeName: "Toronto Maple Leafs", awayName: "Boston Bruins" })]);
    let apiDown = false;

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("statsapi.mlb.com")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
        }
        if (urlStr.includes("schedule/now")) {
          if (apiDown) return Promise.reject(new Error("ECONNREFUSED"));
          return Promise.resolve({ ok: true, json: () => Promise.resolve(schedule) });
        }
        if (urlStr.includes("boxscore")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(makeNhlBoxscore("Ilya Samsonov", "Jeremy Swayman")) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );

    const first = await fetchTodayStarters();
    expect(first.filter((s) => s.sport === "icehockey_nhl")).toHaveLength(1);

    apiDown = true;
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    const duringOutage = await fetchTodayStarters();
    const nhl = duringOutage.filter((s) => s.sport === "icehockey_nhl");
    expect(nhl).toHaveLength(1);
    expect(nhl[0].homeStarter).toBe("Ilya Samsonov");
    expect(nhl[0].confirmed).toBe(true);
  });

  it("still re-fetches within the short error TTL when serving last-known-good (no extra fetches inside the window)", async () => {
    const schedule = nhlScheduleResponse([makeNhlGame({ id: 1, homeName: "Toronto Maple Leafs", awayName: "Boston Bruins" })]);
    let callCount = 0;
    let apiDown = false;

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("statsapi.mlb.com")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
        }
        if (urlStr.includes("schedule/now")) {
          callCount++;
          if (apiDown) return Promise.reject(new Error("ECONNREFUSED"));
          return Promise.resolve({ ok: true, json: () => Promise.resolve(schedule) });
        }
        if (urlStr.includes("boxscore")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(makeNhlBoxscore("Ilya Samsonov", "Jeremy Swayman")) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );

    await fetchTodayStarters();
    expect(callCount).toBe(1);

    apiDown = true;
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    await fetchTodayStarters();
    expect(callCount).toBe(2);

    vi.advanceTimersByTime(60 * 1000);
    await fetchTodayStarters();
    expect(callCount).toBe(2);
  });

  it("returns fresh starters once the API recovers after the error TTL expires while serving last-known-good", async () => {
    const oldSchedule = nhlScheduleResponse([makeNhlGame({ id: 1, homeName: "Toronto Maple Leafs", awayName: "Boston Bruins" })]);
    const newSchedule = nhlScheduleResponse([makeNhlGame({ id: 2, homeName: "Toronto Maple Leafs", awayName: "Boston Bruins" })]);
    let apiDown = false;

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("statsapi.mlb.com")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
        }
        if (urlStr.includes("schedule/now")) {
          if (apiDown) return Promise.reject(new Error("ECONNREFUSED"));
          return Promise.resolve({ ok: true, json: () => Promise.resolve(apiDown ? oldSchedule : newSchedule) });
        }
        if (urlStr.includes("boxscore")) {
          if (urlStr.includes("/2/")) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(makeNhlBoxscore("Joseph Woll", "Jeremy Swayman")) });
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(makeNhlBoxscore("Ilya Samsonov", "Jeremy Swayman")) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );

    await fetchTodayStarters();

    apiDown = true;
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await fetchTodayStarters();

    apiDown = false;
    vi.advanceTimersByTime(91 * 1000);

    const after = await fetchTodayStarters();
    const nhl = after.filter((s) => s.sport === "icehockey_nhl");
    expect(nhl).toHaveLength(1);
    expect(nhl[0].homeStarter).toBe("Joseph Woll");
    expect(nhl[0].confirmed).toBe(true);
  });

  it("does not fall back to last-known-good when the API returns a 200-but-empty response (explicit no games today)", async () => {
    const schedule = nhlScheduleResponse([makeNhlGame({ id: 1, homeName: "Toronto Maple Leafs", awayName: "Boston Bruins" })]);
    let returnEmpty = false;

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("statsapi.mlb.com")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
        }
        if (urlStr.includes("schedule/now")) {
          if (returnEmpty) return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameWeek: [] }) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(schedule) });
        }
        if (urlStr.includes("boxscore")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(makeNhlBoxscore("Ilya Samsonov", "Jeremy Swayman")) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );

    const first = await fetchTodayStarters();
    expect(first.filter((s) => s.sport === "icehockey_nhl")).toHaveLength(1);

    returnEmpty = true;
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    const second = await fetchTodayStarters();
    expect(second.filter((s) => s.sport === "icehockey_nhl")).toHaveLength(0);
  });
});
