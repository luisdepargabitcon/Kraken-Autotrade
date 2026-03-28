import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle,
  Edit3,
  History,
  Calculator,
  ShieldAlert,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { IdcaCycle } from "@/hooks/useInstitutionalDca";

// Exchange options matching the backend
const EXCHANGE_OPTIONS = [
  { value: "revolut_x", label: "Revolut X" },
  { value: "kraken", label: "Kraken" },
  { value: "other", label: "Otro" },
];

// Predefined edit reasons
const EDIT_REASONS = [
  { value: "wrong_avg_price", label: "Error al introducir precio medio" },
  { value: "wrong_quantity", label: "Cantidad incorrecta" },
  { value: "wrong_fees", label: "Fees incorrectos" },
  { value: "wrong_date", label: "Fecha/hora incorrecta" },
  { value: "wrong_exchange", label: "Exchange incorrecto" },
  { value: "other", label: "Otro (especificar en notas)" },
];

interface EditImportedCycleModalProps {
  cycle: IdcaCycle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (cycleId: number, payload: EditPayload) => void;
  isPending: boolean;
}

interface EditPayload {
  avgEntryPrice?: number;
  quantity?: number;
  capitalUsedUsd?: number;
  exchangeSource?: string;
  startedAt?: string;
  soloSalida?: boolean;
  notes?: string;
  feesPaidUsd?: number;
  estimatedFeePct?: number;
  editReason: string;
  editAcknowledged: boolean;
}

interface ImpactPreview {
  tpTargetPrice: number;
  nextBuyPrice: number | null;
  unrealizedPnlPct: number;
  protectionStopPrice: number | null;
  capitalReservedUsd: number;
}

