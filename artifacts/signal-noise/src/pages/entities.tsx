import { useState } from "react";
import {
  useListEntities,
  getListEntitiesQueryKey,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Users } from "lucide-react";

type EntityType = "all" | "person" | "company" | "topic" | "org";

const typeColors: Record<string, string> = {
  person: "bg-blue-100 text-blue-700",
  company: "bg-purple-100 text-purple-700",
  topic: "bg-emerald-100 text-emerald-700",
  org: "bg-amber-100 text-amber-700",
};

export default function Entities() {
  const [typeFilter, setTypeFilter] = useState<EntityType>("all");

  const params = typeFilter === "all" ? {} : { type: typeFilter };
  const { data: entities, isLoading } = useListEntities(params, {
    query: { queryKey: getListEntitiesQueryKey(params) },
  });

  const tabs: { key: EntityType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "person", label: "People" },
    { key: "company", label: "Companies" },
    { key: "topic", label: "Topics" },
    { key: "org", label: "Orgs" },
  ];

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">People & Topics</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Key entities mentioned across your analyzed emails
          </p>
        </div>

        <div className="flex gap-1 border-b border-border" data-testid="filter-tabs-entities">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              data-testid={`tab-entity-${key}`}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                typeFilter === key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : (entities ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <Users className="w-10 h-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No entities found yet. Sync Gmail to identify key people, companies, and topics.
            </p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="entity-list">
            {(entities ?? []).map((entity, index) => (
              <div
                key={`${entity.name}-${entity.type}-${index}`}
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:border-foreground/20 transition-colors"
                data-testid={`card-entity-${index}`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColors[entity.type] ?? "bg-muted text-muted-foreground"}`}
                    data-testid={`badge-type-${index}`}
                  >
                    {entity.type}
                  </span>
                  <span
                    className="text-sm font-medium"
                    data-testid={`text-entity-name-${index}`}
                  >
                    {entity.name}
                  </span>
                </div>
                <span
                  className="text-sm text-muted-foreground font-mono"
                  data-testid={`text-entity-count-${index}`}
                >
                  {entity.count} mention{entity.count !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
