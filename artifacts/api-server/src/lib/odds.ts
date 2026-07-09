import { logger } from "./logger";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

function getApiKey(): string | undefined {
  return process.env.ODDS_API_KEY_V2 ?? process.env.ODDS_API_KEY;
}

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

export interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}

export interface OddsGame {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

export interface OddsSport {
  key: string;
  group: string;
  title: string;
  description: string;
  active: boolean;
  has_outrights: boolean;
}

async function oddsApiFetch<T>(path: string, params: Record<string, string> = {}): Promise<{ data: T; requestsRemaining: number | null }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("ODDS_API_KEY not set");
  const url = new URL(`${ODDS_API_BASE}${path}`);
  url.searchParams.set("apiKey", apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, text }, "Odds API error");
    throw new Error(`Odds API error ${res.status}: ${text}`);
  }
  const remaining = res.headers.get("x-requests-remaining");
  const data = (await res.json()) as T;
  return { data, requestsRemaining: remaining ? parseInt(remaining, 10) : null };
}

export async function fetchSports(): Promise<{ data: OddsSport[]; requestsRemaining: number | null }> {
  return oddsApiFetch<OddsSport[]>("/sports");
}

export async function fetchOdds(sportKey: string, markets = "h2h,spreads,totals"): Promise<{ data: OddsGame[]; requestsRemaining: number | null }> {
  return oddsApiFetch<OddsGame[]>(`/sports/${sportKey}/odds`, {
    regions: "us",
    markets,
    oddsFormat: "american",
    dateFormat: "iso",
    bookmakers: "pinnacle,lowvig,betonlineag,draftkings,fanduel,betmgm,caesars,pointsbet",
  });
}

/**
 * Fetches odds for a single event. Much cheaper than a full sport scan when
 * capturing closing lines: cost scales with markets requested, not with the
 * number of games on the slate.
 */
export async function fetchEventOdds(sportKey: string, eventId: string, markets: string): Promise<{ data: OddsGame; requestsRemaining: number | null }> {
  return oddsApiFetch<OddsGame>(`/sports/${sportKey}/events/${eventId}/odds`, {
    regions: "us",
    markets,
    oddsFormat: "american",
    dateFormat: "iso",
  });
}

export async function fetchMultiSportOdds(sportKeys: string[], markets = "h2h,spreads,totals"): Promise<{ games: OddsGame[]; requestsRemaining: number | null; quotaExhausted: boolean }> {
  const allGames: OddsGame[] = [];
  let requestsRemaining: number | null = null;
  let quotaExhausted = false;
  let successCount = 0;

  for (const key of sportKeys) {
    try {
      const result = await fetchOdds(key, markets);
      allGames.push(...result.data);
      requestsRemaining = result.requestsRemaining;
      successCount++;
    } catch (err) {
      const msg = String(err);
      if (
        msg.includes("OUT_OF_USAGE_CREDITS") ||
        msg.includes("quota") ||
        msg.includes("429")
      ) {
        quotaExhausted = true;
      }
      logger.warn({ sport: key, err }, "Failed to fetch odds for sport");
    }
  }

  if (quotaExhausted && successCount === 0) {
    throw new Error("Odds API quota exhausted — top up at https://the-odds-api.com");
  }

  return { games: allGames, requestsRemaining, quotaExhausted };
}
