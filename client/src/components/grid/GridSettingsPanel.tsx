import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Settings2, Eye, Code2, RotateCcw, Check, ChevronRight, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

interface GridSettingsPanelProps {
  config: any;
  operational?: any;
  onApply: (updates: Record<string, any>) => void;
  applyPending?: boolean;
}

type FieldType = "usd" | "percent" | "number" | "integer" | "boolean" | "select" | "text";

interface FieldMeta {
  label: string;
  unit?: string;
  type: FieldType;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  help: string;
  impact?: string;
  recommended?: string;
  hidden?: boolean;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? {}));
}

function prettifyLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

const FIELD_META: Record<string, FieldMeta> = {
  gridWalletMaxUsd: {
    label: "Capital máximo del Grid",
    unit: "USD",
    type: "usd",
    min: 100,
    max: 100000,
    step: 100,
    help: "Máximo capital que el Grid puede usar en simulación o real.",
    impact: "Mayor capital = más niveles posibles y más exposición.",
    recommended: "5000",
  },
  adaptiveRangeMinViableLevels: {
    label: "Número deseado de niveles",
    unit: "niveles",
    type: "integer",
    min: 2,
    max: 50,
    step: 1,
    help: "Mínimo de niveles que debe generar el motor en un rango viable.",
    impact: "Más niveles = operaciones más pequeñas y frecuentes.",
    recommended: "8",
  },
  netProfitTargetPct: {
    label: "Beneficio neto objetivo",
    unit: "%",
    type: "percent",
    min: 0.1,
    max: 5.0,
    step: 0.05,
    help: "Beneficio neto esperado por cada ciclo completo de compra-venta.",
    impact: "Más alto = niveles más separados y menos operaciones.",
    recommended: "0.80",
  },
  adaptiveRangeProfile: {
    label: "Perfil de rango",
    type: "select",
    options: [
      { value: "conservative", label: "Conservador" },
      { value: "balanced", label: "Equilibrado" },
      { value: "aggressive", label: "Dinámico" },
    ],
    help: "Define qué tan ancho y frecuente es el rango generado.",
    impact: "Dinámico aprovecha más oscilaciones; Conservador es más seguro.",
    recommended: "balanced",
  },
  hodlRecoveryEnabled: {
    label: "Mantener BTC en caídas (HODL)",
    type: "boolean",
    help: "Si se activa, tras un stop suave el sistema conserva BTC esperando recuperación en lugar de vender.",
    impact: "Puede ampliar pérdidas temporales si el mercado sigue bajando.",
    recommended: "false",
  },
  gridWalletCompoundProfits: {
    label: "Reinvertir beneficios",
    type: "boolean",
    help: "Añade los beneficios acumulados al capital disponible para nuevas compras.",
    impact: "Crecimiento compuesto, pero también mayor exposición.",
    recommended: "true",
  },
  // Expert fields
  gridWalletInitialUsd: {
    label: "Capital inicial",
    unit: "USD",
    type: "usd",
    min: 100,
    max: 100000,
    step: 100,
    help: "Capital de partida usado para el cálculo de cartera.",
    impact: "Base sobre la que se calcula el capital libre.",
  },
  gridWalletUseProfits: {
    label: "Usar beneficios como capital",
    type: "boolean",
    help: "Permite que el capital efectivo crezca con los beneficios.",
    impact: "Activa la expansión del capital según el rendimiento.",
  },
  gridMaxCapitalPerCycleUsd: {
    label: "Capital máximo por ciclo",
    unit: "USD",
    type: "usd",
    min: 10,
    max: 50000,
    step: 10,
    help: "Límite de capital invertido en cada compra individual.",
    impact: "Controla el tamaño máximo de cada posición.",
  },
  gridMaxCapitalPerCyclePct: {
    label: "Capital máximo por ciclo (%)",
    unit: "%",
    type: "percent",
    min: 1,
    max: 100,
    step: 1,
    help: "Porcentaje del capital total que puede destinarse a un ciclo.",
    impact: "Evita que un solo ciclo consuma demasiado capital.",
  },
  gridReservePct: {
    label: "Reserva de capital",
    unit: "%",
    type: "percent",
    min: 0,
    max: 100,
    step: 1,
    help: "Porcentaje del capital que se mantiene fuera del Grid como reserva.",
    impact: "Mayor reserva = menos exposición pero también menos operaciones.",
    recommended: "20",
  },
  gridAllocationMode: {
    label: "Modo de reparto de capital",
    type: "select",
    options: [
      { value: "uniform", label: "Uniforme" },
      { value: "progressive", label: "Progresivo" },
    ],
    help: "Cómo se distribuye el capital entre niveles.",
    impact: "Uniforme reparte igual; Progresivo refuerza niveles inferiores.",
  },
  bandPeriod: {
    label: "Período de Bandas Bollinger",
    unit: "velas",
    type: "integer",
    min: 5,
    max: 100,
    step: 1,
    help: "Número de velas usadas para calcular la banda de Bollinger.",
    impact: "Mayor período = banda más estable y menos reactiva.",
    recommended: "20",
  },
  bandStdDevMultiplier: {
    label: "Multiplicador de desviación Bollinger",
    unit: "σ",
    type: "number",
    min: 1,
    max: 4,
    step: 0.1,
    help: "Factor de desviación estándar para el ancho de la banda.",
    impact: "Más alto = rango más ancho y menos niveles.",
    recommended: "2.0",
  },
  atrPeriod: {
    label: "Período ATR",
    unit: "velas",
    type: "integer",
    min: 5,
    max: 50,
    step: 1,
    help: "Ventana del indicador ATR para medir volatilidad.",
    impact: "Mayor período = ATR más suave.",
    recommended: "14",
  },
  atrTimeframe: {
    label: "Timeframe ATR",
    type: "select",
    options: [
      { value: "15min", label: "15 min" },
      { value: "1h", label: "1 hora" },
      { value: "4h", label: "4 horas" },
      { value: "1d", label: "1 día" },
    ],
    help: "Resolución de las velas para calcular ATR.",
    impact: "Timeframe largo = menos reacciones y más estabilidad.",
    recommended: "1h",
  },
  adaptiveRangeEnabled: {
    label: "Rango inteligente adaptativo",
    type: "boolean",
    help: "El motor ajusta automáticamente el rango según la volatilidad.",
    impact: "Mejor ajuste al régimen de mercado actual.",
    recommended: "true",
  },
  adaptiveRangeMinPct: {
    label: "Ancho mínimo del rango",
    unit: "%",
    type: "percent",
    min: 0.5,
    max: 10,
    step: 0.1,
    help: "Distancia mínima entre el límite inferior y superior del rango.",
    impact: "Evita rangos demasiado estrechos sin utilidad.",
    recommended: "1.5",
  },
  adaptiveRangeMaxPct: {
    label: "Ancho máximo del rango",
    unit: "%",
    type: "percent",
    min: 1,
    max: 20,
    step: 0.1,
    help: "Distancia máxima entre los límites del rango.",
    impact: "Más ancho = más niveles posibles pero más lejanos.",
    recommended: "7.0",
  },
  gridStepMinPct: {
    label: "Separación mínima entre niveles",
    unit: "%",
    type: "percent",
    min: 0.05,
    max: 5,
    step: 0.05,
    help: "Distancia mínima que debe haber entre dos niveles consecutivos.",
    impact: "Evita solapamientos y niveles no rentables.",
    recommended: "0.15",
  },
  gridStepMaxPct: {
    label: "Separación máxima entre niveles",
    unit: "%",
    type: "percent",
    min: 0.5,
    max: 10,
    step: 0.1,
    help: "Distancia máxima entre dos niveles consecutivos.",
    impact: "Evita niveles excesivamente separados.",
    recommended: "3.0",
  },
  pumpGuardDeviationPct: {
    label: "Umbral de protección Pump",
    unit: "%",
    type: "percent",
    min: 0.5,
    max: 15,
    step: 0.5,
    help: "Subida brusca que bloquea nuevas compras.",
    impact: "Más bajo = más conservador ante pumps.",
    recommended: "3.0",
  },
  dumpGuardDeviationPct: {
    label: "Umbral de protección Dump",
    unit: "%",
    type: "percent",
    min: 0.5,
    max: 15,
    step: 0.5,
    help: "Caída brusca que bloquea nuevas compras.",
    impact: "Más bajo = más conservador ante dumps.",
    recommended: "3.0",
  },
  stopLossSoftPct: {
    label: "Stop loss suave",
    unit: "%",
    type: "percent",
    min: 0.5,
    max: 10,
    step: 0.5,
    help: "Pérdida que activa HODL o venta según la configuración de HODL.",
    impact: "Primera línea de defensa.",
    recommended: "2.0",
  },
  stopLossHardPct: {
    label: "Stop loss duro",
    unit: "%",
    type: "percent",
    min: 1,
    max: 25,
    step: 0.5,
    help: "Pérdida que fuerza el cierre de posición aunque HODL esté activo.",
    impact: "Límite definitivo de pérdida por ciclo.",
    recommended: "5.0",
  },
  stopLossEmergencyPct: {
    label: "Stop loss de emergencia",
    unit: "%",
    type: "percent",
    min: 2,
    max: 50,
    step: 1,
    help: "Pérdida que cierra toda la posición inmediatamente.",
    impact: "Protección máxima; puede salir con gran pérdida.",
    recommended: "10.0",
  },
  trailingActivationPct: {
    label: "Activación del trailing",
    unit: "%",
    type: "percent",
    min: 0.1,
    max: 10,
    step: 0.1,
    help: "Beneficio mínimo para activar el trailing stop.",
    impact: "Más alto = espera más ganancia antes de proteger.",
    recommended: "1.0",
  },
  trailingStopPct: {
    label: "Distancia del trailing",
    unit: "%",
    type: "percent",
    min: 0.1,
    max: 5,
    step: 0.1,
    help: "Margen que mantiene el trailing por debajo del máximo alcanzado.",
    impact: "Más bajo = protección más ajustada.",
    recommended: "0.4",
  },
  maxOpenCycles: {
    label: "Máximo de ciclos abiertos",
    unit: "ciclos",
    type: "integer",
    min: 1,
    max: 100,
    step: 1,
    help: "Cantidad máxima de ciclos abiertos simultáneos.",
    impact: "Más ciclos = más capital reservado.",
    recommended: "10",
  },
  maxDailyOrders: {
    label: "Máximo de órdenes diarias",
    unit: "órdenes",
    type: "integer",
    min: 10,
    max: 1000,
    step: 10,
    help: "Límite de seguridad para evitar exceso de actividad.",
    impact: "Evita bucles o condiciones extremas.",
    recommended: "300",
  },
  // Security: never expose taker fallback or execution policy controls in this UX
  makerAttemptsBeforeTaker: { label: "Intentos maker", type: "integer", hidden: true, help: "" },
  takerFallbackEnabled: { label: "Taker fallback", type: "boolean", hidden: true, help: "" },
  takerFallbackAttemptNumber: { label: "Número de intento taker", type: "integer", hidden: true, help: "" },
  maxTakerFallbackPerCycle: { label: "Máximos taker fallback por ciclo", type: "integer", hidden: true, help: "" },
  takerFallbackRequiresNetProfit: { label: "Taker fallback requiere beneficio", type: "boolean", hidden: true, help: "" },
  takerFallbackAuditRequired: { label: "Taker fallback requiere auditoría", type: "boolean", hidden: true, help: "" },
  executionPolicy: { label: "Política de ejecución", type: "text", hidden: true, help: "" },
};

