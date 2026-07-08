export const SPORTS: Record<string, string> = {
  americanfootball_nfl: "NFL",
  americanfootball_ncaaf: "NCAAF",
  basketball_nba: "NBA",
  basketball_wnba: "WNBA",
  basketball_ncaab: "NCAAB",
  baseball_mlb: "MLB",
  icehockey_nhl: "NHL",
  tennis_atp: "ATP",
  golf_pga_championship: "PGA",
  soccer_usa_mls: "MLS",
};

export const ACTIVE_SPORT_KEYS: string[] = Object.keys(SPORTS);

export function formatSportKey(key: string): string {
  return SPORTS[key] ?? key.split("_").pop()?.toUpperCase() ?? key;
}
