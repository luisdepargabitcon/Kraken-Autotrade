import { Info, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingExplanationProps {
  title: string;
  description: string;
  higherEffect: string;
  lowerEffect: string;
  riskLevel: "conservative" | "balanced" | "aggressive";
  warning?: string;
}

const riskConfig = {
  conservative: { label: "Más conservador", color: "text-green-400", icon: Minus },
  balanced: { label: "Equilibrado", color: "text-blue-400", icon: Info },
  aggressive: { label: "Más agresivo", color: "text-amber-400", icon: TrendingUp },
};

function SettingExplanation({ title, description, higherEffect, lowerEffect, riskLevel, warning }: SettingExplanationProps) {
  const risk = riskConfig[riskLevel];
  const RiskIcon = risk.icon;

  return (
    <div className="mt-1 mb-3 p-2 rounded-md bg-muted/30 border border-border/30 text-xs space-y-1">
      <p className="text-muted-foreground">{description}</p>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-start gap-1">
          <TrendingUp className="h-3 w-3 mt-0.5 text-green-400 shrink-0" />
          <span className="text-muted-foreground">Si subes: <span className="text-foreground">{higherEffect}</span></span>
        </div>
        <div className="flex items-start gap-1">
          <TrendingDown className="h-3 w-3 mt-0.5 text-blue-400 shrink-0" />
          <span className="text-muted-foreground">Si bajas: <span className="text-foreground">{lowerEffect}</span></span>
        </div>
      </div>
      <div className="flex items-center gap-1 pt-1 border-t border-border/20">
        <RiskIcon className={cn("h-3 w-3", risk.color)} />
        <span className={risk.color}>{risk.label}</span>
      </div>
      {warning && (
        <div className="flex items-start gap-1 pt-1 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{warning}</span>
        </div>
      )}
    </div>
  );
}

export function GridSettingsExplained({ config }: { config: any }) {
  const profile = config?.capitalProfile || "balanced";
  const targetPct = config?.netProfitTargetPct ?? 0.8;
  const stepMin = config?.gridStepMinPct ?? 0.15;
  const stepMax = config?.gridStepMaxPct ?? 3.0;
  const ratioMax = config?.geometricRatioMax ?? 1.2;
  const maxCycles = config?.maxOpenCycles ?? 10;
  const bandPeriod = config?.bandPeriod ?? 20;
  const atrTimeframe = config?.atrTimeframe || "1h";

  const profileLabel = profile === "conservative" ? "conservador" : profile === "aggressive" ? "agresivo" : "balanceado";

  return (
    <div className="space-y-3">
      <SettingExplanation
        title="Perfil de Capital"
        description="Define cuánto capital reserva el Grid y cuánto margen deja libre."
        higherEffect="Más capital expuesto al mercado, más actividad y más riesgo."
        lowerEffect="Menos exposición, más capital en reserva, menos actividad."
        riskLevel={profile === "conservative" ? "conservative" : profile === "aggressive" ? "aggressive" : "balanced"}
      />
      <SettingExplanation
        title="Timeframe ATR"
        description="El ATR mide volatilidad y ayuda a calcular la distancia entre niveles."
        higherEffect="Timeframe largo = más estabilidad y reacción más lenta a cambios de volatilidad."
        lowerEffect="Timeframe corto = más sensibilidad y más ruido en los niveles."
        riskLevel="balanced"
      />
      <SettingExplanation
        title="Periodo de Bandas Bollinger"
        description="Define cuántas velas usa el Grid para calcular la banda/rango."
        higherEffect="Mayor periodo = banda más estable, cambia con menos frecuencia."
        lowerEffect="Menor periodo = banda cambia más rápido, más recálculos de niveles."
        riskLevel="balanced"
      />
      <SettingExplanation
        title="Máx Ciclos Abiertos"
        description="Limita cuántos ciclos Grid pueden estar abiertos al mismo tiempo."
        higherEffect="Más ciclos = más actividad y más capital expuesto simultáneamente."
        lowerEffect="Menos ciclos = más control, menos capital en riesgo a la vez."
        riskLevel={maxCycles > 10 ? "aggressive" : maxCycles < 5 ? "conservative" : "balanced"}
      />
      <SettingExplanation
        title="Step Mín %"
        description="Distancia mínima entre niveles del Grid."
        higherEffect="Más alto = menos operaciones pero más margen por operación."
        lowerEffect="Más bajo = niveles más juntos y más operaciones posibles."
        riskLevel={stepMin < 0.15 ? "aggressive" : stepMin > 0.3 ? "conservative" : "balanced"}
        warning="No debe quedar por debajo de fees, spread y reserva fiscal."
      />
      <SettingExplanation
        title="Step Máx %"
        description="Distancia máxima entre niveles del Grid."
        higherEffect="Más alto = niveles más separados en extremos, menos operaciones en zonas alejadas."
        lowerEffect="Más bajo = niveles más uniformes, más operaciones en todo el rango."
        riskLevel="balanced"
      />
      <SettingExplanation
        title="Ratio Geométrico Máx"
        description="Controla cuánto pueden variar los niveles hacia los extremos de la banda."
        higherEffect="Más alto = niveles más progresivos y menos lineales hacia los extremos."
        lowerEffect="Cerca de 1 = niveles más uniformes y equidistantes."
        riskLevel={ratioMax > 1.5 ? "aggressive" : "balanced"}
      />
      <SettingExplanation
        title="Target Neto"
        description="Beneficio neto mínimo objetivo después de costes estimados (fees + reserva fiscal)."
        higherEffect="Más alto = menos cierres pero mayor beneficio por ciclo completado."
        lowerEffect="Más bajo = cierres más fáciles con menor beneficio por ciclo."
        riskLevel={targetPct < 0.5 ? "aggressive" : targetPct > 1.5 ? "conservative" : "balanced"}
      />
      <div className="p-3 rounded-md bg-blue-500/5 border border-blue-500/20 text-sm">
        <p className="text-blue-600 dark:text-blue-400">
          <strong>Resumen interpretativo:</strong> Con esta configuración, el Grid tenderá a ser <strong>{profileLabel}</strong> porque
          {profile === "conservative" && " reserva más capital y busca menos exposición."}
          {profile === "balanced" && " equilibria actividad y control de riesgo."}
          {profile === "aggressive" && " maximiza actividad y exposición al mercado."}
          {" "}El target neto es {targetPct.toFixed(2)}%, el step mínimo es {stepMin.toFixed(2)}% y el máximo {stepMax.toFixed(2)}%.
        </p>
      </div>
    </div>
  );
}
