import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, DollarSign, Layers, Activity, AlertTriangle, Info } from "lucide-react";

interface GridLevelsMarketHeaderProps {
  marketContext: any;
  mode: string;
  levelsCount: number;
  activeLevelsCount: number;
  cyclesCount: number;
  realOpenOrdersCount?: number;
  lastTickReason?: string | null;
  activeRangeLevelsCount?: number;
}

export function GridLevelsMarketHeader({
  marketContext,
  mode,
  levelsCount,
  activeLevelsCount,
  cyclesCount,
  realOpenOrdersCount,
  lastTickReason,
  activeRangeLevelsCount,
}: GridLevelsMarketHeaderProps) {
  if (!marketContext) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4" />
            <span>Contexto de mercado no disponible</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { currentPrice, band, bandPosition, bandPositionPct, nearestLevel, updatedAt } = marketContext;

  const toNumberOrNull = (value: unknown): number | null => {
    if (value === undefined || value === null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };

  const formatPrice = (value: unknown) => {
    const price = toNumberOrNull(value);
    if (price === null) return "—";
    return `$${price.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPct = (value: unknown) => {
    const pct = toNumberOrNull(value);
    if (pct === null) return "—";
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  };

  const getBandPositionLabel = () => {
    switch (bandPosition) {
      case "below": return "Por debajo de la banda";
      case "lower": return "Zona baja de la banda";
      case "middle": return "Zona media de la banda";
      case "upper": return "Zona superior de la banda";
      case "above": return "Por encima de la banda";
      case "unknown": return "Banda no disponible";
      default: return "Posición desconocida";
    }
  };

  const getBandPositionColor = () => {
    switch (bandPosition) {
      case "below": return "text-amber-400";
      case "lower": return "text-green-400";
      case "middle": return "text-blue-400";
      case "upper": return "text-green-400";
      case "above": return "text-amber-400";
      case "unknown": return "text-muted-foreground";
      default: return "text-muted-foreground";
    }
  };

  const getNaturalExplanation = () => {
    if (bandPosition === "below") {
      return "El precio está por debajo de la banda activa. El Grid espera que el precio entre en rango para generar niveles.";
    }
    if (bandPosition === "above") {
      return "El precio está por encima de la banda activa. El Grid espera condiciones más favorables.";
    }
    if (bandPosition === "lower") {
      return "El precio está en la zona baja de la banda. Posible oportunidad de compra.";
    }
    if (bandPosition === "middle") {
      return "El precio está en la zona media de la banda. Grid operativo normal.";
    }
    if (bandPosition === "upper") {
      return "El precio está en la zona superior de la banda. El Grid mantiene compras planificadas por debajo y objetivos de venta por encima; todavía no hay ciclos abiertos.";
    }
    return "Estado del mercado no determinado.";
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Contexto de mercado para niveles
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Fila 1: Precio actual y banda */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-[10px] font-mono text-muted-foreground mb-1">Precio actual</p>
            <p className="font-mono text-lg font-bold">{formatPrice(currentPrice)}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">
              {updatedAt ? `Actualizado ${new Date(updatedAt).toLocaleTimeString("es-ES")}` : ""}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-[10px] font-mono text-muted-foreground mb-1">Banda Grid</p>
            <p className="font-mono text-sm font-medium">
              {formatPrice(band?.lower)} – {formatPrice(band?.upper)}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5">
              Centro: {formatPrice(band?.center)} · Anchura: {formatPct(band?.widthPct)}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-[10px] font-mono text-muted-foreground mb-1">Posición del precio</p>
            <p className={`font-mono text-sm font-bold ${getBandPositionColor()}`}>
              {getBandPositionLabel()}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5">
              {bandPositionPct !== null ? `${bandPositionPct.toFixed(1)}% dentro del rango` : ""}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-[10px] font-mono text-muted-foreground mb-1">Siguiente nivel cercano</p>
            {nearestLevel ? (
              <>
                <p className="font-mono text-sm font-medium">
                  {nearestLevel.side === "BUY" ? (
                    <span className="text-green-400">BUY</span>
                  ) : (
                    <span className="text-red-400">SELL</span>
                  )}{" "}
                  {formatPrice(nearestLevel.price)}
                </p>
                <p className="text-[9px] text-muted-foreground mt-0.5">
                  Distancia: {formatPrice(nearestLevel.distanceUsd)} / {formatPct(nearestLevel.distancePct)}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Sin niveles</p>
            )}
          </div>
        </div>

        {/* Fila 2: Explicación natural */}
        <div className={`rounded-lg p-3 text-sm ${
          bandPosition === "unknown" ? "bg-muted text-muted-foreground" :
          bandPosition === "below" || bandPosition === "above" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" :
          "bg-blue-500/10 text-blue-700 dark:text-blue-300"
        }`}>
          <p className="font-medium">{getNaturalExplanation()}</p>
        </div>

        {/* Fila 3: Estado operativo */}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {activeRangeLevelsCount ?? levelsCount} niveles en rango activo · {realOpenOrdersCount ?? 0} órdenes reales · {cyclesCount} ciclos
              {activeRangeLevelsCount != null && levelsCount > activeRangeLevelsCount && (
                <span className="text-amber-500"> ({levelsCount - activeRangeLevelsCount} históricos)</span>
              )}
            </span>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            {mode}
          </Badge>
          {mode === "SHADOW" && (
            <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/50">
              Simulación segura, sin órdenes reales
            </Badge>
          )}
          {mode === "OFF" && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Motor inactivo
            </Badge>
          )}
        </div>

        {/* Fila 4: Último motivo */}
        {lastTickReason && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>Motivo del motor: {lastTickReason}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
