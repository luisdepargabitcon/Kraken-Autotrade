/**
 * AmaModeGuide — Guía visual de modos AMA en español.
 *
 * Tarjetas explicativas de cada modo + tabla comparadora.
 * Aparece encima del selector de modo.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PowerOff, FlaskConical, RotateCcw, Ghost, Eye, ShieldCheck, Lock,
  TrendingDown, BarChart3, Database, Wallet, AlertTriangle,
} from "lucide-react";
import { MODE_LABELS, MODE_DESCRIPTIONS, MODE_RISK, MODE_ORDERS, MODE_DATA } from "./amaLabels";

interface ModeInfo {
  mode: string;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
  locked?: boolean;
}

const MODES: ModeInfo[] = [
  {
    mode: "OFF",
    icon: <PowerOff className="h-5 w-5 text-gray-400" />,
    color: "border-gray-500/20 bg-gray-500/5",
  },
  {
    mode: "LAB",
    icon: <FlaskConical className="h-5 w-5 text-purple-400" />,
    color: "border-purple-500/20 bg-purple-500/5",
    subtitle: "Prueba condiciones inventadas o históricas sin esperar al mercado",
  },
  {
    mode: "REPLAY",
    icon: <RotateCcw className="h-5 w-5 text-blue-400" />,
    color: "border-blue-500/20 bg-blue-500/5",
    subtitle: "Reproduce el mercado real del pasado vela a vela",
  },
  {
    mode: "SHADOW_SCENARIO",
    icon: <Ghost className="h-5 w-5 text-yellow-400" />,
    color: "border-yellow-500/20 bg-yellow-500/5",
    subtitle: "Shadow Scenario — sistema completo con mercado controlado",
  },
  {
    mode: "SHADOW_LIVE",
    icon: <Eye className="h-5 w-5 text-amber-400" />,
    color: "border-amber-500/20 bg-amber-500/5",
    subtitle: "Shadow Live — mercado real actual, órdenes simuladas",
  },
  {
    mode: "REAL_LIMITED",
    icon: <ShieldCheck className="h-5 w-5 text-orange-400" />,
    color: "border-orange-500/20 bg-orange-500/5",
    subtitle: "Dinero real con límites estrictos y autorización manual",
  },
  {
    mode: "REAL_FULL",
    icon: <Lock className="h-5 w-5 text-red-400" />,
    color: "border-red-500/20 bg-red-500/5",
    subtitle: "Reservado para el futuro — bloqueado",
    locked: true,
  },
];

const COMPARATOR_ROWS = [
  { label: "Mercado", key: "data" },
  { label: "Motor AMA", key: "engine" },
  { label: "Base de datos real", key: "db" },
  { label: "Órdenes", key: "orders" },
  { label: "Capital real", key: "capital" },
];

const COMPARATOR_DATA: Record<string, Record<string, string>> = {
  LAB: { data: "Controlado / histórico", engine: "Sí", db: "Aislado", orders: "Simuladas", capital: "No" },
  REPLAY: { data: "Histórico real", engine: "Sí", db: "Aislado", orders: "Simuladas", capital: "No" },
  SHADOW_SCENARIO: { data: "Controlado", engine: "Sí", db: "Sí", orders: "Simuladas", capital: "No" },
  SHADOW_LIVE: { data: "Mercado actual", engine: "Sí", db: "Sí", orders: "Simuladas", capital: "No" },
  REAL_LIMITED: { data: "Mercado actual", engine: "Sí", db: "Sí", orders: "Maker reales", capital: "Sí" },
};

export function AmaModeGuide() {
  return (
    <div className="space-y-4">
      {/* Mode Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {MODES.map((m) => (
          <Card key={m.mode} className={`${m.color} border`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {m.icon}
                  <CardTitle className="text-sm font-semibold">
                    {MODE_LABELS[m.mode]}
                  </CardTitle>
                </div>
                {m.locked && (
                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">
                    BLOQUEADO
                  </Badge>
                )}
              </div>
              {m.subtitle && (
                <p className="text-[11px] text-muted-foreground mt-1">{m.subtitle}</p>
              )}
            </CardHeader>
            <CardContent className="pt-1">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {MODE_DESCRIPTIONS[m.mode]}
              </p>
              <div className="mt-2 space-y-1 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-amber-400/70" />
                  <span className="text-muted-foreground">Riesgo: </span>
                  <span>{MODE_RISK[m.mode]}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Wallet className="h-3 w-3 text-cyan-400/70" />
                  <span className="text-muted-foreground">Órdenes: </span>
                  <span>{MODE_ORDERS[m.mode]}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Database className="h-3 w-3 text-blue-400/70" />
                  <span className="text-muted-foreground">Datos: </span>
                  <span>{MODE_DATA[m.mode]}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Visual Comparator */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Comparación de modos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-2 pr-4">Modo</th>
                  {COMPARATOR_ROWS.map((r) => (
                    <th key={r.key} className="text-center px-2">{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(COMPARATOR_DATA).map(([mode, values]) => (
                  <tr key={mode} className="border-b border-border/30 hover:bg-muted/10">
                    <td className="py-2 pr-4 font-medium">
                      {MODE_LABELS[mode]}
                    </td>
                    {COMPARATOR_ROWS.map((r) => (
                      <td key={r.key} className="text-center px-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            values[r.key] === "Sí"
                              ? "border-green-500/30 text-green-400"
                              : values[r.key] === "No"
                              ? "border-gray-500/30 text-gray-400"
                              : values[r.key] === "Maker reales"
                              ? "border-orange-500/30 text-orange-400"
                              : "border-border/50"
                          }`}
                        >
                          {values[r.key]}
                        </Badge>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground flex items-start gap-2">
            <TrendingDown className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>
              <strong>Laboratorio</strong> comprueba la estrategia. <strong>Simulación de escenario</strong> comprueba todo el sistema operativo. <strong>Simulación en vivo</strong> usa mercado real actual. <strong>Real limitado</strong> usa dinero real con límites.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
