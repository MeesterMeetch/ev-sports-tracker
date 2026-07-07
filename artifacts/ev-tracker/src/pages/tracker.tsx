import { useQueryClient } from "@tanstack/react-query";
import {
  useListBets,
  useGetBetStats,
  useUpdateBet,
  useDeleteBet,
  getListBetsQueryKey,
  getGetBetStatsQueryKey,
} from "@workspace/api-client-react";
import {
  formatAmericanOdds,
  formatPercent,
  formatUnits,
  formatSportKey,
  getPnlColorClass,
  getStatusColorClass,
} from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Check, X, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Tracker() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: bets, isLoading: isBetsLoading } = useListBets();
  const { data: stats, isLoading: isStatsLoading } = useGetBetStats();

  const updateBet = useUpdateBet({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBetsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBetStatsQueryKey() });
        toast({ title: "Bet updated" });
      },
    },
  });

  const deleteBet = useDeleteBet({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBetsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBetStatsQueryKey() });
        toast({ title: "Bet deleted" });
      },
    },
  });

  const handleStatusUpdate = (id: number, status: string, units: number, odds: number) => {
    let pnl = 0;
    if (status === "won") {
      pnl = odds > 0 ? units * (odds / 100) : units / (Math.abs(odds) / 100);
    } else if (status === "lost") {
      pnl = -units;
    }
    updateBet.mutate({ id, data: { status, pnl } });
  };

  const hasBySport = stats?.bySport && stats.bySport.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bankroll & Tracker</h1>
        <p className="text-muted-foreground text-sm">Monitor performance and grade bets</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total PnL</div>
            <div className={`text-2xl font-bold ${getPnlColorClass(stats?.totalPnl)}`}>
              {isStatsLoading ? "..." : formatUnits(stats?.totalPnl ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">ROI</div>
            <div className={`text-2xl font-bold ${getPnlColorClass(stats?.roi)}`}>
              {isStatsLoading ? "..." : formatPercent(stats?.roi ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Win Rate</div>
            <div className="text-2xl font-bold text-foreground">
              {isStatsLoading ? "..." : formatPercent(stats?.winRate ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Pending</div>
            <div className="text-2xl font-bold text-yellow-500">
              {isStatsLoading ? "..." : (stats?.pending ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/50 text-muted-foreground uppercase text-xs border-b border-border">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Matchup</th>
                <th className="px-4 py-3">Selection</th>
                <th className="px-4 py-3 text-right">Odds</th>
                <th className="px-4 py-3 text-right">EV%</th>
                <th className="px-4 py-3 text-right">Units</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">PnL</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isBetsLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground animate-pulse">
                    Loading tracker...
                  </td>
                </tr>
              ) : bets?.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <p className="text-muted-foreground font-medium mb-1">No bets tracked yet</p>
                    <p className="text-muted-foreground/60 text-xs">
                      Save a bet from the EV Card to start tracking your bankroll
                    </p>
                  </td>
                </tr>
              ) : (
                bets?.map((bet) => (
                  <tr key={bet.id} className="border-b border-border/50 hover:bg-secondary/20 group">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(bet.commenceTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <span className="inline-block bg-secondary text-secondary-foreground font-semibold px-1.5 py-0.5 rounded text-[10px] tracking-wide mr-1.5">
                        {formatSportKey(bet.sport)}
                      </span>
                      {bet.awayTeam} @ {bet.homeTeam}
                    </td>
                    <td className="px-4 py-3">
                      {bet.selection} {bet.point != null && (bet.point > 0 ? `+${bet.point}` : bet.point)}
                      <span className="block text-xs text-muted-foreground">{bet.bookmaker}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatAmericanOdds(bet.americanOdds)}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      +{formatPercent(bet.evPercent)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{bet.units}u</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="outline" className={getStatusColorClass(bet.status)}>
                        {bet.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${getPnlColorClass(bet.pnl)}`}>
                      {bet.pnl != null ? formatUnits(bet.pnl) : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {bet.status === "pending" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                              onClick={() => handleStatusUpdate(bet.id, "won", bet.units, bet.americanOdds)}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                              onClick={() => handleStatusUpdate(bet.id, "lost", bet.units, bet.americanOdds)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-yellow-500 hover:text-yellow-400 hover:bg-yellow-500/10"
                              onClick={() => handleStatusUpdate(bet.id, "push", bet.units, bet.americanOdds)}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => deleteBet.mutate({ id: bet.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {hasBySport && (
        <div>
          <h2 className="text-lg font-bold tracking-tight mb-3">Performance by Sport</h2>
          <Card className="bg-card border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary/50 text-muted-foreground uppercase text-xs border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Sport</th>
                    <th className="px-4 py-3 text-right">Bets</th>
                    <th className="px-4 py-3 text-right">Wins</th>
                    <th className="px-4 py-3 text-right">Win %</th>
                    <th className="px-4 py-3 text-right">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {stats!.bySport!.map((row) => {
                    const winPct = row.bets > 0 ? (row.wins / row.bets) * 100 : 0;
                    return (
                      <tr key={row.sport} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-medium">
                          <span className="inline-block bg-secondary text-secondary-foreground font-semibold px-1.5 py-0.5 rounded text-[10px] tracking-wide mr-1.5">
                            {formatSportKey(row.sport)}
                          </span>
                          <span className="text-muted-foreground text-xs">{row.sport}</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.bets}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.wins}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {formatPercent(winPct)}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-bold ${getPnlColorClass(row.roi)}`}>
                          {row.roi >= 0 ? "+" : ""}{formatPercent(row.roi)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
