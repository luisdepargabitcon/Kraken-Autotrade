import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GridExecutionPolicyPanel } from "./GridExecutionPolicyPanel";
import { GridCarteraDashboard } from "./GridCarteraDashboard";
import { GridMonitorPanel } from "./GridMonitorPanel";
import { Settings2, Shield, Cpu, FlaskConical, Zap, Zap as ZapIcon, CheckCircle2, XCircle, AlertCircle, AlertTriangle, TrendingUp, TrendingDown, Activity, ScrollText, Wallet } from "lucide-react";

interface GridAjustesPanelProps {
  config: any;
  status: any;
  auditData?: any;
  unlockCheck: any;
  onConfigChange: (key: string, value: any) => void;
  onConfirmChange: (key: string, label: string, oldValue: any, newValue: any, impact: string, riskLevel: "low" | "medium" | "high", affectsCurrent: boolean, requiresRecalc: boolean) => void;
  onReconcile: () => void;
  reconcilePending: boolean;
  showHodlConfirm: boolean;
  setShowHodlConfirm: (v: boolean) => void;
}

export function GridAjustesPanel({
  config, status, auditData, unlockCheck, onConfigChange, onConfirmChange,
  onReconcile, reconcilePending, showHodlConfirm, setShowHodlConfirm,
}: GridAjustesPanelProps) {
  const [subTab, setSubTab] = useState("general");

  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 gap-1 h-auto p-1">
          <TabsTrigger value="general" className="text-sm">General</TabsTrigger>
          <TabsTrigger value="cartera" className="text-sm">Cartera</TabsTrigger>
          <TabsTrigger value="ejecucion" className="text-sm">Ejecución</TabsTrigger>
          <TabsTrigger value="riesgo" className="text-sm">Riesgo</TabsTrigger>
          <TabsTrigger value="avanzado" className="text-sm">Avanzado</TabsTrigger>
          <TabsTrigger value="auditoria" className="text-sm">Auditoría</TabsTrigger>
        </TabsList>

        {/* ─── General ─────────────────────────────── */}
        <TabsContent value="general" className="space-y-4">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Parámetros Generales
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Perfil de Capital — segmented control visual */}
              <div className="space-y-2">
                <Label className="text-sm">Perfil de Capital</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: "conservative", label: "Conservador", sub: "30% reserva", color: "green" },
                    { v: "balanced", label: "Balanceado", sub: "20% reserva", color: "amber" },
                    { v: "aggressive", label: "Agresivo", sub: "10% reserva", color: "red" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      onClick={() => onConfirmChange("capitalProfile", "Perfil de capital", config?.capitalProfile || "balanced", opt.v, "Cambia el perfil de riesgo del Grid.", "medium", false, false)}
                      className={`rounded-lg border p-3 text-center transition-all ${
                        (config?.capitalProfile || "balanced") === opt.v
                          ? `border-${opt.color}-500/50 bg-${opt.color}-500/10 text-foreground`
                          : "border-border/50 bg-muted/10 text-muted-foreground hover:bg-muted/20"
                      }`}
                    >
                      <p className="text-sm font-semibold">{opt.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.sub}</p>
                    </button>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">Define cómo el Grid balancea exposición y reserva.</p>
              </div>

              {/* Periodo Bollinger — slider con display visual */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Periodo de Bandas (Bollinger)</Label>
                  <span className="text-lg font-bold text-blue-400 font-mono">{config?.bandPeriod || 20}</span>
                </div>
                <Slider
                  value={[config?.bandPeriod || 20]}
                  min={5}
                  max={100}
                  step={1}
                  onValueChange={(v) => onConfirmChange("bandPeriod", "Periodo Bollinger", config?.bandPeriod || 20, v[0], "Cambia cuántas velas usa el Grid para calcular bandas.", "low", false, true)}
                  className="[&_[role=slider]]:bg-blue-500"
                />
                <p className="text-sm text-muted-foreground">Mayor periodo = banda más estable. Menor = más reactiva.</p>
              </div>

              {/* ATR Timeframe — segmented control */}
              <div className="space-y-2">
                <Label className="text-sm">Timeframe ATR</Label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { v: "15min", label: "15 min" },
                    { v: "1h", label: "1 hora" },
                    { v: "4h", label: "4 horas" },
                    { v: "1d", label: "1 día" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      onClick={() => onConfirmChange("atrTimeframe", "Timeframe ATR", config?.atrTimeframe || "1h", opt.v, "Cambia la sensibilidad del cálculo de volatilidad.", "low", false, true)}
                      className={`rounded-lg border p-2.5 text-center text-sm transition-all ${
                        (config?.atrTimeframe || "1h") === opt.v
                          ? "border-blue-500/50 bg-blue-500/10 text-foreground font-semibold"
                          : "border-border/50 bg-muted/10 text-muted-foreground hover:bg-muted/20"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">Timeframe largo = más estabilidad. Corto = más sensibilidad.</p>
              </div>

              {/* Máx Ciclos — slider con display visual */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Máx Ciclos Abiertos</Label>
                  <span className={`text-lg font-bold font-mono ${(config?.maxOpenCycles || 10) > 20 ? "text-red-400" : (config?.maxOpenCycles || 10) > 10 ? "text-amber-400" : "text-green-400"}`}>{config?.maxOpenCycles || 10}</span>
                </div>
                <Slider
                  value={[config?.maxOpenCycles || 10]}
                  min={1}
                  max={50}
                  step={1}
                  onValueChange={(v) => onConfirmChange("maxOpenCycles", "Máx ciclos abiertos", config?.maxOpenCycles || 10, v[0], "Más ciclos = más capital expuesto simultáneamente.", "high", true, false)}
                  className={(config?.maxOpenCycles || 10) > 20 ? "[&_[role=slider]]:bg-red-500" : (config?.maxOpenCycles || 10) > 10 ? "[&_[role=slider]]:bg-amber-500" : "[&_[role=slider]]:bg-green-500"}
                />
                <p className="text-sm text-muted-foreground">Limita cuántos ciclos pueden estar abiertos a la vez.</p>
              </div>

              {/* Máx órdenes diarias — slider con display visual */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Máx Órdenes Diarias</Label>
                  <span className="text-lg font-bold text-purple-400 font-mono">{config?.maxDailyOrders || 300}</span>
                </div>
                <Slider
                  value={[config?.maxDailyOrders || 300]}
                  min={10}
                  max={1000}
                  step={10}
                  onValueChange={(v) => onConfigChange("maxDailyOrders", v[0])}
                  className="[&_[role=slider]]:bg-purple-500"
                />
                <p className="text-sm text-muted-foreground">Límite de seguridad para evitar exceso de actividad.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Cartera ────────────────────────────── */}
        <TabsContent value="cartera" className="space-y-4">
          <GridCarteraDashboard
            config={config}
            status={status}
            auditData={auditData}
            onConfigChange={onConfigChange}
            onConfirmChange={onConfirmChange}
          />
        </TabsContent>

        {/* ─── Ejecución ──────────────────────────── */}
        <TabsContent value="ejecucion" className="space-y-4">
          <GridExecutionPolicyPanel
            config={config}
            onConfigChange={onConfigChange}
          />
          {/* Revolut X status */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ZapIcon className="h-4 w-4" />
                Estado Revolut X
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  {unlockCheck?.postOnlySupported ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                  <span>Post-only soportado</span>
                </div>
                <div className="flex items-center gap-2">
                  {unlockCheck?.postOnlySupported ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                  <span>Allow-taker soportado</span>
                </div>
              </div>
              {unlockCheck?.postOnlySupported && (
                <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">
                  Revolut X documenta post_only y allow_taker. El adaptador interno envía executionInstruction correctamente.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Riesgo ─────────────────────────────── */}
        <TabsContent value="riesgo" className="space-y-4">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Configuración de Riesgo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* HODL vs Stop explanation box */}
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 space-y-3">
                <h3 className="text-base font-semibold flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4" />
                  Cómo interactúan HODL Recovery y Stop Loss
                </h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p><strong className="text-foreground">Prioridad de evaluación:</strong> HODL Recovery se evalúa primero. Si está activo, el sistema mantiene la posición hasta que el precio recupere break-even.</p>
                  <p><strong className="text-foreground">Stop Loss Soft (-2%):</strong> Si HODL Recovery está ON, el soft stop <strong className="text-green-500">activa HODL</strong> (no vende). Si está OFF, vende inmediatamente.</p>
                  <p><strong className="text-foreground">Stop Loss Hard (-5%):</strong> <strong className="text-red-500">Vende siempre</strong>, incluso con HODL activo. Override forzado.</p>
                  <p><strong className="text-foreground">Stop Loss Emergency (-10%):</strong> <strong className="text-red-500">Vende siempre</strong>, override total. Cierra todo.</p>
                  <p><strong className="text-foreground">¿Para qué sirve el slider Stop con HODL ON?</strong> El Stop Soft define cuándo se activa HODL. El Hard y Emergency definen cuándo se fuerza la venta aunque HODL esté activo.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
                  <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3 text-sm">
                    <p className="font-semibold text-green-600 dark:text-green-400 mb-1">Estado actual</p>
                    <p className="text-sm text-muted-foreground">HODL Recovery: <strong className={config?.hodlRecoveryEnabled ? "text-green-500" : "text-red-500"}>{config?.hodlRecoveryEnabled ? "ON" : "OFF"}</strong></p>
                    <p className="text-sm text-muted-foreground">Stop Soft: <strong>{config?.stopLossSoftPct?.toFixed(1)}%</strong></p>
                    <p className="text-sm text-muted-foreground">Stop Hard: <strong>{config?.stopLossHardPct?.toFixed(1)}%</strong></p>
                    <p className="text-sm text-muted-foreground">Stop Emergency: <strong>{config?.stopLossEmergencyPct?.toFixed(1)}%</strong></p>
                  </div>
                  <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 text-sm">
                    <p className="font-semibold text-blue-600 dark:text-blue-400 mb-1">Efecto real</p>
                    <p className="text-sm text-muted-foreground">
                      {config?.hodlRecoveryEnabled
                        ? "Con HODL ON: el soft stop activa recuperación. El hard y emergency fuerzan venta."
                        : "Con HODL OFF: cualquier stop loss vende inmediatamente."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Trailing Protection */}
              <div className="space-y-3">
                <h3 className="text-base font-semibold">Trailing Protection</h3>
                <p className="text-sm text-muted-foreground">Activa un stop dinámico cuando el precio sube por encima de la activación.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Activación: {config?.trailingActivationPct?.toFixed(2)}%</Label>
                    <Slider
                      value={[config?.trailingActivationPct || 1.0]}
                      min={0.5}
                      max={5.0}
                      step={0.1}
                      onValueChange={(v) => onConfirmChange("trailingActivationPct", "Trailing activación", config?.trailingActivationPct || 1.0, v[0], "A qué % de beneficio se activa el trailing.", "medium", true, false)}
                    />
                    <p className="text-sm text-muted-foreground"><TrendingUp className="inline h-3 w-3 text-green-400" /> Subes: trailing más tardío. <TrendingDown className="inline h-3 w-3 text-blue-400" /> Bajas: más protector.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Stop: {config?.trailingStopPct?.toFixed(2)}%</Label>
                    <Slider
                      value={[config?.trailingStopPct || 0.4]}
                      min={0.1}
                      max={2.0}
                      step={0.1}
                      onValueChange={(v) => onConfirmChange("trailingStopPct", "Trailing stop", config?.trailingStopPct || 0.4, v[0], "Distancia del trailing stop desde el precio máximo.", "medium", true, false)}
                    />
                    <p className="text-sm text-muted-foreground"><TrendingUp className="inline h-3 w-3 text-green-400" /> Subes: más margen. <TrendingDown className="inline h-3 w-3 text-blue-400" /> Bajas: más ajustado.</p>
                  </div>
                </div>
              </div>

              {/* Stop Loss Layers */}
              <div className="space-y-3">
                <h3 className="text-base font-semibold">Stop Loss (3 capas)</h3>
                <p className="text-sm text-muted-foreground">Sistema escalado de protección contra caídas.</p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm text-yellow-600 dark:text-yellow-400">Soft: {config?.stopLossSoftPct?.toFixed(1)}%</Label>
                    <Slider
                      value={[config?.stopLossSoftPct || 2.0]}
                      min={1.0}
                      max={5.0}
                      step={0.5}
                      onValueChange={(v) => onConfirmChange("stopLossSoftPct", "Stop Soft", config?.stopLossSoftPct || 2.0, v[0], "Con HODL ON: activa recuperación. Con HODL OFF: vende.", "high", true, false)}
                    />
                    <p className="text-sm text-muted-foreground">Primera capa. Activa HODL si está ON.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm text-orange-600 dark:text-orange-400">Hard: {config?.stopLossHardPct?.toFixed(1)}%</Label>
                    <Slider
                      value={[config?.stopLossHardPct || 5.0]}
                      min={3.0}
                      max={10.0}
                      step={0.5}
                      onValueChange={(v) => onConfirmChange("stopLossHardPct", "Stop Hard", config?.stopLossHardPct || 5.0, v[0], "Vende siempre, incluso con HODL activo.", "high", true, false)}
                    />
                    <p className="text-sm text-muted-foreground">Override de HODL. Venta forzada.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm text-red-600 dark:text-red-400">Emergency: {config?.stopLossEmergencyPct?.toFixed(1)}%</Label>
                    <Slider
                      value={[config?.stopLossEmergencyPct || 10.0]}
                      min={5.0}
                      max={20.0}
                      step={1.0}
                      onValueChange={(v) => onConfirmChange("stopLossEmergencyPct", "Stop Emergency", config?.stopLossEmergencyPct || 10.0, v[0], "Cierre total de posición. Override absoluto.", "high", true, false)}
                    />
                    <p className="text-sm text-muted-foreground">Cierre total. Override absoluto.</p>
                  </div>
                </div>
              </div>

              {/* HODL Recovery */}
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <Label className="text-sm">HODL Recovery</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Tras soft stop loss, mantener posición y esperar recuperación a break-even en lugar de vender.
                    </p>
                  </div>
                  <Switch
                    checked={config?.hodlRecoveryEnabled}
                    onCheckedChange={(v) => {
                      if (v && !config?.hodlRecoveryEnabled) {
                        setShowHodlConfirm(true);
                      } else {
                        onConfigChange("hodlRecoveryEnabled", v);
                      }
                    }}
                  />
                </div>
              </div>

              {/* HODL confirmation dialog */}
              {showHodlConfirm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowHodlConfirm(false)}>
                  <div className="bg-card border rounded-lg p-6 max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-amber-500" />
                      Confirmar HODL Recovery
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Estás activando HODL Recovery. Tras un soft stop loss, el sistema NO venderá
                      y mantendrá la posición esperando recuperación. Si el precio sigue bajando,
                      la pérdida puede ampliarse hasta el hard stop (-{config?.stopLossHardPct || 5}%)
                      o emergency stop (-{config?.stopLossEmergencyPct || 10}%).
                    </p>
                    <div className="flex items-center gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => setShowHodlConfirm(false)}>Cancelar</Button>
                      <Button variant="default" size="sm" onClick={() => { onConfigChange("hodlRecoveryEnabled", true); setShowHodlConfirm(false); }}>
                        Activar HODL Recovery
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Pump/Dump Guard */}
              <div className="space-y-3">
                <h3 className="text-base font-semibold">Pump/Dump Guard</h3>
                <p className="text-sm text-muted-foreground">Detecta movimientos bruscos y bloquea nuevas compras.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Pump Deviation: {config?.pumpGuardDeviationPct?.toFixed(1)}%</Label>
                    <Slider
                      value={[config?.pumpGuardDeviationPct || 3.0]}
                      min={1.0}
                      max={10.0}
                      step={0.5}
                      onValueChange={(v) => onConfirmChange("pumpGuardDeviationPct", "Pump deviation", config?.pumpGuardDeviationPct || 3.0, v[0], "Subidas bruscas que bloquean compras.", "medium", false, false)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Dump Deviation: {config?.dumpGuardDeviationPct?.toFixed(1)}%</Label>
                    <Slider
                      value={[config?.dumpGuardDeviationPct || 3.0]}
                      min={1.0}
                      max={10.0}
                      step={0.5}
                      onValueChange={(v) => onConfirmChange("dumpGuardDeviationPct", "Dump deviation", config?.dumpGuardDeviationPct || 3.0, v[0], "Caídas bruscas que bloquean compras.", "medium", false, false)}
                    />
                  </div>
                </div>
              </div>

              {/* Reconciliation */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label className="text-sm">Reconciliación</Label>
                  <p className="text-sm text-muted-foreground mt-1">Verificar estado local vs exchange</p>
                </div>
                <Button variant="outline" size="sm" onClick={onReconcile} disabled={reconcilePending}>
                  Ejecutar
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Avanzado ───────────────────────────── */}
        <TabsContent value="avanzado" className="space-y-4">
          {/* Bloque 1: Control real del Grid */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Control real del Grid
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Separación mínima manual */}
              <div className="space-y-2">
                <Label className="text-sm">Separación mínima manual: {config?.gridStepMinPct?.toFixed(2)}%</Label>
                <Slider
                  value={[config?.gridStepMinPct || 0.15]}
                  min={0.05}
                  max={1.0}
                  step={0.05}
                  onValueChange={(v) => onConfirmChange("gridStepMinPct", "Sep. mín", config?.gridStepMinPct || 0.15, v[0], "Distancia mínima entre niveles. No debe quedar por debajo de fees.", "high", false, true)}
                />
                <p className="text-sm text-muted-foreground">Puede quedar superada por el mínimo rentable calculado por fees, spread y objetivo neto.</p>
              </div>

              {/* Separación máxima permitida */}
              <div className="space-y-2">
                <Label className="text-sm">Separación máxima permitida: {config?.gridStepMaxPct?.toFixed(2)}%</Label>
                <Slider
                  value={[config?.gridStepMaxPct || 3.0]}
                  min={1.0}
                  max={10.0}
                  step={0.5}
                  onValueChange={(v) => onConfirmChange("gridStepMaxPct", "Sep. máx", config?.gridStepMaxPct || 3.0, v[0], "Límite superior de separación entre niveles.", "medium", false, true)}
                />
                <p className="text-sm text-muted-foreground">No define por sí solo el rango final; el rango también depende de volatilidad, beneficio neto y viabilidad.</p>
              </div>

              {/* Objetivo neto por nivel */}
              <div className="space-y-2">
                <Label className="text-sm">Objetivo neto por nivel: {config?.netProfitTargetPct?.toFixed(2)}%</Label>
                <Slider
                  value={[config?.netProfitTargetPct || 0.8]}
                  min={0.1}
                  max={3.0}
                  step={0.1}
                  onValueChange={(v) => onConfirmChange("netProfitTargetPct", "Objetivo neto", config?.netProfitTargetPct || 0.8, v[0], "Beneficio mínimo objetivo después de fees y reserva fiscal.", "medium", false, false)}
                />
                <p className="text-sm text-muted-foreground">Más alto exige más separación entre niveles. Si el objetivo es demasiado alto, pueden caber menos niveles o el rango puede ser no viable.</p>
              </div>
            </CardContent>
          </Card>

          {/* Bloque 2: Adaptive Smart Range */}
          <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-purple-400" />
                Adaptive Smart Range
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Modo de control de rango */}
              <div className="space-y-2">
                <Label className="text-sm">Modo de control de rango</Label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: "adaptive_smart", label: "Adaptive Smart", desc: "Rango dinámico por régimen" },
                    { v: "fixed_compact", label: "Fixed Compact", desc: "Rango compacto fijo" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      onClick={() => onConfirmChange("gridRangeControlMode", "Modo control rango", config?.gridRangeControlMode || "adaptive_smart", opt.v, "Cambia el modo de cálculo de rango del Grid.", "medium", false, true)}
                      className={`rounded-lg border p-3 text-center transition-all ${
                        (config?.gridRangeControlMode || "adaptive_smart") === opt.v
                          ? "border-purple-500/50 bg-purple-500/10 text-foreground"
                          : "border-border/50 bg-muted/10 text-muted-foreground hover:bg-muted/20"
                      }`}
                    >
                      <p className="text-sm font-semibold">{opt.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Adaptive Range Enabled */}
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Adaptive Range activado</Label>
                  <p className="text-sm text-muted-foreground mt-1">Activa el cálculo adaptativo de rango basado en volatilidad y régimen.</p>
                </div>
                <Switch
                  checked={config?.adaptiveRangeEnabled ?? true}
                  onCheckedChange={(v) => onConfirmChange("adaptiveRangeEnabled", "Adaptive Range", config?.adaptiveRangeEnabled ?? true, v, "Activa/desactiva el motor adaptive.", "medium", false, true)}
                />
              </div>

              {/* Perfil */}
              <div className="space-y-2">
                <Label className="text-sm">Perfil Adaptive</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: "conservative", label: "Conservador", desc: "Rangos prudentes" },
                    { v: "balanced", label: "Balanceado", desc: "Equilibrio seguridad/frecuencia" },
                    { v: "aggressive", label: "Agresivo", desc: "Rangos más amplios" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      onClick={() => onConfirmChange("adaptiveRangeProfile", "Perfil adaptive", config?.adaptiveRangeProfile || "balanced", opt.v, "Cambia el perfil de riesgo del rango adaptive.", "low", false, true)}
                      className={`rounded-lg border p-2.5 text-center text-sm transition-all ${
                        (config?.adaptiveRangeProfile || "balanced") === opt.v
                          ? "border-purple-500/50 bg-purple-500/10 text-foreground font-semibold"
                          : "border-border/50 bg-muted/10 text-muted-foreground hover:bg-muted/20"
                      }`}
                    >
                      <p className="font-semibold">{opt.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">Conservative = rangos más prudentes, menos exposición. Balanced = equilibrio entre seguridad y frecuencia. Aggressive = permite rangos más amplios si está habilitado.</p>
              </div>

              {/* Rangos por régimen */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Límites de rango por régimen</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Rango mínimo global: {config?.adaptiveRangeMinPct?.toFixed(2)}%</Label>
                    <Slider
                      value={[config?.adaptiveRangeMinPct || 1.5]}
                      min={0.5}
                      max={5.0}
                      step={0.25}
                      onValueChange={(v) => onConfirmChange("adaptiveRangeMinPct", "Rango mín", config?.adaptiveRangeMinPct || 1.5, v[0], "Rango mínimo permitido para cualquier régimen.", "low", false, true)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Rango máximo global: {config?.adaptiveRangeMaxPct?.toFixed(2)}%</Label>
                    <Slider
                      value={[config?.adaptiveRangeMaxPct || 7.0]}
                      min={3.0}
                      max={15.0}
                      step={0.5}
                      onValueChange={(v) => onConfirmChange("adaptiveRangeMaxPct", "Rango máx", config?.adaptiveRangeMaxPct || 7.0, v[0], "Rango máximo permitido para cualquier régimen.", "low", false, true)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label className="text-sm text-xs">Máx baja vol: {config?.adaptiveRangeLowVolMaxPct?.toFixed(2)}%</Label>
                    <Slider
                      value={[config?.adaptiveRangeLowVolMaxPct || 3.0]}
                      min={1.0}
                      max={8.0}
                      step={0.25}
                      onValueChange={(v) => onConfirmChange("adaptiveRangeLowVolMaxPct", "Máx low vol", config?.adaptiveRangeLowVolMaxPct || 3.0, v[0], "Rango máximo en régimen de baja volatilidad.", "low", false, true)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm text-xs">Máx lateral normal: {config?.adaptiveRangeNormalMaxPct?.toFixed(2)}%</Label>
                    <Slider
                      value={[config?.adaptiveRangeNormalMaxPct || 5.0]}
                      min={2.0}
                      max={10.0}
                      step={0.25}
                      onValueChange={(v) => onConfirmChange("adaptiveRangeNormalMaxPct", "Máx normal", config?.adaptiveRangeNormalMaxPct || 5.0, v[0], "Rango máximo en régimen lateral normal.", "low", false, true)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm text-xs">Máx alta vol: {config?.adaptiveRangeHighVolMaxPct?.toFixed(2)}%</Label>
                    <Slider
                      value={[config?.adaptiveRangeHighVolMaxPct || 7.0]}
                      min={3.0}
                      max={15.0}
                      step={0.5}
                      onValueChange={(v) => onConfirmChange("adaptiveRangeHighVolMaxPct", "Máx high vol", config?.adaptiveRangeHighVolMaxPct || 7.0, v[0], "Rango máximo en régimen de alta volatilidad.", "low", false, true)}
                    />
                  </div>
                </div>
              </div>

              {/* Target full levels + Min viable levels */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label className="text-sm">Target full levels</Label>
                    <p className="text-sm text-muted-foreground mt-1">ON: intenta meter todos los niveles. OFF: no fuerza rangos enormes.</p>
                  </div>
                  <Switch
                    checked={config?.adaptiveRangeTargetFullLevels ?? false}
                    onCheckedChange={(v) => onConfirmChange("adaptiveRangeTargetFullLevels", "Target full levels", config?.adaptiveRangeTargetFullLevels ?? false, v, "Forzar rangos para meter todos los niveles.", "low", false, true)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Mínimo niveles viables: {config?.adaptiveRangeMinViableLevels ?? 4}</Label>
                  <Slider
                    value={[config?.adaptiveRangeMinViableLevels || 4]}
                    min={2}
                    max={12}
                    step={1}
                    onValueChange={(v) => onConfirmChange("adaptiveRangeMinViableLevels", "Mín viable", config?.adaptiveRangeMinViableLevels || 4, v[0], "Mínimo de niveles para considerar el rango viable.", "low", false, true)}
                  />
                  <p className="text-sm text-muted-foreground">Si no caben estos niveles, el rango se marca como no viable.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Bloque 3: Backtest (separado) */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                Simulación / Backtest
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 text-sm text-blue-700 dark:text-blue-300">
                El backtest no cambia la configuración operativa ni crea órdenes. Solo simula.
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm">Capital Inicial (USD)</Label>
                  <Input type="number" defaultValue={1000} id="bt-capital" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Modelo de Fill</Label>
                  <Select defaultValue="realistic">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="optimistic">Optimista</SelectItem>
                      <SelectItem value="realistic">Realista</SelectItem>
                      <SelectItem value="pessimistic">Pesimista</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button variant="default" size="sm">Ejecutar Backtest</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Auditoría ──────────────────────────── */}
        <TabsContent value="auditoria" className="space-y-4">
          <div className="rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
            Auditoría completa del Grid Isolated. Datos desde GET /api/grid-isolated/monitor/audit.
          </div>
          <GridMonitorPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
