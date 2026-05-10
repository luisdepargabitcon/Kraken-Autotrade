/**
 * IdcaCycleExitModal — Lote 4
 * Modal to schedule or immediately execute a partial/full exit for an IDCA cycle.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, DollarSign, X, Zap } from "lucide-react";
import {
  useCreateExitInstruction,
  useCancelExitInstruction,
  useExitInstructions,
  type IdcaCycle,
  type ExitInstructionType,
  type IdcaExitInstruction,
  type ExitInstructionStatus,
} from "@/hooks/useInstitutionalDca";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: ExitInstructionStatus) {
  const map: Record<ExitInstructionStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending:               { label: "Pendiente",          variant: "default" },
    executing:             { label: "Ejecutando…",        variant: "secondary" },
    executed:              { label: "Ejecutada",          variant: "outline" },
    cancelled:             { label: "Cancelada",          variant: "outline" },
    failed:                { label: "Fallida",            variant: "destructive" },
    failed_requires_review:{ label: "⚠️ Revisar",        variant: "destructive" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

function typeLabel(type: ExitInstructionType) {
  const map: Record<ExitInstructionType, string> = {
    immediate:      "Inmediata",
    price_target:   "Por precio",
    scheduled_time: "Programada",
  };
  return map[type] ?? type;
}

// ─── Active Instruction Display ────────────────────────────────────────────────

interface ActiveInstructionProps {
  instr: IdcaExitInstruction;
  cycleId: number;
  onCancelled: () => void;
}

function ActiveInstructionCard({ instr, cycleId, onCancelled }: ActiveInstructionProps) {
  const { mutate: cancel, isPending } = useCancelExitInstruction();

  const canCancel = instr.status === "pending" || instr.status === "failed_requires_review";

  function handleCancel() {
    cancel(
      { cycleId, instrId: instr.id },
      { onSuccess: onCancelled }
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-amber-300">
            Instrucción activa — {typeLabel(instr.type)} · {parseFloat(instr.closePct)}%
          </span>
        </div>
        {statusBadge(instr.status)}
      </div>

      {instr.triggerPrice && (
        <p className="text-xs text-muted-foreground">
          Precio objetivo: ${parseFloat(instr.triggerPrice).toFixed(2)} ({instr.triggerDirection === "above" ? "↑ por encima" : "↓ por debajo"})
        </p>
      )}
      {instr.triggerTime && (
        <p className="text-xs text-muted-foreground">
          Hora programada: {new Date(instr.triggerTime).toLocaleString("es-ES", { timeZone: instr.timezone })}
        </p>
      )}

      {instr.status === "failed_requires_review" && (
        <div className="rounded bg-red-950/40 border border-red-500/40 p-2">
          <p className="text-xs text-red-300 font-medium">⚠️ Requiere revisión manual</p>
          <p className="text-xs text-muted-foreground mt-1">{instr.failureReason}</p>
          {instr.executionClientOrderId && (
            <p className="text-xs text-muted-foreground">
              ClientOrderId: <code className="font-mono">{instr.executionClientOrderId}</code>
            </p>
          )}
        </div>
      )}

      {canCancel && (
        <Button
          variant="destructive"
          size="sm"
          onClick={handleCancel}
          disabled={isPending}
          className="w-full"
        >
          <X className="h-3 w-3 mr-1" />
          {isPending ? "Cancelando…" : "Cancelar instrucción"}
        </Button>
      )}
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  cycle: IdcaCycle;
}

export function IdcaCycleExitModal({ open, onClose, cycle }: Props) {
  const [type, setType] = useState<ExitInstructionType>("immediate");
  const [closePct, setClosePct] = useState<number>(100);
  const [triggerPrice, setTriggerPrice] = useState<string>("");
  const [triggerDirection, setTriggerDirection] = useState<"above" | "below">("above");
  const [triggerTime, setTriggerTime] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { data: instrData } = useExitInstructions(open ? cycle.id : null);
  const { mutate: create, isPending } = useCreateExitInstruction();

  const activeInstruction = instrData?.activeInstruction ?? null;

  const currentQty = parseFloat(cycle.totalQuantity ?? "0");
  const currentPrice = parseFloat(cycle.currentPrice ?? "0");
  const capitalUsed = parseFloat(cycle.capitalUsedUsd ?? "0");
  const totalCostBasis = parseFloat(cycle.totalCostBasisUsd ?? "0") || capitalUsed;

  const sellQty = currentQty * (closePct / 100);
  const estimatedValue = sellQty * currentPrice;
  const estimatedFees = estimatedValue * 0.0009;
  const estimatedNet = estimatedValue - estimatedFees;

  // P&L estimate for this partial sell
  const costBasisSold = capitalUsed * (closePct / 100);
  const estimatedPnl = estimatedNet - costBasisSold;
  const estimatedPnlPct = costBasisSold > 0 ? (estimatedPnl / totalCostBasis) * 100 : 0;

  function handleSubmit() {
    setError(null);

    if (type === "price_target") {
      const p = parseFloat(triggerPrice);
      if (!triggerPrice || isNaN(p) || p <= 0) {
        setError("Introduce un precio de disparo válido");
        return;
      }
    }
    if (type === "scheduled_time") {
      if (!triggerTime) {
        setError("Selecciona una fecha/hora de disparo");
        return;
      }
      if (new Date(triggerTime) <= new Date()) {
        setError("La fecha/hora debe ser futura");
        return;
      }
    }

    create(
      {
        cycleId: cycle.id,
        type,
        closePct,
        triggerPrice: type === "price_target" ? parseFloat(triggerPrice) : undefined,
        triggerDirection: type === "price_target" ? triggerDirection : undefined,
        triggerTime: type === "scheduled_time" ? new Date(triggerTime).toISOString() : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        notes: notes || undefined,
      },
      {
        onSuccess: () => onClose(),
        onError: (e) => setError(e.message),
      }
    );
  }

  // Min datetime for scheduled (now + 1 min)
  const minDatetime = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

  const pnlColor = estimatedPnl >= 0 ? "text-green-400" : "text-red-400";
  const pnlSign = estimatedPnl >= 0 ? "+" : "";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Programar salida — {cycle.pair}
            <Badge variant="outline" className="text-xs ml-1">{cycle.mode}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Active instruction warning */}
          {activeInstruction && (
            <ActiveInstructionCard
              instr={activeInstruction}
              cycleId={cycle.id}
              onCancelled={() => {}}
            />
          )}

          {!activeInstruction && (
            <>
              {/* Cycle summary */}
              <div className="rounded-lg bg-muted/30 border border-border p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cantidad disponible</span>
                  <span className="font-mono">{currentQty.toFixed(6)} {cycle.pair.split("/")[0]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Precio actual</span>
                  <span className="font-mono">${currentPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Capital usado (vivo)</span>
                  <span className="font-mono">${capitalUsed.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Coste histórico total</span>
                  <span className="font-mono">${totalCostBasis.toFixed(2)}</span>
                </div>
              </div>

              {/* Tipo de instrucción */}
              <div className="space-y-1.5">
                <Label>Tipo de salida</Label>
                <Select value={type} onValueChange={(v) => setType(v as ExitInstructionType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediate">
                      <div className="flex items-center gap-2">
                        <Zap className="h-3.5 w-3.5 text-yellow-400" />
                        Inmediata (mercado ahora)
                      </div>
                    </SelectItem>
                    <SelectItem value="price_target">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-3.5 w-3.5 text-blue-400" />
                        Por precio objetivo
                      </div>
                    </SelectItem>
                    <SelectItem value="scheduled_time">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-purple-400" />
                        En fecha/hora programada
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Porcentaje */}
              <div className="space-y-1.5">
                <Label>Porcentaje a vender</Label>
                <Select value={String(closePct)} onValueChange={(v) => setClosePct(parseInt(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25% — Venta parcial mínima</SelectItem>
                    <SelectItem value="50">50% — Venta parcial media</SelectItem>
                    <SelectItem value="75">75% — Venta parcial mayor</SelectItem>
                    <SelectItem value="100">100% — Cierre total</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Price target fields */}
              {type === "price_target" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Precio de disparo (USD)</Label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      placeholder={`ej. ${currentPrice.toFixed(2)}`}
                      value={triggerPrice}
                      onChange={(e) => setTriggerPrice(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Disparar cuando el precio sea</Label>
                    <Select value={triggerDirection} onValueChange={(v) => setTriggerDirection(v as "above" | "below")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="above">↑ Mayor o igual al precio</SelectItem>
                        <SelectItem value="below">↓ Menor o igual al precio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Scheduled time fields */}
              {type === "scheduled_time" && (
                <div className="space-y-1.5">
                  <Label>Fecha y hora de ejecución</Label>
                  <Input
                    type="datetime-local"
                    min={minDatetime}
                    value={triggerTime}
                    onChange={(e) => setTriggerTime(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Hora local del navegador ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                  </p>
                </div>
              )}

              {/* Estimated P&L */}
              <div className="rounded-lg bg-muted/20 border border-border p-3 text-sm space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estimación</p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cantidad a vender</span>
                  <span className="font-mono">{sellQty.toFixed(6)} {cycle.pair.split("/")[0]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor bruto</span>
                  <span className="font-mono">${estimatedValue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fees estimados (~0.09%)</span>
                  <span className="font-mono text-amber-400">−${estimatedFees.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor neto</span>
                  <span className="font-mono">${estimatedNet.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-border/50 pt-1 mt-1">
                  <span className="text-muted-foreground">PnL estimado (parcial)</span>
                  <span className={`font-mono font-semibold ${pnlColor}`}>
                    {pnlSign}${estimatedPnl.toFixed(2)} ({pnlSign}{estimatedPnlPct.toFixed(2)}%)
                  </span>
                </div>
                {closePct < 100 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    * El PnL% se calcula sobre el coste histórico total (${totalCostBasis.toFixed(2)})
                  </p>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label>Notas (opcional)</Label>
                <Input
                  placeholder="Motivo o referencia…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={200}
                />
              </div>

              {/* Error */}
              {error && (
                <div className="rounded bg-red-950/40 border border-red-500/40 p-2">
                  <p className="text-xs text-red-300">{error}</p>
                </div>
              )}

              {/* Warning for immediate */}
              {type === "immediate" && (
                <div className="rounded bg-amber-950/30 border border-amber-500/30 p-2 flex gap-2 items-start">
                  <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-300">
                    La venta se ejecutará <strong>inmediatamente a mercado</strong> al precio actual.
                    Esta acción no se puede deshacer.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cerrar
          </Button>
          {!activeInstruction && (
            <Button
              onClick={handleSubmit}
              disabled={isPending}
              variant={type === "immediate" ? "destructive" : "default"}
            >
              {isPending
                ? "Procesando…"
                : type === "immediate"
                ? `Vender ${closePct}% ahora`
                : `Programar salida ${closePct}%`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
