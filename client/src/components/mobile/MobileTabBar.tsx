import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Home, TrendingUp, BarChart3, FileText, Settings } from "lucide-react";

const tabs = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/dca", label: "DCA", icon: TrendingUp, aliases: ["/institutional-dca"] },
  { href: "/trading", label: "Trading", icon: BarChart3, aliases: ["/strategies"] },
  { href: "/fiscal", label: "Fiscal", icon: FileText, aliases: ["/fisco"] },
  { href: "/settings", label: "Sistema", icon: Settings, aliases: ["/monitor", "/wallet", "/integrations", "/notifications", "/backups", "/terminal", "/ai", "/guide", "/telegram"] },
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
          const isActive = (tab as any).exact
            ? location === tab.href
            : location === tab.href || location.startsWith(tab.href + "/") || ((tab as any).aliases?.some((a: string) => location === a || location.startsWith(a + "/")));
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
