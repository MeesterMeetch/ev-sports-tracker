import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchTodayStarters } from "./starters";

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
