import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Settings2, Info, AlertTriangle, CheckCircle2, Sliders } from "lucide-react";

export type FiscoEngineMode = "legacy" | "v2_shadow" | "v2_official";

interface FiscoConfig {
  engineMode: FiscoEngineMode;
  metodologia: "FIFO";
  pais: "ES";
  moneda: "EUR";
  priceMode: "transaction" | "counterpart" | "best";
  transferMatchingTimeWindowDays: number;
  transferMatchingAmountTolerancePct: number;
  dustThresholdDefault: number;
  cryptoFeeTreatment: "inventory_reduction" | "explicit_disposal";
  blockIfRewardWithoutPrice: boolean;
  blockIfSellWithoutCostBasis: boolean;
  blockIfTransferMismatch: boolean;
  blockIfBalanceMismatchCritical: boolean;
}

const DEFAULT_CONFIG: FiscoConfig = {
  engineMode:                         "v2_shadow",
  metodologia:                        "FIFO",
  pais:                               "ES",
  moneda:                             "EUR",
  priceMode:                          "transaction",
  transferMatchingTimeWindowDays:     5,
  transferMatchingAmountTolerancePct: 5,
  dustThresholdDefault:               0.0001,
  cryptoFeeTreatment:                 "inventory_reduction",
  blockIfRewardWithoutPrice:          false,
  blockIfSellWithoutCostBasis:        true,
  blockIfTransferMismatch:            false,
  blockIfBalanceMismatchCritical:     true,
};

const MODE_INFO: Record<FiscoEngineMode, { label: string; color: string; description: string }> = {
  legacy:     { label: "Legado",       color: "border-border text-muted-foreground",  description: "Motor FIFO actual, sin cambios." },
  v2_shadow:  { label: "V2 Shadow",    color: "border-blue-500/50 text-blue-400",     description: "FIFO V2 en paralelo (shadow mode). Calcula sin sustituir el oficial." },
  v2_official:{ label: "V2 Oficial",   color: "border-green-500/50 text-green-400",   description: "FIFO V2 activo como cálculo oficial. Solo disponible sin blockers." },
};

export function FiscoConfigSection() {
  const [config, setConfig] = useState<FiscoConfig>(DEFAULT_CONFIG);
  const [saved, setSaved]   = useState(false);

  function setMode(m: FiscoEngineMode) {
    setConfig(c => ({ ...c, engineMode: m }));
    setSaved(false);
  }

  function toggle(key: keyof FiscoConfig) {
    setConfig(c => ({ ...c, [key]: !c[key as keyof FiscoConfig] }));
    setSaved(false);
  }

  function handleSave() {
    // En esta fase: guarda localmente (no hay endpoint backend aún)
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-blue-400" /> Configuración FISCO V2
        </h2>
        <p className="text-xs text-muted-foreground">
          Parámetros del motor fiscal, matching de transferencias y bloqueos de informe.
        </p>
      </div>

      {/* ── Motor fiscal ── */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Motor fiscal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(["legacy", "v2_shadow", "v2_official"] as FiscoEngineMode[]).map(mode => {
              const info = MODE_INFO[mode];
              const isActive = config.engineMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setMode(mode)}
                  disabled={mode === "v2_official"}
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    isActive
                      ? `${info.color} bg-blue-500/10`
                      : "border-border text-muted-foreground hover:border-border/80"
                  } ${mode === "v2_official" ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-bold text-sm ${isActive ? info.color.split(" ").find(c => c.startsWith("text-")) : ""}`}>
                      {info.label}
                    </span>
                    {isActive && <Badge variant="outline" className={`text-[10px] ${info.color}`}>Activo</Badge>}
                    {mode === "v2_official" && <Badge variant="outline" className="text-[10px] text-muted-foreground">Bloqueado</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{info.description}</p>
                </button>
              );
            })}
          </div>
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-blue-300">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p><strong>v2_official</strong> se habilitará cuando FIFO V2 no tenga blockers ni diffs desconocidos. Por ahora usa <strong>v2_shadow</strong> para calcular en paralelo.</p>
          </div>
        </CardContent>
      </Card>

      {/* ── Parámetros fiscales ── */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Parámetros fiscales (sólo lectura)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Metodología",  value: config.metodologia },
              { label: "País",         value: config.pais === "ES" ? "España" : config.pais },
              { label: "Moneda base",  value: config.moneda },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 rounded-lg bg-muted/30 border border-border">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
                <div className="text-sm font-bold">{value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Transfer matching ── */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Sliders className="h-4 w-4" /> Transfer Matching
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-muted/30 border border-border">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Ventana temporal</div>
              <div className="text-lg font-bold">{config.transferMatchingTimeWindowDays} días</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Tolerancia cantidad</div>
              <div className="text-lg font-bold">±{config.transferMatchingAmountTolerancePct}%</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Dust threshold</div>
              <div className="text-lg font-bold">{config.dustThresholdDefault}</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Estos parámetros se usan en Balance Check y en el matching de transferencias internas.
          </div>
        </CardContent>
      </Card>

      {/* ── Bloqueos de informe ── */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-400" /> Bloqueos de informe fiscal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {([
            ["blockIfSellWithoutCostBasis",    "Bloquear si hay ventas sin base de coste"],
            ["blockIfRewardWithoutPrice",      "Bloquear si hay rewards sin precio EUR"],
            ["blockIfTransferMismatch",        "Bloquear si hay transfer mismatch sin resolver"],
            ["blockIfBalanceMismatchCritical", "Bloquear si hay balance mismatch crítico"],
          ] as [keyof FiscoConfig, string][]).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <Label htmlFor={key} className="text-xs font-normal cursor-pointer">{label}</Label>
              <Switch
                id={key}
                checked={config[key] as boolean}
                onCheckedChange={() => toggle(key)}
                className="scale-90"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Fee cripto ── */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Tratamiento fees en cripto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              ["inventory_reduction", "Reducción de inventario", "La fee reduce el saldo del activo. No genera disposal explícito. (Recomendado para fees de red en transfers)"],
              ["explicit_disposal",   "Disposal explícito",      "La fee se trata como una venta del activo. Genera ganancia/pérdida fiscal. (Conservador, para fees de trading)"],
            ] as [typeof config.cryptoFeeTreatment, string, string][]).map(([val, label, desc]) => (
              <button
                key={val}
                onClick={() => { setConfig(c => ({ ...c, cryptoFeeTreatment: val })); setSaved(false); }}
                className={`text-left p-3 rounded-xl border transition-colors ${
                  config.cryptoFeeTreatment === val
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                    : "border-border text-muted-foreground hover:border-border/80"
                }`}
              >
                <div className="font-semibold text-sm mb-1">{label}</div>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Guardar ── */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Settings2 className="h-4 w-4" /> Guardar configuración
        </Button>
        {saved && (
          <div className="flex items-center gap-1.5 text-green-400 text-sm">
            <CheckCircle2 className="h-4 w-4" /> Configuración guardada
          </div>
        )}
      </div>
    </div>
  );
}
