import { useState } from "react";
import { useListGames, useListSports, getListGamesQueryKey, useAnalyzeGame } from "@workspace/api-client-react";
import { formatAmericanOdds } from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BrainCircuit, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Games() {
  const [sport, setSport] = useState<string>("all");
  const [analyzingGame, setAnalyzingGame] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<string, string>>({});
  
  const { toast } = useToast();
  const { data: sports } = useListSports();
  
  const queryParams = sport !== "all" ? { sport } : {};
  const { data: games, isLoading } = useListGames(queryParams, {
    query: { queryKey: getListGamesQueryKey(queryParams) }
  });

  const analyzeGame = useAnalyzeGame({
    mutation: {
      onSuccess: (data) => {
        setAnalysisResults(prev => ({
          ...prev,
          [data.gameId]: data.analysis
        }));
        setAnalyzingGame(null);
      },
      onError: () => {
        toast({ title: "Analysis failed", variant: "destructive" });
        setAnalyzingGame(null);
      }
    }
  });

  const handleAnalyze = (gameId: string, homeTeam: string, awayTeam: string, sportKey: string) => {
    setAnalyzingGame(gameId);
    analyzeGame.mutate({
      data: {
        gameId,
        homeTeam,
        awayTeam,
        sport: sportKey
      }
    });
  };

  const activeSports = sports?.filter(s => s.active) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Odds Explorer</h1>
          <p className="text-muted-foreground text-sm">Raw market data across bookmakers</p>
        </div>
        <div className="w-full sm:w-64">
          <Select value={sport} onValueChange={setSport}>
            <SelectTrigger>
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

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground animate-pulse">Loading games...</div>
      ) : games?.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground bg-card rounded-lg border border-border">
          No games found for the selected criteria.
        </div>
      ) : (
        <div className="space-y-6">
          {games?.map((game) => (
            <Card key={game.id} className="bg-card border-border overflow-hidden">
              <CardHeader className="bg-secondary/30 pb-4 border-b border-border">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">
                      {game.sport} • {new Date(game.commenceTime).toLocaleString()}
                    </div>
                    <CardTitle className="text-lg">
                      {game.awayTeam} @ {game.homeTeam}
                    </CardTitle>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="bg-background"
                    onClick={() => handleAnalyze(game.id, game.homeTeam, game.awayTeam, game.sport)}
                    disabled={analyzingGame === game.id}
                  >
                    {analyzingGame === game.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <BrainCircuit className="h-4 w-4 mr-2 text-primary" />
                    )}
                    AI Analysis
                  </Button>
                </div>
              </CardHeader>
              
              {analysisResults[game.id] && (
                <div className="bg-primary/5 border-b border-primary/20 p-4 text-sm font-mono leading-relaxed">
                  <div className="flex items-center gap-2 text-primary font-bold mb-2">
                    <BrainCircuit className="h-4 w-4" /> Analysis
                  </div>
                  {analysisResults[game.id]}
                </div>
              )}

              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-secondary/50 text-muted-foreground text-xs uppercase border-b border-border">
                      <tr>
                        <th className="px-4 py-2">Bookmaker</th>
                        <th className="px-4 py-2">Market</th>
                        <th className="px-4 py-2">Away</th>
                        <th className="px-4 py-2">Home</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {game.bookmakers.map((bookie, bIdx) => (
                        bookie.markets.map((market, mIdx) => {
                          const awayOutcome = market.outcomes.find(o => o.name === game.awayTeam);
                          const homeOutcome = market.outcomes.find(o => o.name === game.homeTeam);
                          
                          if (!awayOutcome || !homeOutcome) return null;

                          return (
                            <tr key={`${bookie.key}-${market.key}`} className="border-b border-border/50 hover:bg-secondary/20">
                              <td className="px-4 py-2 font-sans">{bookie.title}</td>
                              <td className="px-4 py-2 uppercase text-xs">{market.key}</td>
                              <td className="px-4 py-2">
                                {awayOutcome.point != null && <span className="text-muted-foreground mr-2">{awayOutcome.point > 0 ? `+${awayOutcome.point}` : awayOutcome.point}</span>}
                                {formatAmericanOdds(awayOutcome.price)}
                              </td>
                              <td className="px-4 py-2">
                                {homeOutcome.point != null && <span className="text-muted-foreground mr-2">{homeOutcome.point > 0 ? `+${homeOutcome.point}` : homeOutcome.point}</span>}
                                {formatAmericanOdds(homeOutcome.price)}
                              </td>
                            </tr>
                          );
                        })
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
