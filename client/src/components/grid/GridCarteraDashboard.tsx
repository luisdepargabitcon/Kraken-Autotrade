import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wallet, TrendingUp, TrendingDown, Shield, DollarSign, Percent, PiggyBank, Activity, Lock, Settings2 } from "lucide-react";

interface GridCarteraDashboardProps {
  config: any;
  status: any;
  onConfigChange: (key: string, value: any) => void;
  onConfirmChange: (key: string, label: string, oldValue: any, newValue: any, impact: string, riskLevel: "low" | "medium" | "high", affectsCurrent: boolean, requiresRecalc: boolean) => void;
}

export function GridCarteraDashboard({ config, status, onConfigChange, onConfirmChange }: GridCarteraDashboardProps) {
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
            <span>$${reserved.toFixed(0)} reservado</span>
            <span>$${max.toFixed(0)} máximo</span>
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
    red: "[&_[role=slider]]:bg-red-500",
    orange: "[&_[role=slider]]:bg-orange-500",
    green: "[&_[role=slider]]:bg-green-500",
    blue: "[&_[role=slider]]:bg-blue-500",
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <Input
          type="number"
          className="w-28 h-8 text-right text-sm"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onDirectChange(parseFloat(e.target.value) || 0)}
        />
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className={colorMap[colorClass]}
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
