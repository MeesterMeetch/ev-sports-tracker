import { logger } from "./logger";

export interface GameStarter {
  homeTeam: string;
  awayTeam: string;
  sport: string;
  homeStarter: string | null;
  awayStarter: string | null;
  starterType: string;
  confirmed: boolean;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function teamsMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function fetchMlbStarters(): Promise<GameStarter[]> {
  const today = new Date().toLocaleDateString("en-CA");
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=probablePitcher(note)`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`MLB API ${res.status}`);
    const json = (await res.json()) as {
      dates: Array<{
        games: Array<{
          teams: {
            away: { team: { name: string }; probablePitcher?: { fullName: string } };
            home: { team: { name: string }; probablePitcher?: { fullName: string } };
          };
        }>;
      }>;
    };

    const starters: GameStarter[] = [];
    for (const date of json.dates ?? []) {
      for (const game of date.games ?? []) {
        starters.push({
          homeTeam: game.teams.home.team.name,
          awayTeam: game.teams.away.team.name,
          sport: "baseball_mlb",
          homeStarter: game.teams.home.probablePitcher?.fullName ?? null,
          awayStarter: game.teams.away.probablePitcher?.fullName ?? null,
          starterType: "pitcher",
          confirmed: false,
        });
      }
    }
    return starters;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch MLB starters");
    return [];
  }
}

async function fetchNhlGames(): Promise<GameStarter[]> {
  const url = "https://api-web.nhle.com/v1/schedule/now";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`NHL API ${res.status}`);
    const json = (await res.json()) as {
      gameWeek: Array<{
        games: Array<{
          awayTeam: { name: { default: string } };
          homeTeam: { name: { default: string } };
        }>;
      }>;
    };

    const starters: GameStarter[] = [];
    const today = new Date().toLocaleDateString("en-CA");
    for (const week of json.gameWeek ?? []) {
      for (const game of week.games ?? []) {
        starters.push({
          homeTeam: game.homeTeam.name.default,
          awayTeam: game.awayTeam.name.default,
          sport: "icehockey_nhl",
          homeStarter: null,
          awayStarter: null,
          starterType: "goalie",
          confirmed: false,
        });
      }
    }
    return starters;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch NHL schedule");
    return [];
  }
}

export async function fetchTodayStarters(): Promise<GameStarter[]> {
  const [mlb, nhl] = await Promise.all([fetchMlbStarters(), fetchNhlGames()]);
  return [...mlb, ...nhl];
}

export function matchStarter(
  starters: GameStarter[],
  homeTeam: string,
  awayTeam: string,
  sport: string
): GameStarter | null {
  return (
    starters.find(
      (s) =>
        s.sport === sport &&
        teamsMatch(s.homeTeam, homeTeam) &&
        teamsMatch(s.awayTeam, awayTeam)
    ) ?? null
  );
}
