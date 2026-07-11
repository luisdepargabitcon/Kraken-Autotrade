import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Cpu, Activity, AlertTriangle, AlertCircle, CheckCircle2, XCircle,
  Info, Brain, Lightbulb, ChevronDown, ArrowRight, Sparkles,
} from "lucide-react";
import { buildGridConfigRecommendations, applyRecommendationToDraft, type GridRecommendation } from "@shared/gridConfigAdvisor";

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

  // ─── Smart recommendations from gridConfigAdvisor ─────────────
  const recommendations = useMemo(() => {
    return buildGridConfigRecommendations({
      config,
      draft,
      auditData,
      diagnostic: auditData?.latestGridDiagnostic,
    });
  }, [config, draft, auditData]);

  const handleApplyRecommendation = (rec: GridRecommendation) => {
    if (rec.recommendedPatch && Object.keys(rec.recommendedPatch).length > 0) {
      setDraft(prev => applyRecommendationToDraft(prev, rec));
    }
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

      {/* ─── Bloque 1: Cómo calcula el rango ──────────────── */}
      <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-purple-400" />
            Cómo calcula el rango
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Elige cómo quieres que el Grid decida el rango de precios donde colocará los niveles de compra y venta.
          </p>

          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: "adaptive_smart", label: "Rango inteligente", desc: "Se adapta solo según la volatilidad del mercado" },
              { v: "fixed_compact", label: "Rango fijo compacto", desc: "Tú defines los límites del rango manualmente" },
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
                El rango inteligente calcula automáticamente la anchura del rango según la volatilidad del mercado y el beneficio neto que has configurado. Es el modo recomendado porque se adapta solo.
              </div>

              {/* Adaptive Range Enabled */}
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Cálculo adaptativo activado</Label>
                  <p className="text-sm text-muted-foreground mt-1">Si está activado, el Grid calcula el rango automáticamente. Si lo desactivas, el rango no se recalcula.</p>
                </div>
                <Switch
                  checked={eff("adaptiveRangeEnabled", true)}
                  onCheckedChange={(v) => updateDraft("adaptiveRangeEnabled", v)}
                />
              </div>
            </div>
          ) : (
            /* Fixed Compact section */
            <div className="space-y-4">
              <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 text-sm text-muted-foreground">
                El rango fijo compacto usa límites que tú defines. Es más predecible, pero puede quedarse corto si el mercado se vuelve más volátil o bloquear niveles si no hay suficiente espacio.
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Forzar rango compacto fijo</Label>
                  <p className="text-sm text-muted-foreground mt-1">Si está activado, el Grid siempre usa el rango que definas aquí, sin adaptarse.</p>
                </div>
                <Switch
                  checked={eff("enforceCompactRange", false)}
                  onCheckedChange={(v) => updateDraft("enforceCompactRange", v)}
                />
              </div>
            </div>
          )}

          {/* Collapsible for the other mode (collapsed) */}
          <Collapsible open={fixedCompactOpen} onOpenChange={setFixedCompactOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-3 w-3 transition-transform ${fixedCompactOpen ? "rotate-180" : ""}`} />
              {isAdaptive ? "Ver ajustes del rango fijo (inactivos)" : "Ver ajustes del rango inteligente (inactivos)"}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              {isAdaptive ? (
                <div className="rounded-lg bg-muted/20 border p-3 space-y-2 text-xs text-muted-foreground">
                  <p>Estos ajustes no afectan mientras el rango inteligente esté activo:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>Forzar rango fijo: {String(eff("enforceCompactRange", false))}</div>
                    <div>Rango máximo fijo: {eff("gridRangeMaxPct", 5.0)?.toFixed(2)}%</div>
                    <div>Distancia máxima desde el centro: {eff("maxDistanceFromCenterPct", 10.0)?.toFixed(2)}%</div>
                    <div>Distancia máxima venta-compra: {eff("maxSellDistanceFromNearestBuyPct", 8.0)?.toFixed(2)}%</div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-muted/20 border p-3 space-y-2 text-xs text-muted-foreground">
                  <p>Estos ajustes no afectan mientras el rango fijo esté activo:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>Cálculo adaptativo: {String(eff("adaptiveRangeEnabled", true))}</div>
                    <div>Carácter: {eff("adaptiveRangeProfile", "balanced")}</div>
                    <div>Rango mínimo: {eff("adaptiveRangeMinPct", 1.5)?.toFixed(2)}%</div>
                    <div>Rango máximo: {eff("adaptiveRangeMaxPct", 7.0)?.toFixed(2)}%</div>
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ─── Bloque 2: Carácter del Grid (merged presets + profile) ─── */}
      <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            Carácter del Grid
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Elige el carácter general del Grid. Esto define automáticamente los límites del rango y cómo de agresivo o conservador quiere ser.
          </p>

          {/* Unified character selector — replaces both Presets and Perfil */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: "conservative", label: "Conservador", desc: "Rangos más estrechos, menos exposición, más seguro", color: "green" },
              { v: "balanced", label: "Equilibrado", desc: "Balance entre seguridad y frecuencia de operaciones", color: "amber" },
              { v: "aggressive", label: "Agresivo", desc: "Rangos más amplios, más niveles, mayor exposición", color: "red" },
            ].map((opt) => {
              const currentProfile = eff("adaptiveRangeProfile", "balanced");
              const isActive = currentProfile === opt.v;
              const preset = PRESETS[opt.v];
              return (
                <button
                  key={opt.v}
                  onClick={() => {
                    updateDraft("adaptiveRangeProfile", opt.v);
                    setDraft(prev => ({ ...prev, ...preset.values }));
                  }}
                  className={`rounded-lg border p-3 text-center text-sm transition-all ${
                    isActive
                      ? `border-${opt.color}-500/50 bg-${opt.color}-500/10 text-foreground font-semibold`
                      : "border-border/50 bg-muted/10 text-muted-foreground hover:bg-muted/20"
                  }`}
                >
                  <p className="font-semibold">{opt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                </button>
              );
            })}
          </div>

          {/* Show what the selected character means */}
          <div className="rounded-lg bg-muted/20 border p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground mb-1">Qué significa este carácter:</p>
            <p>{PRESETS[eff("adaptiveRangeProfile", "balanced")]?.text ?? "—"}</p>
          </div>

          {/* Detailed limits per character (collapsible) */}
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-3 w-3" />
              Ver límites detallados del carácter seleccionado
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="rounded-lg bg-muted/20 border p-3 space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground">Rango mínimo global:</span> <span className="font-mono">{eff("adaptiveRangeMinPct", 1.5)?.toFixed(2)}%</span></div>
                  <div><span className="text-muted-foreground">Rango máximo global:</span> <span className="font-mono">{eff("adaptiveRangeMaxPct", 7.0)?.toFixed(2)}%</span></div>
                  <div><span className="text-muted-foreground">Máx baja volatilidad:</span> <span className="font-mono">{eff("adaptiveRangeLowVolMaxPct", 3.0)?.toFixed(2)}%</span></div>
                  <div><span className="text-muted-foreground">Máx lateral normal:</span> <span className="font-mono">{eff("adaptiveRangeNormalMaxPct", 5.0)?.toFixed(2)}%</span></div>
                  <div><span className="text-muted-foreground">Máx alta volatilidad:</span> <span className="font-mono">{eff("adaptiveRangeHighVolMaxPct", 7.0)?.toFixed(2)}%</span></div>
                  <div><span className="text-muted-foreground">Mínimo niveles viables:</span> <span className="font-mono">{eff("adaptiveRangeMinViableLevels", 4)}</span></div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ─── Bloque 3: Ajustes finos ───────────────────────── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            Ajustes finos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Estos ajustes te permiten controlar manualmente la separación entre niveles y el beneficio objetivo. Si no estás seguro, mantén los valores por defecto.
          </p>

          <div className="space-y-2">
            <Label className="text-sm">Separación mínima entre niveles: {eff("gridStepMinPct", 0.15)?.toFixed(2)}%</Label>
            <Slider
              value={[eff("gridStepMinPct", 0.15)]}
              min={0.05} max={1.0} step={0.05}
              onValueChange={(v) => updateDraft("gridStepMinPct", v[0])}
            />
            <p className="text-sm text-muted-foreground">Distancia mínima entre niveles de compra/venta. El motor puede aumentarla automáticamente para cubrir fees y beneficio neto.</p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Separación máxima entre niveles: {eff("gridStepMaxPct", 3.0)?.toFixed(2)}%</Label>
            <Slider
              value={[eff("gridStepMaxPct", 3.0)]}
              min={1.0} max={10.0} step={0.5}
              onValueChange={(v) => updateDraft("gridStepMaxPct", v[0])}
            />
            <p className="text-sm text-muted-foreground">Distancia máxima permitida entre niveles. No define el rango por sí solo; el rango también depende de la volatilidad y el beneficio neto.</p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Beneficio neto objetivo por nivel: {eff("netProfitTargetPct", 0.8)?.toFixed(2)}%</Label>
            <Slider
              value={[eff("netProfitTargetPct", 0.8)]}
              min={0.1} max={3.0} step={0.1}
              onValueChange={(v) => updateDraft("netProfitTargetPct", v[0])}
            />
            <p className="text-sm text-muted-foreground">Beneficio mínimo que quieres obtener por cada ciclo de compra-venta, después de restar fees y reserva fiscal. Más alto = más beneficio por ciclo pero más difícil de cerrar.</p>
          </div>

          {/* Adaptive-specific fine settings */}
          {isAdaptive && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label className="text-sm">Forzar todos los niveles</Label>
                    <p className="text-sm text-muted-foreground mt-1">Si está activado, intenta meter todos los niveles solicitados aunque el rango tenga que ser muy amplio. Si no cabe, marca el rango como no viable.</p>
                  </div>
                  <Switch
                    checked={eff("adaptiveRangeTargetFullLevels", false)}
                    onCheckedChange={(v) => updateDraft("adaptiveRangeTargetFullLevels", v)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Mínimo de niveles para que el rango sea viable: {eff("adaptiveRangeMinViableLevels", 4)}</Label>
                  <Slider value={[eff("adaptiveRangeMinViableLevels", 4)]} min={2} max={12} step={1}
                    onValueChange={(v) => updateDraft("adaptiveRangeMinViableLevels", v[0])} />
                  <p className="text-sm text-muted-foreground">Si no caben al menos estos niveles, el rango se considera no viable y no se genera.</p>
                </div>
              </div>

              {/* Límites por régimen — collapsible */}
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <ChevronDown className="h-3 w-3" />
                  Ajustar límites de rango por tipo de mercado
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
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
                      <Label className="text-sm text-xs">Máx baja volatilidad: {eff("adaptiveRangeLowVolMaxPct", 3.0)?.toFixed(2)}%</Label>
                      <Slider value={[eff("adaptiveRangeLowVolMaxPct", 3.0)]} min={1.0} max={8.0} step={0.25}
                        onValueChange={(v) => updateDraft("adaptiveRangeLowVolMaxPct", v[0])} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm text-xs">Máx lateral normal: {eff("adaptiveRangeNormalMaxPct", 5.0)?.toFixed(2)}%</Label>
                      <Slider value={[eff("adaptiveRangeNormalMaxPct", 5.0)]} min={2.0} max={10.0} step={0.25}
                        onValueChange={(v) => updateDraft("adaptiveRangeNormalMaxPct", v[0])} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm text-xs">Máx alta volatilidad: {eff("adaptiveRangeHighVolMaxPct", 7.0)?.toFixed(2)}%</Label>
                      <Slider value={[eff("adaptiveRangeHighVolMaxPct", 7.0)]} min={3.0} max={15.0} step={0.5}
                        onValueChange={(v) => updateDraft("adaptiveRangeHighVolMaxPct", v[0])} />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </>
          )}

          {/* Fixed-compact-specific settings */}
          {!isAdaptive && (
            <>
              <div className="space-y-2">
                <Label className="text-sm">Rango máximo (fijo): {eff("gridRangeMaxPct", 5.0)?.toFixed(2)}%</Label>
                <Slider value={[eff("gridRangeMaxPct", 5.0)]} min={1.0} max={15.0} step={0.5}
                  onValueChange={(v) => updateDraft("gridRangeMaxPct", v[0])} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Distancia máxima desde el centro: {eff("maxDistanceFromCenterPct", 10.0)?.toFixed(2)}%</Label>
                <Slider value={[eff("maxDistanceFromCenterPct", 10.0)]} min={2.0} max={20.0} step={0.5}
                  onValueChange={(v) => updateDraft("maxDistanceFromCenterPct", v[0])} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Distancia máxima venta-compra: {eff("maxSellDistanceFromNearestBuyPct", 8.0)?.toFixed(2)}%</Label>
                <Slider value={[eff("maxSellDistanceFromNearestBuyPct", 8.0)]} min={2.0} max={15.0} step={0.5}
                  onValueChange={(v) => updateDraft("maxSellDistanceFromNearestBuyPct", v[0])} />
              </div>
            </>
          )}

          {/* Valor efectivo usado por el motor */}
          <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 space-y-2 text-sm">
            <p className="font-semibold text-blue-700 dark:text-blue-300">Valor real que usa el motor</p>
            <p className="text-muted-foreground">
              Tu separación manual es <strong className="text-foreground font-mono">{eff("gridStepMinPct", 0.15)?.toFixed(2)}%</strong>
              {minSpacingPctReal != null ? (
                <>
                  , pero el motor no puede bajar de <strong className="text-foreground font-mono">{minSpacingPctReal.toFixed(2)}%</strong> porque debe cubrir beneficio neto, fees y spread. Por tanto, la separación real mínima es <strong className="text-blue-400 font-mono">{effectiveMinSpacing.toFixed(2)}%</strong>.
                </>
              ) : (
                <>. Pendiente de validación para conocer la separación mínima rentable.</>
              )}
            </p>
            <p className="text-muted-foreground">
              Separación máxima permitida: <strong className="text-foreground font-mono">{eff("gridStepMaxPct", 3.0)?.toFixed(2)}%</strong>
              {spacingPct != null ? (
                spacingPct >= eff("gridStepMaxPct", 3.0) - 0.01
                  ? <>. Está limitando ahora mismo.</>
                  : <>. No está limitando ahora mismo.</>
              ) : (
                <>. Pendiente de validación.</>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ─── Bloque 4: Resultado de esta configuración ─────── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-400" />
            Resultado de esta configuración
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Diagnostic-based status */}
          {(() => {
            const diag = auditData?.latestGridDiagnostic;
            if (!diag) {
              return (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Info className="h-4 w-4 shrink-0" />
                  <span>Pendiente de diagnóstico. Pulsa "Analizar ahora sin operar" en la pestaña Bandas.</span>
                </div>
              );
            }
            if (!diag.hasActiveRange) {
              return (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-700 dark:text-amber-300">
                  <p className="font-semibold">Sin rango activo</p>
                  <p>{diag.humanProblem || "No hay rango activo cargado."}</p>
                  <p className="mt-1"><strong>Próximo paso:</strong> {diag.humanNextStep}</p>
                </div>
              );
            }
            const adaptiveDecision = auditData?.rangeIntelligence?.lastAdaptiveRangeDecision;
            if (adaptiveDecision && !adaptiveDecision.adaptiveRangeOk) {
              return (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-700 dark:text-red-300">
                  <p className="font-semibold">Rango no viable</p>
                  <p>{adaptiveDecision.reason || "El rango no es viable con la configuración actual."}</p>
                </div>
              );
            }
            if (diag.professionalGeneratorGeneratedLevels === 0 && diag.repeatedCompactEventsCount > 0) {
              return (
                <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 p-3 text-sm text-orange-700 dark:text-orange-300">
                  <p className="font-semibold">El generador no produce niveles</p>
                  <p>Hay {diag.repeatedCompactEventsCount} evento(s) compacto(s). Revisa las recomendaciones de abajo.</p>
                </div>
              );
            }
            return (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>El rango es viable y el generador produce niveles. Configuración correcta.</span>
              </div>
            );
          })()}

          {/* Impact messages */}
          {impactMessages.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Cambios pendientes:</p>
              {impactMessages.map((msg, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                  msg.type === "danger" ? "bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300"
                  : msg.type === "warning" ? "bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300"
                  : "bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300"
                }`}>
                  {msg.type === "danger" ? <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  : msg.type === "warning" ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  : <Info className="h-4 w-4 mt-0.5 shrink-0" />}
                  <span>{msg.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Smart recommendations */}
          {recommendations.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-purple-400" />
                Recomendaciones inteligentes
              </div>
              {recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className={`rounded-lg p-3 space-y-2 ${
                    rec.severity === "danger" ? "bg-red-500/10 border border-red-500/30"
                    : rec.severity === "warning" ? "bg-amber-500/10 border border-amber-500/30"
                    : "bg-blue-500/10 border border-blue-500/20"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {rec.severity === "danger" ? <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
                    : rec.severity === "warning" ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                    : <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />}
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{rec.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{rec.plainExplanation}</p>
                      {rec.expectedImpact && (
                        <p className="text-xs text-muted-foreground mt-1">
                          <strong>Impacto esperado:</strong> {rec.expectedImpact}
                        </p>
                      )}
                    </div>
                  </div>
                  {rec.recommendedLabel && Object.keys(rec.recommendedPatch).length > 0 && (
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 pl-6">
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{rec.currentValue ?? "—"}</span>
                        <span className="mx-1">→</span>
                        <span className="font-mono font-semibold text-green-500">{rec.recommendedValue ?? rec.recommendedLabel}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleApplyRecommendation(rec)}
                        className="ml-0 sm:ml-auto"
                      >
                        <ArrowRight className="h-3 w-3 mr-1" />
                        Aplicar al borrador
                      </Button>
                      <span className="text-xs text-muted-foreground">Solo modifica el borrador</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 pt-2 border-t">
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            <span>No se regeneran niveles automáticamente. Los cambios solo afectan a futuros rangos. No se activa SHADOW ni REAL.</span>
          </div>
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
