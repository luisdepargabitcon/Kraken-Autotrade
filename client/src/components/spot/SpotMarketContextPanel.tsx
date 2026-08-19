/**
 * SpotMarketContextPanel — Professional market context viewer for SPOT.
 *
 * Visual inspiration from IdcaMarketContextCard but uses SPOT's canonical
 * context pipeline (spotContextSnapshot).
 *
 * Features:
 *   - Compact row per pair with expandable detail
 *   - DECISIÓN ACTUAL section with natural language Spanish explanation
 *   - Gate breakdown (Data Health → Macro 4H → Régimen 1H → Setup 15M → Trigger 5M)
 *   - Semantic color palette
 *   - Full Spanish localization
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  Clock,
  Zap,
  Target,
  Gauge,
  Layers,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SpotGate {
  level: string;
  pass: boolean;
  reason: string;
  reasonCode?: string;
}

export interface SpotContextSnapshotData {
  pair: string;
  scanId: string;
  generatedAt: number;
  enabled: boolean;
  decisionState: string;
  primaryReasonCode: string;
  primaryReasonEs: string;
  secondaryReasonsEs: string[];
  lastReachedStage: string;
  // Market context
  dataHealth: string;
  macro4h: string;
  regime1h: string;
  setup15m: string | null;
  timing5m: string | null;
  spread: number;
  macroBias: string;
  regime: string;
  direction: string;
  volatility: string;
  adx: number;
  ema20: number;
  ema50: number;
  ema200: number;
  emaAlignment: string;
  bollingerWidth: number;
  atrPct: number;
  confidence: number;
  price: number;
  bid: number;
  ask: number;
  spreadPct: number;
  volumeRatio: number;
  volume24h: number;
  participation: string;
  signal: "BUY" | "NONE";
  setupTag: string | null;
  signalReason: string;
  signalConfidence: number;
  blockReason: string | null;
  decisionTitle: string;
  decisionExplanation: string;
  decisionColor: "green" | "red" | "amber" | "violet" | "cyan" | "gray";
  gates: SpotGate[];
  hasActiveIntent: boolean;
  intentState: string | null;
  intentLastBlockReason: string | null;
  intentCreatedAt: number | null;
  intentExpiresAt: number | null;
  marketContextId: string;
  regimeId: string;
  mode: string;
}

interface SpotMarketContextPanelProps {
  snapshots: SpotContextSnapshotData[];
  isLoading?: boolean;
  refreshInterval?: number;
}

// ─── Color maps ─────────────────────────────────────────────────────────────

const decisionColorMap: Record<string, { bg: string; text: string; border: string; icon: typeof Activity }> = {
  green: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30", icon: TrendingUp },
  red: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30", icon: TrendingDown },
  amber: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30", icon: AlertTriangle },
  violet: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/30", icon: Clock },
  cyan: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30", icon: Zap },
  gray: { bg: "bg-muted/20", text: "text-muted-foreground", border: "border-border/30", icon: Minus },
};

const regimeColorMap: Record<string, string> = {
  TREND: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  RANGE: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  TRANSITION: "bg-orange-500/10 text-orange-400 border-orange-500/30",
};

const macroColorMap: Record<string, string> = {
  BULLISH: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  BEARISH: "bg-red-500/10 text-red-400 border-red-500/30",
  NEUTRAL: "bg-muted/20 text-muted-foreground border-border/30",
};

const directionColorMap: Record<string, string> = {
  BULLISH: "text-emerald-400",
  BEARISH: "text-red-400",
  NEUTRAL: "text-muted-foreground",
};

const dataHealthColorMap: Record<string, string> = {
  GOOD: "text-emerald-400",
  DEGRADED: "text-amber-400",
  STALE: "text-amber-400",
  INSUFFICIENT: "text-red-400",
  ERROR: "text-red-400",
};

// ─── Helper functions ───────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toFixed(2)}`;
  if (price >= 1) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}

function formatTime(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getRegimeLabel(regime: string): string {
  const labels: Record<string, string> = {
    TREND: "Tendencia",
    RANGE: "Rango",
    TRANSITION: "Transición",
  };
  return labels[regime] ?? regime;
}

function getMacroLabel(macro: string): string {
  const labels: Record<string, string> = {
    BULLISH: "Alcista",
    BEARISH: "Bajista",
    NEUTRAL: "Neutral",
  };
  return labels[macro] ?? macro;
}

function getDirectionLabel(direction: string): string {
  const labels: Record<string, string> = {
    BULLISH: "Alcista",
    BEARISH: "Bajista",
    NEUTRAL: "Neutral",
  };
  return labels[direction] ?? direction;
}

function getVolatilityLabel(vol: string): string {
  const labels: Record<string, string> = {
    LOW: "Baja",
    NORMAL: "Normal",
    HIGH: "Alta",
  };
  return labels[vol] ?? vol;
}

function getParticipationLabel(part: string): string {
  const labels: Record<string, string> = {
    LOW: "Bajo",
    NORMAL: "Normal",
    HIGH: "Alto",
  };
  return labels[part] ?? part;
}

function getSetupLabel(setup: string | null): string {
  if (!setup) return "—";
  const labels: Record<string, string> = {
    PULLBACK_CONTINUATION: "Pullback Continuación",
    BREAKOUT_RETEST: "Breakout Retest",
  };
  return labels[setup] ?? setup.replace(/_/g, " ");
}

function getDataHealthLabel(dh: string): string {
  const labels: Record<string, string> = {
    GOOD: "Bueno",
    DEGRADED: "Degradado",
    STALE: "Obsoleto",
    INSUFFICIENT: "Insuficiente",
    ERROR: "Error",
  };
  return labels[dh] ?? dh;
}

// ─── Compact Row ────────────────────────────────────────────────────────────

function CompactRow({ snap, expanded, onToggle }: { snap: SpotContextSnapshotData; expanded: boolean; onToggle: () => void }) {
  const dc = decisionColorMap[snap.decisionColor] ?? decisionColorMap.gray;
  const DecisionIcon = dc.icon;
  const dirColor = directionColorMap[snap.direction] ?? "text-muted-foreground";

  return (
    <div
      className={`rounded-lg border ${snap.enabled ? dc.border : "border-border/30"} ${snap.enabled ? dc.bg : "bg-muted/10 opacity-60"} px-3 py-2.5 cursor-pointer transition-colors hover:bg-opacity-20`}
      onClick={onToggle}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="font-mono text-sm font-semibold shrink-0">{snap.pair}</span>
          {!snap.enabled && (
            <span className="text-[9px] bg-gray-500/20 text-gray-400 rounded px-1 shrink-0">DESACTIVADO</span>
          )}
          <span className={`text-[10px] font-mono ${dirColor} shrink-0`}>
            {snap.regime !== "UNKNOWN" ? getRegimeLabel(snap.regime) : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-xs text-muted-foreground">{formatPrice(snap.price)}</span>
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded border ${dc.border} ${dc.bg}`}>
            <DecisionIcon className={`h-3 w-3 ${dc.text}`} />
            <span className={`text-[10px] font-medium ${dc.text}`}>{snap.decisionTitle}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Panel ───────────────────────────────────────────────────────────

function DetailPanel({ snap }: { snap: SpotContextSnapshotData }) {
  const dc = decisionColorMap[snap.decisionColor] ?? decisionColorMap.gray;

  return (
    <div className="rounded-lg border border-border/40 bg-muted/5 px-4 py-3 space-y-4">
      {/* DECISIÓN ACTUAL */}
      <div className={`rounded-lg border ${dc.border} ${dc.bg} px-4 py-3`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${dc.text}`}>Decisión Actual</span>
        </div>
        <p className={`text-sm font-semibold ${dc.text}`}>{snap.decisionTitle}</p>
        <p className="text-xs text-foreground/80 mt-1">{snap.decisionExplanation}</p>
        {snap.setupTag && (
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{getSetupLabel(snap.setupTag)}</Badge>
            <span className="text-[10px] text-muted-foreground">Confianza: {(snap.signalConfidence * 100).toFixed(0)}%</span>
          </div>
        )}
      </div>

      {/* Gates breakdown */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Evaluación Jerárquica</p>
        <div className="space-y-1.5">
          {snap.gates.map((gate, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <div className="shrink-0 mt-0.5">
                {gate.pass ? (
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <ShieldX className="h-3.5 w-3.5 text-red-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className={`font-medium ${gate.pass ? "text-emerald-400" : "text-red-400"}`}>{gate.level}</span>
                <span className="text-muted-foreground ml-2">{gate.reason}</span>
              </div>
            </div>
          ))}
          {snap.gates.length === 0 && (
            <p className="text-xs text-muted-foreground">Sin datos de evaluación.</p>
          )}
        </div>
      </div>

      {/* Market data grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricBox icon={TrendingUp} label="Macro 4H" value={getMacroLabel(snap.macroBias)} colorClass={macroColorMap[snap.macroBias] ?? ""} />
        <MetricBox icon={Activity} label="Régimen 1H" value={getRegimeLabel(snap.regime)} colorClass={regimeColorMap[snap.regime] ?? ""} />
        <MetricBox icon={Layers} label="Dirección" value={getDirectionLabel(snap.direction)} colorClass={directionColorMap[snap.direction] ?? ""} />
        <MetricBox icon={Gauge} label="Volatilidad" value={getVolatilityLabel(snap.volatility)} />
        <MetricBox icon={Target} label="ADX" value={snap.adx.toFixed(1)} />
        <MetricBox icon={Activity} label="ATR %" value={snap.atrPct.toFixed(2)} />
        <MetricBox icon={Gauge} label="Spread %" value={snap.spreadPct.toFixed(3)} />
        <MetricBox icon={Zap} label="Volumen" value={`${snap.volumeRatio.toFixed(2)}× (${getParticipationLabel(snap.participation)})`} />
      </div>

      {/* EMA structure */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Estructura EMA 1H</p>
        <div className="grid grid-cols-3 gap-3">
          <MetricMini label="EMA 20" value={snap.ema20 > 0 ? formatPrice(snap.ema20) : "—"} />
          <MetricMini label="EMA 50" value={snap.ema50 > 0 ? formatPrice(snap.ema50) : "—"} />
          <MetricMini label="EMA 200" value={snap.ema200 > 0 ? formatPrice(snap.ema200) : "—"} />
        </div>
      </div>

      {/* Ticker */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Ticker</p>
        <div className="grid grid-cols-4 gap-3">
          <MetricMini label="Precio" value={formatPrice(snap.price)} />
          <MetricMini label="Bid" value={snap.bid > 0 ? formatPrice(snap.bid) : "—"} />
          <MetricMini label="Ask" value={snap.ask > 0 ? formatPrice(snap.ask) : "—"} />
          <MetricMini label="Datos" value={getDataHealthLabel(snap.dataHealth)} colorClass={dataHealthColorMap[snap.dataHealth] ?? ""} />
        </div>
      </div>

      {/* Active intent */}
      {snap.hasActiveIntent && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Intent Activo</p>
          <div className="flex items-center gap-3 text-xs">
            <Badge variant="outline" className="text-[10px]">{snap.intentState}</Badge>
            {snap.intentCreatedAt && <span className="text-muted-foreground">Creado: {formatTime(snap.intentCreatedAt)}</span>}
            {snap.intentExpiresAt && <span className="text-muted-foreground">Expira: {formatTime(snap.intentExpiresAt)}</span>}
            {snap.intentLastBlockReason && (
              <span className="text-amber-400/80 font-mono text-[10px]">⚠ {snap.intentLastBlockReason}</span>
            )}
          </div>
        </div>
      )}

      {/* Context IDs */}
      <div className="text-[10px] text-muted-foreground font-mono space-y-0.5">
        <div>Contexto ID: {snap.marketContextId || "—"}</div>
        <div>Régimen ID: {snap.regimeId || "—"}</div>
        <div>Generado: {formatTime(snap.generatedAt)}</div>
      </div>
    </div>
  );
}

function MetricBox({ icon: Icon, label, value, colorClass }: { icon: typeof Activity; label: string; value: string; colorClass?: string }) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10 px-2.5 py-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-xs font-mono font-medium ${colorClass ?? ""}`}>{value}</p>
    </div>
  );
}

function MetricMini({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="rounded border border-border/20 bg-muted/5 px-2 py-1.5">
      <span className="text-[9px] text-muted-foreground uppercase">{label}</span>
      <p className={`text-xs font-mono ${colorClass ?? ""}`}>{value}</p>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function SpotMarketContextPanel({ snapshots, isLoading }: SpotMarketContextPanelProps) {
  const [expandedPair, setExpandedPair] = useState<string | null>(null);

  const toggle = (pair: string) => {
    setExpandedPair(prev => prev === pair ? null : pair);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Contexto de Mercado
          </CardTitle>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {snapshots.length} pares
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Cargando contexto de mercado...
          </div>
        ) : snapshots.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No hay pares activos. Activa al menos un par para ver su contexto.
          </div>
        ) : (
          <div className="space-y-2">
            {snapshots.map(snap => (
              <div key={snap.pair}>
                <CompactRow
                  snap={snap}
                  expanded={expandedPair === snap.pair}
                  onToggle={() => toggle(snap.pair)}
                />
                {expandedPair === snap.pair && (
                  <div className="mt-1.5">
                    <DetailPanel snap={snap} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
