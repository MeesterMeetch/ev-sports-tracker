const SPORT_LABELS: Record<string, string> = {
  americanfootball_nfl: "NFL",
  americanfootball_ncaaf: "NCAAF",
  basketball_nba: "NBA",
  basketball_ncaab: "NCAAB",
  baseball_mlb: "MLB",
  icehockey_nhl: "NHL",
  tennis_atp: "ATP",
  golf_pga_championship: "PGA",
  soccer_usa_mls: "MLS",
};

export function formatSportKey(key: string): string {
  return SPORT_LABELS[key] ?? key.split("_").pop()?.toUpperCase() ?? key;
}

export function formatGameTime(isoString: string): string {
  const d = new Date(isoString);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function formatAmericanOdds(odds: number): string {
  if (odds > 0) return `+${odds}`;
  return odds.toString();
}

export function formatPercent(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatUnits(units: number, decimals: number = 2): string {
  const formatted = Math.abs(units).toFixed(decimals);
  if (units > 0) return `+${formatted}u`;
  if (units < 0) return `-${formatted}u`;
  return `${formatted}u`;
}

export function getEvColorClass(evPercent: number): string {
  if (evPercent >= 4) return "text-green-500 font-bold";
  if (evPercent >= 2) return "text-yellow-500 font-bold";
  return "text-gray-400";
}

export function getPnlColorClass(pnl: number | null | undefined): string {
  if (pnl == null) return "text-gray-400";
  if (pnl > 0) return "text-green-500 font-bold";
  if (pnl < 0) return "text-red-500 font-bold";
  return "text-gray-400";
}

export function getStatusColorClass(status: string): string {
  switch (status.toLowerCase()) {
    case "won": return "text-green-500 bg-green-500/10 border-green-500/20";
    case "lost": return "text-red-500 bg-red-500/10 border-red-500/20";
    case "push": return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
    default: return "text-gray-400 bg-gray-800 border-gray-700";
  }
}
