import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Layers, TrendingUp, Wallet } from "lucide-react";

interface GridOperationalHeaderProps {
  operational?: any;
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null) return "—";
  const prefix = v >= 0 ? "+" : "";
  return `${prefix}$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function GridOperationalHeader({ operational }: GridOperationalHeaderProps) {
  const header = operational?.header ?? {};
  const mode = header.mode ?? "OFF";
  const isActive = header.isActive ?? false;
  const isRunning = header.isRunning ?? false;

  const stateLabel = mode === "OFF"
    ? "Detenido"
    : isActive
      ? isRunning ? "Activo · En ejecución" : "Activo · No ejecutando"
      : "Pausado";

  return (
    <Card className="border-border/50 bg-card/60">
      <CardContent className="p-3 md:p-4">
        <div className="flex flex-col gap-3">
          {/* Top row: title + badges */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Layers className="h-5 w-5 text-primary shrink-0" />
              <h1 className="text-lg md:text-xl font-bold truncate">
                {header.title ?? "GRID AISLADO BTC/USD"}
              </h1>
              {mode === "SHADOW" && (
                <Badge variant="secondary" className="shrink-0 bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                  SHADOW
                </Badge>
              )}
              {mode !== "SHADOW" && mode !== "OFF" && (
                <Badge variant="outline" className="shrink-0">
                  {mode}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant="outline"
                className={isActive ? "border-green-500/30 text-green-500 bg-green-500/10" : "border-amber-500/30 text-amber-500 bg-amber-500/10"}
              >
                <Activity className="h-3 w-3 mr-1" />
                {stateLabel}
              </Badge>
              {header.makerOnly && (
                <Badge variant="outline" className="border-cyan-500/30 text-cyan-400 bg-cyan-500/10">
                  Solo maker
                </Badge>
              )}
            </div>
          </div>

          {/* Bottom row: metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            <div className="rounded-lg border border-border/40 p-2 md:p-3">
              <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider truncate">Precio actual</p>
              <p className="text-sm md:text-base font-semibold font-mono truncate" title={header.priceSource ? `Fuente: ${header.priceSource}` : undefined}>
                {fmtPrice(header.currentBid ?? header.currentPrice)}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                {header.priceFresh ? "Fresco" : "Desactualizado"}
              </p>
            </div>

            <div className="rounded-lg border border-border/40 p-2 md:p-3">
              <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider truncate">Operaciones abiertas</p>
              <p className="text-sm md:text-base font-semibold font-mono truncate">
                {header.openCycles ?? 0}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                Esperando venta
              </p>
            </div>

            <div className="rounded-lg border border-border/40 p-2 md:p-3">
              <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider truncate">PnL neto</p>
              <p className={`text-sm md:text-base font-semibold font-mono truncate ${(header.totalNetPnlUsd ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                <TrendingUp className="inline h-3 w-3 mr-1" />
                {fmtUsd(header.totalNetPnlUsd)}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                Acumulado simulado
              </p>
            </div>

            <div className="rounded-lg border border-border/40 p-2 md:p-3">
              <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider truncate">Órdenes reales</p>
              <p className="text-sm md:text-base font-semibold font-mono truncate">
                {header.realOpenOrdersCount ?? 0}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                <Wallet className="inline h-3 w-3 mr-1" />
                {header.realOpenOrdersCount === 0 ? "Sin exposición" : "En mercado"}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
