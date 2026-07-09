import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEvCard,
  getGetEvCardQueryKey,
  getListStartersQueryKey,
  useGetNearMisses,
  getGetNearMissesQueryKey,
  useListSports,
  useListStarters,
  useCreateBet,
  useListBets,
  getListBetsQueryKey,
} from "@workspace/api-client-react";
import type { EvBet, GameStarter, SharpCoverage } from "@workspace/api-client-react";
import {
  formatAmericanOdds,
  formatPercent,
  formatSportKey,
  formatGameTime,
  getEvColorClass,
  formatUnits,
} from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SaveBetDialog } from "@/components/save-bet-dialog";
import { SharpCoverageBanner } from "@/components/sharp-coverage-banner";
import { Star, TrendingUp, AlertTriangle, Check, Plus, RefreshCw, EyeOff, Eye, WifiOff, Mail, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const REFRESH_SECONDS = 300;
const EV_SANITY_THRESHOLD = 30;
const NEAR_MISS_MIN_EV = 2.0;

// Starters (pitchers/goalies) poll faster than the odds scan: the API server's
// error cache clears 90 s after an upstream outage ends, and polling at 60 s
// ensures the UI picks up the server's fresh data within that window without a
// reload. (End-to-end worst case from upstream recovery is ~150 s: up to 90 s
// of server error-cache remainder plus one 60 s poll cycle.)
// Cheap: it only hits our own server's in-memory cache, not external APIs.
export const STARTERS_REFETCH_INTERVAL_MS = 60 * 1000;

type DateFilter = "all" | "today" | "tonight" | "tomorrow";
type MarketFilter = "all" | "h2h" | "spreads" | "totals";

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  all: "All Days", today: "Today", tonight: "Tonight", tomorrow: "Tomorrow",
};
const MARKET_FILTER_LABELS: Record<MarketFilter, string> = {
  all: "All", h2h: "Moneyline", spreads: "Spreads", totals: "Totals",
};

function localDateStr(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-CA");
}

