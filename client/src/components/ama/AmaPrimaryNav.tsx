import { LayoutDashboard, Layers, FlaskConical, RotateCcw, Ghost, ShieldCheck, BookOpen, HelpCircle } from "lucide-react";

export type AmaTabKey = "overview" | "cycles" | "lab" | "replay" | "shadow" | "operation" | "ledger" | "help";

interface AmaPrimaryNavProps {
  activeTab: AmaTabKey;
  onTabChange: (tab: AmaTabKey) => void;
}

const NAV_ITEMS: { key: AmaTabKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Resumen", icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: "cycles", label: "Ciclos", icon: <Layers className="h-4 w-4" /> },
  { key: "lab", label: "Laboratorio", icon: <FlaskConical className="h-4 w-4" /> },
  { key: "replay", label: "Histórico", icon: <RotateCcw className="h-4 w-4" /> },
  { key: "shadow", label: "Simulación", icon: <Ghost className="h-4 w-4" /> },
  { key: "operation", label: "Operación", icon: <ShieldCheck className="h-4 w-4" /> },
  { key: "ledger", label: "Ledger", icon: <BookOpen className="h-4 w-4" /> },
  { key: "help", label: "Ayuda", icon: <HelpCircle className="h-4 w-4" /> },
];

export function AmaPrimaryNav({ activeTab, onTabChange }: AmaPrimaryNavProps) {
  return (
    <div className="w-full overflow-x-auto sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/30">
      <div className="flex gap-1 min-w-max px-1 py-1.5">
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onTabChange(item.key)}
              className={`
                flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium
                transition-all whitespace-nowrap
                ${active
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30 border border-transparent"
                }
              `}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
