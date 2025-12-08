import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Activity, Settings, History, Wallet, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Nav() {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "PANEL", icon: LayoutDashboard },
    { href: "/strategies", label: "ESTRATEGIAS", icon: Activity },
    { href: "/history", label: "HISTORIAL", icon: History },
    { href: "/wallet", label: "CARTERA", icon: Wallet },
    { href: "/settings", label: "AJUSTES", icon: Settings },
  ];

  return (
    <nav className="h-16 border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-50 px-6 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 bg-primary/20 rounded-md flex items-center justify-center border border-primary/50">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <span className="font-sans font-bold text-lg tracking-tight">
            KRAKEN<span className="text-primary">BOT</span>.AI
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1">
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              <a className={cn(
                "px-4 py-2 rounded-md text-sm font-mono transition-colors flex items-center gap-2",
                location === link.href 
                  ? "bg-primary/10 text-primary border border-primary/20" 
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}>
                <link.icon className="h-4 w-4" />
                {link.label}
              </a>
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
          <Bell className="h-5 w-5" />
          <span className="absolute top-2 right-2 h-2 w-2 bg-red-500 rounded-full animate-pulse" />
        </Button>
        <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-primary to-purple-500 border border-white/10" />
      </div>
    </nav>
  );
}
