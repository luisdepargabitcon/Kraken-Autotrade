import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Clock, CheckCircle2, XCircle, Zap, Activity } from "lucide-react";
import { computeCycleProgress, type CycleProgressColor } from "@/lib/gridCycleProgress";

const COLOR_CLASSES: Record<CycleProgressColor, { bar: string; text: string; bg: string }> = {
  green: { bar: "bg-green-500", text: "text-green-400", bg: "bg-green-500/10" },
  blue: { bar: "bg-blue-500", text: "text-blue-400", bg: "bg-blue-500/10" },
  yellow: { bar: "bg-amber-500", text: "text-amber-400", bg: "bg-amber-500/10" },
  red: { bar: "bg-red-500", text: "text-red-400", bg: "bg-red-500/10" },
  purple: { bar: "bg-purple-500", text: "text-purple-400", bg: "bg-purple-500/10" },
  muted: { bar: "bg-muted-foreground/30", text: "text-muted-foreground", bg: "bg-muted/20" },
};

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v); if (Number.isFinite(n)) return n; }
  return null;
}

function fmtUsd(v: unknown): string {
  const n = toNum(v);
  return n === null ? "—" : `$${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function durationLabel(fromDate: Date): string {
  const diffMs = Date.now() - fromDate.getTime();
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface GridCycleProgressCardProps {
  cycle: any;
  currentPrice?: number | null;
  isActiveRange?: boolean;
  onClick?: (cycle: any) => void;
}

export function GridCycleProgressCard({
  cycle,
  currentPrice,
  isActiveRange = true,
  onClick,
}: GridCycleProgressCardProps) {
  const progress = useMemo(
    () => computeCycleProgress(cycle, currentPrice),
    [cycle, currentPrice]
  );

  const colors = COLOR_CLASSES[progress.color];
  const pnl = toNum(cycle?.netPnlUsd);
  const openedAt = cycle?.openedAt ? new Date(cycle.openedAt) : cycle?.buyFilledAt ? new Date(cycle.buyFilledAt) : null;

  const statusIcon = progress.state === "closed" ? (
    <CheckCircle2 className={`h-4 w-4 ${colors.text}`} />
  ) : progress.state === "cancelled" ? (
    <XCircle className="h-4 w-4 text-muted-foreground" />
  ) : progress.state === "near_stop" ? (
    <TrendingDown className="h-4 w-4 text-red-400" />
  ) : progress.state === "trailing_active" || progress.state === "trailing_inactive" ? (
    <Activity className="h-4 w-4 text-purple-400" />
  ) : progress.state === "towards_tp" ? (
    <TrendingUp className={`h-4 w-4 ${colors.text}`} />
  ) : (
    <Zap className="h-4 w-4 text-muted-foreground" />
  );

  return (
    <div
      className={`rounded-lg border border-border/40 p-3 cursor-pointer hover:border-border/80 transition-all ${isActiveRange ? "" : "opacity-60"}`}
      onClick={() => onClick?.(cycle)}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {statusIcon}
          <span className="text-xs font-mono text-muted-foreground">#{cycle?.cycleNumber ?? "—"}</span>
          <Badge
            variant="outline"
            className={`text-[10px] px-1 ${colors.bg} ${colors.text} border-current/20`}
          >
            {progress.stateLabel}
          </Badge>
        </div>
        {pnl !== null && progress.state === "closed" && (
          <span className={`text-xs font-mono font-bold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
            {pnl >= 0 ? "+" : ""}{fmtUsd(pnl)}
          </span>
        )}
        {pnl === null && progress.pnlFloatingPct !== null && progress.isActive && (
          <span className={`text-xs font-mono ${progress.pnlFloatingPct >= 0 ? "text-green-400" : "text-red-400"}`}>
            {progress.pnlFloatingPct >= 0 ? "+" : ""}{progress.pnlFloatingPct.toFixed(2)}%
          </span>
        )}
      </div>

      {/* Progress bar */}
      {progress.isActive && progress.buyPrice !== null && progress.targetPrice !== null && (
        <div className="mb-2">
          <div className="relative h-1.5 w-full rounded-full bg-muted/30 overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full rounded-full transition-all ${colors.bar}`}
              style={{ width: `${Math.max(2, progress.progressPct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>{fmtUsd(progress.buyPrice)}</span>
            <span>{progress.progressPct.toFixed(0)}%</span>
            <span>{fmtUsd(progress.targetPrice)}</span>
          </div>
        </div>
      )}

      {/* Key metrics row */}
      <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
        {progress.distanceToTargetPct !== null && progress.isActive && (
          <div className="flex items-center gap-0.5">
            <TrendingUp className="h-2.5 w-2.5 text-green-400 shrink-0" />
            <span className="text-green-400">{progress.distanceToTargetPct >= 0 ? "+" : ""}{progress.distanceToTargetPct.toFixed(2)}% TP</span>
          </div>
        )}
        {progress.distanceToStopPct !== null && progress.isActive && (
          <div className="flex items-center gap-0.5">
            <TrendingDown className="h-2.5 w-2.5 text-red-400 shrink-0" />
            <span className="text-red-400">{progress.distanceToStopPct.toFixed(2)}% SL</span>
          </div>
        )}
        {openedAt && progress.isActive && (
          <div className="flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5 shrink-0" />
            <span>{durationLabel(openedAt)}</span>
          </div>
        )}
        {!isActiveRange && (
          <div className="col-span-3 flex items-center gap-1 text-amber-400/80">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-400/80" />
            <span>Orphan / no ejecutable sin rango activo</span>
          </div>
        )}
      </div>

      {/* Tooltip lines as small hints */}
      {progress.tooltipLines.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {progress.tooltipLines.map((line, i) => (
            <p key={i} className="text-[10px] text-muted-foreground/70">{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
