/**
 * AmaReadinessPanel — Semáforo de readiness con traducciones al español.
 *
 * Muestra el estado de cada requisito con semáforo visual.
 * Los códigos técnicos van en tooltip/desplegable.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { translateReadinessBlocker, translateReadinessAction } from "./amaLabels";

export interface ReadinessItem {
  key: string;
  label: string;
  ready: boolean;
  blockerCode?: string;
}

interface AmaReadinessPanelProps {
  items: ReadinessItem[];
}

export function AmaReadinessPanel({ items }: AmaReadinessPanelProps) {
  const [showDetails, setShowDetails] = useState(false);
  const readyCount = items.filter((i) => i.ready).length;
  const totalCount = items.length;
  const allReady = readyCount === totalCount;

  return (
    <Card className={`border ${allReady ? "border-green-500/30" : "border-amber-500/30"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Estado de preparación
          </CardTitle>
          <Badge className={`text-xs ${allReady ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"}`}>
            {readyCount}/{totalCount} listos
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {items.map((item) => (
            <div
              key={item.key}
              className="flex items-center gap-2 p-2 rounded-md bg-muted/10 border border-border/20"
            >
              {item.ready ? (
                <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-red-400/80 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{item.label}</div>
                {!item.ready && item.blockerCode && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {translateReadinessBlocker(item.blockerCode)}
                    {translateReadinessAction(item.blockerCode) && (
                      <span className="block text-amber-400/70 mt-0.5">
                        Acción: {translateReadinessAction(item.blockerCode)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Technical details collapsible */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Detalles técnicos
        </button>
        {showDetails && (
          <div className="mt-2 p-2 rounded-md bg-muted/20 border border-border/20 text-[10px] font-mono text-muted-foreground">
            {items.map((item) => (
              <div key={item.key} className="flex justify-between py-0.5">
                <span>{item.key}</span>
                <span className={item.ready ? "text-green-400" : "text-red-400"}>
                  {item.ready ? "READY" : item.blockerCode || "NOT_READY"}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
