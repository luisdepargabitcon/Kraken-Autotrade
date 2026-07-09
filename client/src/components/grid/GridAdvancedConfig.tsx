import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Cpu, FlaskConical, Activity, AlertTriangle, AlertCircle, CheckCircle2, XCircle,
  Info, TrendingUp, TrendingDown, Brain, Gauge, Lightbulb, ChevronDown, Zap,
} from "lucide-react";

interface GridAdvancedConfigProps {
  config: any;
  auditData?: any;
  onConfirmChange: (key: string, label: string, oldValue: any, newValue: any, impact: string, riskLevel: "low" | "medium" | "high", affectsCurrent: boolean, requiresRecalc: boolean) => void;
  onConfigChange: (key: string, value: any) => void;
}

const PRESETS: Record<string, { values: Record<string, any>; text: string }> = {
  conservative: {
    values: {
      adaptiveRangeMinPct: 1.50,
      adaptiveRangeMaxPct: 4.00,
      adaptiveRangeLowVolMaxPct: 2.50,
      adaptiveRangeNormalMaxPct: 4.00,
      adaptiveRangeHighVolMaxPct: 5.00,
      adaptiveRangeTargetFullLevels: false,
      adaptiveRangeMinViableLevels: 4,
    },
    text: "Prioriza seguridad. Rangos más estrechos, menos exposición, puede bloquear más escenarios.",
  },
  balanced: {
    values: {
      adaptiveRangeMinPct: 1.50,
      adaptiveRangeMaxPct: 7.00,
      adaptiveRangeLowVolMaxPct: 3.00,
      adaptiveRangeNormalMaxPct: 5.00,
      adaptiveRangeHighVolMaxPct: 7.00,
      adaptiveRangeTargetFullLevels: false,
      adaptiveRangeMinViableLevels: 4,
    },
    text: "Equilibrio entre seguridad y frecuencia. No fuerza rangos enormes para meter todos los niveles.",
  },
  aggressive: {
    values: {
      adaptiveRangeMinPct: 2.00,
      adaptiveRangeMaxPct: 10.00,
      adaptiveRangeLowVolMaxPct: 4.00,
      adaptiveRangeNormalMaxPct: 7.00,
      adaptiveRangeHighVolMaxPct: 10.00,
      adaptiveRangeTargetFullLevels: true,
      adaptiveRangeMinViableLevels: 5,
    },
    text: "Permite rangos más amplios y busca más niveles. Mayor exposición y más riesgo de rangos demasiado abiertos.",
  },
};

const DRAFT_KEYS = [
  "gridStepMinPct", "gridStepMaxPct", "netProfitTargetPct",
  "gridRangeControlMode", "adaptiveRangeEnabled", "adaptiveRangeProfile",
  "adaptiveRangeMinPct", "adaptiveRangeMaxPct",
  "adaptiveRangeLowVolMaxPct", "adaptiveRangeNormalMaxPct", "adaptiveRangeHighVolMaxPct",
  "adaptiveRangeTargetFullLevels", "adaptiveRangeMinViableLevels",
  "enforceCompactRange", "gridRangeMaxPct", "maxDistanceFromCenterPct", "maxSellDistanceFromNearestBuyPct",
];

