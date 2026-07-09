import { AlertTriangle, Check } from "lucide-react";
import type { GameStarter } from "@workspace/api-client-react";

// Starters (pitchers/goalies) poll faster than the odds scan: the API server's
// error cache clears 90 s after an upstream outage ends, and polling at 60 s
// ensures the UI picks up the server's fresh data within that window without a
// reload. (End-to-end worst case from upstream recovery is ~150 s: up to 90 s
// of server error-cache remainder plus one 60 s poll cycle.)
// Cheap: it only hits our own server's in-memory cache, not external APIs.
export const STARTERS_REFETCH_INTERVAL_MS = 60 * 1000;

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

export function findStarter(starters: GameStarter[], homeTeam: string, awayTeam: string, sport: string): GameStarter | null {
  return starters.find((s) => {
    if (s.sport !== sport) return false;
    const nh = normalize(s.homeTeam), na = normalize(s.awayTeam);
    const qh = normalize(homeTeam), qa = normalize(awayTeam);
    return (nh === qh || nh.includes(qh) || qh.includes(nh)) && (na === qa || na.includes(qa) || qa.includes(na));
  }) ?? null;
}

export function StarterBadge({ starter }: { starter: GameStarter }) {
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

export function StarterTbd({ sport }: { sport: string }) {
  return (
    <div className="flex items-center gap-1 mt-2 rounded px-2 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
      <AlertTriangle className="w-3 h-3 shrink-0" />
      <span>{sport === "baseball_mlb" ? "Pitcher TBD" : "Goalie TBD"}</span>
    </div>
  );
}
