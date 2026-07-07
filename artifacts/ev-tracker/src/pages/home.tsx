import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEvCard,
  getGetEvCardQueryKey,
  useGetNearMisses,
  getGetNearMissesQueryKey,
  useListSports,
  useListStarters,
  useCreateBet,
  useListBets,
  getListBetsQueryKey,
} from "@workspace/api-client-react";
import type { EvBet, GameStarter } from "@workspace/api-client-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SaveBetDialog } from "@/components/save-bet-dialog";
import { Star, TrendingUp, AlertTriangle, Plus, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const REFRESH_SECONDS = 300;
const EV_SANITY_THRESHOLD = 30;

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function findStarter(
  starters: GameStarter[],
  homeTeam: string,
  awayTeam: string,
  sport: string
): GameStarter | null {
  return (
    starters.find((s) => {
      if (s.sport !== sport) return false;
      const nh = normalize(s.homeTeam);
      const na = normalize(s.awayTeam);
      const qh = normalize(homeTeam);
      const qa = normalize(awayTeam);
      return (
        (nh === qh || nh.includes(qh) || qh.includes(nh)) &&
        (na === qa || na.includes(qa) || qa.includes(na))
      );
    }) ?? null
  );
}

interface BetGroup {
  best: EvBet;
  alternates: EvBet[];
}

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
    return (
      <div className="flex items-center gap-1 mt-2 rounded px-2 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        <span>Goalie unconfirmed — check ~30 min before puck drop</span>
      </div>
    );
  }
  const hasBoth = starter.awayStarter && starter.homeStarter;
  const label = hasBoth
    ? `${starter.awayStarter} vs. ${starter.homeStarter}`
    : starter.homeStarter || starter.awayStarter || "Pitcher TBD";
  return (
    <div className="flex items-center gap-1 mt-2 rounded px-2 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
      <AlertTriangle className="w-3 h-3 shrink-0" />
      <span>Probable: {label}</span>
    </div>
  );
}

function StaleBadge() {
  return (
    <div className="flex items-center gap-1 mt-1 rounded px-2 py-1 bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
      <AlertTriangle className="w-3 h-3 shrink-0" />
      <span>Verify odds — line may be stale</span>
    </div>
  );
}