function getFieldMeta(key: string): FieldMeta | undefined {
  return FIELD_META[key];
}

function guessMeta(key: string, value: unknown): FieldMeta {
  const t = typeof value;
  const base: FieldMeta = { label: prettifyLabel(key), type: "text", help: "" };
  if (t === "boolean") {
    base.type = "boolean";
    base.help = "Activa o desactiva esta opción.";
  } else if (t === "number") {
    base.type = "number";
    base.help = "Valor numérico.";
  } else if (t === "string") {
    base.type = "text";
    base.help = "Valor de texto.";
  }
  return base;
}

function FieldControl({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (v: any) => void;
}) {
  const meta = getFieldMeta(fieldKey) ?? guessMeta(fieldKey, value);
  const num = toNum(value) ?? 0;

  switch (meta.type) {
    case "usd":
    case "number":
    case "percent":
    case "integer": {
      const display = meta.type === "percent" ? `${num.toFixed(meta.step && meta.step < 1 ? 2 : 0)}%` : `${num.toLocaleString("es-ES")}${meta.unit ? ` ${meta.unit}` : ""}`;
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">{meta.label}</Label>
            <span className="text-sm font-mono text-cyan-400">{display}</span>
          </div>
          <Slider
            value={[num]}
            min={meta.min ?? 0}
            max={meta.max ?? 100}
            step={meta.step ?? 1}
            onValueChange={(v) => onChange(v[0])}
          />
          <p className="text-xs text-muted-foreground">{meta.help}</p>
          {meta.impact && <p className="text-xs text-muted-foreground"><Lightbulb className="inline h-3 w-3 mr-1" />Impacto: {meta.impact}</p>}
          {meta.recommended && <p className="text-xs text-green-400/80">Recomendado: {meta.recommended}</p>}
        </div>
      );
    }
    case "boolean": {
      const checked = !!value;
      return (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border/50 p-3">
          <div className="space-y-1">
            <Label className="text-sm">{meta.label}</Label>
            <p className="text-xs text-muted-foreground">{meta.help}</p>
            {meta.impact && <p className="text-xs text-muted-foreground">Impacto: {meta.impact}</p>}
          </div>
          <Switch checked={checked} onCheckedChange={onChange} />
        </div>
      );
    }
    case "select": {
      const options = meta.options ?? [{ value: String(value ?? ""), label: String(value ?? "") }];
      return (
        <div className="space-y-2">
          <Label className="text-sm">{meta.label}</Label>
          <select
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{meta.help}</p>
        </div>
      );
    }
    default: {
      return (
        <div className="space-y-2">
          <Label className="text-sm">{meta.label}</Label>
          <input
            type="text"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground">{meta.help}</p>
        </div>
      );
    }
  }
}

