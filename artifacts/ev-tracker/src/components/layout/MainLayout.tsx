import React from "react";
import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, Target } from "lucide-react";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "EV Card", icon: Target },
    { href: "/tracker", label: "Tracker", icon: LayoutDashboard },
    { href: "/games", label: "Games", icon: Activity },
  ];

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col font-mono text-sm">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold tracking-tight">
            <Activity className="h-5 w-5 text-green-500" />
            <span>EV_TRACKER</span>
          </div>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-sm transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                  data-testid={`nav-link-${item.label.toLowerCase()}`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="flex-1 container mx-auto p-4 max-w-6xl">
        {children}
      </main>
    </div>
  );
}
