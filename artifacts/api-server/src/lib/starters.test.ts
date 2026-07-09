import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchTodayStarters } from "./starters";

const TODAY = new Date().toLocaleDateString("en-CA");

function mlbResponse(games: object[]) {
  return {
    dates: [{ games }],
  };
}

function makeGame(opts: {
  homeName: string;
  awayName: string;
  homeProbable?: string;
  awayProbable?: string;
  homeConfirmed?: string;
  awayConfirmed?: string;
}) {
  return {
    teams: {
      home: {
        team: { name: opts.homeName },
        ...(opts.homeProbable ? { probablePitcher: { fullName: opts.homeProbable } } : {}),
      },
      away: {
        team: { name: opts.awayName },
        ...(opts.awayProbable ? { probablePitcher: { fullName: opts.awayProbable } } : {}),
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