function SimpleMode({
  draft,
  onChange,
}: {
  draft: Record<string, any>;
  onChange: (key: string, value: any) => void;
}) {
  return (
    <div className="space-y-6">
      <FieldControl fieldKey="gridWalletMaxUsd" value={draft.gridWalletMaxUsd} onChange={(v) => onChange("gridWalletMaxUsd", v)} />
      <FieldControl fieldKey="adaptiveRangeMinViableLevels" value={draft.adaptiveRangeMinViableLevels} onChange={(v) => onChange("adaptiveRangeMinViableLevels", v)} />
      <FieldControl fieldKey="netProfitTargetPct" value={draft.netProfitTargetPct} onChange={(v) => onChange("netProfitTargetPct", v)} />
      <FieldControl fieldKey="adaptiveRangeProfile" value={draft.adaptiveRangeProfile} onChange={(v) => onChange("adaptiveRangeProfile", v)} />
      <FieldControl fieldKey="hodlRecoveryEnabled" value={draft.hodlRecoveryEnabled} onChange={(v) => onChange("hodlRecoveryEnabled", v)} />
      <FieldControl fieldKey="gridWalletCompoundProfits" value={draft.gridWalletCompoundProfits} onChange={(v) => onChange("gridWalletCompoundProfits", v)} />

      <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-400">
        Política de ejecución fija: <strong>Solo maker</strong>. No se permite activar taker fallback en esta versión.
      </div>
    </div>
  );
}

