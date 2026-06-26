import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Upload, List, Stethoscope, ShieldCheck,
  ArrowLeftRight, FileText, Settings2, AlertTriangle,
} from "lucide-react";

export type FiscoSection =
  | "panel"
  | "importaciones"
  | "transacciones"
  | "diagnostico"
  | "balance-check"
  | "transferencias"
  | "informes"
  | "configuracion";

interface NavItem {
  id: FiscoSection;
  label: string;
  icon: React.FC<{ className?: string }>;
  badge?: string;
  badgeColor?: string;
}

interface FiscoNavProps {
  active: FiscoSection;
  onChange: (s: FiscoSection) => void;
  criticalCount?: number;
  warningCount?: number;
}

export function FiscoNav({ active, onChange, criticalCount = 0, warningCount = 0 }: FiscoNavProps) {
  const items: NavItem[] = [
    { id: "panel",          label: "Panel",           icon: LayoutDashboard },
    { id: "importaciones",  label: "Importaciones",   icon: Upload },
    { id: "transacciones",  label: "Transacciones",   icon: List },
    { id: "diagnostico",    label: "Diagnóstico",     icon: Stethoscope },
    {
      id: "balance-check",
      label: "Balance",
      icon: ShieldCheck,
      badge: criticalCount > 0 ? String(criticalCount) : warningCount > 0 ? String(warningCount) : undefined,
      badgeColor: criticalCount > 0 ? "bg-red-500" : "bg-yellow-500",
    },
    { id: "transferencias", label: "Transferencias",  icon: ArrowLeftRight },
    { id: "informes",       label: "Informes Fiscales", icon: FileText },
    { id: "configuracion",  label: "Configuración",   icon: Settings2 },
  ];

  return (
    <nav className="flex overflow-x-auto scrollbar-none border-b border-border mb-6 -mx-1 px-1 gap-1 pb-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap rounded-t-md transition-colors border-b-2 shrink-0",
              isActive
                ? "border-blue-500 text-blue-400 bg-blue-500/10"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{item.label}</span>
            {item.badge && (
              <span className={cn(
                "absolute -top-0.5 -right-0.5 h-4 min-w-[1rem] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center leading-none",
                item.badgeColor,
              )}>
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
