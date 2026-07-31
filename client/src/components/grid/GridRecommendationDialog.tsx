"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, ArrowRight, Lightbulb, ShieldAlert, Lock } from "lucide-react";
import type { ConfigurationRecommendation, RecommendationAlternative } from "@shared/gridRecommendationHelper";

interface GridRecommendationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recommendation: ConfigurationRecommendation | null;
  onApply: (alt: RecommendationAlternative, recommendation: ConfigurationRecommendation) => Promise<{ beforeValues: Record<string, any>; afterValues: Record<string, any>; appliedFields: string[] } | void>;
  onConfigureManually?: () => void;
}

type DialogState = "select" | "confirm" | "applying" | "success" | "error";

interface ApplyResult {
  beforeValues: Record<string, any>;
  afterValues: Record<string, any>;
  appliedFields: string[];
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function GridRecommendationDialog({
  open,
  onOpenChange,
  recommendation,
  onApply,
  onConfigureManually,
}: GridRecommendationDialogProps) {
  const [selected, setSelected] = React.useState<RecommendationAlternative | null>(null);
  const [state, setState] = React.useState<DialogState>("select");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [applyResult, setApplyResult] = React.useState<ApplyResult | null>(null);

  React.useEffect(() => {
    if (open) {
      setSelected(null);
      setState("select");
      setErrorMsg(null);
    }
  }, [open]);

  const isExpired = React.useMemo(() => {
    if (!recommendation?.expiresAt) return false;
    return new Date() > new Date(recommendation.expiresAt);
  }, [recommendation?.expiresAt]);

  const handleApply = async () => {
    if (!selected || !recommendation) return;
    setState("applying");
    setErrorMsg(null);
    try {
      const result = await onApply(selected, recommendation);
      setApplyResult(result ?? null);
      setState("success");
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Error al aplicar la recomendación");
      setState("error");
    }
  };

  if (!recommendation) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            Recomendaciones de configuración
          </DialogTitle>
          <DialogDescription>
            {state === "select" && recommendation.explanation}
            {state === "confirm" && "Confirma que deseas aplicar esta configuración."}
            {state === "applying" && "Aplicando cambios..."}
            {state === "success" && "Configuración aplicada correctamente."}
            {state === "error" && "Error al aplicar la configuración."}
          </DialogDescription>
        </DialogHeader>

        {recommendation.warnings.length > 0 && state === "select" && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
            {recommendation.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-600 dark:text-amber-400">{w}</p>
              </div>
            ))}
          </div>
        )}

        {isExpired && state === "select" && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-400 shrink-0" />
            <p className="text-xs text-red-600 dark:text-red-400">
              Esta recomendación ha caducado. Cierra y vuelve a analizar el mercado.
            </p>
          </div>
        )}

        {state === "select" && (
          <div className="space-y-3">
            {recommendation.alternatives.map((alt) => {
              const isSelected = selected?.id === alt.id;
              const isRecommended = alt.id === recommendation.recommendedAlternativeId;
              return (
                <Card
                  key={alt.id}
                  className={`cursor-pointer transition-all ${
                    isSelected ? "border-primary ring-2 ring-primary/20" : "border-border/50 hover:border-border"
                  } ${!alt.safeToApply ? "opacity-60" : ""}`}
                  onClick={() => alt.safeToApply && !isExpired && setSelected(alt)}
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant={isRecommended ? "default" : "outline"}>{alt.id}</Badge>
                        {isRecommended && (
                          <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">Recomendado</Badge>
                        )}
                        {!alt.safeToApply && (
                          <Badge variant="destructive" className="text-xs">
                            <Lock className="h-3 w-3 mr-1" />Bloqueado
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Niveles: <span className="font-mono font-semibold text-foreground">{alt.expectedAfter.levels}</span></span>
                        <span>Spacing: <span className="font-mono font-semibold text-foreground">{fmtPct(alt.expectedAfter.spacingPct)}</span></span>
                      </div>
                    </div>
                    <p className="text-sm font-medium">{alt.title}</p>
                    <p className="text-sm text-muted-foreground">{alt.explanation}</p>
                    {alt.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">{w}</p>
                      </div>
                    ))}
                    {alt.blockingReason && (
                      <div className="flex items-start gap-2">
                        <Lock className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-red-500">{alt.blockingReason}</p>
                      </div>
                    )}
                    {isSelected && (
                      <div className="pt-2 border-t">
                        <p className="text-xs font-medium mb-1">Campos a modificar:</p>
                        <div className="flex flex-wrap gap-1">
                          {alt.changedFields.map((field) => (
                            <Badge key={field} variant="outline" className="text-xs font-mono">
                              {field}: {String(alt.proposedConfig[field])}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Antes: {alt.expectedBefore.levels} niveles, {fmtPct(alt.expectedBefore.spacingPct)} spacing, {fmtPct(alt.expectedBefore.netProfitPct)} beneficio
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Después: {alt.expectedAfter.levels} niveles, {fmtPct(alt.expectedAfter.spacingPct)} spacing, {fmtPct(alt.expectedAfter.netProfitPct)} beneficio
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {state === "confirm" && selected && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-400" />
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Confirmación requerida</p>
            </div>
            <p className="text-sm text-muted-foreground">Alternativa <strong>{selected.id}</strong>: {selected.title}</p>
            <div className="flex flex-wrap gap-1">
              {selected.changedFields.map((field) => (
                <Badge key={field} variant="outline" className="text-xs font-mono">
                  {field}: {String(selected.proposedConfig[field])}
                </Badge>
              ))}
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Niveles: {selected.expectedBefore.levels} → {selected.expectedAfter.levels}</p>
              <p>Spacing: {fmtPct(selected.expectedBefore.spacingPct)} → {fmtPct(selected.expectedAfter.spacingPct)}</p>
              <p>Beneficio: {fmtPct(selected.expectedBefore.netProfitPct)} → {fmtPct(selected.expectedAfter.netProfitPct)}</p>
            </div>
            <div className="flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                El rango vigente no se modificará. Esta configuración se usará en futuros análisis.
              </p>
            </div>
          </div>
        )}

        {state === "success" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
              <p className="text-sm font-medium">Configuración aplicada correctamente</p>
            </div>
            {applyResult && applyResult.appliedFields.length > 0 && (
              <div className="rounded-md border border-border/40 p-3 space-y-2">
                <p className="text-xs font-medium">Campos aplicados</p>
                <div className="flex flex-wrap gap-1">
                  {applyResult.appliedFields.map((field) => (
                    <Badge key={field} variant="outline" className="text-xs font-mono">
                      {field}
                    </Badge>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Antes</p>
                    {applyResult.appliedFields.map((field) => (
                      <p key={`before-${field}`} className="font-mono">{field}: {String(applyResult.beforeValues[field] ?? "—")}</p>
                    ))}
                  </div>
                  <div>
                    <p className="text-muted-foreground">Después</p>
                    {applyResult.appliedFields.map((field) => (
                      <p key={`after-${field}`} className="font-mono">{field}: {String(applyResult.afterValues[field] ?? "—")}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              El rango vigente y sus niveles no se han modificado. La nueva configuración se usará en futuros análisis.
            </p>
            <p className="text-xs text-muted-foreground flex items-start gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
              Validación canónica superada: el generador profesional verificó la viabilidad con la microestructura de Revolut X.
            </p>
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center justify-center py-8 space-y-3">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <p className="text-sm font-medium">Error al aplicar</p>
            <p className="text-xs text-muted-foreground">{errorMsg}</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {state === "select" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              {onConfigureManually && (
                <Button variant="ghost" onClick={() => { onOpenChange(false); onConfigureManually(); }}>
                  Configurar manualmente
                </Button>
              )}
              <Button disabled={!selected || !selected.safeToApply || isExpired} onClick={() => setState("confirm")}>
                Revisar alternativa {selected?.id ?? ""}
              </Button>
            </>
          )}
          {state === "confirm" && selected && (
            <>
              <Button variant="outline" onClick={() => setState("select")}>Volver</Button>
              <Button variant="destructive" disabled={isExpired} onClick={handleApply}>
                <ShieldAlert className="h-4 w-4 mr-2" />Confirmar y aplicar
              </Button>
            </>
          )}
          {state === "success" && <Button onClick={() => onOpenChange(false)}>Cerrar</Button>}
          {state === "error" && (
            <>
              <Button variant="outline" onClick={() => setState("select")}>Volver</Button>
              <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { RecommendationAlternative };
