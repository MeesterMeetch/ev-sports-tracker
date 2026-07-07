import { useState } from "react";
import {
  useListActions,
  useUpdateAction,
  getListActionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CheckSquare } from "lucide-react";

type ActionFilter = "all" | "pending" | "done";

const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
const priorityColors: Record<string, string> = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function Actions() {
  const [filter, setFilter] = useState<ActionFilter>("all");
  const queryClient = useQueryClient();

  const params =
    filter === "all" ? {} : { done: filter === "done" };
  const { data: actions, isLoading } = useListActions(params, {
    query: { queryKey: getListActionsQueryKey(params) },
  });

  const updateMutation = useUpdateAction();

  const handleToggle = (id: number, done: boolean) => {
    updateMutation.mutate(
      { id, data: { done: !done } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListActionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListActionsQueryKey({ done: false }) });
          queryClient.invalidateQueries({ queryKey: getListActionsQueryKey({ done: true }) });
        },
      }
    );
  };

  const sorted = [...(actions ?? [])].sort(
    (a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)
  );

  const highPending = (actions ?? []).filter((a) => !a.done && a.priority === "high").length;

  const grouped: Record<string, typeof sorted> = { high: [], medium: [], low: [] };
  for (const item of sorted) {
    grouped[item.priority] = grouped[item.priority] ?? [];
    grouped[item.priority].push(item);
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Action Items</h2>
          {highPending > 0 && (
            <p className="text-sm text-red-600 mt-1 font-medium">
              {highPending} high-priority item{highPending !== 1 ? "s" : ""} pending
            </p>
          )}
        </div>

        <div className="flex gap-1 border-b border-border" data-testid="filter-tabs-actions">
          {(["all", "pending", "done"] as ActionFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              data-testid={`tab-actions-${f}`}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                filter === f
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : (actions ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <CheckSquare className="w-10 h-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No action items yet. Sync Gmail to extract tasks from your emails.
            </p>
          </div>
        ) : (
          <div className="space-y-6" data-testid="action-groups">
            {(["high", "medium", "low"] as const).map((priority) => {
              const items = grouped[priority] ?? [];
              if (items.length === 0) return null;
              return (
                <div key={priority}>
                  <h3
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2"
                    data-testid={`group-header-${priority}`}
                  >
                    {priority} priority
                  </h3>
                  <div className="space-y-1.5">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border border-border bg-card transition-opacity ${
                          item.done ? "opacity-50" : ""
                        }`}
                        data-testid={`row-action-${item.id}`}
                      >
                        <Checkbox
                          id={`action-${item.id}`}
                          checked={item.done}
                          onCheckedChange={() => handleToggle(item.id, item.done)}
                          disabled={updateMutation.isPending}
                          data-testid={`checkbox-action-${item.id}`}
                          className="mt-0.5 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm ${item.done ? "line-through text-muted-foreground" : "text-foreground"}`}
                            data-testid={`text-action-${item.id}`}
                          >
                            {item.text}
                          </p>
                          {item.deadline && (
                            <p
                              className="text-xs text-muted-foreground mt-0.5"
                              data-testid={`text-deadline-${item.id}`}
                            >
                              Due: {item.deadline}
                            </p>
                          )}
                        </div>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded border shrink-0 font-medium ${priorityColors[item.priority] ?? priorityColors.low}`}
                          data-testid={`badge-priority-${item.id}`}
                        >
                          {item.priority}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