function ExpertMode({
  draft,
  expertBlocks,
  onChange,
}: {
  draft: Record<string, any>;
  expertBlocks: any[];
  onChange: (key: string, value: any) => void;
}) {
  return (
    <Accordion type="multiple" className="w-full">
      {(expertBlocks ?? []).map((block) => (
        <AccordionItem key={block.id} value={block.id} className="border-b border-border/50">
          <AccordionTrigger className="text-sm hover:no-underline py-3">
            <div className="flex flex-col items-start">
              <span className="font-medium">{block.title}</span>
              <span className="text-xs text-muted-foreground font-normal">{block.description}</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-5 pb-2">
              {(block.fields ?? []).map((fieldKey: string) => {
                if (FIELD_META[fieldKey]?.hidden) return null;
                if (draft[fieldKey] === undefined) return null;
                return (
                  <div key={fieldKey} className="rounded-lg border border-border/30 p-3 bg-muted/10">
                    <FieldControl fieldKey={fieldKey} value={draft[fieldKey]} onChange={(v) => onChange(fieldKey, v)} />
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export function GridSettingsPanel({ config, operational, onApply, applyPending }: GridSettingsPanelProps) {
  const [viewMode, setViewMode] = useState<"simple" | "expert">("simple");
  const [draft, setDraft] = useState<Record<string, any>>(deepClone(config ?? {}));
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    setDraft(deepClone(config ?? {}));
  }, [config]);

  const expertBlocks = operational?.settings?.expertBlocks ?? [];

  const simpleKeys = [
    "gridWalletMaxUsd",
    "adaptiveRangeMinViableLevels",
    "netProfitTargetPct",
    "adaptiveRangeProfile",
    "hodlRecoveryEnabled",
    "gridWalletCompoundProfits",
  ];

  const changedFields = useMemo(() => {
    const changes: { key: string; oldValue: any; newValue: any }[] = [];
    for (const key of Object.keys(draft)) {
      const oldValue = config?.[key];
      const newValue = draft[key];
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({ key, oldValue, newValue });
      }
    }
    return changes;
  }, [draft, config]);

  const hasChanges = changedFields.length > 0;

  const handleChange = (key: string, value: any) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleDiscard = () => {
    setDraft(deepClone(config ?? {}));
    setReviewOpen(false);
  };

  const handleApply = () => {
    const updates: Record<string, any> = {};
    for (const { key, newValue } of changedFields) {
      updates[key] = newValue;
    }
    onApply(updates);
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Ajustes
          </CardTitle>
          <div className="flex items-center gap-1 rounded-md border border-border/40 p-0.5">
            <Button
              size="sm"
              variant={viewMode === "simple" ? "default" : "ghost"}
              className="h-7 text-xs gap-1"
              onClick={() => setViewMode("simple")}
            >
              <Eye className="h-3 w-3" />
              Sencillo
            </Button>
            <Button
              size="sm"
              variant={viewMode === "expert" ? "default" : "ghost"}
              className="h-7 text-xs gap-1"
              onClick={() => setViewMode("expert")}
            >
              <Code2 className="h-3 w-3" />
              Experto
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {viewMode === "simple" ? (
          <SimpleMode draft={draft} onChange={handleChange} />
        ) : (
          <ExpertMode draft={draft} expertBlocks={expertBlocks} onChange={handleChange} />
        )}

        {/* Draft actions */}
        <div className="sticky bottom-0 z-10 rounded-lg border border-border/50 bg-card/95 p-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2">
            {hasChanges ? (
              <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10">
                {changedFields.length} cambio{changedFields.length > 1 ? "s" : ""} pendiente{changedFields.length > 1 ? "s" : ""}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-green-400 border-green-500/30 bg-green-500/10">
                Sin cambios
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleDiscard} disabled={!hasChanges || applyPending}>
              <RotateCcw className="h-3 w-3 mr-1" />
              Descartar
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setReviewOpen((v) => !v)} disabled={!hasChanges}>
              <ChevronRight className={cn("h-3 w-3 mr-1 transition-transform", reviewOpen && "rotate-90")} />
              Revisar cambios
            </Button>
            <Button size="sm" onClick={handleApply} disabled={!hasChanges || applyPending}>
              <Check className="h-3 w-3 mr-1" />
              Aplicar configuración
            </Button>
          </div>
        </div>

        {reviewOpen && hasChanges && (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
            <p className="text-sm font-medium">Cambios pendientes</p>
            <div className="space-y-1">
              {changedFields.map((change) => (
                <div key={change.key} className="grid grid-cols-3 gap-2 text-xs">
                  <span className="text-muted-foreground">{FIELD_META[change.key]?.label ?? prettifyLabel(change.key)}</span>
                  <span className="font-mono truncate" title={JSON.stringify(change.oldValue)}>{JSON.stringify(change.oldValue)}</span>
                  <span className="font-mono text-cyan-400 truncate" title={JSON.stringify(change.newValue)}>{JSON.stringify(change.newValue)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { FIELD_META, prettifyLabel };
