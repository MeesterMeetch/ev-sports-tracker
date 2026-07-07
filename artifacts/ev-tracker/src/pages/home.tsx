import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetEvCard, 
  getGetEvCardQueryKey,
  useGetNearMisses,
  getGetNearMissesQueryKey,
  useListSports,
  useCreateBet,
  getListBetsQueryKey
} from "@workspace/api-client-react";
import { 
  formatAmericanOdds, 
  formatPercent, 
  getEvColorClass,
  formatUnits
} from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, TrendingUp, AlertTriangle, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const [sport, setSport] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sports } = useListSports();
  
  const queryParams = sport !== "all" ? { sport } : {};
  
  const { data: evCard, isLoading: isEvLoading } = useGetEvCard(queryParams, {
    query: { queryKey: getGetEvCardQueryKey(queryParams) }
  });

  const { data: nearMisses, isLoading: isNearMissLoading } = useGetNearMisses(queryParams, {
    query: { queryKey: getGetNearMissesQueryKey(queryParams) }
  });

  const createBet = useCreateBet({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Bet tracked",
          description: "Bet has been successfully added to your tracker.",
        });
        queryClient.invalidateQueries({ queryKey: getListBetsQueryKey() });
      }
    }
  });

  const handleTrack = (bet: any) => {
    createBet.mutate({
      data: {
        gameId: bet.gameId,
        homeTeam: bet.homeTeam,
        awayTeam: bet.awayTeam,
        sport: bet.sport,
        market: bet.market,
        selection: bet.selection,
        point: bet.point,
        bookmaker: bet.bookmaker,
        americanOdds: bet.americanOdds,
        evPercent: bet.evPercent,
        units: bet.suggestedUnits,
        commenceTime: bet.commenceTime
      }
    });
  };

  const activeSports = sports?.filter(s => s.active) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Today's Bet Card</h1>
          <p className="text-muted-foreground text-sm">Rigorous +EV opportunities</p>
        </div>
        <div className="w-full sm:w-64">
          <Select value={sport} onValueChange={setSport}>
            <SelectTrigger data-testid="select-sport">
              <SelectValue placeholder="All Sports" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sports</SelectItem>
              {activeSports.map(s => (
                <SelectItem key={s.key} value={s.key}>{s.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isEvLoading ? (
        <div className="text-muted-foreground py-12 text-center animate-pulse">Scanning markets...</div>
      ) : evCard?.bets && evCard.bets.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {evCard.bets.map((bet, i) => (
            <Card key={`${bet.gameId}-${bet.selection}-${i}`} className="border-border bg-card/50 flex flex-col">
              <CardHeader className="pb-2 border-b border-border/50">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">{bet.sport} • {new Date(bet.commenceTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                    <CardTitle className="text-base font-semibold">{bet.awayTeam} @ {bet.homeTeam}</CardTitle>
                  </div>
                  <div className="flex">
                    {Array.from({ length: bet.confidence || 0 }).map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 flex-1 flex flex-col justify-between">
                <div className="space-y-3 mb-6">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Selection</span>
                    <span className="font-bold text-foreground">
                      {bet.selection} {bet.point != null && (bet.point > 0 ? `+${bet.point}` : bet.point)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Market</span>
                    <span className="uppercase text-xs tracking-wider">{bet.market}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Bookmaker</span>
                    <span className="text-foreground">{bet.bookmaker}</span>
                  </div>
                  <div className="flex justify-between items-center bg-secondary/50 p-2 rounded">
                    <span className="text-muted-foreground">Odds</span>
                    <span className="font-bold text-lg">{formatAmericanOdds(bet.americanOdds)}</span>
                  </div>
                  
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
                  onClick={() => handleTrack(bet)}
                  disabled={createBet.isPending}
                  data-testid={`button-track-${bet.gameId}`}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Save to Tracker
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-border bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <TrendingUp className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-bold mb-2">No +EV Bets Found</h3>
            <p className="text-muted-foreground max-w-md">
              There are currently no bets meeting your minimum EV threshold for {sport === "all" ? "any sport" : sport}. Check the near-misses below.
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
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground animate-pulse">Loading near misses...</td>
                  </tr>
                ) : nearMisses?.slice(0, 5).map((miss, i) => (
                  <tr key={`${miss.gameId}-${i}`} className="border-b border-border hover:bg-secondary/20">
                    <td className="px-4 py-3 font-medium">
                      <div className="text-xs text-muted-foreground mb-1">{miss.sport}</div>
                      {miss.awayTeam} @ {miss.homeTeam}
                    </td>
                    <td className="px-4 py-3">
                      {miss.selection} {miss.point != null && (miss.point > 0 ? `+${miss.point}` : miss.point)}
                      <div className="text-xs text-muted-foreground uppercase">{miss.market}</div>
                    </td>
                    <td className="px-4 py-3">{miss.bookmaker}</td>
                    <td className="px-4 py-3 font-mono">{formatAmericanOdds(miss.americanOdds)}</td>
                    <td className="px-4 py-3 font-mono text-yellow-500 font-bold">{formatAmericanOdds(miss.breakEvenOdds)}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{formatPercent(miss.evPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
