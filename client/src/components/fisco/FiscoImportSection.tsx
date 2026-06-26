import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Upload, Play, CheckCircle2, AlertTriangle, AlertCircle, XCircle,
  SkipForward, Copy, Loader2, FileText, RefreshCw,
} from "lucide-react";
import type { ImportPreviewResult, ImportPreviewRow } from "./FiscoTypes";

interface ImportOptions {
  includeNormal: boolean;
  includeThirdFees: boolean;
  includeStaking: boolean;
  includeDeposits: boolean;
  includeWithdrawals: boolean;
  skipFiatDepositsWithdrawals: boolean;
  detectDuplicates: boolean;
  reconcileTransfers: boolean;
}

const DEFAULT_OPTIONS: ImportOptions = {
  includeNormal: true,
  includeThirdFees: true,
  includeStaking: true,
  includeDeposits: true,
  includeWithdrawals: true,
  skipFiatDepositsWithdrawals: true,
  detectDuplicates: true,
  reconcileTransfers: true,
};

function StatusBadge({ status }: { status: ImportPreviewRow["status"] }) {
  const cfg = {
    ok:        { icon: <CheckCircle2 className="h-3 w-3" />, label: "OK",         cls: "border-green-500/50 text-green-400 bg-green-500/10" },
    warning:   { icon: <AlertTriangle className="h-3 w-3" />, label: "Aviso",     cls: "border-yellow-500/50 text-yellow-400 bg-yellow-500/10" },
    error:     { icon: <AlertCircle className="h-3 w-3" />, label: "Error",       cls: "border-red-500/50 text-red-400 bg-red-500/10" },
    duplicate: { icon: <Copy className="h-3 w-3" />, label: "Duplicado",          cls: "border-purple-500/50 text-purple-400 bg-purple-500/10" },
    skipped:   { icon: <SkipForward className="h-3 w-3" />, label: "Omitido",     cls: "border-gray-500/50 text-gray-400 bg-gray-500/10" },
  }[status] ?? { icon: null, label: status, cls: "border-border text-muted-foreground" };

  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${cfg.cls}`}>
      {cfg.icon} {cfg.label}
    </Badge>
  );
}

export function FiscoImportSection() {
  const [exchange, setExchange]   = useState<"kraken" | "revolutx">("kraken");
  const [options, setOptions]     = useState<ImportOptions>(DEFAULT_OPTIONS);
  const [file, setFile]           = useState<File | null>(null);
  const [preview, setPreview]     = useState<ImportPreviewResult | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggle(key: keyof ImportOptions) {
    setOptions(o => ({ ...o, [key]: !o[key] }));
  }

  async function runPreview() {
    if (!file) return;
    setIsPreviewLoading(true);
    setError(null);
    setPreview(null);
    setConfirmed(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("exchange", exchange);
      fd.append("options", JSON.stringify(options));
      fd.append("dry_run", "true");
      const resp = await fetch("/api/fisco/import-preview", { method: "POST", body: fd });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || resp.statusText);
      setPreview(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setIsConfirmLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/fisco/import-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import_batch_id: preview.import_batch_id, exchange, options }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || resp.statusText);
      setConfirmed(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsConfirmLoading(false);
    }
  }

  const hasErrors    = (preview?.errors ?? 0) > 0;
  const hasDups      = (preview?.duplicates ?? 0) > 0;
  const canConfirm   = !!preview && !hasErrors && !confirmed;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Importación de datos</h2>
        <p className="text-xs text-muted-foreground">
          Preview primero (dry-run). Solo confirma tras revisar el resultado.
          Los datos existentes no se modifican hasta confirmar.
        </p>
      </div>

      {/* ── Configuración ── */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Exchange selector */}
        <Card className="border border-border">
          <CardContent className="p-4 space-y-3">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Exchange</div>
            <div className="flex gap-2">
              {(["kraken", "revolutx"] as const).map(ex => (
                <button
                  key={ex}
                  onClick={() => { setExchange(ex); setPreview(null); setFile(null); }}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    exchange === ex
                      ? "border-blue-500 bg-blue-500/10 text-blue-400"
                      : "border-border text-muted-foreground hover:border-border/80"
                  }`}
                >
                  {ex === "kraken" ? "Kraken" : "RevolutX"}
                </button>
              ))}
            </div>

            {/* File upload */}
            <div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Archivo CSV</div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-border rounded-lg p-4 text-center hover:border-blue-500/50 hover:bg-blue-500/5 transition-colors"
              >
                {file ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-blue-400" />
                    <span className="font-medium text-blue-400">{file.name}</span>
                    <span className="text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm">
                    <Upload className="h-5 w-5 mx-auto mb-1.5 opacity-50" />
                    <p>Clic para seleccionar CSV de {exchange === "kraken" ? "Kraken Ledger" : "RevolutX"}</p>
                    <p className="text-[10px] mt-0.5 opacity-60">CSV, máx. 50 MB</p>
                  </div>
                )}
              </button>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
            </div>
          </CardContent>
        </Card>

        {/* Options */}
        <Card className="border border-border">
          <CardContent className="p-4 space-y-2.5">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Opciones de importación</div>
            {([
              ["includeNormal",               "Operaciones normales (trades)"],
              ["includeThirdFees",            "Comisiones en tercera divisa"],
              ["includeStaking",              "Staking / recompensas"],
              ["includeDeposits",             "Depósitos"],
              ["includeWithdrawals",          "Retiradas"],
              ["skipFiatDepositsWithdrawals", "Omitir depósitos/retiradas FIAT"],
              ["detectDuplicates",            "Detectar duplicados (hash de deduplicación)"],
              ["reconcileTransfers",          "Reconciliar transferencias internas"],
            ] as [keyof ImportOptions, string][]).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <Label htmlFor={key} className="text-xs font-normal cursor-pointer">{label}</Label>
                <Switch
                  id={key}
                  checked={options[key]}
                  onCheckedChange={() => toggle(key)}
                  className="scale-90"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── Acciones ── */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={runPreview}
          disabled={!file || isPreviewLoading}
          className="gap-2 bg-blue-600 hover:bg-blue-700"
        >
          {isPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {isPreviewLoading ? "Analizando..." : "Dry-run preview"}
        </Button>

        {preview && (
          <Button
            onClick={confirmImport}
            disabled={!canConfirm || isConfirmLoading}
            className={`gap-2 ${canConfirm ? "bg-emerald-600 hover:bg-emerald-700" : "opacity-50"}`}
          >
            {isConfirmLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {isConfirmLoading ? "Confirmando..." : "Confirmar importación"}
          </Button>
        )}

        {(preview || file) && (
          <Button variant="outline" onClick={() => { setPreview(null); setFile(null); setConfirmed(false); setError(null); }} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Limpiar
          </Button>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* ── Confirmación ── */}
      {confirmed && (
        <div className="flex items-start gap-2 p-4 rounded-xl border border-green-500/30 bg-green-500/10 text-green-400">
          <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Importación confirmada</div>
            <div className="text-xs mt-0.5 text-green-300">
              {preview?.normalized} operaciones importadas correctamente. Ejecuta un Rebuild FIFO para recalcular.
            </div>
          </div>
        </div>
      )}

      {/* ── Preview resultado ── */}
      {preview && !confirmed && (
        <div className="space-y-4">
          {/* Contadores */}
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {[
              { label: "Filas",        value: preview.total_rows,    color: "" },
              { label: "Normalizadas", value: preview.normalized,    color: "text-green-400" },
              { label: "Duplicadas",   value: preview.duplicates,    color: preview.duplicates > 0 ? "text-purple-400" : "" },
              { label: "Omitidas",     value: preview.skipped,       color: "" },
              { label: "Errores fecha",value: preview.date_errors,   color: preview.date_errors > 0 ? "text-red-400" : "" },
              { label: "Avisos valor", value: preview.value_warnings,color: preview.value_warnings > 0 ? "text-yellow-400" : "" },
              { label: "Errores",      value: preview.errors,        color: preview.errors > 0 ? "text-red-500 font-bold" : "" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg border border-border p-2.5 text-center">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
                <div className={`text-xl font-bold mt-0.5 ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Tabla de rows */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted/80 border-b border-border">
                    <th className="text-left px-2 py-2 font-mono text-muted-foreground uppercase tracking-wider">#</th>
                    <th className="text-left px-2 py-2 font-mono text-muted-foreground uppercase tracking-wider">Tipo Raw</th>
                    <th className="text-left px-2 py-2 font-mono text-muted-foreground uppercase tracking-wider">Tipo Norm.</th>
                    <th className="text-right px-2 py-2 font-mono text-muted-foreground uppercase tracking-wider">Compra</th>
                    <th className="text-right px-2 py-2 font-mono text-muted-foreground uppercase tracking-wider">Venta</th>
                    <th className="text-right px-2 py-2 font-mono text-muted-foreground uppercase tracking-wider">Fee</th>
                    <th className="text-left px-2 py-2 font-mono text-muted-foreground uppercase tracking-wider">Fecha</th>
                    <th className="text-center px-2 py-2 font-mono text-muted-foreground uppercase tracking-wider">Estado</th>
                    <th className="text-left px-2 py-2 font-mono text-muted-foreground uppercase tracking-wider">Nota</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((row: ImportPreviewRow) => (
                    <tr key={row.row_number} className={`hover:bg-muted/20 ${row.status === "error" ? "bg-red-500/5" : row.status === "duplicate" ? "bg-purple-500/5" : ""}`}>
                      <td className="px-2 py-1.5 font-mono text-muted-foreground">{row.row_number}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{row.raw_type}</td>
                      <td className="px-2 py-1.5">{row.normalized_type ?? <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {row.buy_amount != null ? `${row.buy_amount} ${row.buy_asset ?? ""}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {row.sell_amount != null ? `${row.sell_amount} ${row.sell_asset ?? ""}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                        {row.fee_amount != null ? `${row.fee_amount} ${row.fee_asset ?? ""}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                        {row.executed_at ? new Date(row.executed_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : <span className="text-red-400">Sin fecha</span>}
                      </td>
                      <td className="px-2 py-1.5 text-center"><StatusBadge status={row.status} /></td>
                      <td className="px-2 py-1.5 text-muted-foreground max-w-[200px] truncate" title={row.message ?? ""}>
                        {row.message ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {hasErrors && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-red-400 text-sm">
              <XCircle className="h-4 w-4 shrink-0" />
              Hay {preview.errors} error{preview.errors !== 1 ? "es" : ""} crítico{preview.errors !== 1 ? "s" : ""}. Corrígelos antes de confirmar la importación.
            </div>
          )}
          {hasDups && !hasErrors && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-purple-500/30 bg-purple-500/5 text-purple-400 text-sm">
              <Copy className="h-4 w-4 shrink-0" />
              {preview.duplicates} fila{preview.duplicates !== 1 ? "s" : ""} detectada{preview.duplicates !== 1 ? "s" : ""} como duplicada{preview.duplicates !== 1 ? "s" : ""} (por hash). Se omitirán al confirmar.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
