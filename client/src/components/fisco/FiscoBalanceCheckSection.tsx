import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, TrendingDown } from "lucide-react";
import type { BalanceCheckResult, BalanceCheckIssue } from "./FiscoTypes";
import { ISSUE_ACTIONS } from "./FiscoTypes";

interface BalanceCheckSectionProps {
  year: string;
  balanceCheck: BalanceCheckResult | undefined;
  isLoading: boolean;
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "CRITICAL") return <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />;
  if (severity === "WARNING")  return <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />;
  return <Info className="h-4 w-4 text-blue-400 shrink-0" />;
}

function severityBg(severity: string) {
  if (severity === "CRITICAL") return "border-red-500/40 bg-red-500/5";
  if (severity === "WARNING")  return "border-yellow-500/30 bg-yellow-500/5";
  return "border-blue-500/20 bg-blue-500/5";
}

function severityText(severity: string) {
  if (severity === "CRITICAL") return "text-red-400";
  if (severity === "WARNING")  return "text-yellow-400";
  return "text-blue-400";
}

function eur(val: number | null | undefined): string {
  if (val == null) return "0,00 €";
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val) + " €";
}

export function FiscoBalanceCheckSection({ year, balanceCheck: bc, isLoading }: BalanceCheckSectionProps) {
  if (isLoading) {
    return (
      <div className="text-center py-16 text-muted-foreground animate-pulse">
        Cargando Balance {year}...
      </div>
    );
  }

  if (!bc) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Abre la pestaña Diagnóstico para generar el Balance.</p>
      </div>
    );
  }

  const criticals = bc.issues.filter(i => i.severity === "CRITICAL");
  const warnings  = bc.issues.filter(i => i.severity === "WARNING");
  const infos     = bc.issues.filter(i => i.severity === "INFO");

  return (
    <div className="space-y-6">
      {/* ── Estado global ── */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${
        bc.overallStatus === "CRITICAL" ? "border-red-500/40 bg-red-500/10" :
        bc.overallStatus === "WARNINGS" ? "border-yellow-500/30 bg-yellow-500/10" :
        "border-green-500/30 bg-green-500/10"
      }`}>
        {bc.overallStatus === "CRITICAL" ? <AlertCircle className="h-6 w-6 text-red-400" /> :
         bc.overallStatus === "WARNINGS" ? <AlertTriangle className="h-6 w-6 text-yellow-400" /> :
         <CheckCircle2 className="h-6 w-6 text-green-400" />}
        <div>
          <div className={`font-bold text-lg ${
            bc.overallStatus === "CRITICAL" ? "text-red-400" :
            bc.overallStatus === "WARNINGS" ? "text-yellow-400" : "text-green-400"
          }`}>
            Balance {year}: {bc.overallStatus === "OK" ? "Sin incidencias" : bc.overallStatus}
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {criticals.length} crítico{criticals.length !== 1 ? "s" : ""} ·
            {warnings.length} aviso{warnings.length !== 1 ? "s" : ""} ·
            Comprobado: {new Date(bc.checkedAt).toLocaleString("es-ES")}
          </div>
        </div>
      </div>

      {/* ── Contadores por categoría ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`rounded-lg border p-3 ${criticals.length > 0 ? "border-red-500/40 bg-red-500/5" : "border-border"}`}>
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Críticos</div>
          <div className={`text-2xl font-bold ${criticals.length > 0 ? "text-red-400" : "text-muted-foreground"}`}>{criticals.length}</div>
        </div>
        <div className={`rounded-lg border p-3 ${warnings.length > 0 ? "border-yellow-500/30 bg-yellow-500/5" : "border-border"}`}>
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Avisos</div>
          <div className={`text-2xl font-bold ${warnings.length > 0 ? "text-yellow-400" : "text-muted-foreground"}`}>{warnings.length}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Informativos</div>
          <div className="text-2xl font-bold text-blue-400/70">{infos.length}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Total issues</div>
          <div className="text-2xl font-bold">{bc.issues.length}</div>
        </div>
      </div>

      {/* ── Issues por severidad ── */}
      {bc.issues.length === 0 ? (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto mb-3" />
          <p className="text-green-400 font-semibold">Sin incidencias fiscales detectadas</p>
          <p className="text-xs text-muted-foreground mt-1">Todos los activos tienen cost basis, no hay ventas huérfanas y las transferencias están enlazadas.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...criticals, ...warnings, ...infos].map((issue: BalanceCheckIssue, i: number) => (
            <div key={i} className={`rounded-xl border p-4 ${severityBg(issue.severity)}`}>
              <div className="flex items-start gap-3">
                <SeverityIcon severity={issue.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`text-xs font-bold font-mono uppercase ${severityText(issue.severity)}`}>
                      {issue.severity}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                      {issue.code}
                    </span>
                    <span className="text-xs font-bold text-foreground">{issue.asset}</span>
                    {issue.estimatedImpactEur != null && Math.abs(issue.estimatedImpactEur) > 0 && (
                      <span className="text-xs text-red-400 font-mono">
                        <TrendingDown className="h-3 w-3 inline mr-0.5" />
                        Impacto estimado: {eur(issue.estimatedImpactEur)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground/90">{issue.detail}</p>
                  {ISSUE_ACTIONS[issue.code] && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="text-yellow-400">→</span>
                      <span>{ISSUE_ACTIONS[issue.code]}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Detalle por categoría ── */}
      {bc.sells_without_cost_basis.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider">Ventas sin base de coste (BLOQUEANTE)</h3>
          <div className="rounded-xl border border-red-500/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/40 border-b border-border">
                <th className="text-left px-3 py-2 text-[10px] font-mono text-muted-foreground uppercase">Activo</th>
                <th className="text-right px-3 py-2 text-[10px] font-mono text-muted-foreground uppercase">Ventas</th>
                <th className="text-right px-3 py-2 text-[10px] font-mono text-muted-foreground uppercase">Proceeds EUR</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {bc.sells_without_cost_basis.map((s, i) => (
                  <tr key={i} className="hover:bg-red-500/5">
                    <td className="px-3 py-2 font-bold text-red-400">{s.asset}</td>
                    <td className="px-3 py-2 text-right font-mono">{s.count}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-400">{eur(s.total_proceeds_eur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {bc.rewards_without_price.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-yellow-400 uppercase tracking-wider">Rewards/Staking sin precio EUR</h3>
          <div className="rounded-xl border border-yellow-500/20 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/40 border-b border-border">
                <th className="text-left px-3 py-2 text-[10px] font-mono text-muted-foreground uppercase">Activo</th>
                <th className="text-right px-3 py-2 text-[10px] font-mono text-muted-foreground uppercase">Operaciones</th>
                <th className="text-right px-3 py-2 text-[10px] font-mono text-muted-foreground uppercase">Cantidad total</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {bc.rewards_without_price.map((r, i) => (
                  <tr key={i} className="hover:bg-yellow-500/5">
                    <td className="px-3 py-2 font-bold text-yellow-400">{r.asset}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.count}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.total_amount.toFixed(8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {bc.suspected_duplicate_transfers.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider">Withdrawals sin transfer_link</h3>
          <div className="space-y-2">
            {bc.suspected_duplicate_transfers.map((t, i) => (
              <div key={i} className={`rounded-lg border p-3 text-sm ${t.classification === "INTERNAL_TRANSFER_CANDIDATE" ? "border-blue-500/30 bg-blue-500/5" : "border-orange-500/30 bg-orange-500/5"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className={t.classification === "INTERNAL_TRANSFER_CANDIDATE" ? "border-blue-500/50 text-blue-400" : "border-orange-500/50 text-orange-400"}>
                    {t.classification === "INTERNAL_TRANSFER_CANDIDATE" ? "Transfer candidata" : "Retiro externo"}
                  </Badge>
                  <span className="font-bold">{t.asset}</span>
                  <span className="text-muted-foreground text-xs">{t.from_exchange} → {t.to_exchange ?? "desconocido"}</span>
                </div>
                <p className="text-xs text-muted-foreground">{t.detail}</p>
                <p className="text-xs mt-1 text-yellow-400">→ {ISSUE_ACTIONS[t.classification] ?? ISSUE_ACTIONS["UNLINKED_WITHDRAWAL"]}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
