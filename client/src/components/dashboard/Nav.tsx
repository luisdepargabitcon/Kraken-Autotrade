import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Activity, Settings, History, Wallet, Bell, Plug, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Nav() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const links = [
    { href: "/", label: "PANEL", icon: LayoutDashboard },
    { href: "/strategies", label: "ESTRATEGIAS", icon: Activity },
    { href: "/history", label: "HISTORIAL", icon: History },
    { href: "/wallet", label: "CARTERA", icon: Wallet },
    { href: "/integrations", label: "INTEGRACIONES", icon: Plug },
    { href: "/settings", label: "AJUSTES", icon: Settings },
  ];

  return (
    <>
      <nav className="h-14 md:h-16 border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-50 px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center gap-4 md:gap-8">
          <Button 
            variant="ghost" 
            size="icon" 
            className="md:hidden text-muted-foreground"
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

          <div className="hidden md:flex items-center gap-1">
            {links.map((link) => (
              <Link 
                key={link.href} 
                href={link.href}
                className={cn(
                  "px-2 lg:px-3 xl:px-4 py-2 rounded-md text-xs font-mono transition-colors flex items-center gap-1.5 lg:gap-2",
                  location === link.href 
                    ? "bg-primary/10 text-primary border border-primary/20" 
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                <link.icon className="h-4 w-4" />
                <span className="hidden lg:inline text-xs">{link.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground h-8 w-8 md:h-10 md:w-10">
            <Bell className="h-4 w-4 md:h-5 md:w-5" />
            <span className="absolute top-1.5 right-1.5 md:top-2 md:right-2 h-2 w-2 bg-red-500 rounded-full animate-pulse" />
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
            <div className="flex flex-col p-4 gap-2">
              {links.map((link) => (
                <Link 
                  key={link.href} 
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "px-4 py-3 rounded-lg text-sm font-mono transition-colors flex items-center gap-3",
                    location === link.href 
                      ? "bg-primary/10 text-primary border border-primary/20" 
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"
                  )}
                >
                  <link.icon className="h-5 w-5" />
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
