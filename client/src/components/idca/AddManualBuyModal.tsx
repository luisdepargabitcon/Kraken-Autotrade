/**
 * AddManualBuyModal — Modal to register a manual buy into an open IDCA cycle.
 *
 * IMPORTANT: This does NOT execute any real order.
 * It only records a buy the user already made and recalculates cycle metrics.
 */
import React, { useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, AlertTriangle, Info } from "lucide-react";
import { useManualBuyCycle } from "@/hooks/useInstitutionalDca";
import { useToast } from "@/hooks/use-toast";

interface AddManualBuyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycle: {
    id: number;
    pair: string;
    status: string;
    totalQuantity: string | number;
    avgEntryPrice: string | number | null;
    capitalUsedUsd: string | number;
    tpTargetPrice: string | number | null;
    tpTargetPct: string | number | null;
    nextBuyPrice: string | number | null;
    soloSalida?: boolean;
  };
}

const EXCHANGE_OPTIONS = [
  { value: "kraken", label: "Kraken" },
  { value: "revolut_x", label: "Revolut X" },
  { value: "bit2me", label: "Bit2Me" },
  { value: "manual_external", label: "Manual externo" },
  { value: "other", label: "Otro" },
];

export function AddManualBuyModal({ open, onOpenChange, cycle }: AddManualBuyModalProps) {
  const { toast } = useToast();
  const manualBuy = useManualBuyCycle();

  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [feesUsd, setFeesUsd] = useState("0");
  const [executedAt, setExecutedAt] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [exchange, setExchange] = useState("manual_external");
  const [externalOrderId, setExternalOrderId] = useState("");
  const [note, setNote] = useState("");
  const [continueAuto, setContinueAuto] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);

  const priceNum = parseFloat(price) || 0;
  const qtyNum = parseFloat(quantity) || 0;
  const feesNum = parseFloat(feesUsd) || 0;
  const notionalUsd = useMemo(() => priceNum * qtyNum, [priceNum, qtyNum]);

  // Preview calculations
  const prevQty = parseFloat(String(cycle.totalQuantity || "0"));
  const prevCost = parseFloat(String(cycle.capitalUsedUsd || "0"));
  const prevAvg = parseFloat(String(cycle.avgEntryPrice || "0"));
  const prevTp = cycle.tpTargetPrice ? parseFloat(String(cycle.tpTargetPrice)) : null;
  const prevNextBuy = cycle.nextBuyPrice ? parseFloat(String(cycle.nextBuyPrice)) : null;
  const tpPct = parseFloat(String(cycle.tpTargetPct || "0"));

  const manualNetCost = notionalUsd + feesNum;
  const newQty = prevQty + qtyNum;
  const newCost = prevCost + manualNetCost;
  const newAvg = newQty > 0 ? newCost / newQty : prevAvg;
  const newTp = tpPct > 0 ? newAvg * (1 + tpPct / 100) : prevTp;
  const nextLevelPct = cycle.tpTargetPct ? null : null; // not available here
  const newNextBuy = prevNextBuy; // will be recalculated by engine on next tick

  const canSave = priceNum > 0 && qtyNum > 0 && notionalUsd > 0 && feesNum >= 0 && acknowledged;

  const handleSave = () => {
    if (!canSave) return;
    manualBuy.mutate(
      {
        cycleId: cycle.id,
        pair: cycle.pair,
        price: priceNum,
        quantity: qtyNum,
        notionalUsd,
        feesUsd: feesNum,
        executedAt: new Date(executedAt).toISOString(),
        exchange,
        externalOrderId: externalOrderId || null,
        note: note || null,
        continueAutomaticManagement: continueAuto,
      },
      {
        onSuccess: (data: any) => {
          toast({
            title: "Compra manual registrada",
            description: `Nuevo precio medio: $${data.newAvg.toFixed(2)}. Nuevo TP: ${data.newTp ? "$" + data.newTp.toFixed(2) : "—"}.`,
          });
          onOpenChange(false);
          // Reset form
          setPrice("");
          setQuantity("");
          setFeesUsd("0");
          setExternalOrderId("");
          setNote("");
          setAcknowledged(false);
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const isSoloSalida = cycle.soloSalida;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PlusCircle className="h-4 w-4 text-blue-400" />
            Añadir compra manual
          </DialogTitle>
          <DialogDescription className="text-xs">
            Registra una compra manual dentro de este ciclo. <strong>No ejecuta órdenes reales.</strong>
          </DialogDescription>
        </DialogHeader>

        {/* Read-only cycle info */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Par:</span>
          <Badge variant="outline" className="text-xs">{cycle.pair}</Badge>
          <span className="text-muted-foreground ml-2">Ciclo:</span>
          <Badge variant="outline" className="text-xs">#{cycle.id}</Badge>
          <span className="text-muted-foreground ml-2">Estado:</span>
          <Badge variant="outline" className="text-xs">{cycle.status}</Badge>
        </div>

        {isSoloSalida && (
          <Alert className="border-amber-500/30 bg-amber-500/5">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <AlertDescription className="text-xs text-amber-300">
              <strong>Atención:</strong> Este ciclo está en modo solo salida. Añadir una compra manual aumentará la exposición.
              El modo solo salida no se desactivará automáticamente.
            </AlertDescription>
          </Alert>
        )}

        {/* Form fields */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Fecha/hora de compra</Label>
            <Input
              type="datetime-local"
              value={executedAt}
              onChange={(e) => setExecutedAt(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Exchange / origen</Label>
            <Select value={exchange} onValueChange={setExchange}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXCHANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Precio de compra (USD)</Label>
            <Input type="number" step="0.01" placeholder="Ej: 1620.00" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cantidad comprada</Label>
            <Input type="number" step="0.000001" placeholder="Ej: 0.10" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Valor USD total</Label>
            <Input type="number" step="0.01" value={notionalUsd > 0 ? notionalUsd.toFixed(2) : ""} readOnly className="h-8 text-xs bg-muted/30" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fees / comisión (USD)</Label>
            <Input type="number" step="0.01" placeholder="0.00" value={feesUsd} onChange={(e) => setFeesUsd(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Order ID externo (opcional)</Label>
            <Input type="text" placeholder="Ej: KRAKEN-12345" value={externalOrderId} onChange={(e) => setExternalOrderId(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nota (opcional)</Label>
            <Input type="text" placeholder="Motivo de la compra manual" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>

        {/* Management options */}
        <div className="space-y-2 border-t border-border/20 pt-3">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox checked={continueAuto} onCheckedChange={(v) => setContinueAuto(v === true)} />
            <span>Continuar gestión automática del ciclo (recomendado)</span>
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox checked={!continueAuto} onCheckedChange={(v) => setContinueAuto(v !== true)} />
            <span>Proteger ciclo y no permitir nuevas compras automáticas</span>
          </label>
        </div>

        {/* Preview */}
        {priceNum > 0 && qtyNum > 0 && (
          <div className="border border-border/30 rounded-lg p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" /> Vista previa del recálculo
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cantidad actual</span>
                <span className="font-mono">{prevQty.toFixed(8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nueva cantidad</span>
                <span className="font-mono font-medium">{newQty.toFixed(8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Capital usado</span>
                <span className="font-mono">${prevCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nuevo capital</span>
                <span className="font-mono font-medium">${newCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Precio medio actual</span>
                <span className="font-mono">${prevAvg.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nuevo precio medio</span>
                <span className="font-mono font-medium text-blue-400">${newAvg.toFixed(2)}</span>
              </div>
              {prevTp != null && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">TP actual</span>
                    <span className="font-mono">${prevTp.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Nuevo TP</span>
                    <span className="font-mono font-medium text-green-400">${newTp?.toFixed(2) ?? "—"}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between col-span-2 pt-1 border-t border-border/10">
                <span className="text-muted-foreground">Diferencia en precio medio</span>
                <span className={`font-mono font-medium ${(newAvg - prevAvg) >= 0 ? "text-amber-400" : "text-green-400"}`}>
                  {(newAvg - prevAvg) >= 0 ? "+" : ""}{(newAvg - prevAvg).toFixed(2)} ({((newAvg - prevAvg) / prevAvg * 100).toFixed(2)}%)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation */}
        <Alert className="border-blue-500/30 bg-blue-500/5">
          <AlertDescription className="text-xs text-blue-300">
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} className="mt-0.5" />
              <span>Entiendo que esto <strong>NO ejecuta una orden real</strong>. Solo registra la compra en el ciclo y recalcula sus métricas.</span>
            </label>
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            size="sm"
            disabled={!canSave || manualBuy.isPending}
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-500 text-white"
          >
            {manualBuy.isPending ? "Guardando..." : "Registrar compra manual"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
