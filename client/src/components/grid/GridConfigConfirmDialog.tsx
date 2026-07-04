import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Info, CheckCircle2 } from "lucide-react";

export interface ConfigChange {
  label: string;
  oldValue: any;
  newValue: any;
  impact: string;
  riskLevel: "low" | "medium" | "high";
  affectsCurrent: boolean;
  requiresRecalc: boolean;
}

interface GridConfigConfirmDialogProps {
  open: boolean;
  change: ConfigChange | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function GridConfigConfirmDialog({ open, change, onConfirm, onCancel }: GridConfigConfirmDialogProps) {
  if (!change) return null;

  const riskColor = change.riskLevel === "high" ? "text-red-500" : change.riskLevel === "medium" ? "text-amber-500" : "text-green-500";
  const riskLabel = change.riskLevel === "high" ? "Alto" : change.riskLevel === "medium" ? "Medio" : "Bajo";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Confirmar cambio de configuración
          </DialogTitle>
          <DialogDescription className="text-sm">
            Revisa el impacto antes de aplicar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Parámetro</p>
              <p className="text-sm font-semibold">{change.label}</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Nivel de riesgo</p>
              <p className={`text-sm font-semibold ${riskColor}`}>{riskLabel}</p>
            </div>
            <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
              <p className="text-xs text-muted-foreground">Valor anterior</p>
              <p className="text-sm font-mono font-bold">{String(change.oldValue)}</p>
            </div>
            <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3">
              <p className="text-xs text-muted-foreground">Valor nuevo</p>
              <p className="text-sm font-mono font-bold text-green-500">{String(change.newValue)}</p>
            </div>
          </div>
          <div className="rounded-lg bg-muted/20 p-3 text-sm">
            <p className="text-muted-foreground">{change.impact}</p>
          </div>
          <div className="flex flex-col gap-2">
            {change.affectsCurrent && (
              <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Afecta al estado actual del Grid, no solo a futuros niveles.</span>
              </div>
            )}
            {change.requiresRecalc && (
              <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                <Info className="h-4 w-4 shrink-0" />
                <span>Puede requerir recálculo de niveles en el próximo tick.</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>No afecta órdenes reales ni al motor de trading.</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button onClick={onConfirm}>Aplicar cambio</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
