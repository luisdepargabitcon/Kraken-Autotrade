import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { AmaTrajectoryChart } from "./AmaTrajectoryChart";
import { translateLabStatus, translateReplayStatus, translateShadowStatus } from "./amaLabels";

export type ResultType = "lab" | "replay" | "shadow";

export interface ResultSummaryItem {
  id: string;
  name: string;
  type: ResultType;
  status: string;
  createdAt: string;
  /** Solo para type "shadow": no existe endpoint de detalle por id, así que
   * reutilizamos los campos ya cargados en la lista. */
  raw?: Record<string, unknown>;
}

interface AmaResultDetailProps {
  item: ResultSummaryItem;
  onClose: () => void;
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "No disponible";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtBtc(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "No disponible";
  return `${n.toFixed(8)} BTC`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "No disponible";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

interface Row {
  label: string;
  value: string;
  accent?: "positive" | "negative";
}

function DetailRow({ row }: { row: Row }) {
  const color = row.accent === "positive" ? "text-green-400" : row.accent === "negative" ? "text-red-400" : "";
  return (
    <div className="flex items-center justify-between text-sm border-b border-border/10 py-1.5">
      <span className="text-muted-foreground">{row.label}</span>
      <span className={`font-mono font-medium ${color}`}>{row.value}</span>
    </div>
  );
}

/**
 * Detalle de resultado para las 3 familias de pruebas de Laboratorio.
 * Cada campo se calcula a partir de datos reales devueltos por el backend
 * (GET /api/ama/lab/sessions/:id o /api/ama/replay/runs/:id). Cuando el
 * backend no entrega una métrica, se muestra "No disponible": nunca se
 * inventa un valor.
 */
export function AmaResultDetail({ item, onClose }: AmaResultDetailProps) {
  // Para "shadow" no existe endpoint de detalle por id: los datos ya
  // fetcheados en la lista (item.raw) se usan de inmediato como estado
  // inicial, sin depender de un efecto que no aporta nada en ese caso.
  const [detail, setDetail] = useState<any>(item.type === "shadow" ? (item.raw ?? null) : null);
  const [loading, setLoading] = useState(item.type !== "shadow");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item.type === "shadow") return;
    const url = item.type === "lab" ? `/api/ama/lab/sessions/${item.id}` : `/api/ama/replay/runs/${item.id}`;
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setDetail(json.data);
        else setError(json.error || "No se pudo cargar el detalle.");
      })
      .catch(() => setError("No se pudo conectar con el servidor."))
      .finally(() => setLoading(false));
  }, [item]);

  const rows: Row[] = [];
  let chart: React.ReactNode = null;
  let title = item.name;
  let statusLabel = item.status;

  if (item.type === "lab" && detail) {
    const config = (detail.configJson ?? {}) as Record<string, unknown>;
    const capitalInicial = typeof config.maxCapitalUsd === "number" ? config.maxCapitalUsd : null;
    const capitalUtilizado = typeof detail.totalUsdSimulated === "number" ? detail.totalUsdSimulated : null;
    const capitalRestante = capitalInicial != null && capitalUtilizado != null ? capitalInicial - capitalUtilizado : null;
    const btcFinal: number | null = detail.finalQuantity ?? null;
    const valorFinal: number | null = detail.finalValueUsd ?? null;
    const costeMedio = capitalUtilizado != null && btcFinal ? capitalUtilizado / btcFinal : null;
    const resultadoUsd = valorFinal != null && capitalUtilizado != null ? valorFinal - capitalUtilizado : null;
    const resultadoPct = resultadoUsd != null && capitalUtilizado ? (resultadoUsd / capitalUtilizado) * 100 : null;
    const dropPcts = Array.isArray(config.customDropPcts) ? (config.customDropPcts as number[]) : null;

    statusLabel = translateLabStatus(detail.status);
    rows.push(
      { label: "Capital inicial", value: fmtUsd(capitalInicial) },
      { label: "Capital utilizado", value: fmtUsd(capitalUtilizado) },
      { label: "Capital restante", value: fmtUsd(capitalRestante) },
      { label: "Tramos simulados", value: `${detail.totalTranchesSimulated ?? 0} / ${detail.totalTranchesPlanned ?? 0}` },
      { label: "BTC simulado", value: fmtBtc(btcFinal) },
      { label: "Coste medio", value: costeMedio != null ? fmtUsd(costeMedio) : "No disponible" },
      { label: "Valor final", value: fmtUsd(valorFinal) },
      { label: "Resultado USD", value: resultadoUsd != null ? fmtUsd(resultadoUsd) : "No disponible", accent: resultadoUsd != null ? (resultadoUsd >= 0 ? "positive" : "negative") : undefined },
      { label: "Resultado %", value: fmtPct(resultadoPct), accent: resultadoPct != null ? (resultadoPct >= 0 ? "positive" : "negative") : undefined },
      { label: "Caídas configuradas", value: dropPcts && dropPcts.length > 0 ? dropPcts.map((d) => `${d}%`).join(", ") : "No disponible" },
    );

    const trancheResults = Array.isArray(detail.resultJson?.trancheResults) ? detail.resultJson.trancheResults : [];
    const points = trancheResults.map((t: any, i: number) => ({ x: i, price: t.simulatedPrice }));
    chart = <AmaTrajectoryChart points={points} buyMarkers={points} />;
  }

  if (item.type === "replay" && detail) {
    const capitalInicial: number | null = detail.initialCapitalUsd ?? null;
    const capitalUtilizado: number | null = detail.totalUsdDeployed ?? null;
    const capitalRestante = capitalInicial != null && capitalUtilizado != null ? capitalInicial - capitalUtilizado : null;
    const btcFinal: number | null = detail.finalQuantity ?? null;
    const valorFinal: number | null = detail.finalValueUsd ?? null;
    const costeMedio = capitalUtilizado != null && btcFinal ? capitalUtilizado / btcFinal : null;
    const resultadoUsd = valorFinal != null && capitalUtilizado != null ? valorFinal - capitalUtilizado : null;
    const resultadoPct = resultadoUsd != null && capitalUtilizado ? (resultadoUsd / capitalUtilizado) * 100 : null;

    const events = Array.isArray(detail.resultJson?.events) ? detail.resultJson.events : [];
    let maxDropPct: number | null = null;
    if (events.length > 0) {
      let hwm = events[0].price;
      let maxDrop = 0;
      for (const e of events) {
        if (e.price > hwm) hwm = e.price;
        const drop = hwm > 0 ? ((hwm - e.price) / hwm) * 100 : 0;
        if (drop > maxDrop) maxDrop = drop;
      }
      maxDropPct = maxDrop;
    }

    statusLabel = translateReplayStatus(detail.status);
    title = `${detail.startDate?.slice(0, 10) ?? "—"} → ${detail.endDate?.slice(0, 10) ?? "—"}`;
    rows.push(
      { label: "Período", value: `${detail.startDate?.slice(0, 10) ?? "—"} → ${detail.endDate?.slice(0, 10) ?? "—"}` },
      { label: "Cobertura (velas)", value: events.length > 0 ? String(events.length) : "No disponible" },
      { label: "Capital inicial", value: fmtUsd(capitalInicial) },
      { label: "Capital utilizado", value: fmtUsd(capitalUtilizado) },
      { label: "Tramos ejecutados", value: String(detail.totalTranchesExecuted ?? 0) },
      { label: "BTC acumulado", value: fmtBtc(btcFinal) },
      { label: "Coste medio", value: costeMedio != null ? fmtUsd(costeMedio) : "No disponible" },
      { label: "Valor final", value: fmtUsd(valorFinal) },
      { label: "Resultado USD", value: resultadoUsd != null ? fmtUsd(resultadoUsd) : "No disponible", accent: resultadoUsd != null ? (resultadoUsd >= 0 ? "positive" : "negative") : undefined },
      { label: "Resultado %", value: fmtPct(resultadoPct), accent: resultadoPct != null ? (resultadoPct >= 0 ? "positive" : "negative") : undefined },
      { label: "Máxima caída", value: maxDropPct != null ? `${maxDropPct.toFixed(1)}%` : "No disponible" },
    );

    const points = events.map((e: any, i: number) => ({ x: i, price: e.price }));
    const buyMarkers = events
      .map((e: any, i: number) => ({ x: i, price: e.price, action: e.action }))
      .filter((e: any) => e.action === "BUY");
    chart = <AmaTrajectoryChart points={points} buyMarkers={buyMarkers} />;
  }

  if (item.type === "shadow") {
    const raw = detail ?? {};
    statusLabel = translateShadowStatus(String(raw.status ?? item.status));
    rows.push(
      { label: "Escenario", value: String(raw.name ?? item.name) },
      { label: "Par", value: String(raw.pair ?? "No disponible") },
      { label: "Órdenes simuladas", value: String(raw.totalOrders ?? "No disponible") },
      { label: "Ejecuciones simuladas", value: String(raw.totalFilled ?? "No disponible") },
      { label: "USD utilizado", value: fmtUsd(typeof raw.totalSimulatedUsd === "number" ? raw.totalSimulatedUsd : null) },
      { label: "Estado", value: statusLabel },
    );
    chart = (
      <div className="flex items-center justify-center text-xs text-muted-foreground border border-border/20 rounded-md" style={{ height: 160 }}>
        Gráfico no disponible para este tipo de prueba.
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border/30 px-4 py-3 flex-shrink-0">
          <div className="text-sm font-semibold truncate pr-2">{title}</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          {loading && <div className="text-sm text-muted-foreground">Cargando detalle...</div>}
          {error && <div className="text-sm text-red-400">{error}</div>}
          {!loading && !error && (
            <>
              <div className="text-xs text-muted-foreground">Estado: {statusLabel}</div>
              {chart}
              <div>{rows.map((r, i) => <DetailRow key={i} row={r} />)}</div>
              <details className="pt-1">
                <summary className="text-xs text-muted-foreground cursor-pointer">Detalles técnicos</summary>
                <div className="text-[10px] font-mono text-muted-foreground mt-1 break-all">{item.id}</div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