export function EditImportedCycleModal({
  cycle,
  open,
  onOpenChange,
  onSave,
  isPending,
}: EditImportedCycleModalProps) {
  // Form state
  const [avgEntryPrice, setAvgEntryPrice] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [capitalUsedUsd, setCapitalUsedUsd] = useState<string>("");
  const [exchangeSource, setExchangeSource] = useState<string>("");
  const [startedAt, setStartedAt] = useState<string>("");
  const [soloSalida, setSoloSalida] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");
  const [feesPaidUsd, setFeesPaidUsd] = useState<string>("");
  const [estimatedFeePct, setEstimatedFeePct] = useState<string>("");
  const [editReason, setEditReason] = useState<string>("");
  const [editAcknowledged, setEditAcknowledged] = useState<boolean>(false);

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState<"edit" | "preview" | "history">("edit");

  // Activity assessment (would come from backend in real implementation)
  const [activityLevel, setActivityLevel] = useState<"none" | "low" | "high">("none");

  // Initialize form when cycle changes
  useEffect(() => {
    if (cycle && open) {
      setAvgEntryPrice(cycle.avgEntryPrice || "");
      setQuantity(cycle.totalQuantity || "");
      setCapitalUsedUsd(cycle.capitalUsedUsd || "");
      setExchangeSource(cycle.exchangeSource || "revolut_x");
      setStartedAt(cycle.startedAt ? new Date(cycle.startedAt).toISOString().slice(0, 16) : "");
      setSoloSalida(cycle.soloSalida ?? false);
      setNotes(cycle.importNotes || "");
      setEstimatedFeePct(cycle.estimatedFeePct || "0.09");
      setEditReason("");
      setEditAcknowledged(false);

      // Assess activity level
      const buyCount = cycle.buyCount || 1;
      if (buyCount > 2) {
        setActivityLevel("high");
      } else if (buyCount > 1) {
        setActivityLevel("low");
      } else {
        setActivityLevel("none");
      }
    }
  }, [cycle, open]);

  // Calculate impact preview
  const calculateImpact = (): ImpactPreview | null => {
    if (!cycle) return null;

    const currentPrice = parseFloat(cycle.currentPrice || "0");
    const newAvgEntry = parseFloat(avgEntryPrice || cycle.avgEntryPrice || "0");
    const newQty = parseFloat(quantity || cycle.totalQuantity || "0");
    const oldCapitalUsed = parseFloat(cycle.capitalUsedUsd || "0");

    if (!newAvgEntry || !newQty) return null;

    // Calculate new capital used
    let newCapitalUsed = oldCapitalUsed;
    if (avgEntryPrice || quantity) {
      newCapitalUsed = newQty * newAvgEntry;
    }

    // Calculate TP (using default 4% if not available)
    const tpPct = parseFloat(cycle.tpTargetPct || "4");
    const tpTargetPrice = newAvgEntry * (1 + tpPct / 100);

    // Calculate next buy price (using default safety levels)
    const safetyLevel = 2.0; // First safety buy at -2%
    const nextBuyPrice = newAvgEntry * (1 - safetyLevel / 100);

    // Calculate PnL
    const marketValue = newQty * currentPrice;
    const unrealizedPnlUsd = marketValue - newCapitalUsed;
    const unrealizedPnlPct = newCapitalUsed > 0 ? (unrealizedPnlUsd / newCapitalUsed) * 100 : 0;

    // Protection stop at break-even (new avg entry)
    const protectionStopPrice = cycle.protectionArmedAt ? newAvgEntry : null;

    // Capital reserved (simplified calculation)
    const capitalReservedUsd = Math.max(newCapitalUsed, newCapitalUsed * 1.2);

    return {
      tpTargetPrice,
      nextBuyPrice,
      unrealizedPnlPct,
      protectionStopPrice,
      capitalReservedUsd,
    };
  };

  const impact = calculateImpact();

  // Check if any values changed
  const hasChanges = () => {
    if (!cycle) return false;
    return (
      avgEntryPrice !== (cycle.avgEntryPrice || "") ||
      quantity !== (cycle.totalQuantity || "") ||
      capitalUsedUsd !== (cycle.capitalUsedUsd || "") ||
      exchangeSource !== (cycle.exchangeSource || "revolut_x") ||
      soloSalida !== (cycle.soloSalida ?? false) ||
      notes !== (cycle.importNotes || "") ||
      estimatedFeePct !== (cycle.estimatedFeePct || "0.09")
    );
  };

  const handleSave = () => {
    if (!cycle) return;

    const payload: EditPayload = {
      editReason: EDIT_REASONS.find(r => r.value === editReason)?.label || editReason,
      editAcknowledged: true,
    };

    // Only include changed values
    if (avgEntryPrice !== (cycle.avgEntryPrice || "")) {
      payload.avgEntryPrice = parseFloat(avgEntryPrice);
    }
    if (quantity !== (cycle.totalQuantity || "")) {
      payload.quantity = parseFloat(quantity);
    }
    if (capitalUsedUsd !== (cycle.capitalUsedUsd || "")) {
      payload.capitalUsedUsd = parseFloat(capitalUsedUsd);
    }
    if (exchangeSource !== (cycle.exchangeSource || "revolut_x")) {
      payload.exchangeSource = exchangeSource;
    }
    if (startedAt) {
      payload.startedAt = new Date(startedAt).toISOString();
    }
    if (soloSalida !== (cycle.soloSalida ?? false)) {
      payload.soloSalida = soloSalida;
    }
    if (notes !== (cycle.importNotes || "")) {
      payload.notes = notes;
    }
    if (feesPaidUsd) {
      payload.feesPaidUsd = parseFloat(feesPaidUsd);
    }
    if (estimatedFeePct !== (cycle.estimatedFeePct || "0.09")) {
      payload.estimatedFeePct = parseFloat(estimatedFeePct);
    }

    onSave(cycle.id, payload);
  };

  const formatPrice = (price: number) => {
    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatPercent = (pct: number) => {
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  };

  if (!cycle) return null;

  const isHighActivity = activityLevel === "high";
  const canEditCoreFields = !isHighActivity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit3 className="h-5 w-5" />
            Editar Ciclo Importado
            <Badge variant="outline" className="ml-2">
              #{cycle.id}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Modifica los datos del ciclo importado. Los campos derivados (TP, próxima compra, PnL) se recalcularán automáticamente.
          </DialogDescription>
        </DialogHeader>

        {/* Activity Assessment Banner */}
        {isHighActivity ? (
          <Alert variant="destructive" className="bg-red-950/50 border-red-500/50">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle className="text-red-400">Caso B: Edición Limitada</AlertTitle>
            <AlertDescription className="text-red-300/80">
              Este ciclo tiene {cycle.buyCount - 1} compras de seguridad ejecutadas.
              Solo puedes editar: exchange, fecha, solo salida, notas y fees.
              Para cambiar precio/cantidad, se recomienda cerrar e importar de nuevo.
            </AlertDescription>
          </Alert>
        ) : activityLevel === "low" ? (
          <Alert className="bg-yellow-950/30 border-yellow-600/50">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <AlertTitle className="text-yellow-500">Caso A con Advertencia</AlertTitle>
            <AlertDescription className="text-yellow-400/70">
              Este ciclo tiene 1 compra de seguridad. La edición está permitida pero afectará el histórico.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="bg-emerald-950/30 border-emerald-600/50">
            <Info className="h-4 w-4 text-emerald-500" />
            <AlertTitle className="text-emerald-500">Caso A: Sin Actividad Posterior</AlertTitle>
            <AlertDescription className="text-emerald-400/70">
              Edición completa permitida. Solo compra base, sin actividad automática.
            </AlertDescription>
          </Alert>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-border/50 pb-2">
          <Button
            variant={activeTab === "edit" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("edit")}
            className={cn(
              "flex items-center gap-1.5",
              activeTab === "edit" && "bg-primary text-primary-foreground"
            )}
          >
            <Edit3 className="h-4 w-4" />
            Editar
          </Button>
          <Button
            variant={activeTab === "preview" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("preview")}
            className={cn(
              "flex items-center gap-1.5",
              activeTab === "preview" && "bg-primary text-primary-foreground"
            )}
          >
            <Calculator className="h-4 w-4" />
            Impacto
            {hasChanges() && (
              <span className="ml-1 h-2 w-2 rounded-full bg-yellow-500" />
            )}
          </Button>
          <Button
            variant={activeTab === "history" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("history")}
            className={cn(
              "flex items-center gap-1.5",
              activeTab === "history" && "bg-primary text-primary-foreground"
            )}
          >
            <History className="h-4 w-4" />
            Historial
          </Button>
        </div>

        {/* EDIT TAB */}
        {activeTab === "edit" && (
          <div className="space-y-4 py-2">
            {/* Core Fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="avgEntryPrice" className={cn(!canEditCoreFields && "text-muted-foreground")}>
                  Precio Medio de Entrada ($)
                  {!canEditCoreFields && (
                    <span className="ml-1 text-xs text-red-400">(bloqueado)</span>
                  )}
                </Label>
                <Input
                  id="avgEntryPrice"
                  type="number"
                  step="0.01"
                  value={avgEntryPrice}
                  onChange={(e) => setAvgEntryPrice(e.target.value)}
                  disabled={!canEditCoreFields || isPending}
                  className={cn(!canEditCoreFields && "bg-muted/50")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quantity" className={cn(!canEditCoreFields && "text-muted-foreground")}>
                  Cantidad Total
                  {!canEditCoreFields && (
                    <span className="ml-1 text-xs text-red-400">(bloqueado)</span>
                  )}
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  step="0.00000001"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  disabled={!canEditCoreFields || isPending}
                  className={cn(!canEditCoreFields && "bg-muted/50")}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="capitalUsedUsd">
                  Capital Usado ($)
                  <span className="ml-1 text-xs text-muted-foreground">(auto si vacío)</span>
                </Label>
                <Input
                  id="capitalUsedUsd"
                  type="number"
                  step="0.01"
                  value={capitalUsedUsd}
                  onChange={(e) => setCapitalUsedUsd(e.target.value)}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exchangeSource">Exchange</Label>
                <Select
                  value={exchangeSource}
                  onValueChange={setExchangeSource}
                  disabled={isPending}
                >
                  <SelectTrigger id="exchangeSource">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXCHANGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Date and Solo Salida */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startedAt">Fecha de Apertura</Label>
                <Input
                  id="startedAt"
                  type="datetime-local"
                  value={startedAt}
                  onChange={(e) => setStartedAt(e.target.value)}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="soloSalida" className="flex items-center gap-2">
                  Solo Salida
                  <Switch
                    id="soloSalida"
                    checked={soloSalida}
                    onCheckedChange={setSoloSalida}
                    disabled={isPending}
                  />
                </Label>
                <p className="text-xs text-muted-foreground">
                  {soloSalida
                    ? "Solo gestión de salida activa"
                    : "Gestión completa (compras + venta)"}
                </p>
              </div>
            </div>

            {/* Edit Reason */}
            <div className="space-y-2">
              <Label htmlFor="editReason" className="text-primary">
                Motivo de la Edición *
              </Label>
              <Select
                value={editReason}
                onValueChange={setEditReason}
                disabled={isPending}
              >
                <SelectTrigger id="editReason">
                  <SelectValue placeholder="Selecciona el motivo..." />
                </SelectTrigger>
                <SelectContent>
                  {EDIT_REASONS.map((reason) => (
                    <SelectItem key={reason.value} value={reason.value}>
                      {reason.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notas Adicionales</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Añade información relevante sobre esta edición..."
                disabled={isPending}
                rows={2}
              />
            </div>

            {/* Advanced Fields Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-muted-foreground"
            >
              {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Campos Avanzados
            </Button>

            {showAdvanced && (
              <div className="space-y-4 rounded-md bg-muted/30 p-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="estimatedFeePct">Fee Estimado (%)</Label>
                    <Input
                      id="estimatedFeePct"
                      type="number"
                      step="0.001"
                      value={estimatedFeePct}
                      onChange={(e) => setEstimatedFeePct(e.target.value)}
                      disabled={isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="feesPaidUsd">Fees Reales Pagados ($)</Label>
                    <Input
                      id="feesPaidUsd"
                      type="number"
                      step="0.01"
                      value={feesPaidUsd}
                      onChange={(e) => setFeesPaidUsd(e.target.value)}
                      placeholder="Opcional - para registro"
                      disabled={isPending}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Acknowledgment */}
            <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-950/20 p-3">
              <Checkbox
                id="acknowledge"
                checked={editAcknowledged}
                onCheckedChange={(checked) => setEditAcknowledged(checked === true)}
                disabled={isPending}
                className="mt-1 border-yellow-500/50"
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor="acknowledge"
                  className="text-sm font-medium text-yellow-500/90"
                >
                  Confirmo que entiendo las consecuencias de esta edición
                </Label>
                <p className="text-xs text-yellow-400/70">
                  Esta operación modificará permanentemente el ciclo, quedará registrada en el
                  historial de auditoría, y puede afectar el cálculo de PnL y distancias a triggers.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* PREVIEW TAB */}
        {activeTab === "preview" && impact && (
          <div className="space-y-4 py-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Impacto Estimado de los Cambios
            </h4>

            <div className="grid grid-cols-2 gap-4">
              {/* TP */}
              <div className="rounded-md bg-muted/30 p-3 space-y-1">
                <span className="text-xs text-muted-foreground">TP Objetivo</span>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-mono font-semibold">
                    ${formatPrice(impact.tpTargetPrice)}
                  </span>
                  {parseFloat(avgEntryPrice || cycle.avgEntryPrice || "0") !==
                    parseFloat(cycle.avgEntryPrice || "0") && (
                    <Badge variant="outline" className="text-yellow-400 border-yellow-400/50 text-xs">
                      ← ${formatPrice(parseFloat(cycle.tpTargetPrice || "0"))}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Next Buy */}
              <div className="rounded-md bg-muted/30 p-3 space-y-1">
                <span className="text-xs text-muted-foreground">Próx. Compra</span>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-mono font-semibold text-blue-400">
                    ${impact.nextBuyPrice ? formatPrice(impact.nextBuyPrice) : "N/A"}
                  </span>
                </div>
              </div>

              {/* PnL */}
              <div className="rounded-md bg-muted/30 p-3 space-y-1">
                <span className="text-xs text-muted-foreground">PnL Estimado</span>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-lg font-mono font-semibold",
                      impact.unrealizedPnlPct >= 0 ? "text-green-400" : "text-red-400"
                    )}
                  >
                    {formatPercent(impact.unrealizedPnlPct)}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    ← {formatPercent(parseFloat(cycle.unrealizedPnlPct || "0"))}
                  </Badge>
                </div>
              </div>

              {/* Protection */}
              <div className="rounded-md bg-muted/30 p-3 space-y-1">
                <span className="text-xs text-muted-foreground">Stop Protección</span>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-mono font-semibold text-emerald-400">
                    ${impact.protectionStopPrice ? formatPrice(impact.protectionStopPrice) : "N/A"}
                  </span>
                </div>
              </div>
            </div>

            {/* Capital Summary */}
            <div className="rounded-md bg-primary/5 p-3 space-y-2">
              <span className="text-xs text-primary/70 font-medium">Resumen Capital</span>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Capital Usado:</span>
                  <span className="font-mono">${formatPrice(parseFloat(capitalUsedUsd || cycle.capitalUsedUsd || "0"))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Capital Reservado:</span>
                  <span className="font-mono">${formatPrice(impact.capitalReservedUsd)}</span>
                </div>
              </div>
            </div>

            {!hasChanges() && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  No hay cambios pendientes. Modifica los campos en la pestaña "Editar" para ver el impacto.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === "history" && (
          <div className="space-y-4 py-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <History className="h-4 w-4" />
              Historial de Ediciones
            </h4>

            {cycle.editHistoryJson && Array.isArray(cycle.editHistoryJson) && cycle.editHistoryJson.length > 0 ? (
              <div className="space-y-3">
                {(cycle.editHistoryJson as any[]).map((entry, idx) => (
                  <div
                    key={idx}
                    className="rounded-md bg-muted/30 p-3 space-y-2 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {new Date(entry.editedAt).toLocaleString("es-ES")}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          entry.case === "A_no_activity"
                            ? "text-emerald-400 border-emerald-400/50"
                            : "text-yellow-400 border-yellow-400/50"
                        )}
                      >
                        {entry.case === "A_no_activity" ? "Caso A" : "Caso B"}
                      </Badge>
                    </div>
                    <div className="font-medium text-primary/90">{entry.reason}</div>
                    {entry.changes && Object.keys(entry.changes).length > 0 && (
                      <div className="space-y-1 text-xs">
                        <span className="text-muted-foreground">Cambios:</span>
                        {Object.entries(entry.changes).map(([field, values]: [string, any]) => (
                          <div key={field} className="flex items-center gap-2 pl-2">
                            <span className="text-muted-foreground">{field}:</span>
                            <span className="text-red-400/70 line-through">{String(values.old).slice(0, 20)}</span>
                            <span>→</span>
                            <span className="text-green-400/70">{String(values.new).slice(0, 20)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Alert className="bg-muted/30">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Este ciclo no tiene ediciones previas registradas.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              isPending ||
              !editReason ||
              !editAcknowledged ||
              (!hasChanges() && activeTab === "edit")
            }
            className="bg-primary"
          >
            {isPending ? "Guardando..." : "Guardar Cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
