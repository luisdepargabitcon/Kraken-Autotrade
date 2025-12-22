import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Activity, Monitor, Wallet, Settings, BarChart3 } from "lucide-react";

const tabs = [
  { href: "/", label: "Panel", icon: LayoutDashboard },
  { href: "/strategies", label: "Estrategias", icon: Activity },
  { href: "/terminal", label: "Terminal", icon: BarChart3 },
  { href: "/monitor", label: "Monitor", icon: Monitor },
  { href: "/wallet", label: "Cartera", icon: Wallet },
  { href: "/settings", label: "Ajustes", icon: Settings },
];

export function MobileTabBar() {
  const [location] = useLocation();

  return (
    <nav 
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border safe-area-bottom"
      data-testid="mobile-tab-bar"
    >
      <div className="flex items-center justify-around h-16">
        {tabs.map((tab) => {
          const isActive = location === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center justify-center flex-1 h-full min-h-[56px] py-2 px-1 transition-colors",
                isActive 
                  ? "text-primary" 
                  : "text-muted-foreground active:text-foreground"
              )}
              data-testid={`tab-${tab.href.replace("/", "") || "home"}`}
            >
              <tab.icon className={cn(
                "h-5 w-5 mb-1",
                isActive && "text-primary"
              )} />
              <span className={cn(
                "text-[10px] font-medium leading-tight",
                isActive ? "text-primary" : "text-muted-foreground"
              )}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
