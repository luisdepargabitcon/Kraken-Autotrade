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
import { AlertCircle, CheckCircle2, ArrowRight, Lightbulb } from "lucide-react";

export interface RecommendationAlt {
  id: "A" | "B" | "C";
  label: string;
  title: string;
  explanation: string;
  patch: Record<string, any>;
  expectedLevels: number;
  expectedRangePct: number;
  tradeoff: string;
}

interface GridRecommendationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alternatives: RecommendationAlt[];
  currentLevels: number | null;
  requestedLevels: number | null;
  onApply: (alt: RecommendationAlt) => void;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function GridRecommendationDialog({
  open,
  onOpenChange,
  alternatives,
  currentLevels,
  requestedLevels,
  onApply,
}: GridRecommendationDialogProps) {
  const [selected, setSelected] = React.useState<RecommendationAlt | null>(null);

  React.useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            Recomendaciones de configuración
          </DialogTitle>
          <DialogDescription>
            El Grid tiene {currentLevels ?? "—"} niveles activos de {requestedLevels ?? "—"} solicitados.
            Elige una alternativa para ajustar la configuración. Los cambios no se guardan hasta que pulses "Guardar cambios".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {alternatives.map((alt) => {
            const isSelected = selected?.id === alt.id;
            const isRecommended = alt.id === "C";
            return (
              <Card
                key={alt.id}
                className={`cursor-pointer transition-all ${
                  isSelected
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border/50 hover:border-border"
                }`}
                onClick={() => setSelected(alt)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={isRecommended ? "default" : "outline"}>
                        {alt.id}
                      </Badge>
                      <span className="text-sm font-medium">{alt.label}</span>
                      {isRecommended && (
                        <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
                          Recomendado
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        Niveles esperados: <span className="font-mono font-semibold text-foreground">{alt.expectedLevels}</span>
                      </span>
                      <span>
                        Rango: <span className="font-mono font-semibold text-foreground">{fmtPct(alt.expectedRangePct)}</span>
                      </span>
                    </div>
                  </div>

                  <p className="text-sm font-medium">{alt.title}</p>
                  <p className="text-sm text-muted-foreground">{alt.explanation}</p>

                  <div className="flex items-start gap-2 pt-1">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">{alt.tradeoff}</p>
                  </div>

                  {isSelected && (
                    <div className="pt-2 border-t">
                      <p className="text-xs font-medium mb-1">Cambios que se aplicarán:</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(alt.patch).map(([key, val]) => (
                          <Badge key={key} variant="outline" className="text-xs font-mono">
                            {key}: {String(val)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!selected}
            onClick={() => {
              if (selected) {
                onApply(selected);
                onOpenChange(false);
              }
            }}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Aplicar alternativa {selected?.id ?? ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
