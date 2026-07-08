import { useLocation, Link } from "wouter";
import { Inbox, CheckSquare, Users, TrendingUp, RefreshCw, Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useSyncEmails } from "@workspace/api-client-react";
import { 
  getListSignalsQueryKey, 
  getGetEmailStatsQueryKey,
  getListActionsQueryKey,
  getListTrendsQueryKey,
  getListEntitiesQueryKey
} from "@workspace/api-client-react";

async function fetchGmailStatus(): Promise<{ connected: boolean }> {
  const res = await fetch("/api/auth/google/status");
  if (!res.ok) return { connected: false };
  return res.json() as Promise<{ connected: boolean }>;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: gmailStatus } = useQuery({
    queryKey: ["gmail-status"],
    queryFn: fetchGmailStatus,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const isConnected = gmailStatus?.connected ?? false;

  const syncMutation = useSyncEmails();

  function extractSyncError(err: unknown): string {
    if (err instanceof Error) {
      try {
        const parsed = JSON.parse(err.message) as { error?: string };
        if (parsed.error) return parsed.error;
      } catch {}
      return err.message;
    }
    return "Unknown error — check the server logs.";
  }

  const handleSync = () => {
    syncMutation.mutate({ data: { maxEmails: 20 } }, {
      onSuccess: (data) => {
        toast({
          title: "Sync Complete",
          description: `Processed ${data.processed} emails. Found ${data.newSignals} signals and ${data.newActions} action items.`,
        });
        queryClient.invalidateQueries({ queryKey: getListSignalsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetEmailStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListActionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTrendsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListEntitiesQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
      },
      onError: (err: unknown) => {
        toast({
          title: "Sync Failed",
          description: extractSyncError(err),
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
      },
    });
  };

  const navItems = [
    { href: "/", label: "Signal Inbox", icon: Inbox },
    { href: "/actions", label: "Action Items", icon: CheckSquare },
    { href: "/entities", label: "People & Topics", icon: Users },
    { href: "/trends", label: "Trends", icon: TrendingUp },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      <aside className="w-full md:w-64 border-r border-border bg-card p-6 flex flex-col">
        <div className="mb-8">
          <h1 className="text-xl font-serif font-bold">Signal vs. Noise</h1>
          <p className="text-sm text-muted-foreground mt-1">Intelligence Brief</p>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className="block">
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className={`w-full justify-start ${isActive ? "font-medium" : "font-normal text-muted-foreground"}`}
                  data-testid={`nav-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>

        <div className="mt-8 pt-8 border-t border-border space-y-3">
          {isConnected ? (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                <span>Gmail connected</span>
              </div>
              <Button
                className="w-full"
                onClick={handleSync}
                disabled={syncMutation.isPending}
                data-testid="button-sync-gmail"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                {syncMutation.isPending ? "Syncing..." : "Sync Gmail"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground px-1">
                Connect your Gmail account to start syncing emails.
              </p>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => { window.location.href = "/api/auth/google"; }}
                data-testid="button-connect-gmail"
              >
                <Mail className="mr-2 h-4 w-4" />
                Connect Gmail
              </Button>
            </>
          )}
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-12 max-w-5xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
