/**
 * IdcaHybridPanel — UI panel for IDCA Hybrid Intelligent Layers
 *
 * Shows current mode (Off / Observador / Real), regime classification,
 * Mean Reversion and Grid overlay status, and alert configuration.
 *
 * SAFE: switching to Off or Observer never touches real orders.
 * Real mode requires explicit user confirmation.
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Brain, ChevronDown, Eye, Grid3X3, RefreshCw, Settings2, TrendingDown,
  Zap, Activity, AlertTriangle, CheckCircle2, Info, Play,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = "/api/idca/hybrid";

async function apiGet(path: string) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path: string, body?: object) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function useIdcaHybridConfig() {
  return useQuery({
    queryKey: ["idca", "hybrid", "config"],
    queryFn: () => apiGet("/config"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useIdcaHybridStatus(pair?: string) {
  return useQuery({
    queryKey: ["idca", "hybrid", "status", pair],
    queryFn: () => apiGet(`/status${pair ? `?pair=${encodeURIComponent(pair)}` : ""}`),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}

type HybridMode = "off" | "observer" | "real";

const MODE_LABELS: Record<HybridMode, string> = {
  off: "Apagado",
  observer: "Observador",
  real: "Real",
};

const REGIME_LABELS: Record<string, string> = {
  lateral: "Lateral",
  bullish: "Alcista",
  bearish: "Bajista",
  high_volatility: "Alta volatilidad",
  unknown: "Desconocido",
  insufficient_data: "Datos insuficientes",
};

const MR_STATE_LABELS: Record<string, string> = {
  confirmed: "Confirmada",
  blocked_by_bear_trend: "Bloqueada (tendencia bajista)",
  blocked_by_insufficient_deviation: "Desviación insuficiente",
  blocked_by_high_volatility: "Bloqueada (alta vol.)",
  blocked_by_data_quality: "Datos insuficientes",
  neutral: "Neutral",
};

const GRID_STATE_LABELS: Record<string, string> = {
  inactive: "Inactivo",
  armed: "Armado",
  active: "Activo",
  paused_breakout_down: "Pausado (ruptura bajista)",
  paused_spread_high: "Pausado (spread alto)",
  paused_bear_trend: "Pausado (tendencia bajista)",
  paused_cycle_overloaded: "Pausado (ciclo saturado)",
  closed: "Cerrado",
};

function regimeBadge(regime: string) {
  const colors: Record<string, string> = {
    lateral: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    bullish: "bg-green-500/15 text-green-400 border-green-500/30",
    bearish: "bg-red-500/15 text-red-400 border-red-500/30",
    high_volatility: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    unknown: "bg-gray-500/15 text-gray-400 border-gray-500/30",
    insufficient_data: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  };
  return colors[regime] ?? colors["unknown"];
}

function modeBadge(mode: HybridMode) {
  const colors: Record<HybridMode, string> = {
    off: "bg-gray-500/15 text-gray-400 border-gray-500/30",
    observer: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    real: "bg-green-500/15 text-green-400 border-green-500/30",
  };
  return colors[mode];
}

export function IdcaHybridPanel({ pair }: { pair?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: config, isLoading: configLoading } = useIdcaHybridConfig();
  const { data: status } = useIdcaHybridStatus(pair);
  const [confirmRealDialog, setConfirmRealDialog] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const currentMode: HybridMode = config?.mode ?? "off";
  const hybridConfig = config?.hybridConfig ?? {};
  const alertConfig = config?.alertConfig ?? {};

  const setMode = useMutation({
    mutationFn: (mode: HybridMode) => apiPost("/mode", { mode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca", "hybrid"] });
      toast({ title: "Modo actualizado", description: `IDCA Híbrido: ${MODE_LABELS[currentMode as HybridMode]}` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const applyRecommended = useMutation({
    mutationFn: () => apiPost("/apply-recommended"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca", "hybrid"] });
      toast({ title: "Preset conservador aplicado", description: "Modo observador activado con configuración segura." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const patchConfig = useMutation({
    mutationFn: (patch: object) => apiPost("/config", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["idca", "hybrid"] }),
    onError: (e: Error) => toast({ title: "Error guardando config", description: e.message, variant: "destructive" }),
  });

  const patchAlertConfig = useMutation({
    mutationFn: (patch: object) => apiPost("/alert-config", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["idca", "hybrid"] }),
    onError: (e: Error) => toast({ title: "Error guardando alertas", description: e.message, variant: "destructive" }),
  });

  function handleModeChange(mode: HybridMode) {
    if (mode === "real") {
      setConfirmRealDialog(true);
    } else {
      setMode.mutate(mode);
    }
  }

  const statusRows = Array.isArray(status?.data) ? status.data : [];
  const latestState = statusRows[0];

  if (configLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span>Cargando configuración híbrida...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4 text-primary" />
            IDCA Híbrido Inteligente
            <Badge variant="outline" className={`ml-auto text-xs px-2 py-0.5 ${modeBadge(currentMode)}`}>
              {currentMode === "off" && <Activity className="h-3 w-3 mr-1" />}
              {currentMode === "observer" && <Eye className="h-3 w-3 mr-1" />}
              {currentMode === "real" && <Zap className="h-3 w-3 mr-1" />}
              {MODE_LABELS[currentMode]}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode selector */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Modo de operación</Label>
            <div className="flex gap-2">
              {(["off", "observer", "real"] as HybridMode[]).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={currentMode === m ? "default" : "outline"}
                  className="flex-1 text-xs h-8"
                  onClick={() => handleModeChange(m)}
                  disabled={setMode.isPending}
                >
                  {m === "off" && <Activity className="h-3 w-3 mr-1" />}
                  {m === "observer" && <Eye className="h-3 w-3 mr-1" />}
                  {m === "real" && <Zap className="h-3 w-3 mr-1" />}
                  {MODE_LABELS[m]}
                </Button>
              ))}
            </div>
          </div>

          {currentMode === "off" && (
            <Alert className="border-muted">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Módulo desactivado. El bot IDCA funciona exactamente como siempre.
                Activa <strong>Observador</strong> para ver análisis sin afectar órdenes.
              </AlertDescription>
            </Alert>
          )}

          {currentMode === "observer" && (
            <Alert className="border-blue-500/30 bg-blue-500/5">
              <Eye className="h-4 w-4 text-blue-400" />
              <AlertDescription className="text-xs text-blue-300">
                <strong>Modo Observador:</strong> El análisis híbrido se ejecuta y persiste, pero NO bloquea compras IDCA.
                Úsalo para validar el comportamiento antes de activar modo Real.
              </AlertDescription>
            </Alert>
          )}

          {currentMode === "real" && (
            <Alert className="border-orange-500/30 bg-orange-500/5">
              <AlertTriangle className="h-4 w-4 text-orange-400" />
              <AlertDescription className="text-xs text-orange-300">
                <strong>Modo Real activo.</strong> La capa de Reversión a la Media puede bloquear entradas IDCA
                cuando detecte tendencias bajistas o alta volatilidad.
              </AlertDescription>
            </Alert>
          )}

          {/* Quick preset */}
          {currentMode === "off" && (
            <Button
              variant="outline" size="sm" className="w-full text-xs h-8 gap-1"
              onClick={() => applyRecommended.mutate()}
              disabled={applyRecommended.isPending}
            >
              <Play className="h-3 w-3" />
              Activar preset conservador (Observador)
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Live state (only shown when mode !== off) */}
      {currentMode !== "off" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-3.5 w-3.5" />
              Estado en tiempo real
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestState ? (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Régimen</span>
                  <div className="mt-0.5">
                    <Badge variant="outline" className={`text-xs ${regimeBadge(latestState.regime)}`}>
                      {REGIME_LABELS[latestState.regime] ?? latestState.regime}
                    </Badge>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Reversión a la Media</span>
                  <div className="mt-0.5 font-medium text-foreground">
                    {MR_STATE_LABELS[latestState.mean_reversion_state] ?? latestState.mean_reversion_state}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Grid</span>
                  <div className="mt-0.5 font-medium text-foreground">
                    {GRID_STATE_LABELS[latestState.grid_state] ?? latestState.grid_state}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Score</span>
                  <div className="mt-0.5 font-medium text-foreground">{latestState.score ?? "—"}/100</div>
                </div>
                {latestState.z_score != null && (
                  <div>
                    <span className="text-muted-foreground">Z-Score</span>
                    <div className="mt-0.5 font-medium text-foreground">{parseFloat(latestState.z_score).toFixed(2)}</div>
                  </div>
                )}
                {latestState.atr_pct != null && (
                  <div>
                    <span className="text-muted-foreground">ATRP</span>
                    <div className="mt-0.5 font-medium text-foreground">{parseFloat(latestState.atr_pct).toFixed(2)}%</div>
                  </div>
                )}
                {latestState.natural_reason && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Análisis</span>
                    <div className="mt-0.5 text-foreground leading-relaxed">{latestState.natural_reason}</div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sin datos aún. El estado se actualizará en el próximo ciclo del motor IDCA.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Advanced config */}
      {currentMode !== "off" && (
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <Card>
            <CardHeader className="pb-2">
              <CollapsibleTrigger className="flex items-center justify-between w-full">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Settings2 className="h-3.5 w-3.5" />
                  Configuración avanzada
                </CardTitle>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="space-y-4 pt-0">

                {/* Layers config */}
                <div className="space-y-3">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Capas activas</Label>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="h-3.5 w-3.5 text-blue-400" />
                      <div>
                        <Label className="text-xs">Reversión a la Media</Label>
                        <p className="text-xs text-muted-foreground">Filtra entradas basado en desviación del VWAP</p>
                      </div>
                    </div>
                    <Switch
                      checked={hybridConfig.meanReversionEnabled ?? true}
                      onCheckedChange={(v) => patchConfig.mutate({ meanReversionEnabled: v })}
                      disabled={patchConfig.isPending}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Grid3X3 className="h-3.5 w-3.5 text-purple-400" />
                      <div>
                        <Label className="text-xs">Grid Inteligente</Label>
                        <p className="text-xs text-muted-foreground">Grid bidireccional en mercados laterales</p>
                      </div>
                    </div>
                    <Switch
                      checked={hybridConfig.gridEnabled ?? false}
                      onCheckedChange={(v) => patchConfig.mutate({ gridEnabled: v })}
                      disabled={patchConfig.isPending}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
                      <div>
                        <Label className="text-xs">Bloqueo por alta volatilidad</Label>
                        <p className="text-xs text-muted-foreground">No comprar cuando ATRP {'>'} 4%</p>
                      </div>
                    </div>
                    <Switch
                      checked={hybridConfig.dynamicVolatilityEnabled ?? true}
                      onCheckedChange={(v) => patchConfig.mutate({ dynamicVolatilityEnabled: v })}
                      disabled={patchConfig.isPending}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                      <div>
                        <Label className="text-xs">Bloqueo por tendencia bajista</Label>
                        <p className="text-xs text-muted-foreground">No comprar cuando régimen es bajista</p>
                      </div>
                    </div>
                    <Switch
                      checked={hybridConfig.bearTrendBlockEnabled ?? true}
                      onCheckedChange={(v) => patchConfig.mutate({ bearTrendBlockEnabled: v })}
                      disabled={patchConfig.isPending}
                    />
                  </div>
                </div>

                {/* Alert config */}
                <div className="space-y-3 pt-2 border-t border-border/30">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Alertas Telegram</Label>

                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Alertas híbridas activadas</Label>
                    <Switch
                      checked={alertConfig.enabled ?? true}
                      onCheckedChange={(v) => patchAlertConfig.mutate({ enabled: v })}
                      disabled={patchAlertConfig.isPending}
                    />
                  </div>
                  {alertConfig.enabled && (
                    <>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Cambio de régimen</Label>
                        <Switch
                          checked={alertConfig.regimeChange ?? true}
                          onCheckedChange={(v) => patchAlertConfig.mutate({ regimeChange: v })}
                          disabled={patchAlertConfig.isPending}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Reversión confirmada / bloqueada</Label>
                        <Switch
                          checked={alertConfig.meanReversionAllowed ?? true}
                          onCheckedChange={(v) => patchAlertConfig.mutate({ meanReversionAllowed: v, meanReversionBlocked: v })}
                          disabled={patchAlertConfig.isPending}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Grid armado / pausado</Label>
                        <Switch
                          checked={alertConfig.gridArmed ?? true}
                          onCheckedChange={(v) => patchAlertConfig.mutate({ gridArmed: v, gridPaused: v })}
                          disabled={patchAlertConfig.isPending}
                        />
                      </div>
                    </>
                  )}
                </div>

                {currentMode === "observer" && (
                  <Alert className="border-muted">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    <AlertDescription className="text-xs">
                      En modo Observador, ninguna decisión del Híbrido afecta órdenes reales.
                      Los datos se guardan en <code className="text-xs bg-muted px-1 rounded">idca_hybrid_state</code> para análisis.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Confirm Real mode dialog */}
      <AlertDialog open={confirmRealDialog} onOpenChange={setConfirmRealDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activar modo Real</AlertDialogTitle>
            <AlertDialogDescription>
              En modo Real, la capa de Reversión a la Media puede <strong>bloquear entradas IDCA</strong> cuando
              detecte condiciones adversas (tendencia bajista, alta volatilidad, datos insuficientes).
              <br /><br />
              El grid permanece en modo observador por defecto. ¿Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setMode.mutate("real"); setConfirmRealDialog(false); }}
            >
              Activar modo Real
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
