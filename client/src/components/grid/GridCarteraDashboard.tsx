import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wallet, TrendingUp, TrendingDown, Shield, DollarSign, Percent, PiggyBank, Activity, Lock, Settings2, ShoppingCart, ArrowUpCircle, Info, BarChart2, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface GridCarteraDashboardProps {
  config: any;
  status: any;
  auditData?: any;
  onConfigChange: (key: string, value: any) => void;
  onConfirmChange: (key: string, label: string, oldValue: any, newValue: any, impact: string, riskLevel: "low" | "medium" | "high", affectsCurrent: boolean, requiresRecalc: boolean) => void;
}

export function GridCarteraDashboard({ config, status, auditData, onConfigChange, onConfirmChange }: GridCarteraDashboardProps) {
  const [showPerLevel, setShowPerLevel] = useState(false);
  const capitalSummary = auditData?.levelsSummary?.capitalAllocationSummary;
  const total = (config?.gridWalletInitialUsd || 1000) + (status?.totalNetPnlUsd || 0);
  const reserved = status?.capitalReservedUsd || 0;
  const free = total - reserved;
  const max = config?.gridWalletMaxUsd || 5000;
  const pnl = status?.totalNetPnlUsd || 0;
  const usedPct = max > 0 ? (reserved / max) * 100 : 0;
  const freePct = total > 0 ? (free / total) * 100 : 0;
  const perCycleUsd = config?.gridMaxCapitalPerCycleUsd || 600;
  const perCyclePct = config?.gridMaxCapitalPerCyclePct || 60;
  const reservePct = config?.gridReservePct || 20;
  const minFree = config?.gridMinFreeCapitalUsd || 50;

  const cards = [
    {
      icon: Wallet,
      title: "Capital Total",
      value: `$${total.toFixed(2)}`,
      sub: `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} PnL`,
      color: pnl >= 0 ? "text-green-400" : "text-red-400",
      bg: "from-blue-500/10 to-card",
      border: "border-blue-500/20",
    },
    {
      icon: TrendingUp,
      title: "Capital Libre",
      value: `$${free.toFixed(2)}`,
      sub: `${freePct.toFixed(1)}% del total`,
      color: freePct < 10 ? "text-red-400" : freePct < 25 ? "text-amber-400" : "text-green-400",
      bg: "from-green-500/10 to-card",
      border: "border-green-500/20",
    },
    {
      icon: Lock,
      title: "Capital Reservado",
      value: `$${reserved.toFixed(2)}`,
      sub: `${usedPct.toFixed(1)}% del máximo`,
      color: usedPct > 80 ? "text-red-400" : usedPct > 50 ? "text-amber-400" : "text-blue-400",
      bg: "from-amber-500/10 to-card",
      border: "border-amber-500/20",
    },
    {
      icon: Activity,
      title: "PnL Acumulado",
      value: `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
      sub: `${status?.totalCyclesCompleted || 0} ciclos completados`,
      color: pnl >= 0 ? "text-green-400" : "text-red-400",
      bg: pnl >= 0 ? "from-green-500/10 to-card" : "from-red-500/10 to-card",
      border: pnl >= 0 ? "border-green-500/20" : "border-red-500/20",
    },
    {
      icon: DollarSign,
      title: "Máximo por Ciclo",
      value: `$${perCycleUsd.toFixed(0)}`,
      sub: `${perCyclePct}% de la cartera`,
      color: perCyclePct > 80 ? "text-red-400" : perCyclePct > 60 ? "text-amber-400" : "text-green-400",
      bg: "from-purple-500/10 to-card",
      border: "border-purple-500/20",
    },
    {
      icon: PiggyBank,
      title: "Reserva de Seguridad",
      value: `${reservePct}%`,
      sub: `$${(total * reservePct / 100).toFixed(0)} reservado`,
      color: reservePct < 10 ? "text-red-400" : reservePct < 20 ? "text-amber-400" : "text-green-400",
      bg: "from-cyan-500/10 to-card",
      border: "border-cyan-500/20",
    },
  ];

  return (
    <div className="space-y-4">

      {/* ─── Reparto real de capital del Grid ─────────────────── */}
      {capitalSummary ? (
        <Card className="border-indigo-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-indigo-400" />
              Reparto real de capital del Grid
              <Badge variant="outline" className="text-xs font-mono ml-auto">
                {capitalSummary.allocationMode?.replace(/_/g, " ") ?? "uniform"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* BUY vs SELL cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <ShoppingCart className="h-3.5 w-3.5 text-green-400" />
                  <span className="text-xs text-muted-foreground">BUY — USD real</span>
                </div>
                <p className="text-xl font-bold text-green-400">${capitalSummary.plannedBuyUsd?.toFixed(2) ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-1">{capitalSummary.buyLevelsCount ?? 0} niveles × USD real</p>
              </div>
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowUpCircle className="h-3.5 w-3.5 text-blue-400" />
                  <span className="text-xs text-muted-foreground">SELL — notional visual</span>
                </div>
                <p className="text-xl font-bold text-blue-400">${capitalSummary.plannedSellNotionalUsd?.toFixed(2) ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-1">{capitalSummary.sellLevelsCount ?? 0} niveles × BTC/inventario</p>
              </div>
            </div>

            {/* Budget utilization */}
            {(capitalSummary.maxBudgetReferenceUsd ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Presupuesto BUY usado</span>
                  <span className="font-bold font-mono text-green-400">{(capitalSummary.budgetUsedPct ?? 0).toFixed(1)}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${Math.min(capitalSummary.budgetUsedPct ?? 0, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>$0</span>
                  <span>${(capitalSummary.plannedBuyUsd ?? 0).toFixed(0)} usados</span>
                  <span>${(capitalSummary.maxBudgetReferenceUsd ?? 0).toFixed(0)} máx</span>
                </div>
              </div>
            )}

            {/* Explanation */}
            <div className="rounded-md bg-indigo-500/10 border border-indigo-500/20 p-3 text-sm text-indigo-200">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-indigo-400" />
                <p>{capitalSummary.allocationExplanation}</p>
              </div>
            </div>

            {/* Budget unused reason */}
            {capitalSummary.budgetUnusedUsd > 1 && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-200">
                <span className="font-semibold">Por qué no se usa todo el presupuesto:</span>{" "}
                {capitalSummary.budgetUnusedReason}
              </div>
            )}

            {/* Per-level toggle */}
            {(capitalSummary.perLevelAllocations?.length ?? 0) > 0 && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setShowPerLevel(v => !v)}
                >
                  {showPerLevel ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                  {showPerLevel ? "Ocultar" : "Ver"} detalle por nivel BUY
                </Button>
                {showPerLevel && (
                  <div className="mt-2 rounded-lg border border-border/50 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="px-3 py-2 text-left">Nivel</th>
                          <th className="px-3 py-2 text-right">Peso</th>
                          <th className="px-3 py-2 text-right">Capital USD</th>
                          <th className="px-3 py-2 text-left hidden md:table-cell">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {capitalSummary.perLevelAllocations.map((lvl: any, i: number) => (
                          <tr key={i} className="border-t border-border/30 hover:bg-muted/10">
                            <td className="px-3 py-1.5 font-mono">BUY {lvl.levelIndex + 1}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{(lvl.weight ?? 1).toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-green-400">${(lvl.allocationUsd ?? 0).toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-muted-foreground hidden md:table-cell">{lvl.allocationReason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Visual cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <div key={i} className={`rounded-xl border ${c.border} bg-gradient-to-br ${c.bg} p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{c.title}</p>
              </div>
              <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Usage progress bar */}
      <Card className="border-border/50">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Uso de cartera</span>
            <span className={`font-mono font-bold text-sm ${usedPct > 80 ? "text-red-500" : usedPct > 50 ? "text-amber-500" : "text-green-500"}`}>
              {usedPct.toFixed(1)}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-muted/30 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${usedPct > 80 ? "bg-red-500" : usedPct > 50 ? "bg-amber-500" : "bg-green-500"}`}
              style={{ width: `${Math.min(usedPct, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>$0</span>
            <span>${reserved.toFixed(0)} reservado</span>
            <span>${max.toFixed(0)} máximo</span>
          </div>
        </CardContent>
      </Card>

      {/* Configuration controls */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Configuración de Capital
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Mode selector */}
          <div className="space-y-2">
            <Label className="text-sm">Modo de asignación de capital</Label>
            <Select
              value={config?.gridWalletMode || "automatic"}
              onValueChange={(v) => onConfirmChange("gridWalletMode", "Modo de asignación", config?.gridWalletMode || "automatic", v, "Cambia cómo el sistema asigna capital a cada ciclo.", "low", false, false)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="automatic">Automático (recomendado)</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {config?.gridWalletMode === "manual"
                ? "Tú fijas cuánto capital máximo puede usar cada ciclo."
                : "El sistema decide cuánto capital asignar según volatilidad, distancia entre niveles y riesgo."}
            </p>
          </div>

          {/* Allocation mode selector */}
          <div className="space-y-2 pt-2 border-t">
            <Label className="text-sm font-medium">Modo de reparto de capital</Label>
            <Select
              value={config?.gridAllocationMode || "uniform"}
              onValueChange={(v) => onConfirmChange("gridAllocationMode", "Modo de reparto", config?.gridAllocationMode || "uniform", v, "Cambia cómo se distribuye el presupuesto BUY entre los niveles. No afecta niveles SELL (solo BTC).", "low", false, true)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="uniform">Uniforme — igual capital por nivel BUY</SelectItem>
                <SelectItem value="progressive_conservative">Progresivo conservador — más en niveles profundos</SelectItem>
                <SelectItem value="progressive_aggressive">Progresivo agresivo — fuerte concentración profunda</SelectItem>
                <SelectItem value="adaptive_market">Adaptativo por mercado — pesos por distancia/régimen</SelectItem>
              </SelectContent>
            </Select>
            {config?.gridAllocationMode === "progressive_conservative" || config?.gridAllocationMode === "progressive_aggressive" ? (
              <ConfigSlider
                label="Intensidad progresiva"
                value={config?.gridProgressiveIntensity ?? 0.30}
                min={0.05}
                max={0.80}
                step={0.05}
                displayValue={`+${((config?.gridProgressiveIntensity ?? 0.30) * 100).toFixed(0)}% / nivel`}
                colorClass={(config?.gridProgressiveIntensity ?? 0.30) > 0.60 ? "red" : (config?.gridProgressiveIntensity ?? 0.30) > 0.40 ? "orange" : "green"}
                explanation="Incremento porcentual adicional por cada nivel más profundo."
                onChange={(v) => onConfirmChange("gridProgressiveIntensity", "Intensidad progresiva", config?.gridProgressiveIntensity ?? 0.30, v, "Más intensidad = mayor diferencia entre primer y último nivel BUY.", "low", false, true)}
                onDirectChange={(v) => onConfigChange("gridProgressiveIntensity", v)}
              />
            ) : null}
            <p className="text-sm text-muted-foreground">
              {config?.gridAllocationMode === "progressive_conservative" && "Los niveles BUY más profundos reciben algo más de capital. Favorece entradas escalonadas con coste promedio decreciente."}
              {config?.gridAllocationMode === "progressive_aggressive" && "Fuerte concentración de capital en niveles profundos. Mayor potencial, mayor exposición si el precio sigue bajando."}
              {config?.gridAllocationMode === "adaptive_market" && "El capital se reparte según distancia al precio actual y régimen de mercado. Más dinámico y reactivo."}
              {(!config?.gridAllocationMode || config?.gridAllocationMode === "uniform") && "Capital igual para todos los niveles BUY. Sencillo, predecible y fácil de auditar."}
            </p>
          </div>

          {/* Deployment mode */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Modo de uso del presupuesto</Label>
            <Select
              value={config?.gridCapitalDeploymentMode || "capped"}
              onValueChange={(v) => onConfirmChange("gridCapitalDeploymentMode", "Modo de uso", config?.gridCapitalDeploymentMode || "capped", v, "Cambia si el grid intenta gastar todo el presupuesto o solo hasta el límite.", "low", false, true)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="capped">Conservador (capped) — hasta el máximo, sin forzar todo</SelectItem>
                <SelectItem value="target_budget">Presupuesto objetivo — intenta usar todo el máximo</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {config?.gridCapitalDeploymentMode === "target_budget"
                ? "El grid intenta aproximarse al presupuesto máximo configurado. El capital no usado es mínimo."
                : "El grid usa hasta el máximo pero no se fuerza a gastar todo. El sobrante queda como reserva."}
            </p>
          </div>

          {/* Capital inicial slider */}
          <ConfigSlider
            label="Capital inicial cartera Grid"
            value={config?.gridWalletInitialUsd ?? 1000}
            min={0}
            max={config?.gridWalletMaxUsd || 5000}
            step={50}
            displayValue={`$${(config?.gridWalletInitialUsd || 1000).toFixed(0)}`}
            colorClass={(config?.gridWalletInitialUsd || 1000) > (config?.gridWalletMaxUsd || 5000) * 0.8 ? "red" : (config?.gridWalletInitialUsd || 1000) > (config?.gridWalletMaxUsd || 5000) * 0.5 ? "orange" : "green"}
            explanation="Capital inicial que el Grid puede usar."
            onChange={(v) => onConfirmChange("gridWalletInitialUsd", "Capital inicial", config?.gridWalletInitialUsd ?? 1000, v, "Cambia el capital disponible para el Grid. Más capital = más actividad pero más riesgo.", "medium", false, false)}
            onDirectChange={(v) => onConfigChange("gridWalletInitialUsd", v)}
          />

          {/* Cartera máxima slider */}
          <ConfigSlider
            label="Cartera máxima Grid"
            value={config?.gridWalletMaxUsd ?? 5000}
            min={0}
            max={50000}
            step={100}
            displayValue={`$${(config?.gridWalletMaxUsd || 5000).toFixed(0)}`}
            colorClass={(config?.gridWalletMaxUsd || 5000) > 20000 ? "red" : (config?.gridWalletMaxUsd || 5000) > 10000 ? "orange" : "green"}
            explanation="Límite máximo de capital que la cartera Grid puede alcanzar."
            onChange={(v) => onConfirmChange("gridWalletMaxUsd", "Cartera máxima", config?.gridWalletMaxUsd ?? 5000, v, "Cambia el techo de capital del Grid. Solo afecta a futuros ciclos.", "medium", false, false)}
            onDirectChange={(v) => onConfigChange("gridWalletMaxUsd", v)}
          />

          {/* Capital max por ciclo USD */}
          <ConfigSlider
            label="Capital máximo por ciclo (USD)"
            value={config?.gridMaxCapitalPerCycleUsd ?? 600}
            min={0}
            max={config?.gridWalletMaxUsd || 5000}
            step={50}
            displayValue={`$${(config?.gridMaxCapitalPerCycleUsd || 600).toFixed(0)}`}
            colorClass={(config?.gridMaxCapitalPerCycleUsd || 600) > (config?.gridWalletMaxUsd || 5000) * 0.5 ? "red" : (config?.gridMaxCapitalPerCycleUsd || 600) > (config?.gridWalletMaxUsd || 5000) * 0.3 ? "orange" : "green"}
            explanation="Cuánto capital puede usar un solo ciclo como máximo."
            onChange={(v) => onConfirmChange("gridMaxCapitalPerCycleUsd", "Capital por ciclo (USD)", config?.gridMaxCapitalPerCycleUsd ?? 600, v, "Más capital por ciclo = más exposición individual.", "high", true, false)}
            onDirectChange={(v) => onConfigChange("gridMaxCapitalPerCycleUsd", v)}
          />

          {/* Capital max por ciclo % */}
          <ConfigSlider
            label="Capital máximo por ciclo (%)"
            value={config?.gridMaxCapitalPerCyclePct ?? 60}
            min={0}
            max={100}
            step={5}
            displayValue={`${config?.gridMaxCapitalPerCyclePct ?? 60}%`}
            colorClass={(config?.gridMaxCapitalPerCyclePct || 60) > 80 ? "red" : (config?.gridMaxCapitalPerCyclePct || 60) > 60 ? "orange" : "green"}
            explanation="Porcentaje máximo de la cartera que un ciclo puede usar."
            onChange={(v) => onConfirmChange("gridMaxCapitalPerCyclePct", "Capital por ciclo (%)", config?.gridMaxCapitalPerCyclePct ?? 60, v, "Más % = más concentración de riesgo en un solo ciclo.", "high", true, false)}
            onDirectChange={(v) => onConfigChange("gridMaxCapitalPerCyclePct", v)}
          />

          {/* Reserva % */}
          <ConfigSlider
            label="Reserva de seguridad (%)"
            value={config?.gridReservePct ?? 20}
            min={0}
            max={80}
            step={5}
            displayValue={`${config?.gridReservePct ?? 20}%`}
            colorClass={(config?.gridReservePct || 20) < 10 ? "red" : (config?.gridReservePct || 20) < 20 ? "orange" : "green"}
            explanation="Porcentaje de cartera que se mantiene libre como colchón."
            onChange={(v) => onConfirmChange("gridReservePct", "Reserva de seguridad", config?.gridReservePct ?? 20, v, "Menos reserva = más capital disponible pero menos protección.", "medium", false, false)}
            onDirectChange={(v) => onConfigChange("gridReservePct", v)}
          />

          {/* Capital libre mínimo */}
          <ConfigSlider
            label="Capital libre mínimo (USD)"
            value={config?.gridMinFreeCapitalUsd ?? 50}
            min={0}
            max={config?.gridWalletInitialUsd || 1000}
            step={10}
            displayValue={`$${(config?.gridMinFreeCapitalUsd || 50).toFixed(0)}`}
            colorClass="blue"
            explanation="Capital mínimo que debe quedar libre antes de pausar nuevos ciclos."
            onChange={(v) => onConfirmChange("gridMinFreeCapitalUsd", "Capital libre mínimo", config?.gridMinFreeCapitalUsd ?? 50, v, "Más alto = el Grid se pausa antes cuando hay menos capital libre.", "low", false, false)}
            onDirectChange={(v) => onConfigChange("gridMinFreeCapitalUsd", v)}
          />

          {/* Switches */}
          <div className="space-y-3 pt-4 border-t">
            <ConfigSwitch
              label="Reinvertir ganancias del Grid"
              description="Las ganancias cerradas se suman a la cartera y pueden usarse en próximos ciclos."
              checked={config?.gridWalletCompoundProfits ?? true}
              onChange={(v) => onConfigChange("gridWalletCompoundProfits", v)}
            />
            <ConfigSwitch
              label="Pausar ciclo si capital agotado"
              description="Si un ciclo usa todo el capital asignado, queda pausado."
              checked={config?.gridPauseCycleWhenCapitalDepleted ?? true}
              onChange={(v) => onConfigChange("gridPauseCycleWhenCapitalDepleted", v)}
            />
            <ConfigSwitch
              label="Permitir nuevo ciclo con capital libre"
              description="Si hay capital libre, el sistema puede abrir otro ciclo aislado."
              checked={config?.gridAllowNewCycleWhenCapitalFree ?? true}
              onChange={(v) => onConfigChange("gridAllowNewCycleWhenCapitalFree", v)}
            />
          </div>

          {/* Preview summary */}
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-4 text-sm">
            <p className="text-blue-700 dark:text-blue-300">
              Con esta configuración, el Grid tendrá una cartera máxima de <strong>${(config?.gridWalletMaxUsd || 5000).toFixed(0)}</strong>,
              empezará usando <strong>${(config?.gridWalletInitialUsd || 1000).toFixed(0)}</strong>,
              reservará un <strong>{config?.gridReservePct || 20}%</strong> como colchón
              y no asignará más de <strong>${(config?.gridMaxCapitalPerCycleUsd || 600).toFixed(0)}</strong>
              {" "}o <strong>{config?.gridMaxCapitalPerCyclePct || 60}%</strong> a un ciclo individual.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onConfigChange("gridWalletMode", "automatic")}
            >
              Restaurar perfil automático
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helper components ──────────────────────────────────────

function ConfigSlider({ label, value, min, max, step, displayValue, colorClass, explanation, onChange, onDirectChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  colorClass: "red" | "orange" | "green" | "blue";
  explanation: string;
  onChange: (v: number) => void;
  onDirectChange: (v: number) => void;
}) {
  const colorMap = {
    red: "text-red-400",
    orange: "text-amber-400",
    green: "text-green-400",
    blue: "text-blue-400",
  };
  const sliderColorMap = {
    red: "[&_[role=slider]]:bg-red-500",
    orange: "[&_[role=slider]]:bg-orange-500",
    green: "[&_[role=slider]]:bg-green-500",
    blue: "[&_[role=slider]]:bg-blue-500",
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className={`text-lg font-bold font-mono ${colorMap[colorClass]}`}>{displayValue}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className={sliderColorMap[colorClass]}
      />
      <p className="text-sm text-muted-foreground">{explanation}</p>
    </div>
  );
}

function ConfigSwitch({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex-1">
        <Label className="text-sm">{label}</Label>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
