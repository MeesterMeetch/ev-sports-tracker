import { AlertTriangle } from "lucide-react";
import type { SharpCoverage, EvBet } from "@workspace/api-client-react";

export function SharpCoverageBanner({ coverage, bets }: { coverage: SharpCoverage; bets?: EvBet[] }) {
  const { gamesEvaluated, gamesWithSharpH2H, gamesWithSharpSpreads, gamesWithSharpTotals } = coverage;
  if (gamesEvaluated === 0) return null;

  const markets: { label: string; count: number; marketKey: string }[] = [
    { label: "Moneyline", count: gamesWithSharpH2H, marketKey: "h2h" },
    { label: "Spreads", count: gamesWithSharpSpreads, marketKey: "spreads" },
    { label: "Totals", count: gamesWithSharpTotals, marketKey: "totals" },
  ];

  const activeBetMarkets = new Set((bets ?? []).map(b => b.market));

  const zeroWarnings = markets.filter(({ count, marketKey }) =>
    count === 0 && activeBetMarkets.has(marketKey)
  );

  const lowWarnings = markets.filter(({ count, marketKey }) => {
    const pct = count / gamesEvaluated;
    return count > 0 && pct < 0.5 && activeBetMarkets.has(marketKey);
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/70">Sharp coverage</span>
        {markets.map(({ label, count }) => {
          const pct = gamesEvaluated > 0 ? count / gamesEvaluated : 0;
          const colorClass = pct >= 0.75 ? "text-green-400" : pct >= 0.4 ? "text-yellow-400" : "text-red-400";
          return (
            <span key={label} className="flex items-center gap-1">
              <span>{label}:</span>
              <span data-testid={`coverage-${label.toLowerCase()}`} className={`font-semibold tabular-nums ${colorClass}`}>{count}/{gamesEvaluated}</span>
              <span>games</span>
            </span>
          );
        })}
      </div>
      {zeroWarnings.map(({ label, marketKey }) => (
        <div key={marketKey} data-testid={`warning-${marketKey}`} className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
          <span>
            <span className="font-semibold text-red-200">No sharp lines — {label} EV is unreliable for this market</span>
          </span>
        </div>
      ))}
      {lowWarnings.map(({ label, count, marketKey }) => (
        <div key={marketKey} data-testid={`warning-${marketKey}`} className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <span>
            <span className="font-semibold text-amber-200">{label} EV may be unreliable</span>
            {" "}— only {count} of {gamesEvaluated} games had sharp lines
          </span>
        </div>
      ))}
    </div>
  );
}
