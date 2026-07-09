import { useState } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Check, X, Minus, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
} from "recharts";

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

  const [logClvId, setLogClvId] = useState<number | null>(null);
  const [closingInput, setClosingInput] = useState("");

  const handleStatusUpdate = (id: number, status: string, units: number, odds: number) => {
    let pnl = 0;
    if (status === "won") pnl = odds > 0 ? units * (odds / 100) : units / (Math.abs(odds) / 100);
    else if (status === "lost") pnl = -units;
    updateBet.mutate({ id, data: { status, pnl } });
  };

  const handleLogClv = (id: number) => {
    const odds = parseInt(closingInput, 10);
    if (isNaN(odds) || (Math.abs(odds) < 100)) {
      toast({ title: "Enter valid American odds (e.g. -110 or +150)", variant: "destructive" });
      return;
    }
    updateBet.mutate({ id, data: { closingOdds: odds } }, {
      onSuccess: () => { setLogClvId(null); setClosingInput(""); },
    });
  };

  const hasBySport = stats?.bySport && stats.bySport.length > 0;

  // Default sort: game time ascending (soonest first).
  const sortedBets = [...(bets ?? [])].sort(
    (a, b) => new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime(),
  );

  // Chart data: cumulative PnL over time (settled bets only)
  const settledBets = [...(bets ?? [])]
    .filter((b) => b.status !== "pending" && b.pnl != null)
    .sort((a, b) => new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime());

  let cumulative = 0;
  const pnlCurve = settledBets.map((b) => {
    cumulative += b.pnl!;
    return {
      label: new Date(b.commenceTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      pnl: Math.round(cumulative * 100) / 100,
      game: `${b.awayTeam} @ ${b.homeTeam}`,
      result: b.pnl! >= 0 ? "W" : "L",
    };
  });

  // PnL by bookmaker
  const bookMap = new Map<string, number>();
  for (const bet of settledBets) {
    bookMap.set(bet.bookmaker, (bookMap.get(bet.bookmaker) ?? 0) + (bet.pnl ?? 0));
  }
  const bookData = Array.from(bookMap.entries())
    .map(([bookmaker, pnl]) => ({ bookmaker, pnl: Math.round(pnl * 100) / 100 }))
    .sort((a, b) => b.pnl - a.pnl);

  const showCharts = pnlCurve.length >= 2;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bankroll & Tracker</h1>
        <p className="text-muted-foreground text-sm">Monitor performance and grade bets</p>
      </div>

      {/* Stats */}
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

      {/* Bet table */}
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
                <th className="px-4 py-3 text-right" title="Closing Line Value — positive means you beat the market">CLV</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isBetsLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground animate-pulse">Loading tracker...</td></tr>
              ) : bets?.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <p className="text-muted-foreground font-medium mb-1">No bets tracked yet</p>
                    <p className="text-muted-foreground/60 text-xs">Save a bet from the EV Card to start tracking your bankroll</p>
                  </td>
                </tr>
              ) : (
                sortedBets.map((bet) => (
                  <tr key={bet.id} className="border-b border-border/50 hover:bg-secondary/20 group">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(bet.commenceTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <span className="inline-block bg-secondary text-secondary-foreground font-semibold px-1.5 py-0.5 rounded text-[10px] tracking-wide mr-1.5">{formatSportKey(bet.sport)}</span>
                      {bet.awayTeam} @ {bet.homeTeam}
                    </td>
                    <td className="px-4 py-3">
                      {bet.selection} {bet.point != null && (bet.point > 0 ? `+${bet.point}` : bet.point)}
                      <span className="block text-xs text-muted-foreground">{bet.bookmaker}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatAmericanOdds(bet.americanOdds)}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">+{formatPercent(bet.evPercent)}</td>
                    <td className="px-4 py-3 text-right font-mono">{bet.units}u</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="outline" className={getStatusColorClass(bet.status)}>{bet.status.toUpperCase()}</Badge>
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${getPnlColorClass(bet.pnl)}`}>
                      {bet.pnl != null ? formatUnits(bet.pnl) : "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {bet.status === "pending" ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : bet.clvPercent != null ? (
                        <span className={`font-mono text-xs font-bold ${getPnlColorClass(bet.clvPercent)}`}>
                          {bet.clvPercent >= 0 ? "+" : ""}{bet.clvPercent.toFixed(1)}%
                        </span>
                      ) : logClvId === bet.id ? (
                        <div className="flex items-center gap-1 justify-end">
                          <input
                            type="text"
                            placeholder="-110"
                            value={closingInput}
                            onChange={e => setClosingInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") handleLogClv(bet.id);
                              if (e.key === "Escape") { setLogClvId(null); setClosingInput(""); }
                            }}
                            className="w-16 text-xs bg-secondary border border-border rounded px-1.5 py-0.5 font-mono text-center focus:outline-none focus:ring-1 focus:ring-primary"
                            autoFocus
                          />
                          <button onClick={() => handleLogClv(bet.id)} className="text-xs text-primary hover:text-primary/80 font-bold">✓</button>
                        </div>
                      ) : (
                        <button onClick={() => { setLogClvId(bet.id); setClosingInput(""); }} className="text-xs text-muted-foreground/50 hover:text-muted-foreground underline-offset-2 hover:underline">log</button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {bet.status === "pending" && (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-green-500 hover:text-green-400 hover:bg-green-500/10" onClick={() => handleStatusUpdate(bet.id, "won", bet.units, bet.americanOdds)}><Check className="h-4 w-4"/></Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-400 hover:bg-red-500/10" onClick={() => handleStatusUpdate(bet.id, "lost", bet.units, bet.americanOdds)}><X className="h-4 w-4"/></Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-yellow-500 hover:text-yellow-400 hover:bg-yellow-500/10" onClick={() => handleStatusUpdate(bet.id, "push", bet.units, bet.americanOdds)}><Minus className="h-4 w-4"/></Button>
                          </>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => deleteBet.mutate({ id: bet.id })}><Trash2 className="h-4 w-4"/></Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Sport breakdown table */}
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
                          <span className="inline-block bg-secondary text-secondary-foreground font-semibold px-1.5 py-0.5 rounded text-[10px] tracking-wide mr-1.5">{formatSportKey(row.sport)}</span>
                          <span className="text-muted-foreground text-xs">{row.sport}</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.bets}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.wins}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatPercent(winPct)}</td>
                        <td className={`px-4 py-3 text-right font-mono font-bold ${getPnlColorClass(row.roi)}`}>{row.roi >= 0 ? "+" : ""}{formatPercent(row.roi)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* PnL Charts */}
      {showCharts ? (
        <div className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="w-5 h-5"/>Performance Charts
          </h2>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Cumulative PnL (units)</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-4">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={pnlCurve} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937"/>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false}/>
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false}/>
                  <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3"/>
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: "#9ca3af" }}
                    formatter={(value: number) => [`${value >= 0 ? "+" : ""}${value}u`, "Cumulative PnL"]}
                  />
                  <Area type="monotone" dataKey="pnl" stroke="#10b981" strokeWidth={2} fill="url(#pnlGradient)" dot={false} activeDot={{ r: 4, fill: "#10b981" }}/>
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {bookData.length >= 2 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wider">PnL by Bookmaker</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <ResponsiveContainer width="100%" height={Math.max(120, bookData.length * 36)}>
                  <BarChart data={bookData} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false}/>
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false}/>
                    <YAxis type="category" dataKey="bookmaker" width={90} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false}/>
                    <ReferenceLine x={0} stroke="#374151"/>
                    <Tooltip
                      contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 6, fontSize: 12 }}
                      formatter={(value: number) => [`${value >= 0 ? "+" : ""}${value}u`, "PnL"]}
                    />
                    <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
                      {bookData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.pnl >= 0 ? "#10b981" : "#ef4444"}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      ) : settledBets.length === 1 ? (
        <p className="text-xs text-muted-foreground text-center py-4">Grade one more bet to unlock performance charts.</p>
      ) : null}
    </div>
  );
}
