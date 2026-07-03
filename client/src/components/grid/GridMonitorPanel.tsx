import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Activity, AlertCircle, Zap, TrendingUp, Shield, ScrollText, Layers,
  Settings, FileDown, Copy, Check, ChevronDown, ChevronRight,
} from "lucide-react";

const API_BASE = "/api/grid-isolated";

const modeColor = (mode: string) => {
  switch (mode) {
    case "OFF": return "secondary";
    case "SHADOW": return "outline";
    case "REAL_LIMITED": return "default";
    case "REAL_FULL": return "destructive";
    default: return "secondary";
  }
};

const severityFromEventType = (eventType: string): "INFO" | "WARNING" | "CRITICAL" => {
  if (eventType.includes("CIRCUIT_BREAKER") || eventType.includes("UNKNOWN") || eventType.includes("EMERGENCY")) return "CRITICAL";
  if (eventType.includes("BLOCKED") || eventType.includes("LOCKED") || eventType.includes("REJECTED") || eventType.includes("PUMP") || eventType.includes("DUMP") || eventType.includes("STOP") || eventType.includes("TOO_NARROW") || eventType.includes("FAILED")) return "WARNING";
  return "INFO";
};

const categoryFromEventType = (eventType: string): string => {
  if (eventType.includes("MODE")) return "Modo";
  if (eventType.includes("RANGE") || eventType.includes("BANDS")) return "Bandas";
  if (eventType.includes("CAPITAL") || eventType.includes("RESERVE") || eventType.includes("FINANCED")) return "Capital";
  if (eventType.includes("LEVEL") || eventType.includes("BUY") || eventType.includes("SELL")) return "Niveles";
  if (eventType.includes("CYCLE")) return "Ciclos";
  if (eventType.includes("PUMP") || eventType.includes("DUMP")) return "Pump/Dump";
  if (eventType.includes("TRAILING")) return "Trailing";
  if (eventType.includes("POST_ONLY") || eventType.includes("TAKER")) return "Ejecución";
  if (eventType.includes("RECONCIL") || eventType.includes("ORDER_SUBMIT") || eventType.includes("API")) return "API";
  if (eventType.includes("BACKTEST")) return "Backtest";
  if (eventType.includes("HODL") || eventType.includes("HIBERNATE")) return "Recovery";
  return "Otros";
};

function naturalLanguageSummary(mode: string, audit: any): string {
  const pair = audit?.summary?.pair || "BTC/USD";
  const blocked = audit?.summary?.realModesBlocked;
  if (mode === "OFF") {
    return `Grid ${pair} está en OFF. No evalúa mercado ni envía órdenes. ${blocked ? "Los modos reales están bloqueados porque " + (audit?.safety?.blockingReasons?.[0] || "condiciones de seguridad no cumplidas") + "." : ""}`;
  }
  if (mode === "SHADOW") {
    return `Grid ${pair} está en SHADOW. Evalúa y simula operaciones sin enviar órdenes reales.`;
  }
  if (mode === "REAL_LIMITED") {
    return `Grid ${pair} está en REAL_LIMITED. Opera con capital limitado y órdenes reales.`;
  }
  if (mode === "REAL_FULL") {
    return `Grid ${pair} está en REAL_FULL. Opera con capital completo y órdenes reales.`;
  }
  return `Grid ${pair} en estado desconocido.`;
}

