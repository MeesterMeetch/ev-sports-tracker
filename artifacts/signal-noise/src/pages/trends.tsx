import { useState } from "react";
import { useListTrends, getListTrendsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { TrendingUp, ChevronDown, ChevronRight } from "lucide-react";

export default function Trends() {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data: trends, isLoading } = useListTrends({
    query: { queryKey: getListTrendsQueryKey() },
  });

  const toggleExpanded = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Emerging Trends</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Topics recurring across your analyzed emails, ordered by frequency
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : (trends ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <TrendingUp className="w-10 h-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No trends detected yet. Sync more emails to surface recurring topics.
            </p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="trend-list">
            {(trends ?? []).map((trend, index) => {
              const isOpen = expanded.has(index);
              return (
                <div
                  key={trend.topic}
                  className="border border-border rounded-lg bg-card overflow-hidden"
                  data-testid={`card-trend-${index}`}
                >
                  <button
                    className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors text-left"
                    onClick={() => toggleExpanded(index)}
                    data-testid={`button-trend-toggle-${index}`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-foreground text-background text-xs font-bold shrink-0"
                        data-testid={`badge-rank-${index}`}
                      >
                        {index + 1}
                      </span>
                      <span
                        className="font-medium text-sm capitalize"
                        data-testid={`text-trend-topic-${index}`}
                      >
                        {trend.topic}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className="text-sm text-muted-foreground"
                        data-testid={`text-trend-count-${index}`}
                      >
                        {trend.count} email{trend.count !== 1 ? "s" : ""}
                      </span>
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </button>

                  {isOpen && trend.recentEmails.length > 0 && (
                    <div
                      className="border-t border-border px-4 py-3 space-y-1.5 bg-muted/30"
                      data-testid={`emails-trend-${index}`}
                    >
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        Recent emails
                      </p>
                      {trend.recentEmails.map((subject, si) => (
                        <p
                          key={si}
                          className="text-sm text-foreground/80 pl-2 border-l-2 border-border"
                          data-testid={`text-trend-email-${index}-${si}`}
                        >
                          {subject}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
