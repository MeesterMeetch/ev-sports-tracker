import { logger } from "./logger";

export interface GameStarter {
  homeTeam: string;
  awayTeam: string;
  sport: string;
  homeStarter: string | null;
  awayStarter: string | null;
  homeStarterEra: string | null;
  homeStarterWhip: string | null;
  awayStarterEra: string | null;
  awayStarterWhip: string | null;
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

interface MlbPitcherStats {
  era: string | null;
  whip: string | null;
}

interface MlbProbablePitcher {
  fullName: string;
  stats?: Array<{
    type?: { displayName?: string };
    group?: { displayName?: string };
    splits?: Array<{ stat?: { era?: string; whip?: string } }>;
  }>;
}

function extractPitcherStats(pitcher: MlbProbablePitcher | undefined): MlbPitcherStats {
  if (!pitcher) return { era: null, whip: null };
  const seasonStats = pitcher.stats?.find(
    (s) => s.type?.displayName === "season" && s.group?.displayName === "pitching"
  );
  const stat = seasonStats?.splits?.[0]?.stat;
  return {
    era: stat?.era ?? null,
    whip: stat?.whip ?? null,
  };
}

async function fetchMlbStarters(): Promise<GameStarter[]> {
  const today = new Date().toLocaleDateString("en-CA");
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=probablePitcher(stats(type=season,group=pitching)),lineups`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`MLB API ${res.status}`);
    const json = (await res.json()) as {
      dates: Array<{
        games: Array<{
          teams: {
            away: { team: { name: string }; probablePitcher?: MlbProbablePitcher };
            home: { team: { name: string }; probablePitcher?: MlbProbablePitcher };
          };
          lineups?: {
            homePitchers?: Array<{ person: { fullName: string } }>;
            awayPitchers?: Array<{ person: { fullName: string } }>;
          };
        }>;
      }>;
    };

    const starters: GameStarter[] = [];
    for (const date of json.dates ?? []) {
      for (const game of date.games ?? []) {
        const confirmedHome = game.lineups?.homePitchers?.[0]?.person.fullName ?? null;
        const confirmedAway = game.lineups?.awayPitchers?.[0]?.person.fullName ?? null;
        const confirmed = confirmedHome !== null || confirmedAway !== null;

        const homeProb = game.teams.home.probablePitcher;
        const awayProb = game.teams.away.probablePitcher;

        const homeStarterName = confirmedHome ?? homeProb?.fullName ?? null;
        const awayStarterName = confirmedAway ?? awayProb?.fullName ?? null;

        const homeStats = confirmedHome === null || confirmedHome === homeProb?.fullName
          ? extractPitcherStats(homeProb)
          : { era: null, whip: null };
        const awayStats = confirmedAway === null || confirmedAway === awayProb?.fullName
          ? extractPitcherStats(awayProb)
          : { era: null, whip: null };

        starters.push({
          homeTeam: game.teams.home.team.name,
          awayTeam: game.teams.away.team.name,
          sport: "baseball_mlb",
          homeStarter: homeStarterName,
          awayStarter: awayStarterName,
          homeStarterEra: confirmed ? homeStats.era : null,
          homeStarterWhip: confirmed ? homeStats.whip : null,
          awayStarterEra: confirmed ? awayStats.era : null,
          awayStarterWhip: confirmed ? awayStats.whip : null,
          starterType: "pitcher",
          confirmed,
        });
      }
    }
    return starters;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch MLB starters");
    return [];
  }
}

interface NhlTeam {
  name?: { default?: string };
  commonName?: { default?: string };
  placeName?: { default?: string };
  abbrev?: string;
}

function getNhlTeamName(team: NhlTeam): string {
  if (team.name?.default) return team.name.default;
  const place = team.placeName?.default ?? "";
  const common = team.commonName?.default ?? "";
  const full = `${place} ${common}`.trim();
  if (full) return full;
  return team.abbrev ?? "Unknown";
}

interface NhlBoxscoreGoalies {
  homeStarter: string | null;
  awayStarter: string | null;
  confirmed: boolean;
}

async function fetchNhlBoxscore(gameId: number): Promise<NhlBoxscoreGoalies | null> {
  const url = `https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      playerByGameStats?: {
        homeTeam?: { goalies?: Array<{ name?: { default?: string }; starter?: boolean }> };
        awayTeam?: { goalies?: Array<{ name?: { default?: string }; starter?: boolean }> };
      };
    };
    const homeGoalies = json.playerByGameStats?.homeTeam?.goalies ?? [];
    const awayGoalies = json.playerByGameStats?.awayTeam?.goalies ?? [];
    const homeStarter = homeGoalies.find((g) => g.starter)?.name?.default ?? null;
    const awayStarter = awayGoalies.find((g) => g.starter)?.name?.default ?? null;
    const confirmed = homeStarter !== null || awayStarter !== null;
    return { homeStarter, awayStarter, confirmed };
  } catch {
    return null;
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
          id: number;
          awayTeam: NhlTeam;
          homeTeam: NhlTeam;
        }>;
      }>;
    };

    const games: Array<{ id: number; homeTeam: string; awayTeam: string }> = [];
    for (const week of json.gameWeek ?? []) {
      for (const game of week.games ?? []) {
        games.push({
          id: game.id,
          homeTeam: getNhlTeamName(game.homeTeam),
          awayTeam: getNhlTeamName(game.awayTeam),
        });
      }
    }

    const boxscores = await Promise.all(games.map((g) => fetchNhlBoxscore(g.id)));

    return games.map((game, i) => {
      const bs = boxscores[i];
      return {
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        sport: "icehockey_nhl",
        homeStarter: bs?.homeStarter ?? null,
        awayStarter: bs?.awayStarter ?? null,
        homeStarterEra: null,
        homeStarterWhip: null,
        awayStarterEra: null,
        awayStarterWhip: null,
        starterType: "goalie",
        confirmed: bs?.confirmed ?? false,
      };
    });
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