export default function Home() {
  const [sport, setSport] = useState<string>("all");
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [pendingBet, setPendingBet] = useState<EvBet | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sports } = useListSports();
  const { data: starters = [] } = useListStarters();
  const { data: existingBets = [] } = useListBets();

  const queryParams = sport !== "all" ? { sport } : {};

  const { data: evCard, isLoading: isEvLoading, refetch: refetchEv } = useGetEvCard(queryParams, {
    query: { queryKey: getGetEvCardQueryKey(queryParams) },
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
      setCountdown((prev) => {
        if (prev <= 1) { handleRefresh(); return REFRESH_SECONDS; }
        return prev - 1;
      });
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
      onError: () => {
        toast({ title: "Failed to save bet", variant: "destructive" });
        setPendingBet(null);
      },
    },
  });

  const handleConfirmSave = (units: number) => {
    if (!pendingBet) return;
    createBet.mutate({
      data: {
        gameId: pendingBet.gameId,
        homeTeam: pendingBet.homeTeam,
        awayTeam: pendingBet.awayTeam,
        sport: pendingBet.sport,
        market: pendingBet.market,
        selection: pendingBet.selection,
        point: pendingBet.point ?? null,
        bookmaker: pendingBet.bookmaker,
        americanOdds: pendingBet.americanOdds,
        evPercent: pendingBet.evPercent,
        units,
        commenceTime: pendingBet.commenceTime,
      },
    });
  };

  const isDuplicate = pendingBet
    ? existingBets.some(
        (b) =>
          b.gameId === pendingBet.gameId &&
          b.market === pendingBet.market &&
          b.selection === pendingBet.selection
      )
    : false;

  const activeSports = sports?.filter((s) => s.active) || [];
  const betGroups = groupBets(evCard?.bets ?? []);

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  const countdownLabel = `${mins}:${String(secs).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Today's Bet Card</h1>
          <p className="text-muted-foreground text-sm">Rigorous +EV opportunities</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="w-full sm:w-64">
            <Select value={sport} onValueChange={setSport}>
              <SelectTrigger data-testid="select-sport">
                <SelectValue placeholder="All Sports" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sports</SelectItem>
                {activeSports.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="shrink-0 gap-1.5 text-muted-foreground"
            title="Refresh markets"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="font-mono text-xs tabular-nums">{countdownLabel}</span>
          </Button>
        </div>
      </div>

      {isEvLoading ? (
        <div className="text-muted-foreground py-12 text-center animate-pulse">Scanning markets...</div>
      ) : betGroups.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {betGroups.map(({ best: bet, alternates }, i) => {
            const isStale = bet.evPercent > EV_SANITY_THRESHOLD;
            const starter = findStarter(starters, bet.homeTeam, bet.awayTeam, bet.sport);
            const showStarter =
              starter &&
              (bet.sport === "baseball_mlb" || bet.sport === "icehockey_nhl") &&
              bet.market === "h2h";

            return (
              <Card key={`${bet.gameId}-${bet.selection}-${i}`} className="border-border bg-card/50 flex flex-col">
                <CardHeader className="pb-2 border-b border-border/50">
                  <div className="flex justify-between items-start">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="bg-secondary text-secondary-foreground font-semibold px-1.5 py-0.5 rounded text-[10px] tracking-wide">
                          {formatSportKey(bet.sport)}
                        </span>
                        <span>{formatGameTime(bet.commenceTime)}</span>
                      </div>
                      <CardTitle className="text-base font-semibold">{bet.awayTeam} @ {bet.homeTeam}</CardTitle>
                    </div>
                    <div className="flex shrink-0">
                      {Array.from({ length: bet.confidence || 0 }).map((_, j) => (
                        <Star key={j} className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                      ))}
                    </div>
                  </div>
                  {showStarter && <StarterBadge starter={starter} />}
                  {isStale && <StaleBadge />}
                </CardHeader>
                <CardContent className="pt-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-3 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Selection</span>
                      <span className="font-bold text-foreground">
                        {bet.selection}{" "}
                        {bet.point != null && (bet.point > 0 ? `+${bet.point}` : bet.point)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Market</span>
                      <span className="uppercase text-xs tracking-wider">{bet.market}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Best book</span>
                      <span className="text-foreground font-medium">{bet.bookmaker}</span>
                    </div>
                    <div className="flex justify-between items-center bg-secondary/50 p-2 rounded">
                      <span className="text-muted-foreground">Odds</span>
                      <span className="font-bold text-lg">{formatAmericanOdds(bet.americanOdds)}</span>
                    </div>

                    {alternates.length > 0 && (
                      <div className="text-xs text-muted-foreground border-t border-border/40 pt-2">
                        <span className="mr-1">Also at:</span>
                        {alternates.map((alt, j) => (
                          <span key={j}>
                            {j > 0 && " · "}
                            <span className="text-foreground/70">{alt.bookmaker}</span>{" "}
                            <span className="font-mono">{formatAmericanOdds(alt.americanOdds)}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground">EV</span>
                        <span className={`text-lg ${getEvColorClass(bet.evPercent)}`}>
                          +{formatPercent(bet.evPercent)}
                        </span>
                      </div>
                      <div className="flex flex-col text-right">
                        <span className="text-xs text-muted-foreground">Suggested</span>
                        <span className="text-lg font-bold">{formatUnits(bet.suggestedUnits)}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => setPendingBet(bet)}
                    disabled={createBet.isPending}
                    data-testid={`button-track-${bet.gameId}`}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Save to Tracker
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-border bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <TrendingUp className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-bold mb-2">No +EV Bets Found</h3>
            <p className="text-muted-foreground max-w-md">
              There are currently no bets meeting your minimum EV threshold for{" "}
              {sport === "all" ? "any sport" : sport}. Check the near-misses below.
            </p>
          </CardContent>
        </Card>
      )}

      {(isNearMissLoading || (nearMisses && nearMisses.length > 0)) && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            <h2 className="text-xl font-bold tracking-tight">Near Misses</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-secondary text-secondary-foreground uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 rounded-tl">Matchup</th>
                  <th className="px-4 py-3">Selection</th>
                  <th className="px-4 py-3">Bookmaker</th>
                  <th className="px-4 py-3">Current</th>
                  <th className="px-4 py-3 text-yellow-500">Target</th>
                  <th className="px-4 py-3 rounded-tr">Current EV</th>
                </tr>
              </thead>
              <tbody>
                {isNearMissLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground animate-pulse">
                      Loading near misses...
                    </td>
                  </tr>
                ) : (
                  nearMisses?.slice(0, 5).map((miss, i) => (
                    <tr key={`${miss.gameId}-${i}`} className="border-b border-border hover:bg-secondary/20">
                      <td className="px-4 py-3 font-medium">
                        <span className="inline-block bg-secondary text-secondary-foreground font-semibold px-1.5 py-0.5 rounded text-[10px] tracking-wide mr-1.5">
                          {formatSportKey(miss.sport)}
                        </span>
                        {miss.awayTeam} @ {miss.homeTeam}
                      </td>
                      <td className="px-4 py-3">
                        {miss.selection}{" "}
                        {miss.point != null && (miss.point > 0 ? `+${miss.point}` : miss.point)}
                        <div className="text-xs text-muted-foreground uppercase">{miss.market}</div>
                      </td>
                      <td className="px-4 py-3">{miss.bookmaker}</td>
                      <td className="px-4 py-3 font-mono">{formatAmericanOdds(miss.americanOdds)}</td>
                      <td className="px-4 py-3 font-mono text-yellow-500 font-bold">
                        {formatAmericanOdds(miss.breakEvenOdds)}
                      </td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">
                        {formatPercent(miss.evPercent)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SaveBetDialog
        open={pendingBet !== null}
        onClose={() => setPendingBet(null)}
        onConfirm={handleConfirmSave}
        bet={pendingBet}
        isDuplicate={isDuplicate}
        isPending={createBet.isPending}
      />
    </div>
  );
}
