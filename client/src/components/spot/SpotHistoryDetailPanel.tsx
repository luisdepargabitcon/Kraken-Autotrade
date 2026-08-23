import { useQuery } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, TrendingDown, Clock, ArrowUpRight, ArrowDownRight,
  Shield, Activity, AlertTriangle, CheckCircle, Info,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpotTradeListRow {
  lotId: string;
  pair: string;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  notionalUsd: number;
  grossPnl: number;
  netPnl: number;
  returnPct: number | null;
  entryFee: number;
  exitFee: number;
  executionCost: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  rMultiple: number | null;
  exitReason: string | null;
  holdTimeMinutes: number;
  executionMode: string;
  setupTag: string | null;
  signalId: string | null;
  marketContextId: string | null;
  openedAt: number | null;
  closedAt: number | null;
}

interface TimelineEvent {
  timestamp: number;
  type: string;
  titleEs: string;
  descriptionEs: string;
  price?: number;
  pnlUsd?: number;
  metadata?: Record<string, unknown>;
}

interface TradeDetail {
  trade: SpotTradeListRow;
  context: {
    setupTag: string | null;
    regime: string | null;
    direction: string | null;
    macroBias: string | null;
    signalId: string | null;
    marketContextId: string | null;
  };
  protections: {
    breakEvenActivated: boolean;
    breakEvenActivatedAt: number | null;
    trailingActivated: boolean;
    trailingActivatedAt: number | null;
  };
  timeline: TimelineEvent[];
  availability: "FULL_DETAIL" | "PARTIAL_DETAIL" | "BASIC_DETAIL";
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function safeNum(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function fmtUsd(n: unknown): string {
  return `$${safeNum(n).toFixed(2)}`;
}

function fmtPrice(n: unknown): string {
  const v = safeNum(n);
  return v >= 100 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
}

function fmtPct(n: unknown): string {
  return `${safeNum(n).toFixed(2)}%`;
}

function fmtR(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(2)}R`;
}

function getBaseCurrency(pair: string): string {
  return pair.split("/")[0] ?? pair;
}

function fmtAmount(amount: number, pair: string): string {
  const base = getBaseCurrency(pair);
  const decimals = amount >= 10 ? 4 : 6;
  return `${amount.toFixed(decimals)} ${base}`;
}

function formatDatetimeEs(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function fmtTimestamp(ms: number): string {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(ms));
}

const exitReasonEs: Record<string, string> = {
  STRUCTURE_INVALIDATION: "Pérdida de estructura",
  TIME_EFFICIENCY: "Eficiencia temporal",
  TIME_STOP: "Time stop",
  BREAK_EVEN: "Punto de equilibrio",
  TAKE_PROFIT: "Toma de beneficios",
  PROFIT: "Toma de beneficios",
  TRAILING_STOP: "Trailing stop",
  TRAILING: "Trailing stop",
  MANUAL: "Cierre manual",
  MAX_LOSS: "Pérdida máxima",
};

const setupTagEs: Record<string, string> = {
  PULLBACK_CONTINUATION: "Continuación pullback",
  BREAKOUT_RETEST: "Ruptura y retesteo",
  PULLBACK: "Retroceso",
  BREAKOUT: "Ruptura",
  ROLLING_HIGH: "Máximo reciente",
  MEAN_REVERSION: "Regresión a la media",
};

const regimeEs: Record<string, string> = {
  TREND: "Tendencia",
  RANGE: "Rango",
  TRANSITION: "Transición",
};

const directionEs: Record<string, string> = {
  BULLISH: "Alcista",
  BEARISH: "Bajista",
  NEUTRAL: "Neutral",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 mt-4">
        {title}
      </h4>
      <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-1">
        {children}
      </div>
    </div>
  );
}

function TimelineEventItem({ ev }: { ev: TimelineEvent }) {
  const iconMap: Record<string, React.ReactNode> = {
    ENTRY: <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />,
    BREAK_EVEN: <Shield className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />,
    TRAILING: <Activity className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />,
    TRAILING_UPDATE: <Activity className="h-3.5 w-3.5 text-amber-300 flex-shrink-0" />,
    EXIT: <ArrowDownRight className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />,
  };
  return (
    <div className="flex gap-2.5 py-2 border-b border-border/20 last:border-0">
      <div className="flex-shrink-0 mt-0.5">
        {iconMap[ev.type] ?? <Info className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">{ev.titleEs}</span>
          <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
            {fmtTimestamp(ev.timestamp)}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{ev.descriptionEs}</p>
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-6 bg-muted/30 rounded" />
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SpotHistoryDetailPanelProps {
  lotId: string | null;
  previewTrade?: SpotTradeListRow;
  onClose: () => void;
}

export function SpotHistoryDetailPanel({ lotId, previewTrade, onClose }: SpotHistoryDetailPanelProps) {
  const { data: detail, isLoading, isError } = useQuery<TradeDetail | null>({
    queryKey: ["spot-trade-detail", lotId],
    queryFn: async () => {
      if (!lotId) return null;
      const res = await fetch(`/api/spot/history/${encodeURIComponent(lotId)}`);
      if (!res.ok) throw new Error("Failed to fetch trade detail");
      return res.json();
    },
    enabled: !!lotId,
    staleTime: 60_000,
    retry: 1,
  });

  const trade = detail?.trade ?? previewTrade;
  const isWinner = safeNum(trade?.netPnl) > 0;
  const pair = trade?.pair ?? "—";

  return (
    <Sheet open={!!lotId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto p-0"
      >
        {/* Header */}
        <div className={`px-5 pt-5 pb-4 border-b border-border/50 ${isWinner ? "bg-emerald-500/5" : "bg-red-500/5"}`}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <span className="font-mono font-bold">{pair}</span>
              <Badge
                variant="outline"
                className={`text-[10px] ${isWinner
                  ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
                  : "text-red-400 border-red-500/40 bg-red-500/10"
                }`}
              >
                {isWinner
                  ? <><TrendingUp className="h-3 w-3 mr-1 inline" />GANADORA</>
                  : <><TrendingDown className="h-3 w-3 mr-1 inline" />PERDEDORA</>
                }
              </Badge>
              {trade?.executionMode && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  {trade.executionMode}
                </Badge>
              )}
              {detail?.availability && detail.availability !== "FULL_DETAIL" && (
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                  Detalle {detail.availability === "PARTIAL_DETAIL" ? "parcial" : "básico"}
                </Badge>
              )}
            </SheetTitle>
          </SheetHeader>
        </div>

        <div className="px-5 py-4 space-y-1">
          {isLoading && !trade && <DetailSkeleton />}
          {isError && (
            <div className="flex items-center gap-2 text-sm text-red-400 py-4">
              <AlertTriangle className="h-4 w-4" />
              Error al cargar el detalle de la operación.
            </div>
          )}

          {trade && (
            <>
              {/* Resumen */}
              <Section title="Resumen de la operación">
                <DetailRow
                  label="Entrada"
                  value={
                    <span>
                      {formatDatetimeEs(trade.openedAt)}
                    </span>
                  }
                />
                <DetailRow label="Salida" value={formatDatetimeEs(trade.closedAt)} />
                <DetailRow
                  label="Duración"
                  value={<><Clock className="h-3 w-3 inline mr-1 text-muted-foreground" />{fmtDuration(safeNum(trade.holdTimeMinutes))}</>}
                />
                <DetailRow label="Capital invertido" value={<span className="font-mono">{fmtUsd(trade.notionalUsd)}</span>} />
                <DetailRow label="Cantidad" value={<span className="font-mono">{fmtAmount(safeNum(trade.amount), pair)}</span>} />
                <DetailRow label="Precio entrada" value={<span className="font-mono">{fmtPrice(trade.entryPrice)}</span>} />
                <DetailRow label="Precio salida" value={<span className="font-mono">{fmtPrice(trade.exitPrice)}</span>} />
              </Section>

              {/* PnL */}
              <Section title="Resultado financiero">
                <DetailRow label="PnL bruto" value={<span className={`font-mono ${safeNum(trade.grossPnl) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtUsd(trade.grossPnl)}</span>} />
                <DetailRow label="Comisión entrada" value={<span className="font-mono text-muted-foreground">-{fmtUsd(trade.entryFee)}</span>} />
                <DetailRow label="Comisión salida" value={<span className="font-mono text-muted-foreground">-{fmtUsd(trade.exitFee)}</span>} />
                <DetailRow label="Comisiones totales" value={<span className="font-mono text-muted-foreground">-{fmtUsd(safeNum(trade.entryFee) + safeNum(trade.exitFee))}</span>} />
                <DetailRow
                  label="PnL neto"
                  value={
                    <span className={`font-mono font-bold ${safeNum(trade.netPnl) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {fmtUsd(trade.netPnl)}
                    </span>
                  }
                />
                <DetailRow
                  label="Rentabilidad"
                  value={
                    <span className={`font-mono ${trade.returnPct !== null && trade.returnPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {trade.returnPct !== null ? fmtPct(trade.returnPct) : "—"}
                    </span>
                  }
                />
                <DetailRow label="R múltiple" value={<span className="font-mono">{fmtR(trade.rMultiple)}</span>} />
              </Section>

              {/* MFE / MAE */}
              {(trade.mfe > 0 || trade.mae > 0) && (
                <Section title="MFE / MAE">
                  <DetailRow
                    label="Máximo favorable (MFE)"
                    value={
                      <span className="font-mono text-emerald-400">
                        +{fmtUsd(trade.mfe)}{trade.mfeR > 0 ? ` / +${trade.mfeR.toFixed(2)}R` : ""}
                      </span>
                    }
                  />
                  <DetailRow
                    label="Máximo adverso (MAE)"
                    value={
                      <span className="font-mono text-red-400">
                        -{fmtUsd(trade.mae)}{trade.maeR > 0 ? ` / -${trade.maeR.toFixed(2)}R` : ""}
                      </span>
                    }
                  />
                </Section>
              )}

              {/* Por qué entró */}
              <Section title="Por qué entró">
                {detail?.context ? (
                  <>
                    {detail.context.setupTag && (
                      <DetailRow label="Setup" value={setupTagEs[detail.context.setupTag] ?? detail.context.setupTag} />
                    )}
                    {detail.context.regime && (
                      <DetailRow label="Régimen" value={regimeEs[detail.context.regime] ?? detail.context.regime} />
                    )}
                    {detail.context.direction && (
                      <DetailRow label="Dirección" value={directionEs[detail.context.direction] ?? detail.context.direction} />
                    )}
                    {detail.context.macroBias && (
                      <DetailRow label="Macro" value={directionEs[detail.context.macroBias] ?? detail.context.macroBias} />
                    )}
                    {detail.context.signalId && (
                      <DetailRow label="Señal ID" value={<span className="font-mono text-[10px] break-all">{detail.context.signalId}</span>} />
                    )}
                    {detail.context.marketContextId && (
                      <DetailRow label="Contexto ID" value={<span className="font-mono text-[10px] break-all">{detail.context.marketContextId}</span>} />
                    )}
                    {!detail.context.regime && !detail.context.direction && (
                      <p className="text-xs text-muted-foreground py-1.5">No disponible para esta operación histórica.</p>
                    )}
                  </>
                ) : (
                  <>
                    {trade.setupTag && (
                      <DetailRow label="Setup" value={setupTagEs[trade.setupTag] ?? trade.setupTag} />
                    )}
                    {trade.signalId && (
                      <DetailRow label="Señal ID" value={<span className="font-mono text-[10px] break-all">{trade.signalId}</span>} />
                    )}
                    {!trade.setupTag && !trade.signalId && (
                      <p className="text-xs text-muted-foreground py-1.5">No disponible para esta operación histórica.</p>
                    )}
                  </>
                )}
              </Section>

              {/* Protecciones */}
              <Section title="Protecciones">
                {detail?.protections ? (
                  <>
                    <DetailRow
                      label="Break-even"
                      value={
                        detail.protections.breakEvenActivated
                          ? <span className="text-emerald-400 flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" />
                              Activado{detail.protections.breakEvenActivatedAt
                                ? ` · ${fmtTimestamp(detail.protections.breakEvenActivatedAt)}`
                                : ""}
                            </span>
                          : <span className="text-muted-foreground">No activado</span>
                      }
                    />
                    <DetailRow
                      label="Trailing stop"
                      value={
                        detail.protections.trailingActivated
                          ? <span className="text-amber-400 flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" />
                              Activado{detail.protections.trailingActivatedAt
                                ? ` · ${fmtTimestamp(detail.protections.trailingActivatedAt)}`
                                : ""}
                            </span>
                          : <span className="text-muted-foreground">No activado</span>
                      }
                    />
                    <DetailRow
                      label="Motivo de cierre"
                      value={exitReasonEs[trade.exitReason ?? ""] ?? trade.exitReason ?? "—"}
                    />
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground py-1.5">No disponible para esta operación histórica.</p>
                )}
              </Section>

              {/* Timeline */}
              {detail?.timeline && detail.timeline.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 mt-4">
                    Recorrido de la posición
                  </h4>
                  <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-1">
                    {detail.timeline.map((ev, i) => (
                      <TimelineEventItem key={i} ev={ev} />
                    ))}
                  </div>
                </div>
              )}

              {isLoading && trade && (
                <p className="text-xs text-muted-foreground text-center py-2 animate-pulse">Cargando detalle completo…</p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
