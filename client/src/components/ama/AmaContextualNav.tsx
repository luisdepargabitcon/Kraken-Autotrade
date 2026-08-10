import {
  LayoutDashboard, History, Terminal, HelpCircle, FlaskConical, ListChecks,
  Activity, ShieldCheck, TrendingDown, Layers, List, BookOpen, Lock,
} from "lucide-react";

export type AmaOffSubtab = "overview" | "history" | "events" | "help";
export type AmaLabSubtab = "home" | "results" | "events" | "help";
export type AmaRealSubtab =
  | "status" | "activation" | "strategy" | "cycle" | "orders"
  | "movements" | "history" | "events" | "security" | "help";

export type AmaEnvironment = "OFF" | "LAB" | "REAL";
export type AmaAnySubtab = AmaOffSubtab | AmaLabSubtab | AmaRealSubtab;

interface NavItem {
  key: AmaAnySubtab;
  label: string;
  icon: React.ReactNode;
}

const OFF_ITEMS: NavItem[] = [
  { key: "overview", label: "Resumen", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
  { key: "history", label: "Historial", icon: <History className="h-3.5 w-3.5" /> },
  { key: "events", label: "Eventos", icon: <Terminal className="h-3.5 w-3.5" /> },
  { key: "help", label: "Ayuda", icon: <HelpCircle className="h-3.5 w-3.5" /> },
];

const LAB_ITEMS: NavItem[] = [
  { key: "home", label: "Inicio", icon: <FlaskConical className="h-3.5 w-3.5" /> },
  { key: "results", label: "Resultados", icon: <ListChecks className="h-3.5 w-3.5" /> },
  { key: "events", label: "Eventos", icon: <Terminal className="h-3.5 w-3.5" /> },
  { key: "help", label: "Ayuda", icon: <HelpCircle className="h-3.5 w-3.5" /> },
];

const REAL_ITEMS: NavItem[] = [
  { key: "status", label: "Estado", icon: <Activity className="h-3.5 w-3.5" /> },
  { key: "activation", label: "Activación", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  { key: "strategy", label: "Estrategia", icon: <TrendingDown className="h-3.5 w-3.5" /> },
  { key: "cycle", label: "Ciclo y tramos", icon: <Layers className="h-3.5 w-3.5" /> },
  { key: "orders", label: "Órdenes", icon: <List className="h-3.5 w-3.5" /> },
  { key: "movements", label: "Movimientos", icon: <BookOpen className="h-3.5 w-3.5" /> },
  { key: "history", label: "Historial", icon: <History className="h-3.5 w-3.5" /> },
  { key: "events", label: "Eventos", icon: <Terminal className="h-3.5 w-3.5" /> },
  { key: "security", label: "Seguridad", icon: <Lock className="h-3.5 w-3.5" /> },
  { key: "help", label: "Ayuda", icon: <HelpCircle className="h-3.5 w-3.5" /> },
];

export function navItemsForEnvironment(env: AmaEnvironment): NavItem[] {
  if (env === "OFF") return OFF_ITEMS;
  if (env === "LAB") return LAB_ITEMS;
  return REAL_ITEMS;
}

export function defaultSubtabForEnvironment(env: AmaEnvironment): AmaAnySubtab {
  return navItemsForEnvironment(env)[0].key;
}

interface AmaContextualNavProps {
  environment: AmaEnvironment;
  subtab: AmaAnySubtab;
  onSubtabChange: (subtab: AmaAnySubtab) => void;
}

/**
 * Navegación contextual ÚNICA debajo del selector de modo AMA. Sus opciones
 * cambian según el entorno backend activo (OFF/LAB/REAL). Nunca produce
 * llamadas a /api/ama/mode: solo cambia qué contenido se muestra dentro del
 * entorno actual (MODE_CHANGE_CALLS=0 al navegar).
 */
export function AmaContextualNav({ environment, subtab, onSubtabChange }: AmaContextualNavProps) {
  const items = navItemsForEnvironment(environment);
  return (
    <div className="w-full overflow-x-auto sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/30">
      <div className="flex gap-1 min-w-max px-1 py-1.5">
        {items.map((item) => {
          const active = subtab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onSubtabChange(item.key)}
              className={`
                flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium
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