export function GridAdvancedConfig({ config, auditData, onConfirmChange, onConfigChange }: GridAdvancedConfigProps) {
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [showPresetPreview, setShowPresetPreview] = useState<string | null>(null);
  const [showApplySummary, setShowApplySummary] = useState(false);
  const [fixedCompactOpen, setFixedCompactOpen] = useState(false);

  // Initialize draft from config when config changes
  useEffect(() => {
    if (config) {
      const newDraft: Record<string, any> = {};
      for (const key of DRAFT_KEYS) {
        if (config[key] !== undefined) {
          newDraft[key] = config[key];
        }
      }
      setDraft(newDraft);
    }
  }, [config]);

  // Get effective value: draft > config > default
  const eff = useCallback((key: string, fallback: any) => {
    if (draft[key] !== undefined) return draft[key];
    if (config?.[key] !== undefined) return config[key];
    return fallback;
  }, [draft, config]);

  // Dirty fields
  const dirtyFields = useMemo(() => {
    const dirty: string[] = [];
    for (const key of DRAFT_KEYS) {
      const saved = config?.[key];
      const draftVal = draft[key];
      if (draftVal !== undefined && saved !== undefined && draftVal !== saved) {
        dirty.push(key);
      } else if (draftVal !== undefined && saved === undefined && draftVal !== null) {
        dirty.push(key);
      }
    }
    return dirty;
  }, [draft, config]);

  const isDirty = dirtyFields.length > 0;

  const updateDraft = (key: string, value: any) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const discardDraft = () => {
    const newDraft: Record<string, any> = {};
    for (const key of DRAFT_KEYS) {
      if (config?.[key] !== undefined) newDraft[key] = config[key];
    }
    setDraft(newDraft);
    setShowApplySummary(false);
  };

  const applyDraft = () => {
    for (const key of dirtyFields) {
      const savedVal = config?.[key];
      const newVal = draft[key];
      onConfigChange(key, newVal);
    }
    setShowApplySummary(false);
  };

  // Mode
  const mode = eff("gridRangeControlMode", "adaptive_smart");
  const isAdaptive = mode === "adaptive_smart";

  // Audit data for effective values
  const pg = auditData?.professionalGenerator;
  const minSpacingPctReal = pg?.available ? pg.minSpacingPctReal : null;
  const spacingPct = pg?.available ? pg.spacingPct : null;
  const adaptiveDecision = auditData?.rangeIntelligence?.lastAdaptiveRangeDecision;

  // Effective min spacing
  const gridStepMinPct = eff("gridStepMinPct", 0.15);
  const effectiveMinSpacing = minSpacingPctReal != null
    ? Math.max(gridStepMinPct, minSpacingPctReal)
    : gridStepMinPct;

  // ─── Impact messages ──────────────────────────────────────
  const impactMessages = useMemo(() => {
    const msgs: { type: "info" | "warning" | "danger"; text: string }[] = [];
    const netProfit = eff("netProfitTargetPct", 0.8);
    const stepMin = eff("gridStepMinPct", 0.15);
    const stepMax = eff("gridStepMaxPct", 3.0);
    const rangeMax = eff("adaptiveRangeMaxPct", 7.0);
    const targetFull = eff("adaptiveRangeTargetFullLevels", false);
    const minViable = eff("adaptiveRangeMinViableLevels", 4);

    // A) Objetivo neto
    const savedNetProfit = config?.netProfitTargetPct ?? 0.8;
    if (netProfit > savedNetProfit) {
      msgs.push({ type: "info", text: "Objetivo neto subido: más beneficio por ciclo, pero necesita más separación compra/venta. Puede reducir niveles viables o hacer no viable el rango." });
    } else if (netProfit < savedNetProfit) {
      msgs.push({ type: "info", text: "Objetivo neto bajado: caben más niveles, más operaciones posibles. Menos beneficio por ciclo, más sensibilidad a fees/spread." });
    }

    // B) Separación mínima
    const savedStepMin = config?.gridStepMinPct ?? 0.15;
    if (stepMin > savedStepMin) {
      msgs.push({ type: "info", text: "Separación mínima subida: menos niveles dentro del rango, menos operaciones, más margen entre entradas." });
    } else if (stepMin < savedStepMin) {
      msgs.push({ type: "info", text: "Separación mínima bajada: más niveles posibles, más operaciones. Puede quedar ignorada si la separación mínima rentable es mayor." });
    }

    // C) Separación máxima
    const savedStepMax = config?.gridStepMaxPct ?? 3.0;
    if (stepMax > savedStepMax) {
      msgs.push({ type: "info", text: "Separación máxima subida: permite niveles más separados. Puede ayudar en volatilidad alta, pero puede alejar demasiado las entradas/salidas." });
    } else if (stepMax < savedStepMax) {
      msgs.push({ type: "info", text: "Separación máxima bajada: rango más compacto. Puede bloquear niveles si el mínimo rentable no cabe." });
    }

    // D) Rango máximo Adaptive
    const savedRangeMax = config?.adaptiveRangeMaxPct ?? 7.0;
    if (rangeMax > savedRangeMax) {
      msgs.push({ type: "info", text: "Rango máximo subido: permite rangos más amplios, puede mantener niveles en mercados volátiles. Aumenta exposición del rango." });
    } else if (rangeMax < savedRangeMax) {
      msgs.push({ type: "info", text: "Rango máximo bajado: más conservador, evita rangos enormes. Puede reducir o bloquear niveles." });
    }

    // E) Target full levels
    const savedTargetFull = config?.adaptiveRangeTargetFullLevels ?? false;
    if (targetFull !== savedTargetFull) {
      if (targetFull) {
        msgs.push({ type: "info", text: "Target full levels ON: intenta meter todos los niveles. Puede ampliar rango hasta el límite seguro. Si no cabe, marcará no viable." });
      } else {
        msgs.push({ type: "info", text: "Target full levels OFF: no fuerza rangos enormes. Puede aceptar menos niveles." });
      }
    }

    // F) Mínimo niveles viables
    const savedMinViable = config?.adaptiveRangeMinViableLevels ?? 4;
    if (minViable > savedMinViable) {
      msgs.push({ type: "info", text: "Mínimo niveles viables subido: más exigente, evita grids pobres. Puede marcar más escenarios no viables." });
    } else if (minViable < savedMinViable) {
      msgs.push({ type: "info", text: "Mínimo niveles viables bajado: más permisivo, permite grids más pequeños. Menor estructura operativa." });
    }

    return msgs;
  }, [draft, config, eff]);

  // ─── Smart alerts ─────────────────────────────────────────
  const alerts = useMemo(() => {
    const list: { type: "warning" | "danger"; text: string }[] = [];
    const netProfit = eff("netProfitTargetPct", 0.8);
    const stepMax = eff("gridStepMaxPct", 3.0);
    const rangeMax = eff("adaptiveRangeMaxPct", 7.0);
    const lowVolMax = eff("adaptiveRangeLowVolMaxPct", 3.0);
    const normalMax = eff("adaptiveRangeNormalMaxPct", 5.0);
    const highVolMax = eff("adaptiveRangeHighVolMaxPct", 7.0);
    const targetFull = eff("adaptiveRangeTargetFullLevels", false);

    if (netProfit >= 1.2) {
      list.push({ type: "warning", text: "Objetivo exigente. Puede reducir niveles viables o hacer no viable el rango." });
    }
    if (minSpacingPctReal != null && stepMax < minSpacingPctReal) {
      list.push({ type: "danger", text: "La separación máxima permitida es menor que la separación mínima rentable. Esta configuración puede bloquear la generación de niveles." });
    }
    if (rangeMax < normalMax || rangeMax < highVolMax) {
      list.push({ type: "danger", text: "El máximo global es menor que algún máximo por régimen." });
    }
    if (lowVolMax > normalMax) {
      list.push({ type: "warning", text: "Baja volatilidad no debería tener más rango que lateral normal." });
    }
    if (normalMax > highVolMax) {
      list.push({ type: "warning", text: "Alta volatilidad debería permitir igual o más rango que lateral normal." });
    }
    if (targetFull && rangeMax < 6) {
      list.push({ type: "warning", text: "Estás pidiendo todos los niveles, pero el rango máximo puede no ser suficiente." });
    }
    if (!isAdaptive) {
      list.push({ type: "warning", text: "Modo más rígido. Puede ser útil como cinturón de seguridad, pero no se adapta tanto a volatilidad." });
    }
    return list;
  }, [eff, minSpacingPctReal, isAdaptive]);

  // Preset preview
  const presetPreview = useMemo(() => {
    if (!showPresetPreview) return null;
    const preset = PRESETS[showPresetPreview];
    if (!preset) return null;
    return Object.entries(preset.values).map(([key, newVal]) => {
      const currentVal = eff(key, newVal);
      return { key, currentVal, newVal, changed: currentVal !== newVal };
    });
  }, [showPresetPreview, eff]);

  const applyPreset = () => {
    if (!showPresetPreview) return;
    const preset = PRESETS[showPresetPreview];
    if (!preset) return;
    setDraft(prev => ({ ...prev, ...preset.values }));
    setShowPresetPreview(null);
  };

  return (
    <div className="space-y-4">
      {/* ─── Draft status bar ──────────────────────────────── */}
      {isDirty && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertCircle className="h-4 w-4" />
            <span>Tienes {dirtyFields.length} cambio(s) sin aplicar. No se envían al backend hasta que pulses "Aplicar cambios".</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={discardDraft}>Descartar cambios</Button>
            <Button size="sm" onClick={() => setShowApplySummary(true)}>Aplicar cambios</Button>
          </div>
        </div>
      )}

      {/* ─── Bloque 1: Control real del Grid ───────────────── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            Control real del Grid
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-sm">Separación mínima manual: {eff("gridStepMinPct", 0.15)?.toFixed(2)}%</Label>
            <Slider
              value={[eff("gridStepMinPct", 0.15)]}
              min={0.05} max={1.0} step={0.05}
              onValueChange={(v) => updateDraft("gridStepMinPct", v[0])}
            />
            <p className="text-sm text-muted-foreground">Puede quedar superada por el mínimo rentable calculado por fees, spread y objetivo neto.</p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Separación máxima permitida: {eff("gridStepMaxPct", 3.0)?.toFixed(2)}%</Label>
            <Slider
              value={[eff("gridStepMaxPct", 3.0)]}
              min={1.0} max={10.0} step={0.5}
              onValueChange={(v) => updateDraft("gridStepMaxPct", v[0])}
            />
            <p className="text-sm text-muted-foreground">No define por sí solo el rango final; el rango también depende de volatilidad, beneficio neto y viabilidad.</p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Objetivo neto por nivel: {eff("netProfitTargetPct", 0.8)?.toFixed(2)}%</Label>
            <Slider
              value={[eff("netProfitTargetPct", 0.8)]}
              min={0.1} max={3.0} step={0.1}
              onValueChange={(v) => updateDraft("netProfitTargetPct", v[0])}
            />
            <p className="text-sm text-muted-foreground">Más alto exige más separación entre niveles. Si el objetivo es demasiado alto, pueden caber menos niveles o el rango puede ser no viable.</p>
          </div>
        </CardContent>
      </Card>

      {/* ─── Valor efectivo usado por el motor ─────────────── */}
      <Card className="border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="h-4 w-4 text-blue-400" />
            Valor efectivo usado por el motor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-lg bg-muted/20 p-3">
            <p className="text-muted-foreground">
              Tu separación manual es <strong className="text-foreground font-mono">{eff("gridStepMinPct", 0.15)?.toFixed(2)}%</strong>
              {minSpacingPctReal != null ? (
                <>
                  , pero el motor no puede bajar de <strong className="text-foreground font-mono">{minSpacingPctReal.toFixed(2)}%</strong> porque debe cubrir objetivo neto, fees, spread y seguridad. Por tanto, la separación efectiva mínima es <strong className="text-blue-400 font-mono">{effectiveMinSpacing.toFixed(2)}%</strong>.
                </>
              ) : (
                <>. Pendiente de validación read-only para conocer la separación mínima rentable.</>
              )}
            </p>
          </div>
          <div className="rounded-lg bg-muted/20 p-3">
            <p className="text-muted-foreground">
              Separación máxima permitida: <strong className="text-foreground font-mono">{eff("gridStepMaxPct", 3.0)?.toFixed(2)}%</strong>
              {spacingPct != null ? (
                spacingPct >= eff("gridStepMaxPct", 3.0) - 0.01
                  ? <>. La separación máxima está limitando ahora mismo.</>
                  : <>. La separación máxima no está limitando ahora mismo.</>
              ) : (
                <>. Pendiente de validación read-only.</>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ─── Bloque 2: Mode switching + Adaptive / Fixed ───── */}
      <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-purple-400" />
            Modo de control de rango
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: "adaptive_smart", label: "Adaptive Smart", desc: "Rango dinámico por régimen" },
              { v: "fixed_compact", label: "Fixed Compact", desc: "Rango compacto fijo" },
            ].map((opt) => (
              <button
                key={opt.v}
                onClick={() => updateDraft("gridRangeControlMode", opt.v)}
                className={`rounded-lg border p-3 text-center transition-all ${
                  mode === opt.v
                    ? "border-purple-500/50 bg-purple-500/10 text-foreground"
                    : "border-border/50 bg-muted/10 text-muted-foreground hover:bg-muted/20"
                }`}
              >
                <p className="text-sm font-semibold">{opt.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>

          {/* Mode change warning */}
          {dirtyFields.includes("gridRangeControlMode") && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-blue-700 dark:text-blue-300">
              Este cambio no modifica el rango activo actual ni regenera niveles. Solo afectará a futuros rangos cuando se autorice una regeneración o evaluación.
            </div>
          )}

          {/* Adaptive Smart section */}
          {isAdaptive ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-purple-500/5 border border-purple-500/20 p-3 text-sm text-muted-foreground">
                Adaptive Smart calcula el rango según volatilidad, régimen y viabilidad. Es el modo recomendado para evitar rangos fijos que se quedan cortos o demasiado amplios.
              </div>

              {/* Adaptive Range Enabled */}
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Adaptive Range activado</Label>
                  <p className="text-sm text-muted-foreground mt-1">Activa el cálculo adaptativo de rango basado en volatilidad y régimen.</p>
                </div>
                <Switch
                  checked={eff("adaptiveRangeEnabled", true)}
                  onCheckedChange={(v) => updateDraft("adaptiveRangeEnabled", v)}
                />
              </div>

              {/* Presets */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold flex items-center gap-1">
                  <Lightbulb className="h-3 w-3 text-amber-400" />
                  Presets Adaptive
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      onClick={() => setShowPresetPreview(key)}
                      className={`rounded-lg border p-2.5 text-center text-sm transition-all ${
                        showPresetPreview === key
                          ? "border-amber-500/50 bg-amber-500/10 text-foreground font-semibold"
                          : "border-border/50 bg-muted/10 text-muted-foreground hover:bg-muted/20"
                      }`}
                    >
                      <p className="font-semibold capitalize">{key === "conservative" ? "Conservador" : key === "balanced" ? "Balanceado" : "Agresivo"}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Preset preview */}
              {presetPreview && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
                  <p className="text-sm text-muted-foreground">{PRESETS[showPresetPreview!]?.text}</p>
                  <div className="grid grid-cols-1 gap-1 text-xs">
                    {presetPreview.map(({ key, currentVal, newVal, changed }) => (
                      <div key={key} className={`flex items-center justify-between rounded px-2 py-1 ${changed ? "bg-amber-500/10" : ""}`}>
                        <span className="text-muted-foreground font-mono">{key}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground line-through">{String(currentVal)}</span>
                          <span className="text-foreground">→</span>
                          <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{String(newVal)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setShowPresetPreview(null)}>Cancelar</Button>
                    <Button size="sm" onClick={applyPreset}>Aplicar perfil</Button>
                  </div>
                </div>
              )}

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
                      onClick={() => updateDraft("adaptiveRangeProfile", opt.v)}
                      className={`rounded-lg border p-2.5 text-center text-sm transition-all ${
                        eff("adaptiveRangeProfile", "balanced") === opt.v
                          ? "border-purple-500/50 bg-purple-500/10 text-foreground font-semibold"
                          : "border-border/50 bg-muted/10 text-muted-foreground hover:bg-muted/20"
                      }`}
                    >
                      <p className="font-semibold">{opt.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Rangos por régimen */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Límites de rango por régimen</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Rango mínimo global: {eff("adaptiveRangeMinPct", 1.5)?.toFixed(2)}%</Label>
                    <Slider value={[eff("adaptiveRangeMinPct", 1.5)]} min={0.5} max={5.0} step={0.25}
                      onValueChange={(v) => updateDraft("adaptiveRangeMinPct", v[0])} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Rango máximo global: {eff("adaptiveRangeMaxPct", 7.0)?.toFixed(2)}%</Label>
                    <Slider value={[eff("adaptiveRangeMaxPct", 7.0)]} min={3.0} max={15.0} step={0.5}
                      onValueChange={(v) => updateDraft("adaptiveRangeMaxPct", v[0])} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label className="text-sm text-xs">Máx baja vol: {eff("adaptiveRangeLowVolMaxPct", 3.0)?.toFixed(2)}%</Label>
                    <Slider value={[eff("adaptiveRangeLowVolMaxPct", 3.0)]} min={1.0} max={8.0} step={0.25}
                      onValueChange={(v) => updateDraft("adaptiveRangeLowVolMaxPct", v[0])} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm text-xs">Máx lateral normal: {eff("adaptiveRangeNormalMaxPct", 5.0)?.toFixed(2)}%</Label>
                    <Slider value={[eff("adaptiveRangeNormalMaxPct", 5.0)]} min={2.0} max={10.0} step={0.25}
                      onValueChange={(v) => updateDraft("adaptiveRangeNormalMaxPct", v[0])} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm text-xs">Máx alta vol: {eff("adaptiveRangeHighVolMaxPct", 7.0)?.toFixed(2)}%</Label>
                    <Slider value={[eff("adaptiveRangeHighVolMaxPct", 7.0)]} min={3.0} max={15.0} step={0.5}
                      onValueChange={(v) => updateDraft("adaptiveRangeHighVolMaxPct", v[0])} />
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
                    checked={eff("adaptiveRangeTargetFullLevels", false)}
                    onCheckedChange={(v) => updateDraft("adaptiveRangeTargetFullLevels", v)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Mínimo niveles viables: {eff("adaptiveRangeMinViableLevels", 4)}</Label>
                  <Slider value={[eff("adaptiveRangeMinViableLevels", 4)]} min={2} max={12} step={1}
                    onValueChange={(v) => updateDraft("adaptiveRangeMinViableLevels", v[0])} />
                  <p className="text-sm text-muted-foreground">Si no caben estos niveles, el rango se marca como no viable.</p>
                </div>
              </div>
            </div>
          ) : (
            /* Fixed Compact section */
            <div className="space-y-4">
              <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 text-sm text-muted-foreground">
                Fixed Compact usa límites fijos de rango. Es más predecible, pero puede quedarse corto en semanas de más volatilidad o bloquear niveles si el mercado requiere más espacio.
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Enforce Compact Range</Label>
                  <p className="text-sm text-muted-foreground mt-1">Fuerza el rango compacto fijado manualmente.</p>
                </div>
                <Switch
                  checked={eff("enforceCompactRange", false)}
                  onCheckedChange={(v) => updateDraft("enforceCompactRange", v)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Rango máximo (Fixed): {eff("gridRangeMaxPct", 5.0)?.toFixed(2)}%</Label>
                <Slider value={[eff("gridRangeMaxPct", 5.0)]} min={1.0} max={15.0} step={0.5}
                  onValueChange={(v) => updateDraft("gridRangeMaxPct", v[0])} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Máx distancia desde centro: {eff("maxDistanceFromCenterPct", 10.0)?.toFixed(2)}%</Label>
                <Slider value={[eff("maxDistanceFromCenterPct", 10.0)]} min={2.0} max={20.0} step={0.5}
                  onValueChange={(v) => updateDraft("maxDistanceFromCenterPct", v[0])} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Máx distancia venta-compra: {eff("maxSellDistanceFromNearestBuyPct", 8.0)?.toFixed(2)}%</Label>
                <Slider value={[eff("maxSellDistanceFromNearestBuyPct", 8.0)]} min={2.0} max={15.0} step={0.5}
                  onValueChange={(v) => updateDraft("maxSellDistanceFromNearestBuyPct", v[0])} />
              </div>
            </div>
          )}

          {/* Collapsible for the other mode (collapsed) */}
          <Collapsible open={fixedCompactOpen} onOpenChange={setFixedCompactOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-3 w-3 transition-transform ${fixedCompactOpen ? "rotate-180" : ""}`} />
              {isAdaptive ? "Ver configuración Fixed Compact (inactiva)" : "Ver configuración Adaptive Smart (inactiva)"}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              {isAdaptive ? (
                <div className="rounded-lg bg-muted/20 border p-3 space-y-2 text-xs text-muted-foreground">
                  <p>Estos campos no afectan mientras Adaptive Smart esté activo:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>Enforce Compact: {String(eff("enforceCompactRange", false))}</div>
                    <div>Range Max: {eff("gridRangeMaxPct", 5.0)?.toFixed(2)}%</div>
                    <div>Max Dist Center: {eff("maxDistanceFromCenterPct", 10.0)?.toFixed(2)}%</div>
                    <div>Max Sell-Buy Dist: {eff("maxSellDistanceFromNearestBuyPct", 8.0)?.toFixed(2)}%</div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-muted/20 border p-3 space-y-2 text-xs text-muted-foreground">
                  <p>Estos campos no afectan mientras Fixed Compact esté activo:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>Adaptive Enabled: {String(eff("adaptiveRangeEnabled", true))}</div>
                    <div>Profile: {eff("adaptiveRangeProfile", "balanced")}</div>
                    <div>Range Min: {eff("adaptiveRangeMinPct", 1.5)?.toFixed(2)}%</div>
                    <div>Range Max: {eff("adaptiveRangeMaxPct", 7.0)?.toFixed(2)}%</div>
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ─── Panel Impacto Estimado ────────────────────────── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-400" />
            Impacto estimado de esta configuración
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {impactMessages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay cambios pendientes respecto a la configuración guardada.</p>
          ) : (
            impactMessages.map((msg, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Info className="h-3 w-3 mt-0.5 shrink-0 text-blue-400" />
                <span>{msg.text}</span>
              </div>
            ))
          )}
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 pt-2 border-t">
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            <span>No se regeneran niveles automáticamente. Los cambios solo afectan a futuros rangos.</span>
          </div>
        </CardContent>
      </Card>

      {/* ─── Alertas inteligentes ──────────────────────────── */}
      {alerts.length > 0 && (
        <Card className="border-red-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              Alertas de configuración
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((alert, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                  alert.type === "danger"
                    ? "bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300"
                    : "bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300"
                }`}
              >
                {alert.type === "danger"
                  ? <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                <span>{alert.text}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ─── Backtest ──────────────────────────────────────── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Simulación / Backtest
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 text-sm text-blue-700 dark:text-blue-300">
            Backtest pendiente de validación. La simulación/backtest se habilitará en una fase posterior. No afecta al Grid actual.
          </div>
          <div className="grid grid-cols-2 gap-4 opacity-50">
            <div className="space-y-2">
              <Label className="text-sm">Capital Inicial (USD)</Label>
              <Input type="number" defaultValue={1000} disabled id="bt-capital" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Modelo de Fill</Label>
              <Select defaultValue="realistic" disabled>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="optimistic">Optimista</SelectItem>
                  <SelectItem value="realistic">Realista</SelectItem>
                  <SelectItem value="pessimistic">Pesimista</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button variant="default" size="sm" disabled>Backtest pendiente de validación</Button>
        </CardContent>
      </Card>

      {/* ─── Apply summary modal ───────────────────────────── */}
      {showApplySummary && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowApplySummary(false)}>
          <div className="bg-card border rounded-lg p-6 max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Resumen de cambios
            </h3>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {dirtyFields.map(key => (
                <div key={key} className="flex items-center justify-between rounded px-3 py-2 bg-muted/20 text-sm">
                  <span className="font-mono text-muted-foreground">{key}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground line-through">{String(config?.[key] ?? "—")}</span>
                    <span>→</span>
                    <span className="font-mono font-semibold text-green-500">{String(draft[key])}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>No se regeneran niveles automáticamente. No se activa SHADOW ni REAL.</span>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowApplySummary(false)}>Cancelar</Button>
              <Button size="sm" onClick={applyDraft}>Aplicar {dirtyFields.length} cambio(s)</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
