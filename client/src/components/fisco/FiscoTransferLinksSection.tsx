import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, Info, ExternalLink, CheckCircle2, AlertTriangle } from "lucide-react";
import type { TransferLinksResult, TransferLink } from "./FiscoTypes";

interface TransferLinksSectionProps {
  year: string;
  data: TransferLinksResult | undefined;
  isLoading: boolean;
  error: Error | null;
}

function qty(v: string | null | undefined, dec = 8): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: dec });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const CONFIDENCE_CONFIG: Record<string, { label: string; color: string }> = {
  high:   { label: "Alta",  color: "border-green-500/50 text-green-400 bg-green-500/10" },
  medium: { label: "Media", color: "border-yellow-500/50 text-yellow-400 bg-yellow-500/10" },
  low:    { label: "Baja",  color: "border-orange-500/50 text-orange-400 bg-orange-500/10" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  matched:       { label: "Enlazada",    color: "border-green-500/50 text-green-400" },
  unmatched:     { label: "Sin enlazar", color: "border-orange-500/50 text-orange-400" },
  rejected:      { label: "Rechazada",   color: "border-red-500/50 text-red-400" },
  manual_review: { label: "Revisión",    color: "border-blue-500/50 text-blue-400" },
};

export function FiscoTransferLinksSection({ year, data, isLoading, error }: TransferLinksSectionProps) {
  if (isLoading) {
    return <div className="text-center py-16 text-muted-foreground animate-pulse">Cargando transferencias {year}...</div>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center text-red-400">
        <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
        <p className="text-sm">Error al cargar transfer links: {error.message}</p>
      </div>
    );
  }

  if (!data) return null;

  const matched   = data.links.filter(l => l.status === "matched").length;
  const unmatched = data.links.filter(l => l.status === "unmatched" || l.status === "manual_review").length;

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-blue-400" />
            Transferencias internas {year}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data.count} transfer link{data.count !== 1 ? "s" : ""} ·
            {matched} enlazada{matched !== 1 ? "s" : ""} ·
            {unmatched} pendiente{unmatched !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-1.5 text-xs text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> {matched} enlazadas
          </div>
          <div className="flex items-center gap-1.5 text-xs text-orange-400">
            <AlertTriangle className="h-3.5 w-3.5" /> {unmatched} pendientes
          </div>
        </div>
      </div>

      {data.links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <ArrowLeftRight className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Sin transfer links registrados en {year}</p>
          <p className="text-xs mt-1">Las transferencias internas entre exchanges se crean al usar el Transfer Matching.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="text-left px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Activo</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Origen</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Destino</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Enviado</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider hidden md:table-cell">Recibido</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider hidden md:table-cell">Fee</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Fecha salida</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Fecha entrada</th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Confianza</th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.links.map((link: TransferLink) => {
                  const conf = CONFIDENCE_CONFIG[link.confidence] ?? CONFIDENCE_CONFIG.low;
                  const stat = STATUS_CONFIG[link.status] ?? STATUS_CONFIG.unmatched;
                  return (
                    <tr key={link.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2.5 font-bold">{link.asset}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{link.from_exchange}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {link.to_exchange ?? link.to_exchange_confirmed ?? (
                          <span className="text-orange-400 text-xs">Sin datos</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">
                        {qty(link.amount_sent, 6)} {link.asset}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs hidden md:table-cell">
                        {link.amount_received ? qty(link.amount_received, 6) + " " + link.asset : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs hidden md:table-cell text-muted-foreground">
                        {link.fee_amount ? qty(link.fee_amount, 6) + " " + (link.fee_asset ?? link.asset) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                        {link.from_executed_at ? fmtDate(link.from_executed_at) : (
                          <span className="flex items-center gap-1 text-blue-400">
                            <Info className="h-3 w-3" /> Sin op. origen
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                        {fmtDate(link.to_executed_at)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge variant="outline" className={`text-[10px] ${conf.color}`}>{conf.label}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge variant="outline" className={`text-[10px] ${stat.color}`}>{stat.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Nota informativa ── */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-blue-300">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div>
          <p><strong>Transferencias internas</strong>: movimiento de activos entre exchanges propios. <strong>No son eventos fiscales</strong> — el coste base se conserva en el exchange destino.</p>
          <p className="mt-1">Si hay withdrawals sin transfer_link, ve a <strong>Balance Check</strong> para clasificarlos.</p>
        </div>
      </div>
    </div>
  );
}
