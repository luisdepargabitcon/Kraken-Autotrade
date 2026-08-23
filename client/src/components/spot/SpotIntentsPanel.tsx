import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Crosshair } from "lucide-react";

interface SpotIntentRow {
  signalId: string;
  pair: string;
  setupTag: string | null;
  state: string;
  createdAt: number | null;
  expiresAt: number | null;
  originPrice: number | null;
  originRegime: string | null;
  originDirection: string | null;
  originMacro: string | null;
  originAtrPct: number | null;
  retryCount: number | null;
  lastBlockReason: string | null;
}

function safeNumber(n: unknown, fallback = 0): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function formatUsd(n: unknown): string {
  return `$${safeNumber(n, 0).toFixed(2)}`;
}

function formatPct(n: unknown): string {
  return `${safeNumber(n, 0).toFixed(2)}%`;
}

interface SpotIntentsPanelProps {
  intents: SpotIntentRow[];
}

const stateLabels: Record<string, string> = {
  CREATED: "Creada",
  WAITING: "En espera",
  APPROVED: "Aprobada",
  EXECUTED: "Ejecutada",
  EXPIRED: "Expirada",
  INVALIDATED: "Invalidada",
  CHASED: "Reevaluando",
  CANCELLED: "Cancelada",
};

const setupLabels: Record<string, string> = {
  PULLBACK_CONTINUATION: "Continuación pullback",
  BREAKOUT_RETEST: "Ruptura y retesteo",
  PULLBACK: "Retroceso",
  BREAKOUT: "Ruptura",
  ROLLING_HIGH: "Máximo reciente",
  MEAN_REVERSION: "Regresión a la media",
};

const regimeLabels: Record<string, string> = {
  TREND: "Tendencia",
  RANGE: "Rango",
  TRANSITION: "Transición",
};

const directionLabels: Record<string, string> = {
  BULLISH: "Alcista",
  BEARISH: "Bajista",
  NEUTRAL: "Neutral",
};

const macroLabels: Record<string, string> = {
  BULLISH: "Alcista",
  BEARISH: "Bajista",
  NEUTRAL: "Neutral",
};

function humanizeBlockReason(r: string | null): string {
  if (!r) return "—";
  const map: Record<string, string> = {
    NO_SETUP_15M: "Sin setup en 15M",
    NO_TRIGGER_5M: "Sin trigger en 5M",
    MAX_LOTS_REACHED: "Máximo de posiciones",
    SPREAD_TOO_HIGH: "Diferencial muy alto",
    REGIME_CHANGE: "Cambio de régimen",
    MACRO_INVALIDATION: "Macro invalidada",
    DATA_HEALTH: "Datos insuficientes",
    ENTRY_PRICE_MISSED: "Precio de entrada no alcanzado",
    PRICE_CHASED: "Precio no válido",
    DIRECTION_CHANGE: "Cambio de dirección",
  };
  return map[r] || r.replace(/_/g, " ");
}

const stateColors: Record<string, string> = {
  CREATED: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  WAITING: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  APPROVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  EXECUTED: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  EXPIRED: "bg-muted text-muted-foreground border-border",
  INVALIDATED: "bg-red-500/10 text-red-400 border-red-500/30",
  CHASED: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

export function SpotIntentsPanel({ intents }: SpotIntentsPanelProps) {
  const active = intents.filter(
    (i) => i.state === "WAITING" || i.state === "CREATED" || i.state === "CHASED"
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Crosshair className="h-4 w-4 text-primary" />
            Intenciones de Entrada
          </CardTitle>
          <div className="flex gap-2">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {active.length} activos
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {intents.length} total
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {intents.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No hay intenciones de entrada. El motor generará intenciones al detectar señales válidas.
          </div>
        ) : (
          <div className="space-y-2">
            {intents.map((intent) => {
              const now = Date.now();
              const expired = intent.expiresAt != null && intent.expiresAt < now;
              const stateColor = stateColors[intent.state] ?? stateColors.CREATED;
              return (
                <div
                  key={intent.signalId}
                  className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{intent.pair}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {intent.setupTag ? (setupLabels[intent.setupTag] ?? intent.setupTag.replace(/_/g, " ")) : "—"}
                      </Badge>
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${stateColor}`}>
                      {stateLabels[intent.state] ?? intent.state}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[11px]">
                    <MetaItem label="Origen" value={formatUsd(intent.originPrice)} />
                    <MetaItem label="Régimen" value={regimeLabels[intent.originRegime ?? ""] ?? (intent.originRegime ?? "—")} />
                    <MetaItem label="Dirección" value={directionLabels[intent.originDirection ?? ""] ?? (intent.originDirection ?? "—")} />
                    <MetaItem label="Macro" value={macroLabels[intent.originMacro ?? ""] ?? (intent.originMacro ?? "—")} />
                    <MetaItem label="ATR%" value={formatPct(intent.originAtrPct)} />
                    <MetaItem
                      label="Reintento"
                      value={String(safeNumber(intent.retryCount, 0))}
                    />
                  </div>
                  {intent.lastBlockReason && (
                    <p className="text-[11px] text-yellow-400/80">
                      ⚠ {humanizeBlockReason(intent.lastBlockReason)}
                    </p>
                  )}
                  {expired && intent.state === "WAITING" && (
                    <p className="text-[11px] text-red-400/80 font-mono">
                      Expirado (TTL vencido)
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}
