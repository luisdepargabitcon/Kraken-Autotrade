import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Activity, ShieldCheck, TrendingDown, Layers, List, BookOpen, History, Terminal, Lock,
  AlertTriangle, CheckCircle2, XCircle,
} from "lucide-react";
import { OperationTab, CyclesTab, LedgerTab } from "./AmaTabs";
import { AmaEventsPanel } from "./AmaEventsPanel";
import {
  REAL_SUBTAB_LABELS, translateRealState, translateMode,
  translateRealAuthorizedMode, translateTrancheType, translateTrancheStatus,
} from "./amaLabels";

export type AmaRealSubtab =
  | "status"
  | "activation"
  | "strategy"
  | "cycle"
  | "orders"
  | "movements"
  | "history"
  | "events"
  | "security";

interface AmaRealPanelProps {
  currentMode: string;
}

interface RealAuth {
  authorizedMode: string;
  authorizedBy: string;
  authorizedAt: string;
  isActive: boolean;
  operationalState: string;
  maxCapitalUsd: number;
  maxSingleTrancheUsd: number;
  maxTranchesPerCycle: number;
  expiresAt: string | null;
  reason: string | null;
}

interface Reconciliation {
  reconciliationId: string;
  status: string;
  cycleId: string | null;
  createdAt: string;
  resolved: boolean;
}

