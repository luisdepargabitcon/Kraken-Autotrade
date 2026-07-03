import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, CheckCircle2 } from "lucide-react";

export function GridExecutionPolicyPanel() {
  const items = [
    "3 intentos maker con post_only",
    "4º intento allow_taker controlado",
    "Fallback con slippage y fee-aware",
    "Auditoría obligatoria de fallback",
    "Requiere beneficio neto suficiente",
  ];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4" />
          Política de ejecución
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg bg-muted/30 p-3 text-sm">
          <p className="font-semibold">3 intentos maker + 4º taker controlado</p>
        </div>
        <div className="space-y-1.5">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
