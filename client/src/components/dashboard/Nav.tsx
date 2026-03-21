import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Activity, Settings, Wallet, Bell, Plug, Menu, X, BookOpen, BarChart3, Monitor, HardDrive, Calculator, Brain, CircleDollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";

type NavLink = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavSeparator = { separator: true; label: string };
type NavItem = NavLink | NavSeparator;

function isSeparator(item: NavItem): item is NavSeparator {
  return "separator" in item;
}

export function Nav() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: NavItem[] = [
    // TRADING
    { href: "/", label: "PANEL", icon: LayoutDashboard },
    { href: "/strategies", label: "TRADING", icon: Activity },
    { href: "/terminal", label: "TERMINAL", icon: BarChart3 },
    { href: "/institutional-dca", label: "IDCA", icon: CircleDollarSign },
    // ANÁLISIS
    { separator: true, label: "ANÁLISIS" },
    { href: "/monitor", label: "MONITOR", icon: Monitor },
    { href: "/wallet", label: "CARTERA", icon: Wallet },
    { href: "/ai", label: "IA/ML", icon: Brain },
    { href: "/fisco", label: "FISCO", icon: Calculator },
    // SISTEMA
    { separator: true, label: "SISTEMA" },
    { href: "/notifications", label: "ALERTAS", icon: Bell },
    { href: "/integrations", label: "APIS", icon: Plug },
    { href: "/settings", label: "SISTEMA", icon: Settings },
    { href: "/backups", label: "BACKUPS", icon: HardDrive },
    { href: "/guide", label: "GUÍA", icon: BookOpen },
  ];

  // Flat links for mobile and iteration
  const links: NavLink[] = navItems.filter((item): item is NavLink => !isSeparator(item));

  return (
    <>
      <nav className="h-14 md:h-16 border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-50 px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center gap-4 md:gap-8">
          <Button 
            variant="ghost" 
            size="icon" 
            className="md:hidden text-muted-foreground h-11 w-11 touch-target"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="button-mobile-menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 md:h-8 md:w-8 bg-primary/20 rounded-md flex items-center justify-center border border-primary/50">
              <Activity className="h-4 w-4 md:h-5 md:w-5 text-primary" />
            </div>
            <span className="font-sans font-bold text-base md:text-lg tracking-tight">
              KRAKEN<span className="text-primary">BOT</span><span className="hidden sm:inline">.AI</span>
            </span>
          </div>

          <div className="hidden md:flex items-center gap-0.5">
            {navItems.map((item, idx) => {
              if (isSeparator(item)) {
                return (
                  <div key={`sep-${idx}`} className="mx-1 h-5 w-px bg-border/50" />
                );
              }
              return (
                <Link 
                  key={item.href} 
                  href={item.href}
                  className={cn(
                    "px-2 lg:px-3 xl:px-3 py-1.5 rounded-md text-xs font-mono transition-colors flex items-center gap-1.5",
                    location === item.href 
                      ? "bg-primary/10 text-primary border border-primary/20" 
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline text-[11px]">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground h-11 w-11 touch-target">
            <Bell className="h-5 w-5" />
            <span className="absolute top-2 right-2 h-2 w-2 bg-red-500 rounded-full animate-pulse" />
          </Button>
          <div className="h-7 w-7 md:h-8 md:w-8 rounded-full bg-gradient-to-tr from-primary to-purple-500 border border-white/10" />
        </div>
      </nav>
      
      {mobileMenuOpen && (
        <>
          <div 
            className="md:hidden fixed inset-0 top-14 z-30 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="md:hidden fixed inset-x-0 top-14 z-40 bg-background border-b border-border max-h-[calc(100vh-3.5rem)] overflow-y-auto">
            <div className="flex flex-col p-4 gap-1">
              {navItems.map((item, idx) => {
                if (isSeparator(item)) {
                  return (
                    <div key={`msep-${idx}`} className="flex items-center gap-2 px-4 pt-3 pb-1">
                      <span className="text-[10px] font-mono font-bold text-muted-foreground/60 tracking-widest uppercase">{item.label}</span>
                      <div className="flex-1 h-px bg-border/30" />
                    </div>
                  );
                }
                return (
                  <Link 
                    key={item.href} 
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "px-4 py-3 min-h-[44px] rounded-lg text-sm font-mono transition-colors flex items-center gap-3 touch-target",
                      location === item.href 
                        ? "bg-primary/10 text-primary border border-primary/20" 
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
