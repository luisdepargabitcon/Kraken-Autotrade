import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Pause, Settings, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function BotControl() {
  const [isActive, setIsActive] = useState(true);

  return (
    <Card className="glass-panel border-border/50">
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/10">
        <CardTitle className="text-sm font-medium font-mono flex items-center justify-between">
          <span>CONTROL DEL SISTEMA</span>
          <div className="flex items-center gap-2">
            <div className={cn("h-2 w-2 rounded-full animate-pulse", isActive ? "bg-green-500" : "bg-red-500")} />
            <span className={cn("text-xs", isActive ? "text-green-500" : "text-red-500")}>
              {isActive ? "EN LÍNEA" : "DESCONECTADO"}
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Interruptor Maestro</Label>
            <p className="text-xs text-muted-foreground">Habilitar trading autónomo</p>
          </div>
          <Button
            size="sm"
            variant={isActive ? "destructive" : "default"}
            className={cn("w-24 font-mono transition-all", isActive ? "bg-red-500/10 text-red-500 border-red-500 hover:bg-red-500 hover:text-white" : "bg-green-500 text-black hover:bg-green-600")}
            onClick={() => setIsActive(!isActive)}
          >
            {isActive ? (
              <><Pause className="mr-2 h-4 w-4" /> PARAR</>
            ) : (
              <><Play className="mr-2 h-4 w-4" /> INICIAR</>
            )}
          </Button>
        </div>

        <div className="space-y-4 pt-4 border-t border-border/50">
          <div className="grid gap-2">
            <Label className="text-xs font-mono text-muted-foreground">ESTRATEGIA</Label>
            <Select defaultValue="momentum">
              <SelectTrigger className="font-mono text-xs bg-background/50 border-border">
                <SelectValue placeholder="Seleccionar estrategia" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="momentum">MOMENTUM_ALPHA_V2</SelectItem>
                <SelectItem value="grid">GRID_NEUTRAL_HFT</SelectItem>
                <SelectItem value="arbitrage">KRAKEN_ARBITRAGE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label className="text-xs font-mono text-muted-foreground">NIVEL DE RIESGO</Label>
            <Select defaultValue="medium">
              <SelectTrigger className="font-mono text-xs bg-background/50 border-border">
                <SelectValue placeholder="Seleccionar riesgo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">BAJO (Conservador)</SelectItem>
                <SelectItem value="medium">MEDIO (Equilibrado)</SelectItem>
                <SelectItem value="high">ALTO (Agresivo)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-md flex gap-3 items-start">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-yellow-500/80 leading-tight">
              Ejecutando en modo ALTA FRECUENCIA. Asegure los límites de API en Kraken para evitar bloqueos.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
