import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Layers } from "lucide-react";

interface GridLevelsPanelProps {
  levels: any[];
  mode: string;
  onGoToTab: (tab: string) => void;
}

export function GridLevelsPanel({ levels, mode, onGoToTab }: GridLevelsPanelProps) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Niveles activos
        </CardTitle>
      </CardHeader>
      <CardContent>
        {levels && levels.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2 px-2">Nivel</th>
                    <th className="text-left py-2 px-2">Lado</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-left py-2 px-2">Precio</th>
                    <th className="text-left py-2 px-2">Capital</th>
                    <th className="text-left py-2 px-2">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.slice(0, 10).map((level: any, i: number) => (
                    <tr key={level.id || i} className="border-b">
                      <td className="py-2 px-2 font-mono text-xs">#{i + 1}</td>
                      <td className="py-2 px-2">
                        <Badge variant={level.side === "BUY" ? "default" : "outline"} className="text-xs">
                          {level.side}
                        </Badge>
                      </td>
                      <td className="py-2 px-2"><Badge variant="secondary" className="text-xs">{level.status}</Badge></td>
                      <td className="py-2 px-2 font-mono">${level.price?.toFixed(2)}</td>
                      <td className="py-2 px-2 font-mono">${level.notionalUsd?.toFixed(2)}</td>
                      <td className="py-2 px-2 font-mono text-xs">{level.quantity?.toFixed(6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {levels.length > 10 && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => onGoToTab("niveles")}>
                Ver todos los {levels.length} niveles
              </Button>
            )}
          </>
        ) : (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No hay niveles activos todavía. El Grid está esperando condiciones válidas para generarlos.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
