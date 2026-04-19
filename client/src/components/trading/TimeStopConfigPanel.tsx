/**
 * TimeStopConfigPanel — FASE 4 refactor completo
 *
 * UI única y honesta para gestionar la tabla `time_stop_config`:
 *  - Slider TTL base por par (y wildcard `*`)
 *  - Toggle "usar régimen dinámico" (si off → factor=1 en los 3 regímenes)
 *  - Factores avanzados TREND/RANGE/TRANSITION
 *  - Clamp min/max TTL
 *  - Toggle softMode real (no cierra en pérdida neta)
 *  - Selector closeOrderType (market/limit)
 *  - Preview TTL efectivo por régimen
 *
 * Consume los endpoints existentes:
 *  - GET  /api/config/timestop          → lista todos
 *  - GET  /api/config/timestop/:pair/preview → preview TTL por régimen
 *  - PUT  /api/config/timestop          → upsert
 *  - DELETE /api/config/timestop/:id    → eliminar
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Timer, Plus, Trash2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TimeStopConfigRow {
  id: number;
  pair: string;
  market: string;
  ttlBaseHours: string;
  factorTrend: string;
  factorRange: string;
  factorTransition: string;
  minTtlHours: string;
  maxTtlHours: string;
  closeOrderType: "market" | "limit";
  limitFallbackSeconds: number;
  telegramAlertEnabled: boolean;
  logExpiryEvenIfDisabled: boolean;
  softMode: boolean;
  priority: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface PreviewResult {
  ttlHours: number;
  regimeFactor: number;
  regime: string;
  clamped: boolean;
}

const DEFAULT_PAIRS = ["*", "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "TON/USD"];

function toNum(v: string | number, fallback: number): number {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

export function TimeStopConfigPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<{ configs: TimeStopConfigRow[] }>({
    queryKey: ["timestopConfigs"],
    queryFn: async () => {
      const res = await fetch("/api/config/timestop");
      if (!res.ok) throw new Error("Failed to load TimeStop configs");
      return res.json();
    },
    refetchOnWindowFocus: false,
  });

  const configs = data?.configs ?? [];
  const wildcard = useMemo(
    () => configs.find(c => c.pair === "*" && c.market === "spot"),
    [configs]
  );

  const upsertMutation = useMutation({
    mutationFn: async (payload: Partial<TimeStopConfigRow> & { pair: string }) => {
      const res = await fetch("/api/config/timestop", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.details || err?.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: (_d, payload) => {
      toast({ title: "Time-Stop guardado", description: `Configuración actualizada para ${payload.pair}:${payload.market ?? "spot"}` });
      queryClient.invalidateQueries({ queryKey: ["timestopConfigs"] });
    },
    onError: (e: Error) => {
      toast({ title: "Error al guardar", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/config/timestop/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Eliminado", description: "Fila de Time-Stop eliminada" });
      queryClient.invalidateQueries({ queryKey: ["timestopConfigs"] });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const [addPair, setAddPair] = useState<string>("");

  const addPairRow = () => {
    if (!addPair.trim()) return;
    const pair = addPair.trim().toUpperCase();
    // Use wildcard defaults if available, otherwise sensible defaults
    const base = wildcard ?? {
      ttlBaseHours: "36",
      factorTrend: "1.200",
      factorRange: "0.800",
      factorTransition: "1.000",
      minTtlHours: "4",
      maxTtlHours: "168",
      closeOrderType: "market" as const,
      limitFallbackSeconds: 30,
      telegramAlertEnabled: true,
      logExpiryEvenIfDisabled: true,
      softMode: true,
      priority: 10,
      isActive: true,
    };
    upsertMutation.mutate({
      pair,
      market: "spot",
      ttlBaseHours: base.ttlBaseHours,
      factorTrend: base.factorTrend,
      factorRange: base.factorRange,
      factorTransition: base.factorTransition,
      minTtlHours: base.minTtlHours,
      maxTtlHours: base.maxTtlHours,
      closeOrderType: base.closeOrderType,
      limitFallbackSeconds: base.limitFallbackSeconds,
      telegramAlertEnabled: base.telegramAlertEnabled,
      logExpiryEvenIfDisabled: base.logExpiryEvenIfDisabled,
      softMode: base.softMode,
      priority: 10,
      isActive: true,
    });
    setAddPair("");
  };

  return (
    <Card className="glass-panel border-amber-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Timer className="h-5 w-5 text-amber-500" />
          Time-Stop — Configuración
          <Badge variant="outline" className="text-amber-400 border-amber-500/50 text-[10px]">FUENTE ÚNICA</Badge>
        </CardTitle>
        <CardDescription>
          TTL por par con multiplicadores de régimen y modo soft real. Esta configuración <strong>reemplaza</strong> el
          antiguo input global en Motor Adaptativo; el motor usa esta tabla (con fallback a wildcard <code>*</code> si un par
          no tiene fila propia).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <div className="text-xs text-muted-foreground">Cargando configuración…</div>}
        {error && (
          <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-xs text-red-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Error: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && (
          <>
            {/* Add new pair row */}
            <div className="flex items-end gap-2 p-3 rounded border border-border/50 bg-muted/20">
              <div className="flex-1">
                <Label className="text-xs">Añadir par específico</Label>
                <Input
                  value={addPair}
                  onChange={(e) => setAddPair(e.target.value)}
                  placeholder="Ej. BTC/USD"
                  className="h-8 font-mono bg-background/50 text-xs"
                  list="ts-suggested-pairs"
                />
                <datalist id="ts-suggested-pairs">
                  {DEFAULT_PAIRS.filter(p => p !== "*" && !configs.some(c => c.pair === p)).map(p => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
              <Button
                size="sm"
                onClick={addPairRow}
                disabled={!addPair.trim() || upsertMutation.isPending}
              >
                <Plus className="h-3 w-3 mr-1" /> Añadir
              </Button>
            </div>

            {/* Wildcard / default */}
            {wildcard && (
              <TimeStopRowEditor
                row={wildcard}
                isWildcard
                onSave={(patch) => upsertMutation.mutate({ ...wildcard, ...patch } as any)}
                onDelete={undefined}
                saving={upsertMutation.isPending}
              />
            )}

            {/* Per-pair rows */}
            {configs
              .filter(c => !(c.pair === "*" && c.market === "spot"))
              .sort((a, b) => a.pair.localeCompare(b.pair))
              .map(row => (
                <TimeStopRowEditor
                  key={row.id}
                  row={row}
                  isWildcard={false}
                  onSave={(patch) => upsertMutation.mutate({ ...row, ...patch } as any)}
                  onDelete={() => deleteMutation.mutate(row.id)}
                  saving={upsertMutation.isPending || deleteMutation.isPending}
                />
              ))}

            {configs.length === 0 && (
              <div className="p-4 text-xs text-muted-foreground text-center border border-dashed border-border/50 rounded">
                No hay configuraciones todavía. Añade un par o usa el wildcard por defecto.
              </div>
            )}

            {/* Info block */}
            <div className="p-3 rounded border border-amber-500/20 bg-amber-500/5 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-amber-400">Cómo funciona:</p>
              <p>• <strong>TTL final</strong> = clamp(TTL base × factor régimen, min, max).</p>
              <p>• <strong>Modo soft</strong>: si está activo y el TTL expira, el bot <strong>solo cerrará si el P&amp;L neto (precio − fees) es positivo</strong>. Evita cerrar a pérdida por timeout.</p>
              <p>• <strong>Régimen dinámico</strong>: si desactivas "usar régimen", los tres factores se fuerzan a 1.0 (TTL fijo = TTL base).</p>
              <p>• El par <code>*</code> es el valor por defecto que se aplica a cualquier par sin fila propia.</p>
            </div>

            {/* FASE 4.1 — Semántica del toggle "Activo" */}
            <div className="p-3 rounded border border-sky-500/20 bg-sky-500/5 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-sky-400">Toggle "Activo" (desde FASE 4.1):</p>
              <p>• <strong>Fila específica (ej. BTC/USD) en OFF</strong> → Time-Stop queda <strong>completamente desactivado para ese par</strong>. NO cae al wildcard, NO aplica legacy.</p>
              <p>• <strong>Fila wildcard <code>*</code> en OFF y sin fila específica</strong> → Time-Stop desactivado globalmente (comportamiento seguro).</p>
              <p>• Para pausar el Time-Stop de un <strong>lote individual</strong> sin tocar la config del par, usa el botón ⏱ en la tarjeta de la posición.</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row editor
// ─────────────────────────────────────────────────────────────────────────────

interface RowEditorProps {
  row: TimeStopConfigRow;
  isWildcard: boolean;
  onSave: (patch: Partial<TimeStopConfigRow>) => void;
  onDelete?: () => void;
  saving: boolean;
}

function TimeStopRowEditor({ row, isWildcard, onSave, onDelete, saving }: RowEditorProps) {
  const [ttlBase, setTtlBase] = useState<number>(toNum(row.ttlBaseHours, 36));
  const [minTtl, setMinTtl] = useState<number>(toNum(row.minTtlHours, 4));
  const [maxTtl, setMaxTtl] = useState<number>(toNum(row.maxTtlHours, 168));
  const [fTrend, setFTrend] = useState<number>(toNum(row.factorTrend, 1.2));
  const [fRange, setFRange] = useState<number>(toNum(row.factorRange, 0.8));
  const [fTrans, setFTrans] = useState<number>(toNum(row.factorTransition, 1.0));
  const [softMode, setSoftMode] = useState<boolean>(!!row.softMode);
  const [useRegime, setUseRegime] = useState<boolean>(
    !(fTrend === 1 && fRange === 1 && fTrans === 1)
  );
  const [isActive, setIsActive] = useState<boolean>(!!row.isActive);
  const [closeOrderType, setCloseOrderType] = useState<"market" | "limit">(row.closeOrderType);
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

  // Reset from server when row updates
  useEffect(() => {
    setTtlBase(toNum(row.ttlBaseHours, 36));
    setMinTtl(toNum(row.minTtlHours, 4));
    setMaxTtl(toNum(row.maxTtlHours, 168));
    setFTrend(toNum(row.factorTrend, 1.2));
    setFRange(toNum(row.factorRange, 0.8));
    setFTrans(toNum(row.factorTransition, 1.0));
    setSoftMode(!!row.softMode);
    setIsActive(!!row.isActive);
    setCloseOrderType(row.closeOrderType);
    setUseRegime(!(toNum(row.factorTrend, 1.2) === 1 && toNum(row.factorRange, 0.8) === 1 && toNum(row.factorTransition, 1.0) === 1));
  }, [row.id, row.ttlBaseHours, row.minTtlHours, row.maxTtlHours, row.factorTrend, row.factorRange, row.factorTransition, row.softMode, row.isActive, row.closeOrderType]);

  const dirty =
    toNum(row.ttlBaseHours, 36) !== ttlBase ||
    toNum(row.minTtlHours, 4) !== minTtl ||
    toNum(row.maxTtlHours, 168) !== maxTtl ||
    toNum(row.factorTrend, 1.2) !== (useRegime ? fTrend : 1) ||
    toNum(row.factorRange, 0.8) !== (useRegime ? fRange : 1) ||
    toNum(row.factorTransition, 1.0) !== (useRegime ? fTrans : 1) ||
    !!row.softMode !== softMode ||
    !!row.isActive !== isActive ||
    row.closeOrderType !== closeOrderType;

  // Preview TTL effective per regime
  const preview = useMemo(() => {
    const apply = (f: number) => {
      const raw = ttlBase * f;
      const clamped = Math.max(minTtl, Math.min(maxTtl, raw));
      return { hours: clamped, clamped: clamped !== raw, factor: f };
    };
    return {
      TREND: apply(useRegime ? fTrend : 1),
      RANGE: apply(useRegime ? fRange : 1),
      TRANSITION: apply(useRegime ? fTrans : 1),
    };
  }, [ttlBase, minTtl, maxTtl, fTrend, fRange, fTrans, useRegime]);

  const handleSave = () => {
    onSave({
      ttlBaseHours: ttlBase.toString(),
      minTtlHours: minTtl.toString(),
      maxTtlHours: maxTtl.toString(),
      factorTrend: (useRegime ? fTrend : 1).toString(),
      factorRange: (useRegime ? fRange : 1).toString(),
      factorTransition: (useRegime ? fTrans : 1).toString(),
      softMode,
      isActive,
      closeOrderType,
    });
  };

  const handleReset = () => {
    setTtlBase(toNum(row.ttlBaseHours, 36));
    setMinTtl(toNum(row.minTtlHours, 4));
    setMaxTtl(toNum(row.maxTtlHours, 168));
    setFTrend(toNum(row.factorTrend, 1.2));
    setFRange(toNum(row.factorRange, 0.8));
    setFTrans(toNum(row.factorTransition, 1.0));
    setSoftMode(!!row.softMode);
    setIsActive(!!row.isActive);
    setCloseOrderType(row.closeOrderType);
  };

  return (
    <div className={`p-3 rounded border ${isWildcard ? "border-amber-500/40 bg-amber-500/5" : "border-border/50 bg-background/30"} space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-amber-500" />
          <span className="font-mono text-sm font-medium">{row.pair}</span>
          <Badge variant="outline" className="text-[9px]">{row.market}</Badge>
          {isWildcard && <Badge className="text-[9px] bg-amber-500/20 text-amber-300 border-amber-500/40">POR DEFECTO</Badge>}
          {!isActive && <Badge variant="destructive" className="text-[9px]">INACTIVO</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Activo</Label>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          {onDelete && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-red-400 hover:text-red-500"
              onClick={() => {
                if (confirm(`¿Eliminar configuración Time-Stop para ${row.pair}?`)) {
                  onDelete();
                }
              }}
              disabled={saving}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Master slider: TTL base */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">TTL base (horas)</Label>
          <span className="font-mono text-sm text-amber-400">{ttlBase.toFixed(1)}h</span>
        </div>
        <Slider
          value={[ttlBase]}
          onValueChange={(v) => setTtlBase(v[0])}
          min={1}
          max={168}
          step={1}
          className="[&>span]:bg-amber-500"
        />
        <p className="text-[10px] text-muted-foreground">
          Horas máximas que el bot mantiene una posición antes de considerar cierre por tiempo.
        </p>
      </div>

      {/* Soft mode + regime toggles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="flex items-center justify-between p-2 rounded border border-border/40 bg-background/30">
          <div>
            <Label className="text-xs">Modo soft</Label>
            <p className="text-[10px] text-muted-foreground">No cierra si P&amp;L neto ≤ 0</p>
          </div>
          <Switch checked={softMode} onCheckedChange={setSoftMode} />
        </div>
        <div className="flex items-center justify-between p-2 rounded border border-border/40 bg-background/30">
          <div>
            <Label className="text-xs">Usar régimen dinámico</Label>
            <p className="text-[10px] text-muted-foreground">Multiplica TTL según TREND/RANGE/TRANSITION</p>
          </div>
          <Switch checked={useRegime} onCheckedChange={setUseRegime} />
        </div>
      </div>

      {/* Preview TTL per regime */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="p-2 rounded border border-green-500/30 bg-green-500/5 text-center">
          <div className="text-muted-foreground text-[10px]">TREND {useRegime && `× ${fTrend.toFixed(2)}`}</div>
          <div className="font-mono text-green-400">
            {preview.TREND.hours.toFixed(1)}h
            {preview.TREND.clamped && <span className="text-[9px] text-amber-400 ml-1">(clamp)</span>}
          </div>
        </div>
        <div className="p-2 rounded border border-blue-500/30 bg-blue-500/5 text-center">
          <div className="text-muted-foreground text-[10px]">RANGE {useRegime && `× ${fRange.toFixed(2)}`}</div>
          <div className="font-mono text-blue-400">
            {preview.RANGE.hours.toFixed(1)}h
            {preview.RANGE.clamped && <span className="text-[9px] text-amber-400 ml-1">(clamp)</span>}
          </div>
        </div>
        <div className="p-2 rounded border border-yellow-500/30 bg-yellow-500/5 text-center">
          <div className="text-muted-foreground text-[10px]">TRANSITION {useRegime && `× ${fTrans.toFixed(2)}`}</div>
          <div className="font-mono text-yellow-400">
            {preview.TRANSITION.hours.toFixed(1)}h
            {preview.TRANSITION.clamped && <span className="text-[9px] text-amber-400 ml-1">(clamp)</span>}
          </div>
        </div>
      </div>

      {/* Advanced */}
      <div className="border-t border-border/40 pt-2">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground underline"
          onClick={() => setAdvancedOpen(v => !v)}
        >
          {advancedOpen ? "Ocultar" : "Mostrar"} opciones avanzadas
        </button>
        {advancedOpen && (
          <div className="mt-3 space-y-3">
            {/* Regime factors */}
            {useRegime && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px]">Factor TREND</Label>
                  <Input
                    type="number" step="0.05" min={0.1} max={5.0}
                    value={fTrend}
                    onChange={(e) => setFTrend(parseFloat(e.target.value) || 1)}
                    className="h-7 text-xs font-mono bg-background/50"
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Factor RANGE</Label>
                  <Input
                    type="number" step="0.05" min={0.1} max={5.0}
                    value={fRange}
                    onChange={(e) => setFRange(parseFloat(e.target.value) || 1)}
                    className="h-7 text-xs font-mono bg-background/50"
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Factor TRANSITION</Label>
                  <Input
                    type="number" step="0.05" min={0.1} max={5.0}
                    value={fTrans}
                    onChange={(e) => setFTrans(parseFloat(e.target.value) || 1)}
                    className="h-7 text-xs font-mono bg-background/50"
                  />
                </div>
              </div>
            )}
            {/* Clamp + closeOrderType */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px]">TTL mínimo (h)</Label>
                <Input
                  type="number" step="0.5" min={0.5} max={500}
                  value={minTtl}
                  onChange={(e) => setMinTtl(parseFloat(e.target.value) || 1)}
                  className="h-7 text-xs font-mono bg-background/50"
                />
              </div>
              <div>
                <Label className="text-[10px]">TTL máximo (h)</Label>
                <Input
                  type="number" step="1" min={1} max={720}
                  value={maxTtl}
                  onChange={(e) => setMaxTtl(parseFloat(e.target.value) || 168)}
                  className="h-7 text-xs font-mono bg-background/50"
                />
              </div>
              <div>
                <Label className="text-[10px]">Tipo de orden al cierre</Label>
                <Select value={closeOrderType} onValueChange={(v) => setCloseOrderType(v as "market" | "limit")}>
                  <SelectTrigger className="h-7 text-xs font-mono bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market">Market</SelectItem>
                    <SelectItem value="limit">Limit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {dirty && (
          <span className="text-[10px] text-amber-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> cambios sin guardar
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={handleReset} disabled={!dirty || saving}>
          <RefreshCw className="h-3 w-3 mr-1" /> Deshacer
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
          <CheckCircle2 className="h-3 w-3 mr-1" /> Guardar
        </Button>
      </div>
    </div>
  );
}
