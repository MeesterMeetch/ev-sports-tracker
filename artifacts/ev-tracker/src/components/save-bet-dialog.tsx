import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAmericanOdds, formatPercent } from "@/lib/formatters";

interface SaveBetDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (units: number) => void;
  bet: {
    homeTeam: string;
    awayTeam: string;
    selection: string;
    market: string;
    bookmaker: string;
    americanOdds: number;
    evPercent: number;
    suggestedUnits: number;
    point?: number | null;
  } | null;
  isDuplicate: boolean;
  isPending: boolean;
}

export function SaveBetDialog({
  open,
  onClose,
  onConfirm,
  bet,
  isDuplicate,
  isPending,
}: SaveBetDialogProps) {
  const [units, setUnits] = useState<string>("");

  const suggestedUnits = bet?.suggestedUnits ?? 0;

  const handleOpen = () => {
    setUnits(suggestedUnits.toString());
  };

  const handleConfirm = () => {
    const parsed = parseFloat(units);
    if (isNaN(parsed) || parsed <= 0) return;
    onConfirm(parsed);
  };

  if (!bet) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) handleOpen();
        else onClose();
      }}
    >
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle>Save to Tracker</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isDuplicate && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                You already have a tracked bet on <strong>{bet.selection}</strong> for this game. Adding another will create a duplicate.
              </span>
            </div>
          )}

          <div className="rounded-md bg-secondary/50 p-3 space-y-1 text-sm">
            <div className="font-semibold text-foreground">
              {bet.awayTeam} @ {bet.homeTeam}
            </div>
            <div className="text-muted-foreground">
              {bet.selection}
              {bet.point != null && (
                <span> ({bet.point > 0 ? `+${bet.point}` : bet.point})</span>
              )}{" "}
              — {bet.market.toUpperCase()} — {bet.bookmaker}
            </div>
            <div className="flex gap-4 pt-1">
              <span className="font-mono font-bold text-foreground">
                {formatAmericanOdds(bet.americanOdds)}
              </span>
              <span className="text-green-400 font-bold">
                +{formatPercent(bet.evPercent)} EV
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="units-input">Units to wager</Label>
            <div className="flex items-center gap-2">
              <Input
                id="units-input"
                type="number"
                min="0.01"
                step="0.01"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                className="font-mono"
              />
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground"
                onClick={() => setUnits(suggestedUnits.toString())}
              >
                Reset ({suggestedUnits}u)
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Quarter-Kelly suggestion: {suggestedUnits}u
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending || !units || parseFloat(units) <= 0}
          >
            {isDuplicate ? "Save Anyway" : "Save Bet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