export function GridMonitorPanel() {
  const [activeSubtab, setActiveSubtab] = useState("resumen");
  const [eventFilter, setEventFilter] = useState("Todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [copied, setCopied] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

  const { data: audit } = useQuery({
    queryKey: ["grid-monitor-audit"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/monitor/audit`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: events } = useQuery({
    queryKey: ["grid-events-audit"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/events?limit=100`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const mode = audit?.mode || "OFF";
  const summary = audit?.summary;
  const safety = audit?.safety;
  const decisions = audit?.decisions || [];
  const levels = audit?.levels || [];
  const cycles = audit?.cycles || [];
  const apiInfo = audit?.api;
  const allEvents: any[] = events || audit?.events || [];

  const filteredEvents = allEvents.filter((ev: any) => {
    if (eventFilter === "INFO" && severityFromEventType(ev.eventType) !== "INFO") return false;
    if (eventFilter === "WARNING" && severityFromEventType(ev.eventType) !== "WARNING") return false;
    if (eventFilter === "CRITICAL" && severityFromEventType(ev.eventType) !== "CRITICAL") return false;
    if (eventFilter !== "Todos" && eventFilter !== "INFO" && eventFilter !== "WARNING" && eventFilter !== "CRITICAL") {
      if (categoryFromEventType(ev.eventType) !== eventFilter) return false;
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      if (!ev.eventType?.toLowerCase().includes(term) &&
          !ev.message?.toLowerCase().includes(term) &&
          !ev.mode?.toLowerCase().includes(term)) return false;
    }
    return true;
  });

  const toggleEvent = (id: number) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filterOptions = ["Todos", "INFO", "WARNING", "CRITICAL", "Modo", "Niveles", "Ciclos", "Pump/Dump", "API", "Capital", "Trailing", "Ejecución", "Recovery"];

  return (
    <div className="space-y-4">
      <Tabs value={activeSubtab} onValueChange={setActiveSubtab}>
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="resumen" className="text-xs">Resumen</TabsTrigger>
          <TabsTrigger value="decisiones" className="text-xs">Decisiones</TabsTrigger>
          <TabsTrigger value="logs" className="text-xs">Logs Inteligentes</TabsTrigger>
          <TabsTrigger value="niveles" className="text-xs">Niveles y Ciclos</TabsTrigger>
          <TabsTrigger value="seguridad" className="text-xs">Seguridad</TabsTrigger>
          <TabsTrigger value="api" className="text-xs">API/Reconc.</TabsTrigger>
          <TabsTrigger value="exportar" className="text-xs">Exportar</TabsTrigger>
        </TabsList>

        {/* 1. Resumen */}
        <TabsContent value="resumen" className="space-y-4">
          <div className="rounded-lg bg-muted/30 p-4 text-sm">
            <p className="font-medium">{naturalLanguageSummary(mode, audit)}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-3">
              <div className="flex items-center gap-2"><Activity className="h-3 w-3 text-blue-500" /><span className="text-xs text-muted-foreground">Modo</span></div>
              <Badge variant={modeColor(mode) as any} className="mt-1">{mode}</Badge>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="flex items-center gap-2"><Zap className="h-3 w-3 text-yellow-500" /><span className="text-xs text-muted-foreground">Niveles Abiertos</span></div>
              <p className="text-lg font-bold mt-1">{summary?.openLevels || 0}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="flex items-center gap-2"><TrendingUp className="h-3 w-3 text-green-500" /><span className="text-xs text-muted-foreground">PnL Neto</span></div>
              <p className="text-lg font-bold mt-1 text-green-500">${summary?.totalNetPnlUsd?.toFixed(2) || "0.00"}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="flex items-center gap-2"><Shield className="h-3 w-3 text-purple-500" /><span className="text-xs text-muted-foreground">Ciclos Cerrados</span></div>
              <p className="text-lg font-bold mt-1">{summary?.totalCyclesCompleted || 0}</p>
            </CardContent></Card>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Par</p><p className="text-sm font-medium mt-1">{summary?.pair || "BTC/USD"}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Exchange</p><p className="text-sm font-medium mt-1">Revolut X</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Política Ejecución</p><p className="text-sm font-medium mt-1 text-xs">{summary?.executionPolicy || "MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK"}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Post-Only</p><Badge variant={summary?.postOnlySupported ? "default" : "secondary"} className="mt-1">{summary?.postOnlySupported ? "SOPORTADO" : "NO SOPORTADO"}</Badge></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Modos REAL</p><Badge variant={summary?.realModesBlocked ? "destructive" : "default"} className="mt-1">{summary?.realModesBlocked ? "BLOQUEADOS" : "DESBLOQUEADOS"}</Badge></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Circuit Breaker</p><Badge variant={summary?.circuitBreakerOpen ? "destructive" : "secondary"} className="mt-1">{summary?.circuitBreakerOpen ? "ABIERTO" : "CERRADO"}</Badge></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Ciclos Abiertos</p><p className="text-sm font-medium mt-1">{summary?.openCycles || 0}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Órdenes Hoy</p><p className="text-sm font-medium mt-1">{summary?.dailyOrderCount || 0}</p></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Capital Reservado</p><p className="text-sm font-medium mt-1">${summary?.capitalReservedUsd?.toFixed(2) || "0.00"}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Capital Disponible</p><p className="text-sm font-medium mt-1">${summary?.capitalAvailableUsd?.toFixed(2) || "0.00"}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Pump/Dump</p><Badge variant={summary?.pumpDumpState !== "normal" ? "destructive" : "secondary"} className="mt-1">{summary?.pumpDumpState || "normal"}</Badge></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Target Neto</p><p className="text-sm font-medium mt-1">{summary?.netProfitTargetPct?.toFixed(2)}%</p></div>
          </div>
          {safety?.blockingReasons && safety.blockingReasons.length > 0 && (
            <div className="rounded-lg bg-orange-500/10 p-3 space-y-1">
              <p className="text-sm font-semibold">Motivos de bloqueo:</p>
              {safety.blockingReasons.map((reason: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-orange-500 flex-shrink-0" />
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* 2. Decisiones */}
        <TabsContent value="decisiones" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ScrollText className="h-5 w-5" />Decisiones del Motor Grid</CardTitle></CardHeader>
            <CardContent>
              {decisions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No hay decisiones registradas.</p>
              ) : (
                <div className="space-y-3">
                  {decisions.map((dec: any, i: number) => (
                    <div key={i} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge variant={modeColor(dec.mode) as any}>{dec.mode}</Badge>
                        <span className="text-xs text-muted-foreground">{new Date(dec.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-muted-foreground">Detectó:</span> {dec.detected}</div>
                        <div><span className="text-muted-foreground">Quería:</span> {dec.wanted}</div>
                        <div><span className="text-muted-foreground">Decidió:</span> <strong>{dec.decided}</strong></div>
                        <div><span className="text-muted-foreground">Impacto:</span> {dec.impact}</div>
                      </div>
                      <p className="text-sm"><span className="text-muted-foreground">Motivo:</span> {dec.reason}</p>
                      <p className="text-sm"><span className="text-muted-foreground">Próxima acción:</span> {dec.nextAction}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 3. Logs Inteligentes */}
        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ScrollText className="h-5 w-5" />Logs Inteligentes Grid</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {filterOptions.map((opt) => (
                  <Button key={opt} variant={eventFilter === opt ? "default" : "outline"} size="sm" onClick={() => setEventFilter(opt)}>
                    {opt}
                  </Button>
                ))}
              </div>
              <Input placeholder="Buscar por texto, evento, modo..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              {filteredEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Todavía no hay eventos Grid registrados. Activa SHADOW o ejecuta una evaluación simulada para generar auditoría.
                </p>
              ) : (
                <div className="rounded-lg border max-h-96 overflow-y-auto">
                  {filteredEvents.map((ev: any) => {
                    const severity = severityFromEventType(ev.eventType);
                    const sevColor = severity === "CRITICAL" ? "destructive" : severity === "WARNING" ? "default" : "secondary";
                    const isExpanded = expandedEvents.has(ev.id);
                    return (
                      <div key={ev.id} className="border-b p-2 hover:bg-muted/30">
                        <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleEvent(ev.id)}>
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          <Badge variant={sevColor as any} className="text-xs">{severity}</Badge>
                          <Badge variant="secondary" className="text-xs">{ev.eventType}</Badge>
                          <span className="text-xs text-muted-foreground">{new Date(ev.createdAt).toLocaleString()}</span>
                          <span className="text-xs truncate flex-1">{ev.message}</span>
                          <Badge variant="outline" className="text-xs">{ev.mode}</Badge>
                        </div>
                        {isExpanded && (
                          <div className="mt-2 ml-6 space-y-1 text-xs text-muted-foreground">
                            <div><strong>Tipo:</strong> {ev.eventType}</div>
                            <div><strong>Categoría:</strong> {categoryFromEventType(ev.eventType)}</div>
                            <div><strong>Modo:</strong> {ev.mode}</div>
                            <div><strong>Par:</strong> {ev.pair}</div>
                            {ev.levelId && <div><strong>Nivel:</strong> {ev.levelId}</div>}
                            {ev.cycleId && <div><strong>Ciclo:</strong> {ev.cycleId}</div>}
                            {ev.rangeVersionId && <div><strong>Range Version:</strong> {ev.rangeVersionId}</div>}
                            <div><strong>Mensaje:</strong> {ev.message}</div>
                            {ev.metadataJson && <div><strong>Contexto técnico:</strong> <pre className="mt-1 p-2 rounded bg-muted/50 overflow-x-auto">{JSON.stringify(ev.metadataJson, null, 2)}</pre></div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 4. Niveles y Ciclos */}
        <TabsContent value="niveles" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Layers className="h-5 w-5" />Niveles Grid</CardTitle></CardHeader>
            <CardContent>
              {levels.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No hay niveles Grid generados.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b text-left">
                      <th className="p-2">Nivel</th><th className="p-2">Tipo</th><th className="p-2">Precio</th>
                      <th className="p-2">Estado</th><th className="p-2">Range Version</th>
                    </tr></thead>
                    <tbody>
                      {levels.map((lvl: any, i: number) => (
                        <tr key={i} className="border-b">
                          <td className="p-2">{lvl.index ?? i + 1}</td>
                          <td className="p-2"><Badge variant={lvl.side === "BUY" ? "default" : "secondary"}>{lvl.side}</Badge></td>
                          <td className="p-2 font-mono">{lvl.price?.toFixed(2)}</td>
                          <td className="p-2"><Badge variant="outline">{lvl.status}</Badge></td>
                          <td className="p-2 font-mono text-muted-foreground">{lvl.rangeVersionId?.slice(0, 8)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Ciclos Grid</CardTitle></CardHeader>
            <CardContent>
              {cycles.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No hay ciclos Grid abiertos ni simulados todavía.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b text-left">
                      <th className="p-2">Ciclo</th><th className="p-2">Estado</th><th className="p-2">Modo</th>
                      <th className="p-2">Compra</th><th className="p-2">Venta objetivo</th>
                      <th className="p-2">PnL Neto</th><th className="p-2">Trailing</th>
                    </tr></thead>
                    <tbody>
                      {cycles.map((cyc: any, i: number) => (
                        <tr key={i} className="border-b">
                          <td className="p-2">{cyc.id?.slice(0, 8) || i + 1}</td>
                          <td className="p-2"><Badge variant="outline">{cyc.status}</Badge></td>
                          <td className="p-2">{cyc.mode}</td>
                          <td className="p-2 font-mono">{cyc.buyPrice?.toFixed(2) || "-"}</td>
                          <td className="p-2 font-mono">{cyc.sellTargetPrice?.toFixed(2) || "-"}</td>
                          <td className="p-2 font-mono">{cyc.netPnlUsd?.toFixed(2) || "0.00"}</td>
                          <td className="p-2">{cyc.trailingArmed ? "Sí" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 5. Seguridad / Bloqueos */}
        <TabsContent value="seguridad" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Seguridad y Bloqueos</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">REAL_LIMITED bloqueado</span>
                  <Badge variant={safety?.realLimitedBlocked ? "destructive" : "default"}>{safety?.realLimitedBlocked ? "SÍ" : "NO"}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">REAL_FULL bloqueado</span>
                  <Badge variant={safety?.realFullBlocked ? "destructive" : "default"}>{safety?.realFullBlocked ? "SÍ" : "NO"}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">Post-Only soportado</span>
                  <Badge variant={safety?.postOnlySupported ? "default" : "secondary"}>{safety?.postOnlySupported ? "SÍ" : "NO"}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">Revolut X inicializado</span>
                  <Badge variant={safety?.revolutxInitialized ? "default" : "secondary"}>{safety?.revolutxInitialized ? "SÍ" : "NO"}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">Balance detectado</span>
                  <Badge variant={safety?.revolutxHasBalance ? "default" : "secondary"}>{safety?.revolutxHasBalance ? "SÍ" : "NO"}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">Reconciliación OK</span>
                  <Badge variant={safety?.reconciliationPassed ? "default" : "secondary"}>{safety?.reconciliationPassed ? "SÍ" : "NO"}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">Capital reservado</span>
                  <Badge variant={safety?.capitalReserved ? "default" : "secondary"}>{safety?.capitalReserved ? "SÍ" : "NO"}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">Mode lock reconocido</span>
                  <Badge variant={safety?.modeLockAcknowledged ? "default" : "secondary"}>{safety?.modeLockAcknowledged ? "SÍ" : "NO"}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">Límite diario OK</span>
                  <Badge variant={safety?.dailyOrderLimitRespected ? "default" : "secondary"}>{safety?.dailyOrderLimitRespected ? "SÍ" : "NO"}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">Circuit breaker</span>
                  <Badge variant={safety?.circuitBreakerOpen ? "destructive" : "secondary"}>{safety?.circuitBreakerOpen ? "ABIERTO" : "CERRADO"}</Badge>
                </div>
              </div>
              {safety?.blockingReasons && safety.blockingReasons.length > 0 && (
                <div className="rounded-lg bg-destructive/10 p-4 space-y-2">
                  <p className="text-sm font-semibold">Motivos de bloqueo REAL:</p>
                  {safety.blockingReasons.map((reason: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="font-mono text-destructive">{i + 1}.</span>
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 6. API / Reconciliación */}
        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />API y Reconciliación</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Órdenes hoy</p><p className="text-sm font-medium mt-1">{apiInfo?.dailyOrderCount || 0} / {apiInfo?.maxDailyOrders || 300}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Circuit breaker</p><Badge variant={apiInfo?.circuitBreakerOpen ? "destructive" : "secondary"} className="mt-1">{apiInfo?.circuitBreakerOpen ? "ABIERTO" : "CERRADO"}</Badge></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Reconciliación</p><Badge variant={apiInfo?.reconciliationOk === true ? "default" : apiInfo?.reconciliationOk === false ? "destructive" : "secondary"} className="mt-1">{apiInfo?.reconciliationOk === true ? "OK" : apiInfo?.reconciliationOk === false ? "CON ERRORES" : "PENDIENTE"}</Badge></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Mismatches</p><p className="text-sm font-medium mt-1">{apiInfo?.reconciliationMismatches || 0}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Órdenes abiertas</p><p className="text-sm font-medium mt-1">{apiInfo?.openOrders || 0}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Órdenes desconocidas</p><p className="text-sm font-medium mt-1">{apiInfo?.unknownOrders || 0}</p></div>
              </div>
              <div className="space-y-2 text-sm">
                {apiInfo?.reconciliationOk === null || apiInfo?.reconciliationOk === undefined ? (
                  <p className="text-muted-foreground">El Grid no puede operar real porque la reconciliación todavía no se ha ejecutado.</p>
                ) : apiInfo?.reconciliationOk === false ? (
                  <p className="text-destructive">Reconciliación con errores — nuevas órdenes bloqueadas.</p>
                ) : (
                  <p className="text-green-500">Reconciliación OK — el Grid puede operar real si el resto de condiciones se cumplen.</p>
                )}
                {(apiInfo?.openOrders || 0) === 0 && <p className="text-muted-foreground">No hay órdenes Grid reales abiertas.</p>}
                {(apiInfo?.unknownOrders || 0) === 0 && <p className="text-muted-foreground">No hay órdenes en estado desconocido.</p>}
                {!apiInfo?.circuitBreakerOpen && <p className="text-muted-foreground">El circuit breaker está cerrado.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 7. Exportar / Copiar */}
        <TabsContent value="exportar" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileDown className="h-5 w-5" />Exportar y Copiar</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="default" onClick={() => copyToClipboard(audit?.export?.chatgptSummary || "Generando resumen...")}>
                  {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  {copied ? "Copiado" : "Copiar resumen ChatGPT"}
                </Button>
                <Button variant="outline" onClick={() => window.open(`${API_BASE}/export/chatgpt`, "_blank")}>
                  <FileDown className="h-4 w-4 mr-1" /> Ver resumen ChatGPT
                </Button>
                <Button variant="outline" onClick={() => window.open(`${API_BASE}/export/json`, "_blank")}>
                  <FileDown className="h-4 w-4 mr-1" /> Exportar JSON
                </Button>
                <Button variant="outline" onClick={() => window.open(`${API_BASE}/export/csv`, "_blank")}>
                  <FileDown className="h-4 w-4 mr-1" /> Exportar CSV
                </Button>
                <Button variant="outline" onClick={() => copyToClipboard(JSON.stringify(allEvents, null, 2))}>
                  <Copy className="h-4 w-4 mr-1" /> Copiar eventos
                </Button>
                <Button variant="outline" onClick={() => copyToClipboard(JSON.stringify(audit?.export?.json || audit, null, 2))}>
                  <Copy className="h-4 w-4 mr-1" /> Copiar estado técnico
                </Button>
              </div>
              {audit?.export?.chatgptSummary && (
                <div className="space-y-2">
                  <Label>Resumen para ChatGPT:</Label>
                  <pre className="rounded-lg border p-3 text-xs whitespace-pre-wrap max-h-96 overflow-y-auto bg-muted/20">
                    {audit.export.chatgptSummary}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
