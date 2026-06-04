import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { EnvironmentBadge } from "@/components/dashboard/EnvironmentBadge";
import { Settings, Hexagon } from "lucide-react";

export function GlobalHeader() {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Home", labelShort: "Home" },
    { href: "/dca", label: "DCA Inteligente", labelShort: "DCA", aliases: ["/institutional-dca"] },
    { href: "/trading", label: "Trading Activo", labelShort: "Trading", aliases: ["/strategies"] },
    { href: "/fiscal", label: "Fiscal Crypto", labelShort: "Fiscal", aliases: ["/fisco"] },
  ];

  const isActive = (item: { href: string; aliases?: string[] }) => {
    if (item.href === "/" && location === "/") return true;
    if (item.href !== "/" && location.startsWith(item.href)) return true;
    if (item.aliases?.some((a) => location.startsWith(a))) return true;
    return false;
  };

  return (
    <header className="sticky top-0 z-40 bg-card/95 backdrop-blur-md border-b border-border">
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center gap-4">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Hexagon className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm hidden sm:inline">NEXA Crypto Suite</span>
          <span className="font-semibold text-sm sm:hidden">NEXA</span>
        </Link>

        {/* Nav links — desktop */}
        <nav className="hidden md:flex items-center gap-1 ml-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                isActive(item)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3">
          <EnvironmentBadge compact />
          <Link
            href="/settings"
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Sistema"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