function matchesDateFilter(commenceTime: string, filter: DateFilter): boolean {
  if (filter === "all") return true;
  const gameDate = localDateStr(commenceTime);
  const today = localDateStr(new Date().toISOString());
  const tomorrow = localDateStr(new Date(Date.now() + 86_400_000).toISOString());
  if (filter === "today") return gameDate === today;
  if (filter === "tonight") return gameDate === today && new Date(commenceTime).getHours() >= 17;
  if (filter === "tomorrow") return gameDate === tomorrow;
  return true;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function findStarter(starters: GameStarter[], homeTeam: string, awayTeam: string, sport: string): GameStarter | null {
  return starters.find((s) => {
    if (s.sport !== sport) return false;
    const nh = normalize(s.homeTeam), na = normalize(s.awayTeam);
    const qh = normalize(homeTeam), qa = normalize(awayTeam);
    return (nh === qh || nh.includes(qh) || qh.includes(nh)) && (na === qa || na.includes(qa) || qa.includes(na));
  }) ?? null;
}

interface BetGroup { best: EvBet; alternates: EvBet[]; }

function groupBets(bets: EvBet[]): BetGroup[] {
  const map = new Map<string, EvBet[]>();
  for (const bet of bets) {
    const key = `${bet.gameId}|${bet.market}|${bet.selection}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(bet);
  }
  return Array.from(map.values()).map((group) => {
    const sorted = [...group].sort((a, b) => b.evPercent - a.evPercent);
    return { best: sorted[0], alternates: sorted.slice(1) };
  });
}

function StarterBadge({ starter }: { starter: GameStarter }) {
  if (starter.starterType === "goalie") {
    if (starter.confirmed && (starter.homeStarter || starter.awayStarter)) {
      const hasBoth = starter.awayStarter && starter.homeStarter;
      const label = hasBoth
        ? `${starter.awayStarter} vs. ${starter.homeStarter}`
        : starter.homeStarter || starter.awayStarter || "";
      return (
        <div data-testid="starter-badge" className="flex items-center gap-1 mt-2 rounded px-2 py-1 bg-green-500/10 border border-green-500/30 text-green-400 text-xs">
          <Check className="w-3 h-3 shrink-0" />
          <span>Starting goalies: {label}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 mt-2 rounded px-2 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        <span>Goalie unconfirmed — check ~30 min before puck drop</span>
      </div>
    );
  }
  const hasBoth = starter.awayStarter && starter.homeStarter;
  const label = hasBoth ? `${starter.awayStarter} vs. ${starter.homeStarter}` : starter.homeStarter || starter.awayStarter || "Pitcher TBD";
  if (label === "Pitcher TBD") {
    return (
      <div className="flex items-center gap-1 mt-2 rounded px-2 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
        <AlertTriangle className="w-3 h-3 shrink-0" /><span>Pitcher TBD</span>
      </div>
    );
  }
  if (starter.confirmed) {
    const awayStats = (starter.awayStarterEra || starter.awayStarterWhip)
      ? `ERA ${starter.awayStarterEra ?? "—"} / WHIP ${starter.awayStarterWhip ?? "—"}`
      : null;
    const homeStats = (starter.homeStarterEra || starter.homeStarterWhip)
      ? `ERA ${starter.homeStarterEra ?? "—"} / WHIP ${starter.homeStarterWhip ?? "—"}`
      : null;
    return (
      <div data-testid="starter-badge" className="mt-2 rounded px-2 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 text-xs space-y-0.5">
        <div className="flex items-center gap-1">
          <Check className="w-3 h-3 shrink-0" />
          <span className="font-medium">Confirmed starters</span>
        </div>
        {hasBoth ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 pl-4">
              <span className="opacity-70 shrink-0">Away:</span>
              <span>{starter.awayStarter}</span>
              {awayStats && <span className="opacity-60 whitespace-nowrap">{awayStats}</span>}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 pl-4">
              <span className="opacity-70 shrink-0">Home:</span>
              <span>{starter.homeStarter}</span>
              {homeStats && <span className="opacity-60 whitespace-nowrap">{homeStats}</span>}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2 pl-4">
            <span>{label}</span>
            {(awayStats || homeStats) && (
              <span className="opacity-60 whitespace-nowrap">{awayStats ?? homeStats}</span>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 mt-2 rounded px-2 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
      <AlertTriangle className="w-3 h-3 shrink-0" /><span>Probable: {label}</span>
    </div>
  );
}

function StaleBadge() {
  return (
    <div className="flex items-center gap-1 mt-1 rounded px-2 py-1 bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
      <AlertTriangle className="w-3 h-3 shrink-0" /><span>Verify odds — line may be stale</span>
    </div>
  );
}

function FreshnessBadge({ ageMinutes }: { ageMinutes: number }) {
  const hours = Math.floor(ageMinutes / 60);
  const label = hours >= 1 ? `${hours}h old` : `${ageMinutes}m old`;
  return (
    <div className="flex items-center gap-1 mt-1 rounded px-2 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
      <AlertTriangle className="w-3 h-3 shrink-0" /><span>Line {label} — re-verify before betting</span>
    </div>
  );
}

function QuotaExhaustedBanner() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
      <div>
        <span className="font-semibold text-amber-200">Quota reached — results may be incomplete.</span>
        {" "}One or more sports were skipped because the Odds API request quota ran out mid-scan. Top up your quota or wait for it to reset to see the full market.
      </div>
    </div>
  );
}


function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-card/50 flex flex-col animate-pulse">
      <div className="p-4 border-b border-border/50 space-y-2">
        <div className="flex justify-between">
          <div className="h-3 w-24 rounded bg-secondary" />
          <div className="flex gap-0.5">{[1,2,3,4,5].map(j=><div key={j} className="h-4 w-4 rounded bg-secondary"/>)}</div>
        </div>
        <div className="h-5 w-3/4 rounded bg-secondary" />
      </div>
      <div className="p-4 flex-1 space-y-3">
        {[1,2,3].map(j=>(
          <div key={j} className="flex justify-between">
            <div className="h-3 w-20 rounded bg-secondary"/><div className="h-3 w-28 rounded bg-secondary"/>
          </div>
        ))}
        <div className="h-10 rounded bg-secondary"/>
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
          <div className="space-y-1"><div className="h-3 w-8 rounded bg-secondary"/><div className="h-6 w-16 rounded bg-secondary"/></div>
          <div className="space-y-1 flex flex-col items-end"><div className="h-3 w-16 rounded bg-secondary"/><div className="h-6 w-14 rounded bg-secondary"/></div>
        </div>
        <div className="h-9 rounded bg-secondary mt-4"/>
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="border-border bg-card/50">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <WifiOff className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-bold mb-1">Couldn't reach the market feed</h3>
        <p className="text-muted-foreground text-sm max-w-sm mb-6">
          The Odds API returned an error — your quota may be exhausted or the key is invalid.
        </p>
        <Button variant="outline" onClick={onRetry}><RefreshCw className="w-4 h-4 mr-2"/>Try again</Button>
      </CardContent>
    </Card>
  );
}

function NearMissBar({ evPercent }: { evPercent: number }) {
  const pct = Math.min(100, Math.max(0, (evPercent / NEAR_MISS_MIN_EV) * 100));
  return (
    <div className="flex items-center gap-2 w-24">
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className="h-full rounded-full bg-yellow-500/70 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-muted-foreground tabular-nums w-10 text-right">{formatPercent(evPercent)}</span>
    </div>
  );
}

export default function Home() {
  const [sport, setSport] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [bookFilter, setBookFilter] = useState<string>("all");
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [hideStale, setHideStale] = useState(false);
  const [pendingBet, setPendingBet] = useState<EvBet | null>(null);
  const [digestOpen, setDigestOpen] = useState(false);
  const [digestEmail, setDigestEmail] = useState("");
  const [digestSending, setDigestSending] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sports } = useListSports();
  const { data: starters = [] } = useListStarters({
    query: { queryKey: getListStartersQueryKey(), refetchInterval: STARTERS_REFETCH_INTERVAL_MS },
  });
  const { data: existingBets = [] } = useListBets();

  const queryParams = sport !== "all" ? { sport } : {};

  const { data: evCard, isLoading: isEvLoading, isError: isEvError, refetch: refetchEv } = useGetEvCard(queryParams, {
    query: { queryKey: getGetEvCardQueryKey(queryParams), retry: 1 },
  });
  const { data: nearMisses, isLoading: isNearMissLoading, refetch: refetchNear } = useGetNearMisses(queryParams, {
    query: { queryKey: getGetNearMissesQueryKey(queryParams) },
  });

  const handleRefresh = useCallback(() => {
    setCountdown(REFRESH_SECONDS);
    refetchEv();
    refetchNear();
  }, [refetchEv, refetchNear]);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((prev) => { if (prev <= 1) { handleRefresh(); return REFRESH_SECONDS; } return prev - 1; });
    }, 1000);
    return () => clearInterval(id);
  }, [handleRefresh]);

  const createBet = useCreateBet({
    mutation: {
      onSuccess: () => {
        toast({ title: "Bet tracked", description: "Added to your tracker." });
        queryClient.invalidateQueries({ queryKey: getListBetsQueryKey() });
        setPendingBet(null);
      },
      onError: () => { toast({ title: "Failed to save bet", variant: "destructive" }); setPendingBet(null); },
    },
  });

  const handleConfirmSave = (units: number) => {
    if (!pendingBet) return;
    createBet.mutate({ data: { gameId: pendingBet.gameId, homeTeam: pendingBet.homeTeam, awayTeam: pendingBet.awayTeam, sport: pendingBet.sport, market: pendingBet.market, selection: pendingBet.selection, point: pendingBet.point ?? null, bookmaker: pendingBet.bookmaker, americanOdds: pendingBet.americanOdds, evPercent: pendingBet.evPercent, units, commenceTime: pendingBet.commenceTime } });
  };

  const handleSendDigest = async () => {
    if (!digestEmail) return;
    setDigestSending(true);
    try {
      const res = await fetch("/api/digest/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: digestEmail }),
      });
      const data = await res.json() as { sent?: boolean; betCount?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      toast({ title: "Digest sent!", description: `${data.betCount ?? 0} bets sent to ${digestEmail}` });
      setDigestOpen(false);
    } catch (err) {
      toast({ title: "Failed to send digest", description: String(err), variant: "destructive" });
    } finally {
      setDigestSending(false);
    }
  };

  const isDuplicate = pendingBet ? existingBets.some(b => b.gameId === pendingBet.gameId && b.market === pendingBet.market && b.selection === pendingBet.selection) : false;

  const activeSports = sports?.filter((s) => s.active) || [];

  const allBets = evCard?.bets ?? [];
  const dateBets = allBets.filter(b => matchesDateFilter(b.commenceTime, dateFilter));
  const marketBets = marketFilter === "all" ? dateBets : dateBets.filter(b => b.market === marketFilter);
  const allGroups = groupBets(marketBets);
  const staleCount = allGroups.filter(({ best }) => best.evPercent > EV_SANITY_THRESHOLD).length;
  const nonStaleGroups = hideStale ? allGroups.filter(({ best }) => best.evPercent <= EV_SANITY_THRESHOLD) : allGroups;
  const betGroups = bookFilter === "all" ? nonStaleGroups : nonStaleGroups.filter(({ best }) => best.bookmaker === bookFilter);
  const availableBooks = Array.from(new Set(allBets.map(b => b.bookmaker))).sort();
  const filteredNearMisses = (nearMisses ?? []).filter(m => matchesDateFilter(m.commenceTime, dateFilter));

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  const countdownLabel = `${mins}:${String(secs).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      {/* Title row */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {dateFilter === "all" ? "All Upcoming Bets" : `${DATE_FILTER_LABELS[dateFilter]}'s Bet Card`}
          </h1>
          <p className="text-muted-foreground text-sm">Rigorous +EV opportunities</p>
        </div>

        {/* Right-side controls */}
        <div className="flex flex-col gap-2 w-full sm:w-auto">
          {/* Row 1: Date + Market filters */}
          <div className="flex flex-wrap gap-1.5">
            <div className="flex gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
              {(["all", "today", "tonight", "tomorrow"] as DateFilter[]).map(d => (
                <button key={d} onClick={() => setDateFilter(d)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${dateFilter === d ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {DATE_FILTER_LABELS[d]}
                </button>
              ))}
            </div>
            <div className="flex gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
              {(["all", "h2h", "spreads", "totals"] as MarketFilter[]).map(m => (
                <button key={m} onClick={() => setMarketFilter(m)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${marketFilter === m ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {MARKET_FILTER_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: Book + Sport + extras */}
          <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
            {staleCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => setHideStale(h => !h)}
                className={`shrink-0 gap-1.5 text-xs ${hideStale ? "border-primary text-primary" : "text-muted-foreground"}`}
                title={hideStale ? "Show stale lines" : "Hide stale lines"}>
                {hideStale ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {hideStale ? `Show stale (${staleCount})` : `Hide stale (${staleCount})`}
              </Button>
            )}
            {availableBooks.length > 0 && (
              <div className="w-36">
                <Select value={bookFilter} onValueChange={setBookFilter}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="All Books" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Books</SelectItem>
                    {availableBooks.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="w-full sm:w-48">
              <Select value={sport} onValueChange={setSport}>
                <SelectTrigger data-testid="select-sport" className="h-8 text-xs">
                  <SelectValue placeholder="All Sports" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sports</SelectItem>
                  {activeSports.map(s => <SelectItem key={s.key} value={s.key}>{s.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={handleRefresh} className="shrink-0 gap-1.5 text-muted-foreground h-8" title="Refresh markets">
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="font-mono text-xs tabular-nums">{countdownLabel}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDigestOpen(true)} className="shrink-0 gap-1.5 text-muted-foreground h-8" title="Send email digest">
              <Mail className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Quota exhausted banner */}
      {evCard?.quotaExhausted && <QuotaExhaustedBanner />}

      {/* Sharp coverage banner */}
      {evCard?.sharpCoverage && <SharpCoverageBanner coverage={evCard.sharpCoverage} bets={evCard.bets} />}

      {/* Bet cards */}
      {isEvLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <SkeletonCard key={i}/>)}
        </div>
      ) : isEvError ? (
        <ErrorState onRetry={handleRefresh}/>
      ) : betGroups.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {betGroups.map(({ best: bet, alternates }, i) => {
            const isStale = bet.evPercent > EV_SANITY_THRESHOLD;
            const isOldLine = (bet.lineAgeMinutes ?? 0) > 120;
            const starter = findStarter(starters, bet.homeTeam, bet.awayTeam, bet.sport);
            const isStarterGame = (bet.sport === "baseball_mlb" || bet.sport === "icehockey_nhl") && bet.market === "h2h";
            const showStarter = isStarterGame;

            return (
              <Card key={`${bet.gameId}-${bet.selection}-${i}`} className={`border-border flex flex-col transition-opacity ${isStale ? "bg-card/30 opacity-80" : "bg-card/50"}`}>
                <CardHeader className="pb-2 border-b border-border/50">
                  <div className="flex justify-between items-start">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="bg-secondary text-secondary-foreground font-semibold px-1.5 py-0.5 rounded text-[10px] tracking-wide">{formatSportKey(bet.sport)}</span>
                        <span className="bg-secondary/60 text-secondary-foreground/80 font-medium px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide">{bet.market === "h2h" ? "ML" : bet.market === "spreads" ? "SP" : bet.market === "totals" ? "OU" : bet.market}</span>
                        <span>{formatGameTime(bet.commenceTime)}</span>
                      </div>
                      <CardTitle className="text-base font-semibold">{bet.awayTeam} @ {bet.homeTeam}</CardTitle>
                    </div>
                    <div className="flex shrink-0">
                      {Array.from({ length: bet.confidence || 0 }).map((_, j) => <Star key={j} className="w-4 h-4 fill-yellow-500 text-yellow-500"/>)}
                    </div>
                  </div>
                  {showStarter && (
                    starter
                      ? <StarterBadge starter={starter} />
                      : <div className="flex items-center gap-1 mt-2 rounded px-2 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>{bet.sport === "baseball_mlb" ? "Pitcher TBD" : "Goalie TBD"}</span>
                        </div>
                  )}
                  {isStale && <StaleBadge/>}
                  {!isStale && isOldLine && <FreshnessBadge ageMinutes={bet.lineAgeMinutes!}/>}
                </CardHeader>
                <CardContent className="pt-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-3 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Selection</span>
                      <span className="font-bold text-foreground">{bet.selection}{" "}{bet.point != null && (bet.point > 0 ? `+${bet.point}` : bet.point)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Best book</span>
                      <span className="text-foreground font-medium">{bet.bookmaker}</span>
                    </div>
                    {bet.sharpBook && (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Sharp ref</span>
                        <span className="text-foreground/70 text-sm">{bet.sharpBook}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center bg-secondary/50 p-2 rounded">
                      <span className="text-muted-foreground">Odds</span>
                      <span className="font-bold text-lg">{formatAmericanOdds(bet.americanOdds)}</span>
                    </div>
                    {alternates.length > 0 && (
                      <div className="text-xs text-muted-foreground border-t border-border/40 pt-2 space-y-0.5">
                        <span className="text-[11px] uppercase tracking-wide">Also at</span>
                        {alternates.map((alt, j) => (
                          <div key={j} className="flex justify-between items-center">
                            <span className="text-foreground/70">{alt.bookmaker}</span>
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-foreground/80">{formatAmericanOdds(alt.americanOdds)}</span>
                              <span className="text-green-500/70 font-medium">+{formatPercent(alt.evPercent)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground">EV</span>
                        <span className={`text-lg ${getEvColorClass(bet.evPercent)}`}>+{formatPercent(bet.evPercent)}</span>
                      </div>
                      <div className="flex flex-col text-right">
                        <span className="text-xs text-muted-foreground">Suggested</span>
                        <span className="text-lg font-bold">{formatUnits(bet.suggestedUnits)}</span>
                      </div>
                    </div>
                  </div>
                  <Button className="w-full" onClick={() => setPendingBet(bet)} disabled={createBet.isPending} data-testid={`button-track-${bet.gameId}`}>
                    <Plus className="w-4 h-4 mr-2"/>Save to Tracker
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-border bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <TrendingUp className="w-12 h-12 text-muted-foreground mb-4"/>
            <h3 className="text-lg font-bold mb-2">No +EV Bets Found</h3>
            <p className="text-muted-foreground max-w-md">
              No bets meeting your threshold for {sport === "all" ? "any sport" : sport}
              {dateFilter !== "all" ? ` ${DATE_FILTER_LABELS[dateFilter].toLowerCase()}` : ""}
              {marketFilter !== "all" ? ` · ${MARKET_FILTER_LABELS[marketFilter]}` : ""}
              {bookFilter !== "all" ? ` · ${bookFilter}` : ""}.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Near Misses */}
      {(isNearMissLoading || filteredNearMisses.length > 0) && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-yellow-500"/>
            <h2 className="text-xl font-bold tracking-tight">Near Misses</h2>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm text-left">
              <thead className="bg-secondary text-secondary-foreground uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Matchup</th>
                  <th className="px-4 py-3">Selection</th>
                  <th className="px-4 py-3">Bookmaker</th>
                  <th className="px-4 py-3">Current</th>
                  <th className="px-4 py-3 text-yellow-500">Need to Qualify</th>
                  <th className="px-4 py-3">Proximity</th>
                </tr>
              </thead>
              <tbody>
                {isNearMissLoading ? (
                  <>{[1,2,3].map(i=>(
                    <tr key={i} className="border-b border-border animate-pulse">
                      {[1,2,3,4,5,6].map(j=><td key={j} className="px-4 py-3"><div className="h-3 rounded bg-secondary w-3/4"/></td>)}
                    </tr>
                  ))}</>
                ) : (
                  filteredNearMisses.slice(0, 5).map((miss, i) => (
                    <tr key={`${miss.gameId}-${i}`} className="border-b border-border hover:bg-secondary/20 last:border-0">
                      <td className="px-4 py-3 font-medium">
                        <span className="inline-block bg-secondary text-secondary-foreground font-semibold px-1.5 py-0.5 rounded text-[10px] tracking-wide mr-1.5">{formatSportKey(miss.sport)}</span>
                        {miss.awayTeam} @ {miss.homeTeam}
                      </td>
                      <td className="px-4 py-3">{miss.selection}{" "}{miss.point != null && (miss.point > 0 ? `+${miss.point}` : miss.point)}<div className="text-xs text-muted-foreground uppercase">{miss.market}</div></td>
                      <td className="px-4 py-3">{miss.bookmaker}</td>
                      <td className="px-4 py-3 font-mono">{formatAmericanOdds(miss.americanOdds)}</td>
                      <td className="px-4 py-3 text-yellow-500">
                        <span className="font-mono font-bold">{formatAmericanOdds(miss.breakEvenOdds)}</span>
                        <span className="text-xs text-muted-foreground ml-1">or better</span>
                      </td>
                      <td className="px-4 py-3"><NearMissBar evPercent={miss.evPercent}/></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Save Bet Dialog */}
      <SaveBetDialog open={pendingBet !== null} onClose={() => setPendingBet(null)} onConfirm={handleConfirmSave} bet={pendingBet} isDuplicate={isDuplicate} isPending={createBet.isPending}/>

      {/* Send Digest Dialog */}
      <Dialog open={digestOpen} onOpenChange={setDigestOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mail className="w-4 h-4"/>Send +EV Digest</DialogTitle>
            <DialogDescription>Email today's top +EV bets to yourself.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Input type="email" placeholder="you@gmail.com" value={digestEmail} onChange={e => setDigestEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSendDigest()}/>
            <Button onClick={handleSendDigest} disabled={digestSending || !digestEmail} className="w-full">
              <Send className="w-4 h-4 mr-2"/>
              {digestSending ? "Sending..." : `Send Digest${betGroups.length > 0 ? ` (${betGroups.length} bets)` : ""}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