const OP_STATE_COLORS: Record<string, string> = {
  NOT_READY: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  READY_DISABLED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  ARMED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  ACTIVE: "bg-green-500/20 text-green-400 border-green-500/30",
  PAUSED_BY_USER: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  PAUSED_BY_RESTART: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  DISABLED_BY_USER: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  AUTO_BLOCKED: "bg-red-500/20 text-red-400 border-red-500/30",
  KILL_SWITCHED: "bg-red-600/20 text-red-500 border-red-600/30",
  EXPIRED: "bg-gray-600/20 text-gray-500 border-gray-600/30",
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export function AmaRealPanel({ currentMode }: AmaRealPanelProps) {
  const [subtab, setSubtab] = useState<AmaRealSubtab>("status");

  return (
    <Tabs value={subtab} onValueChange={(v) => setSubtab(v as AmaRealSubtab)} className="space-y-4">
      <TabsList className="flex flex-wrap h-auto min-h-10 gap-1">
        {([
          ["status", <Activity key="i1" className="h-3.5 w-3.5" />],
          ["activation", <ShieldCheck key="i2" className="h-3.5 w-3.5" />],
          ["strategy", <TrendingDown key="i3" className="h-3.5 w-3.5" />],
          ["cycle", <Layers key="i4" className="h-3.5 w-3.5" />],
          ["orders", <List key="i5" className="h-3.5 w-3.5" />],
          ["movements", <BookOpen key="i6" className="h-3.5 w-3.5" />],
          ["history", <History key="i7" className="h-3.5 w-3.5" />],
          ["events", <Terminal key="i8" className="h-3.5 w-3.5" />],
          ["security", <Lock key="i9" className="h-3.5 w-3.5" />],
        ] as [AmaRealSubtab, React.ReactNode][]).map(([key, icon]) => (
          <TabsTrigger key={key} value={key} className="text-xs gap-1">
            {icon}
            {REAL_SUBTAB_LABELS[key]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="status" className="mt-2">
        <RealStatusPanel currentMode={currentMode} />
      </TabsContent>
      <TabsContent value="activation" className="mt-2">
        <OperationTab />
      </TabsContent>
      <TabsContent value="strategy" className="mt-2">
        <RealStrategyPanel />
      </TabsContent>
      <TabsContent value="cycle" className="mt-2">
        <CyclesTab />
      </TabsContent>
      <TabsContent value="orders" className="mt-2">
        <RealOrdersPanel />
      </TabsContent>
      <TabsContent value="movements" className="mt-2">
        <LedgerTab />
      </TabsContent>
      <TabsContent value="history" className="mt-2">
        <RealHistoryPanel />
      </TabsContent>
      <TabsContent value="events" className="mt-2">
        <AmaEventsPanel modeFilter={["REAL_LIMITED"]} hideModeFilter />
      </TabsContent>
      <TabsContent value="security" className="mt-2">
        <RealSecurityPanel />
      </TabsContent>
    </Tabs>
  );
}

function RealStatusPanel({ currentMode }: { currentMode: string }) {
  const [auth, setAuth] = useState<RealAuth | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/ama/real/authorization");
      const json = await res.json();
      setAuth(json.data || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuth();
    const interval = setInterval(fetchAuth, 5000);
    return () => clearInterval(interval);
  }, [fetchAuth]);

  if (loading) return <div className="text-sm text-muted-foreground">Cargando estado...</div>;

  const opState = auth?.operationalState ?? "NOT_READY";
  const colorClass = OP_STATE_COLORS[opState] ?? OP_STATE_COLORS.NOT_READY;
  const hasActiveAuthorization = auth?.isActive === true;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" /> Estado del modo Real
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Badge className={`text-sm ${colorClass}`}>{translateRealState(opState)}</Badge>
            <span className="text-sm text-muted-foreground">
              Modo AMA: <strong>{translateMode(currentMode)}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border border-border/30 bg-muted/10 p-3">
              <div className="text-xs text-muted-foreground mb-1">Autorización activa</div>
              <div className="flex items-center gap-2">
                {hasActiveAuthorization ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-400" /> Sí
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-gray-400" /> No
                  </>
                )}
              </div>
            </div>
            <div className="rounded-md border border-border/30 bg-muted/10 p-3">
              <div className="text-xs text-muted-foreground mb-1">Modo Real</div>
              <div className="font-medium">
                {hasActiveAuthorization ? translateRealAuthorizedMode(auth?.authorizedMode) : "Desactivado"}
              </div>
            </div>
          </div>

          {hasActiveAuthorization && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="rounded-md border border-border/30 bg-muted/10 p-3">
                <div className="text-xs text-muted-foreground mb-1">Capital autorizado</div>
                <div className="font-mono">${auth?.maxCapitalUsd?.toLocaleString() ?? "0"}</div>
              </div>
              <div className="rounded-md border border-border/30 bg-muted/10 p-3">
                <div className="text-xs text-muted-foreground mb-1">Tramo máximo</div>
                <div className="font-mono">${auth?.maxSingleTrancheUsd?.toLocaleString() ?? "0"}</div>
              </div>
              <div className="rounded-md border border-border/30 bg-muted/10 p-3">
                <div className="text-xs text-muted-foreground mb-1">Tramos/ciclo</div>
                <div className="font-mono">{auth?.maxTranchesPerCycle ?? 0}</div>
              </div>
            </div>
          )}

          {/* Autorización actual vs. último evento de seguridad: conceptos separados.
              "reason" en auth describe el ÚLTIMO evento (p.ej. una parada de emergencia
              pasada), no necesariamente la causa de la autorización activa actual. */}
          {auth?.reason && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-amber-400/90">Último evento de seguridad: </span>
              {auth.reason}
              {!hasActiveAuthorization && (
                <span className="block mt-1">
                  No existe una autorización activa actualmente. Este evento corresponde al historial.
                </span>
              )}
            </div>
          )}

          <div className="rounded-md bg-red-500/5 border border-red-500/20 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 inline mr-1 text-red-400" />
            <strong>Real limitado</strong> solo permite órdenes pasivas. Nunca cruza el mercado directamente.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RealStrategyPanel() {
  const [mandate, setMandate] = useState<any>(null);
  const [policy, setPolicy] = useState<any>(null);

  useEffect(() => {
    fetch("/api/ama/mandate").then((r) => r.json()).then((j) => setMandate(j.data));
    fetch("/api/ama/policy/active").then((r) => r.json()).then((j) => setPolicy(j.data));
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingDown className="h-4 w-4" /> Estrategia activa
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mandate ? (
            <div className="text-sm space-y-1">
              <div><span className="text-muted-foreground">Mandato:</span> {mandate.mandateId} ({mandate.status})</div>
              <div><span className="text-muted-foreground">Riesgo:</span> {mandate.riskMandate}</div>
              <div><span className="text-muted-foreground">Estilo:</span> {mandate.accumulationStyle}</div>
              <div><span className="text-muted-foreground">Objetivo de salida:</span> {mandate.exitObjective}</div>
              <div><span className="text-muted-foreground">Autonomía:</span> {mandate.autonomyLevel}</div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No hay mandato aprobado.</div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Política activa</CardTitle>
        </CardHeader>
        <CardContent>
          {policy ? (
            <div className="text-sm text-muted-foreground">Política {policy.policyId} — versión {policy.policyVersion}</div>
          ) : (
            <div className="text-sm text-muted-foreground">No hay política activa.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface RealTranche {
  trancheId: string;
  cycleId: string;
  trancheType: string;
  status: string;
  plannedAmountUsd: number;
  executedAmountUsd: number;
  assetQuantity: number;
  fillPrice: number | null;
  createdAt?: string;
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Visor read-only de órdenes REAL. Conectado a /api/ama/real/orders,
 * que consulta tramos ejecutados exclusivamente en ciclos REAL_LIMITED.
 * No es un texto estático: si la API devuelve un array vacío porque
 * nunca se ha operado, se muestra el estado vacío correspondiente.
 */
function RealOrdersPanel() {
  const [orders, setOrders] = useState<RealTranche[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/ama/real/orders");
      const json = await res.json();
      if (json.success) {
        setOrders(json.data || []);
        setError(null);
      } else {
        setError(json.error || "No se pudieron cargar las órdenes reales.");
      }
    } catch {
      setError("No se pudo conectar con el servidor.");
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <List className="h-4 w-4" /> Órdenes en modo Real
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && <div className="text-sm text-red-400 mb-2">{error}</div>}
        {orders === null ? (
          <div className="text-sm text-muted-foreground">Cargando órdenes reales...</div>
        ) : orders.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No existen órdenes reales registradas.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-2">Tipo</th>
                  <th className="text-left">Estado</th>
                  <th className="text-right">Planificado</th>
                  <th className="text-right">Ejecutado</th>
                  <th className="text-right">Precio</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.trancheId} className="border-b border-border/50">
                    <td className="py-2">{translateTrancheType(o.trancheType)}</td>
                    <td><Badge variant="outline" className="text-xs">{translateTrancheStatus(o.status)}</Badge></td>
                    <td className="text-right font-mono">{fmtUsd(o.plannedAmountUsd)}</td>
                    <td className="text-right font-mono">{fmtUsd(o.executedAmountUsd)}</td>
                    <td className="text-right font-mono">{o.fillPrice ? `$${o.fillPrice.toLocaleString()}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface RealCycleSummary {
  cycleId: string;
  state: string;
  budgetUsd: number;
  deployedUsd: number;
  accumulatedQuantity: number;
  averageCostBasis: number | null;
  createdAt: string;
  closedAt: string | null;
}

/**
 * Historial operativo REAL: ciclos, compras y ventas ejecutados en
 * REAL_LIMITED. Distinto de la pestaña Eventos (logs técnicos de
 * auditoría): aquí se muestra el resultado operativo real.
 */
function RealHistoryPanel() {
  const [data, setData] = useState<{ cycles: RealCycleSummary[]; tranches: RealTranche[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ama/real/history")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setData(json.data);
        else setError(json.error || "No se pudo cargar el historial real.");
      })
      .catch(() => setError("No se pudo conectar con el servidor."));
  }, []);

  if (error) return <div className="text-sm text-red-400">{error}</div>;
  if (!data) return <div className="text-sm text-muted-foreground">Cargando historial real...</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Ciclos en modo Real</CardTitle>
        </CardHeader>
        <CardContent>
          {data.cycles.length === 0 ? (
            <div className="text-sm text-muted-foreground">No existen ciclos reales registrados.</div>
          ) : (
            <div className="space-y-2">
              {data.cycles.map((c) => (
                <div key={c.cycleId} className="rounded-md border border-border/30 bg-muted/10 p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">{c.state}</Badge>
                    <span className="text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs mt-1">
                    <div><span className="text-muted-foreground">Capital: </span>{fmtUsd(c.budgetUsd)}</div>
                    <div><span className="text-muted-foreground">Desplegado: </span>{fmtUsd(c.deployedUsd)}</div>
                    <div><span className="text-muted-foreground">Coste medio: </span>{c.averageCostBasis ? `$${c.averageCostBasis.toLocaleString()}` : "—"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Compras y ventas registradas</CardTitle>
        </CardHeader>
        <CardContent>
          {data.tranches.length === 0 ? (
            <div className="text-sm text-muted-foreground">No existen compras ni ventas reales registradas.</div>
          ) : (
            <div className="space-y-1 text-xs">
              {data.tranches.map((t) => (
                <div key={t.trancheId} className="flex items-center justify-between border-b border-border/20 py-1">
                  <span>{translateTrancheType(t.trancheType)}</span>
                  <Badge variant="outline" className="text-[10px]">{translateTrancheStatus(t.status)}</Badge>
                  <span className="font-mono">{fmtUsd(t.executedAmountUsd)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RealSecurityPanel() {
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);

  useEffect(() => {
    fetch("/api/ama/real/reconciliations")
      .then((r) => r.json())
      .then((j) => setReconciliations((j.data || []) as Reconciliation[]));
  }, []);

  return (
    <div className="space-y-4">
      <Card className="border-red-500/20 bg-red-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="h-4 w-4" /> Seguridad de Real limitado
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div>• Solo órdenes maker/post-only.</div>
          <div>• Capital máximo, tramo máximo y tramos por ciclo controlados.</div>
          <div>• Cada orden pasa por comprobaciones de seguridad previas.</div>
          <div>• Reconciliación automática y auditoría persistente.</div>
          <div>• Parada de emergencia desactiva Real inmediatamente.</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Reconciliaciones pendientes</CardTitle>
        </CardHeader>
        <CardContent>
          {reconciliations.length === 0 ? (
            <div className="text-sm text-muted-foreground">No hay reconciliaciones pendientes.</div>
          ) : (
            <div className="space-y-2">
              {reconciliations.map((r) => (
                <div key={r.reconciliationId} className="text-sm border-b border-border/20 pb-1">
                  <span className="font-mono text-xs">{r.reconciliationId}</span>
                  <span className="ml-2">{r.status}</span>
                  <span className="ml-2 text-muted-foreground">{fmtDate(r.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
