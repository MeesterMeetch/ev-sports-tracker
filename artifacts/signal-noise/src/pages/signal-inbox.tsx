import { useState } from "react";
import {
  useGetEmailStats,
  useListSignals,
  useSyncEmails,
  getListSignalsQueryKey,
  getGetEmailStatsQueryKey,
  getListActionsQueryKey,
  getListTrendsQueryKey,
  getListEntitiesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Inbox } from "lucide-react";

type FilterTab = "all" | "signal" | "noise";

function scoreColor(score: number) {
  if (score >= 80) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 60) return "bg-blue-100 text-blue-800 border-blue-200";
  if (score >= 40) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-gray-100 text-gray-600 border-gray-200";
}

function scoreLabel(score: number) {
  if (score >= 80) return "High Signal";
  if (score >= 60) return "Signal";
  if (score >= 40) return "Weak Signal";
  return "Noise";
}

export default function SignalInbox() {
  const [filter, setFilter] = useState<FilterTab>("all");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = filter === "all" ? {} : { category: filter };
  const { data: signals, isLoading: signalsLoading } = useListSignals(params, {
    query: { queryKey: getListSignalsQueryKey(params) },
  });
  const { data: stats } = useGetEmailStats({
    query: { queryKey: getGetEmailStatsQueryKey() },
  });

  const syncMutation = useSyncEmails();

  const handleSync = () => {
    syncMutation.mutate(
      { data: { maxEmails: 20 } },
      {
        onSuccess: (data) => {
          toast({
            title: "Sync Complete",
            description: `Synced ${data.processed} emails — ${data.newSignals} signals, ${data.newActions} action items found.`,
          });
          queryClient.invalidateQueries({ queryKey: getListSignalsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetEmailStatsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListActionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListTrendsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListEntitiesQueryKey() });
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Unknown error";
          toast({
            title: "Sync Failed",
            description: msg,
            variant: "destructive",
          });
        },
      }
    );
  };

  const hasEmails = (signals?.length ?? 0) > 0 || (stats?.total ?? 0) > 0;
  const signalCount = (signals ?? []).filter((s) => s.category === "signal").length;
  const noiseCount = (signals ?? []).filter((s) => s.category === "noise").length;
  const allCount = (signals ?? []).length;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Signal Inbox</h2>
            <p className="text-sm text-muted-foreground mt-1">
              AI-scored emails ranked by intelligence value
            </p>
          </div>
          <Button
            onClick={handleSync}
            disabled={syncMutation.isPending}
            data-testid="button-sync-gmail-inline"
            size="sm"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync Gmail"}
          </Button>
        </div>

        {stats && stats.total > 0 && (
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
            data-testid="stats-bar"
          >
            {[
              { label: "Processed", value: stats.total },
              {
                label: "Signal Rate",
                value: `${stats.signalRate}%`,
              },
              { label: "Avg Score", value: stats.avgSignalScore },
              { label: "Pending Actions", value: stats.pendingActions },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="bg-card border border-border rounded-lg p-3"
                data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        )}

        {!hasEmails && !signalsLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <Inbox className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">No emails analyzed yet</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                Connect your Gmail and sync to get AI-powered signal scores, action items,
                and topic summaries for your inbox.
              </p>
            </div>
            <Button
              onClick={handleSync}
              disabled={syncMutation.isPending}
              data-testid="button-sync-gmail-empty"
              size="lg"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing Gmail..." : "Sync Gmail Now"}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-1 border-b border-border" data-testid="filter-tabs">
              {(
                [
                  { key: "all", label: "All", count: allCount },
                  { key: "signal", label: "Signal", count: signalCount },
                  { key: "noise", label: "Noise", count: noiseCount },
                ] as { key: FilterTab; label: string; count: number }[]
              ).map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  data-testid={`tab-${key}`}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    filter === key
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span className="ml-1.5 text-xs font-normal">({count})</span>
                  )}
                </button>
              ))}
            </div>

            {signalsLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="h-28 rounded-lg bg-muted animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-3" data-testid="signal-list">
                {(signals ?? []).map((signal) => (
                  <div
                    key={signal.id}
                    className="border border-border rounded-lg p-4 bg-card hover:border-foreground/20 transition-colors"
                    data-testid={`card-signal-${signal.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="text-xs font-medium text-muted-foreground"
                            data-testid={`text-sender-${signal.id}`}
                          >
                            {signal.fromName || signal.fromEmail}
                          </span>
                          <span className="text-xs text-muted-foreground/50">
                            {new Date(signal.date).toLocaleDateString()}
                          </span>
                        </div>
                        <p
                          className="font-medium text-sm mt-0.5 truncate"
                          data-testid={`text-subject-${signal.id}`}
                        >
                          {signal.subject}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {signal.summary}
                        </p>
                        {signal.topics.length > 0 && (
                          <div className="flex gap-1.5 mt-2 flex-wrap">
                            {signal.topics.map((topic) => (
                              <span
                                key={topic}
                                className="text-xs px-2 py-0.5 bg-muted rounded-full text-muted-foreground"
                                data-testid={`chip-topic-${signal.id}-${topic}`}
                              >
                                {topic}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded border ${scoreColor(signal.signalScore)}`}
                          data-testid={`badge-score-${signal.id}`}
                        >
                          {signal.signalScore}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {scoreLabel(signal.signalScore)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {(signals ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-12">
                    No emails in this category.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
