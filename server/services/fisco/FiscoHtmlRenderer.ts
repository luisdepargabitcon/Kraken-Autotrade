/**
 * FiscoHtmlRenderer
 *
 * Renders complete, interactive HTML fiscal reports in Spanish.
 * All data is embedded — no CDN dependencies.
 * Supports <details> collapsible sections and PDF print.
 *
 * INVARIANTS:
 *   - Read-only: never modifies DB tables
 *   - Self-contained HTML (no external resources)
 *   - All status codes translated to human Spanish
 */

import type { Pool } from "pg";

// ─── Annual gain/loss summary types ─────────────────────────────────────────

export interface AnnualGainLossByAssetRow {
  ticker: string;
  name: string;
  considerationTypeCode: string;
  considerationTypeLabel: string;
  transmissionValueEur: number;
  acquisitionValueEur: number;
  capitalGainLossEur: number;
}

export interface AnnualGainLossByAssetSummary {
  year: number;
  rows: AnnualGainLossByAssetRow[];
  totals: {
    transmissionValueEur: number;
    acquisitionValueEur: number;
    capitalGainLossEur: number;
  };
}

/**
 * Per-disposal enrichment row from DB JOIN.
 * Each row represents one sell_operation_id with its counter_asset info.
 */
export interface DisposalCounterAssetRow {
  asset: string;
  sell_operation_id: number;
  counter_asset: string | null;
  pair: string | null;
  op_type: string | null;
  net_proceeds_eur: number;
  cost_basis_eur: number;
  gain_loss_eur: number;
  is_fee_disposal: boolean;
}

// Consideration type codes (Art. 14 bis Ley 35/2006)
const CONSIDERATION_TYPE_LABELS: Record<string, string> = {
  F: "F - Moneda de curso legal",
  N: "N - Otra moneda virtual",
  O: "O - Otro activo virtual",
};

// Fiat currencies: EUR, USD and major world currencies
export const FIAT_CURRENCIES = new Set([
  "EUR","USD","GBP","CHF","JPY","CAD","AUD","NZD",
  "SEK","NOK","DKK","PLN","CZK","HUF","RON","TRY",
  "MXN","BRL","ZUSD","ZEUR","ZGBP",
]);

// op_types that indicate a fee/expense disposal (→ type O)
const FEE_DISPOSAL_OP_TYPES = new Set([
  "fee","expense","fee_disposal","balancing","rounding","other","adjustment",
  "conservative_external_disposal",
]);

/**
 * Classifies the consideration type for a disposal:
 *  F  — received fiat currency (EUR, USD, GBP, …)
 *  N  — received another virtual currency (BTC, ETH, USDC, USDT, EURC, …)
 *  O  — fee/expense disposal, or counter asset unknown/missing
 *
 * Priority: op_type fee → O; counter fiat → F; counter crypto → N;
 *           infer from pair → F/N; missing counter → O + warning
 */
export function classifyConsiderationType(
  counterAsset: string | null | undefined,
  pair: string | null | undefined,
  opType: string | null | undefined,
  year: number,
  asset: string
): { code: "F" | "N" | "O"; source: string } {
  // 1. Fee/expense/other op_type → O
  if (opType && FEE_DISPOSAL_OP_TYPES.has(opType.toLowerCase())) {
    return { code: "O", source: "op_type_fee" };
  }

  // 2. Explicit counter_asset present
  if (counterAsset && counterAsset.trim() !== "") {
    const ca = counterAsset.trim().toUpperCase();
    if (FIAT_CURRENCIES.has(ca)) {
      console.log(
        `[FISCO][ANNUAL_GAIN_LOSS_COUNTERPARTY] year=${year} asset=${asset} counter=${ca} type=F source=operation_counter_asset`
      );
      return { code: "F", source: "operation_counter_asset" };
    }
    console.log(
      `[FISCO][ANNUAL_GAIN_LOSS_COUNTERPARTY] year=${year} asset=${asset} counter=${ca} type=N source=operation_counter_asset`
    );
    return { code: "N", source: "operation_counter_asset" };
  }

  // 3. Infer from pair (format BASE/COUNTER or BASECOUNTER with known fiat suffix)
  if (pair && pair.includes("/")) {
    const parts = pair.split("/");
    const counterFromPair = parts[parts.length - 1].trim().toUpperCase();
    if (FIAT_CURRENCIES.has(counterFromPair)) {
      console.log(
        `[FISCO][ANNUAL_GAIN_LOSS_COUNTERPARTY] year=${year} asset=${asset} counter=${counterFromPair} type=F source=pair_inference`
      );
      return { code: "F", source: "pair_inference" };
    }
    if (counterFromPair !== "") {
      console.log(
        `[FISCO][ANNUAL_GAIN_LOSS_COUNTERPARTY] year=${year} asset=${asset} counter=${counterFromPair} type=N source=pair_inference`
      );
      return { code: "N", source: "pair_inference" };
    }
  }

  // 4. No counter info → O + warning
  console.warn(
    `[FISCO][ANNUAL_GAIN_LOSS_COUNTERPARTY_WARNING] year=${year} asset=${asset} reason=counter_asset_missing fallback=O`
  );
  return { code: "O", source: "missing_counter" };
}

/**
 * Builds the annual gain/loss summary grouped by (asset, considerationType).
 * Uses enriched disposal rows with counter_asset / pair / op_type so that
 * F/N/O is derived from actual transaction data, not a default fallback.
 *
 * transmissionValueEur = net proceeds (proceeds_eur - fee_eur) per Bit2Me convention.
 * gain_loss_eur        = remains canonical (from fisco_disposals FIFO).
 */
export function buildAnnualGainLossByAssetSummary(
  year: number,
  disposalRows: DisposalCounterAssetRow[]
): AnnualGainLossByAssetSummary {
  // Group by asset + considerationType
  const groupKey = (asset: string, typeCode: string) => `${asset}|${typeCode}`;
  const groups = new Map<string, {
    ticker: string;
    typeCode: string;
    transmissionValueEur: number;
    acquisitionValueEur: number;
    capitalGainLossEur: number;
  }>();

  for (const r of disposalRows) {
    const { code } = classifyConsiderationType(
      r.counter_asset, r.pair, r.op_type, year, r.asset
    );
    const key = groupKey(r.asset, code);
    const existing = groups.get(key);
    if (existing) {
      existing.transmissionValueEur += r.net_proceeds_eur;
      existing.acquisitionValueEur  += r.cost_basis_eur;
      existing.capitalGainLossEur   += r.gain_loss_eur;
    } else {
      groups.set(key, {
        ticker: r.asset,
        typeCode: code,
        transmissionValueEur: r.net_proceeds_eur,
        acquisitionValueEur:  r.cost_basis_eur,
        capitalGainLossEur:   r.gain_loss_eur,
      });
    }
  }

  const typeOrder: Record<string, number> = { F: 0, N: 1, O: 2 };
  const rows: AnnualGainLossByAssetRow[] = [...groups.values()]
    .map(g => ({
      ticker: g.ticker,
      name: g.ticker,
      considerationTypeCode: g.typeCode,
      considerationTypeLabel: CONSIDERATION_TYPE_LABELS[g.typeCode]
        ?? `${g.typeCode} - Tipo no determinado`,
      transmissionValueEur: g.transmissionValueEur,
      acquisitionValueEur: g.acquisitionValueEur,
      capitalGainLossEur: g.capitalGainLossEur,
    }))
    .sort((a, b) => {
      const tc = a.ticker.localeCompare(b.ticker);
      if (tc !== 0) return tc;
      return (typeOrder[a.considerationTypeCode] ?? 9) - (typeOrder[b.considerationTypeCode] ?? 9);
    });

  const totalTransmission = rows.reduce((s, r) => s + r.transmissionValueEur, 0);
  const totalAcquisition  = rows.reduce((s, r) => s + r.acquisitionValueEur, 0);
  const totalGainLoss     = rows.reduce((s, r) => s + r.capitalGainLossEur, 0);

  // Validation: transmission_net - acquisition should ≈ gain_loss (tolerance 0.02 EUR)
  const expectedGainLoss = totalTransmission - totalAcquisition;
  const diff = Math.abs(totalGainLoss - expectedGainLoss);
  if (diff > 0.02) {
    console.warn(
      `[FISCO][ANNUAL_GAIN_LOSS_SUMMARY_WARNING] year=${year} reason=totals_mismatch ` +
      `diff=${diff.toFixed(4)} totalGainLoss=${totalGainLoss.toFixed(2)} ` +
      `expected=${expectedGainLoss.toFixed(2)}`
    );
  }

  console.log(
    `[FISCO][ANNUAL_GAIN_LOSS_SUMMARY] year=${year} rows=${rows.length} ` +
    `transmission_net=${totalTransmission.toFixed(2)} ` +
    `acquisition=${totalAcquisition.toFixed(2)} ` +
    `pnl=${totalGainLoss.toFixed(2)}`
  );

  return {
    year,
    rows,
    totals: {
      transmissionValueEur: totalTransmission,
      acquisitionValueEur:  totalAcquisition,
      capitalGainLossEur:   totalGainLoss,
    },
  };
}

// ─── Status translations ──────────────────────────────────────────────────────

export function translateStatus(code: string): string {
  const map: Record<string, string> = {
    OK:                                  "Correcto",
    OK_WITH_WARNINGS:                    "Correcto con avisos",
    WARNINGS:                            "Avisos",
    DIFFERENCES:                         "Diferencias",
    PENDING:                             "Pendiente",
    NONE:                                "Ninguna",
    ACTIVE:                              "Activas",
    CRITICAL:                            "Error crítico",
    fifo_internal_historical_inventory:  "Validación FIFO histórica interna",
    exchange_statement_verified:         "Verificado con extracto del exchange",
    OK_INTERNAL_TRANSFER:                "OK — Transferencia interna",
    NO_DISPOSALS:                        "Sin disposals este año",
    NEGATIVE_CLOSING:                    "Cierre negativo (error estructural FIFO)",
    MISMATCH:                            "Discrepancia",
  };
  return map[code] ?? code;
}

// ─── CSS + JS (self-contained) ────────────────────────────────────────────────

export const HTML_STYLE = `
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;max-width:1200px;margin:0 auto;padding:1.5rem;color:#1a1a1a;font-size:14px}
  h1{color:#1a1a2e;border-bottom:3px solid #1a1a2e;padding-bottom:.5rem;font-size:1.6rem}
  h2{color:#16213e;margin-top:2rem;border-left:5px solid #0f3460;padding-left:.75rem;font-size:1.2rem}
  h3{color:#0f3460;font-size:1rem;margin:.75rem 0 .4rem}
  table{border-collapse:collapse;width:100%;margin:.75rem 0;font-size:13px}
  th,td{padding:.45rem .6rem;border:1px solid #ddd;text-align:left}
  th{background:#f0f4ff;font-weight:600}
  tr:nth-child(even){background:#fafafa}
  .badge{display:inline-block;padding:.15rem .45rem;border-radius:4px;font-size:.72rem;font-weight:600;white-space:nowrap}
  .ok{color:#155724}.err{color:#721c24}.warn{color:#856404}
  .b-ok{background:#d4edda;color:#155724}.b-warn{background:#fff3cd;color:#856404}.b-err{background:#f8d7da;color:#721c24}.b-info{background:#d1ecf1;color:#0c5460}
  details{border:1px solid #e0e0e0;border-radius:6px;margin:.5rem 0;padding:0}
  summary{padding:.6rem 1rem;cursor:pointer;font-weight:600;background:#f5f7ff;border-radius:5px;list-style:none;user-select:none}
  summary::-webkit-details-marker{display:none}
  summary::before{content:"▶ ";font-size:.7rem;color:#0f3460}
  details[open] summary::before{content:"▼ "}
  details[open]{padding-bottom:.5rem}
  .details-body{padding:.5rem 1rem}
  .portada{background:linear-gradient(135deg,#f0f4ff,#e8f0fe);border-radius:10px;padding:2rem;margin-bottom:2rem;border:1px solid #c5d3f0}
  .portada h1{border:none;margin:0 0 .5rem}
  .portada .estado{font-size:1.1rem;margin:.75rem 0}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:.75rem 0}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin:.75rem 0}
  .card{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:.75rem}
  .card label{display:block;font-size:.68rem;text-transform:uppercase;color:#888;margin-bottom:.2rem;letter-spacing:.03em}
  .card .val{font-size:1rem;font-weight:700}
  .blockers{background:#fff5f5;border:1px solid #f5c6cb;border-radius:6px;padding:.75rem;margin:.5rem 0}
  .warnings-box{background:#fffbf0;border:1px solid #ffc107;border-radius:6px;padding:.75rem;margin:.5rem 0}
  .diagnostic-note{background:#e8f4fd;border:1px solid #bee5eb;border-radius:6px;padding:.6rem .9rem;font-size:.8rem;color:#0c5460;margin:.4rem 0}
  .resumen-ejecutivo{background:#f8fff8;border:1px solid #c3e6cb;border-radius:8px;padding:1.25rem;margin:1rem 0;line-height:1.6}
  .toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #e0e0e0;padding:.5rem 0;z-index:100;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
  .btn{padding:.35rem .8rem;border-radius:4px;border:1px solid #ccc;cursor:pointer;font-size:.8rem;background:#fff;color:#333}
  .btn:hover{background:#f0f4ff;border-color:#0f3460;color:#0f3460}
  .btn-primary{background:#0f3460;color:#fff;border-color:#0f3460}
  .btn-primary:hover{background:#16213e}
  .annexe{background:#f9f9f9;border:1px solid #ddd;border-radius:8px;padding:1.5rem;margin-top:2rem;font-size:.82rem}
  .section-block{border:1px solid #e0e0e0;border-radius:8px;padding:1.25rem;margin:1.25rem 0}
  .gain-pos{color:#721c24;font-weight:700}.gain-neg{color:#155724;font-weight:700}.gain-zero{color:#555;font-weight:700}
  .annual-gain-loss-summary{margin:1.5rem 0;page-break-after:always;break-after:page}
  .annual-gain-loss-summary h2{margin-top:0}
  .gain-loss-summary-table{width:100%;border-collapse:collapse;font-size:12px;margin:.75rem 0}
  .gain-loss-summary-table th,.gain-loss-summary-table td{border:1px solid #333;padding:4px 6px;vertical-align:middle}
  .gain-loss-summary-table th{background:#e8eef8;font-weight:700;text-align:center;font-size:11px}
  .gain-loss-summary-table td:nth-child(4),.gain-loss-summary-table td:nth-child(5),.gain-loss-summary-table td:nth-child(6){text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .gain-loss-summary-table .total-row{font-weight:700;background:#f0f0f0}
  .gain-loss-summary-table .total-row td{border-top:2px solid #333}
  @page {
    size: A4 portrait;
    margin: 10mm;
  }
  @media print {
    html, body {
      width: 190mm;
      max-width: 190mm;
      margin: 0 auto;
      padding: 0;
      font-size: 10px;
      line-height: 1.25;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .toolbar,
    .no-print {
      display: none !important;
    }
    .portada {
      padding: 10mm;
      margin-bottom: 8mm;
      page-break-after: avoid;
    }
    .grid2,
    .grid3 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4mm;
    }
    .card {
      padding: 4mm;
      page-break-inside: avoid;
    }
    .section-block {
      page-break-inside: avoid;
      margin: 6mm 0;
      padding: 4mm;
    }
    table {
      width: 100%;
      table-layout: fixed;
      font-size: 8.5px;
      page-break-inside: auto;
    }
    th,
    td {
      padding: 2.5px 3.5px;
      word-break: break-word;
    }
    tr {
      page-break-inside: avoid;
    }
    .annual-gain-loss-summary {
      page-break-after: always;
      break-after: page;
    }
    .annual-gain-loss-summary .gain-loss-summary-table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      font-size: 8.5pt;
    }
    .annual-gain-loss-summary .gain-loss-summary-table th,
    .annual-gain-loss-summary .gain-loss-summary-table td {
      border: 1px solid #333;
      padding: 3px 4px;
      vertical-align: middle;
      overflow-wrap: anywhere;
      word-break: normal;
    }
    .annual-gain-loss-summary .gain-loss-summary-table th {
      font-weight: 700;
      text-align: center;
    }
    .annual-gain-loss-summary .gain-loss-summary-table td:nth-child(4),
    .annual-gain-loss-summary .gain-loss-summary-table td:nth-child(5),
    .annual-gain-loss-summary .gain-loss-summary-table td:nth-child(6) {
      text-align: right;
      white-space: nowrap;
    }
    .annual-gain-loss-summary .gain-loss-summary-table .total-row {
      font-weight: 700;
    }
    details {
      display: block !important;
      page-break-inside: avoid;
      border: none;
    }
    details summary {
      display: none !important;
    }
    .details-body {
      display: block !important;
      padding: 0;
    }
    h1 {
      font-size: 18px;
    }
    h2 {
      font-size: 14px;
      margin-top: 8mm;
    }
    h3 {
      font-size: 12px;
    }
  }
</style>`;

export const HTML_SCRIPTS = `
<script>
function expandAll(){document.querySelectorAll('details').forEach(d=>d.open=true)}
function collapseAll(){document.querySelectorAll('details').forEach(d=>d.open=false)}
function preparePdf(){
  expandAll();
  document.body.classList.add('print-mode');
  setTimeout(()=>window.print(),200);
}
function filterTable(inputId,tableId){
  var v=document.getElementById(inputId).value.toLowerCase();
  document.querySelectorAll('#'+tableId+' tbody tr').forEach(function(r){
    r.style.display=r.textContent.toLowerCase().includes(v)?'':'none';
  });
}
</script>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Canonical function to build annual HTML report data with enriched finStatus.
 * This ensures consistent enrichment of gains_eur, losses_eur, staking_total_eur
 * across all report generation endpoints (direct HTML and audit-pack ZIP).
 */
export async function buildAnnualHtmlReportData(
  pool: Pool,
  year: number,
  exchanges: string[]
): Promise<{
  year: number;
  exchanges: string[];
  finStatus: any;
  portfolio: any;
  krakenRec: any;
}> {
  const { FiscoValidationService } = await import("./FiscoValidationService");
  const { KrakenReconciliationService } = await import("./KrakenReconciliationService");

  const validSvc = new FiscoValidationService(pool);
  const krakenSvc = new KrakenReconciliationService(pool);

  const [finStatus, portfolio, krakenRec, gainsQ, stakingQ] = await Promise.all([
    validSvc.getFinalizationStatus(year),
    validSvc.validatePortfolio(year, null),
    krakenSvc.reconcile(year),
    // Gains/losses breakdown — same query as /api/fisco/annual-report section_a
    pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN d.gain_loss_eur::numeric > 0 THEN d.gain_loss_eur::numeric ELSE 0 END), 0) AS ganancias,
        COALESCE(SUM(CASE WHEN d.gain_loss_eur::numeric < 0 THEN d.gain_loss_eur::numeric ELSE 0 END), 0) AS perdidas
      FROM fisco_disposals d
      JOIN fisco_operations o ON o.id = d.sell_operation_id
      WHERE EXTRACT(YEAR FROM d.disposed_at) = $1
    `, [year]),
    // Staking total — informational row in fiscal summary
    pool.query(`
      SELECT COALESCE(SUM(fo.total_eur::numeric), 0) AS total
      FROM fisco_operations fo
      WHERE fo.op_type IN ('staking','reward','distribution')
        AND EXTRACT(YEAR FROM fo.executed_at) = $1
    `, [year]),
  ]);

  // Enrich finStatus so renderFiscalSummaryTable can show gains/losses/staking correctly
  const finEnriched = {
    ...finStatus,
    gains_eur: Math.round(parseFloat(gainsQ.rows[0]?.ganancias ?? "0") * 100) / 100,
    losses_eur: Math.round(parseFloat(gainsQ.rows[0]?.perdidas ?? "0") * 100) / 100,
    staking_total_eur: Math.round(parseFloat(stakingQ.rows[0]?.total ?? "0") * 100) / 100,
  };

  return { year, exchanges, finStatus: finEnriched, portfolio, krakenRec };
}

function eur(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
}

function fmtQty(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 8 }).format(n);
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("es-ES"); }
  catch { return String(d); }
}

function badge(cls: string, text: string) {
  return `<span class="badge ${cls}">${text}</span>`;
}

function statusBadge(ok: boolean, warn?: boolean): string {
  if (ok && !warn) return badge("b-ok", "✓ Finalizable");
  if (warn)        return badge("b-warn", "⚠ Finalizable con avisos");
  return badge("b-err", "✗ No finalizable");
}

function gainClass(n: number): string {
  if (n > 0.01) return "gain-pos";
  if (n < -0.01) return "gain-neg";
  return "gain-zero";
}

// ─── Fiscal summary table ────────────────────────────────────────────────────

function renderFiscalSummaryTable(fin: any): string {
  const rows = [
    ["Ganancias por transmisiones (FIFO)",   eur(fin.gains_eur ?? 0),         "Suma de ganancias individuales de cada venta"],
    ["Pérdidas por transmisiones (FIFO)",    eur(fin.losses_eur ?? 0),        "Suma de pérdidas individuales de cada venta"],
    ["Resultado FIFO ordinario",             `<strong class="${gainClass(fin.ordinary_fifo_gain_loss_eur ?? 0)}">${eur(fin.ordinary_fifo_gain_loss_eur)}</strong>`, "Ganancias + Pérdidas del ejercicio"],
    ["Disposiciones externas conservadoras", eur(fin.conservative_external_disposals_gain_loss_eur ?? 0), "Retiros sin statement, valorados conservadoramente a precio de mercado"],
    ["Total fiscal final",                   `<strong class="${gainClass(fin.final_taxable_gain_loss_eur ?? 0)}">${eur(fin.final_taxable_gain_loss_eur)}</strong>`, "FIFO ordinario + Disposiciones conservadoras — A declarar"],
    ["Staking / rewards (informativo)",      eur(fin.staking_total_eur ?? 0),  "Rendimientos de staking — se tratan como rendimiento del capital mobiliario"],
    ["Número de operaciones",                String(fin.operations_count ?? "—"), "Total operaciones en el año"],
    ["Ventas / disposals FIFO",              String(fin.disposals_count ?? "—"),  "Número de ventas o consumos de lotes FIFO"],
    ["Lotes abiertos (inventario actual)",   String(fin.open_lots_count ?? "—"),  "Lotes FIFO con remaining_qty > 0"],
  ];

  return `<table>
    <thead><tr><th>Concepto</th><th>Importe</th><th>Explicación</th></tr></thead>
    <tbody>${rows.map(([c, v, e]) => `<tr><td>${c}</td><td>${v}</td><td style="color:#666;font-size:.82rem">${e}</td></tr>`).join("")}
    </tbody></table>`;
}

// ─── Validation state section ─────────────────────────────────────────────────

function renderValidationState(fin: any, portfolio: any): string {
  const fifoHuman   = translateStatus(fin.fifo_status ?? "—");
  const portHuman   = translateStatus(fin.portfolio_status ?? "—");
  const wdHuman     = translateStatus(fin.withdrawals_status ?? "—");
  const consHuman   = translateStatus(fin.conservative_disposals_status ?? "—");
  const valStrength = translateStatus(portfolio?.validation_strength ?? "—");

  const blockerHtml = fin.blockers?.length > 0
    ? `<div class="blockers"><strong>Bloqueantes:</strong><ul>${fin.blockers.map((b: any) =>
        `<li class="err">[${b.code}] ${b.detail}</li>`).join("")}</ul></div>`
    : `<p class="ok">Sin bloqueantes ✓</p>`;

  const warnHtml = fin.warnings?.length > 0
    ? `<div class="warnings-box"><strong>Avisos (no bloquean):</strong><ul>${fin.warnings.map((w: any) =>
        `<li class="warn">[${w.code}] ${w.detail}</li>`).join("")}</ul></div>`
    : "";

  return `
  <div class="grid2">
    <div class="card"><label>FIFO</label><span class="val ${fin.fifo_status === "OK" ? "ok" : "err"}">${fifoHuman}</span></div>
    <div class="card"><label>Cartera (portfolio)</label><span class="val ${fin.portfolio_status === "OK" ? "ok" : "err"}">${portHuman}</span></div>
    <div class="card"><label>Retiradas / withdrawals</label><span class="val">${wdHuman}</span></div>
    <div class="card"><label>Disposiciones conservadoras</label><span class="val">${consHuman}</span></div>
    <div class="card"><label>Método de validación</label><span style="font-size:.82rem">${valStrength}</span></div>
    <div class="card"><label>Estado final</label>${statusBadge(fin.report_can_be_finalized)}</div>
  </div>
  ${blockerHtml}${warnHtml}`;
}

// ─── Asset detail section ────────────────────────────────────────────────────

function renderAssetSection(assetSummaries: AssetSummary[], disposalsByAsset: Record<string, any[]>, operationsByAsset: Record<string, any[]>): string {
  if (!assetSummaries || assetSummaries.length === 0) {
    return `<p class="warn">Sin datos de activos para este año.</p>`;
  }

  const items = assetSummaries.map(a => {
    const disposals = disposalsByAsset[a.asset] ?? [];
    const ops       = operationsByAsset[a.asset] ?? [];

    const dispTable = disposals.length === 0 ? `<p style="color:#888">Sin ventas FIFO este año</p>` : `
      <table><thead><tr>
        <th>Fecha venta</th><th>Exchange</th><th>Cantidad vendida</th><th>Valor de venta / transmisión</th>
        <th>Valor de adquisición FIFO</th><th>Comisión imputada</th><th>Ganancia/Pérdida fiscal</th>
      </tr></thead><tbody>
      ${disposals.slice(0, 100).map(d => `<tr>
        <td>${fmtDate(d.disposed_at)}</td>
        <td>${d.exchange ?? "—"}</td>
        <td>${fmtQty(parseFloat(d.quantity ?? "0"))}</td>
        <td>${eur(parseFloat(d.proceeds_eur ?? "0"))}</td>
        <td>${eur(parseFloat(d.cost_basis_eur ?? "0"))}</td>
        <td>${eur(parseFloat(d.fee_eur ?? "0"))}</td>
        <td class="${gainClass(parseFloat(d.gain_loss_eur ?? "0"))}">${eur(parseFloat(d.gain_loss_eur ?? "0"))}</td>
      </tr>`).join("")}
      ${disposals.length > 100 ? `<tr><td colspan="7" style="color:#888">… y ${disposals.length - 100} más</td></tr>` : ""}
      </tbody></table>`;

    const opsTable = ops.length === 0 ? `<p style="color:#888">Sin operaciones registradas</p>` : `
      <table><thead><tr>
        <th>Fecha</th><th>Exchange</th><th>Tipo</th><th>Cantidad</th><th>Precio EUR</th><th>Total EUR</th><th>External ID</th>
      </tr></thead><tbody>
      ${ops.slice(0, 50).map(o => `<tr>
        <td>${fmtDate(o.executed_at)}</td>
        <td>${o.exchange ?? "—"}</td>
        <td>${o.op_type ?? "—"}</td>
        <td>${fmtQty(parseFloat(o.amount ?? "0"))}</td>
        <td>${eur(parseFloat(o.price_eur ?? "0"))}</td>
        <td>${eur(parseFloat(o.total_eur ?? "0"))}</td>
        <td style="font-size:.72rem;color:#888">${o.external_id ?? "—"}</td>
      </tr>`).join("")}
      ${ops.length > 50 ? `<tr><td colspan="7" style="color:#888">… y ${ops.length - 50} más (ver CSV para lista completa)</td></tr>` : ""}
      </tbody></table>`;

    const totalGain = a.gain_loss_eur ?? 0;
    const gainLabel = `<span class="${gainClass(totalGain)}">${eur(totalGain)}</span>`;

    return `
    <details>
      <summary>${a.asset} &nbsp;—&nbsp; Resultado: ${gainLabel} &nbsp;—&nbsp; Disposals: ${a.disposals_count ?? 0} &nbsp;—&nbsp; Ops: ${a.operations_count ?? 0}</summary>
      <div class="details-body">
        <div class="grid3">
          <div class="card"><label>Inventario inicio año</label><span class="val">${fmtQty(a.opening_qty)}</span></div>
          <div class="card"><label>Adquirido en el año</label><span class="val">${fmtQty(a.acquisitions_qty)}</span></div>
          <div class="card"><label>Vendido/dispuesto</label><span class="val">${fmtQty(a.disposals_qty)}</span></div>
          <div class="card"><label>Inventario fin año</label><span class="val">${fmtQty(a.closing_qty)}</span></div>
          <div class="card"><label>Valor de venta / transmisión</label><span class="val">${eur(a.proceeds_eur)}</span></div>
          <div class="card"><label>Valor de adquisición FIFO</label><span class="val">${eur(a.cost_basis_eur)}</span></div>
          <div class="card"><label>Comisiones</label><span class="val">${eur(a.fees_eur)}</span></div>
          <div class="card"><label>Ganancia / Pérdida</label><span class="val ${gainClass(totalGain)}">${eur(totalGain)}</span></div>
          <div class="card"><label>Exchanges</label><span style="font-size:.82rem">${a.exchanges ?? "—"}</span></div>
        </div>

        <details><summary>Ventas FIFO de ${a.asset} (${disposals.length})</summary>
          <div class="details-body">${dispTable}</div>
        </details>

        <details><summary>Operaciones de ${a.asset} (${ops.length})</summary>
          <div class="details-body">${opsTable}</div>
        </details>
      </div>
    </details>`;
  }).join("\n");

  return `<div class="section-block">${items}</div>`;
}

// ─── Exchange detail section ──────────────────────────────────────────────────

function renderExchangeSection(exchangeSummaries: ExchangeSummary[]): string {
  if (!exchangeSummaries || exchangeSummaries.length === 0) {
    return `<p class="warn">Sin datos por exchange.</p>`;
  }
  return exchangeSummaries.map(e => {
    const diagNote = e.diagnostic_only ? `
      <div class="diagnostic-note">ℹ️ <strong>Diagnóstico por exchange.</strong>
      El FIFO fiscal oficial del bot es global multi-exchange. Esta vista puede mostrar diferencias si existen
      transferencias internas, withdrawals cross-exchange o movimientos cuyo lote de origen está en otro exchange.
      No bloquea el informe fiscal global.</div>` : "";

    return `
    <details>
      <summary>${e.exchange === "global" ? "🌐 Global consolidado" : `🏛 ${e.exchange}`}
        &nbsp;—&nbsp; ${e.operations_count ?? 0} operaciones
        &nbsp;—&nbsp; ${badge(e.reconciliation_status === "OK" ? "b-ok" : e.reconciliation_status === "OK_WITH_WARNINGS" ? "b-warn" : "b-err", translateStatus(e.reconciliation_status ?? "—"))}
      </summary>
      <div class="details-body">
        ${diagNote}
        <div class="grid3">
          <div class="card"><label>Operaciones totales</label><span class="val">${e.operations_count ?? 0}</span></div>
          <div class="card"><label>Compras</label><span class="val">${e.buys_count ?? 0}</span></div>
          <div class="card"><label>Ventas</label><span class="val">${e.sells_count ?? 0}</span></div>
          <div class="card"><label>Depósitos</label><span class="val">${e.deposits_count ?? 0}</span></div>
          <div class="card"><label>Retiradas</label><span class="val">${e.withdrawals_count ?? 0}</span></div>
          <div class="card"><label>Staking/rewards</label><span class="val">${e.staking_count ?? 0}</span></div>
          <div class="card"><label>Comisiones totales</label><span class="val">${eur(e.fees_eur ?? 0)}</span></div>
          <div class="card"><label>Resultado atribuido</label><span class="val ${gainClass(e.gain_loss_eur ?? 0)}">${eur(e.gain_loss_eur ?? 0)}</span></div>
          <div class="card"><label>Conciliación</label>${badge(e.reconciliation_status === "OK" ? "b-ok" : e.reconciliation_status === "OK_WITH_WARNINGS" ? "b-warn" : "b-err", translateStatus(e.reconciliation_status ?? "—"))}</div>
        </div>
        ${e.warnings && e.warnings.length > 0 ? `<div class="warnings-box"><strong>Avisos:</strong><ul>${e.warnings.map((w: string) => `<li class="warn">⚠ ${w}</li>`).join("")}</ul></div>` : ""}
      </div>
    </details>`;
  }).join("\n");
}

// ─── Formato EUR español (sin símbolo) ───────────────────────────────────────

function fmtEurEs(n: number): string {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// ─── Annual gain/loss summary section ────────────────────────────────────────

function renderAnnualGainLossSummarySection(
  summary: AnnualGainLossByAssetSummary
): string {
  const { year, rows, totals } = summary;

  if (rows.length === 0) {
    return `
<section class="annual-gain-loss-summary section-block">
  <h2>Resumen de ganancias y pérdidas por activo el ${year}</h2>
  <p style="color:#888">Sin transmisiones registradas en ${year}.</p>
</section>`;
  }

  const dataRows = rows.map(r => `
      <tr>
        <td>${r.ticker}</td>
        <td>${r.name}</td>
        <td>${r.considerationTypeLabel}</td>
        <td>${fmtEurEs(r.transmissionValueEur)}</td>
        <td>${fmtEurEs(r.acquisitionValueEur)}</td>
        <td class="${r.capitalGainLossEur > 0.005 ? "gain-pos" : r.capitalGainLossEur < -0.005 ? "gain-neg" : "gain-zero"}">${fmtEurEs(r.capitalGainLossEur)}</td>
      </tr>`).join("");

  const totalClass = totals.capitalGainLossEur > 0.005 ? "gain-pos"
    : totals.capitalGainLossEur < -0.005 ? "gain-neg" : "gain-zero";

  return `
<section class="annual-gain-loss-summary">
  <h2>Resumen de ganancias y pérdidas por activo el ${year}</h2>
  <table class="gain-loss-summary-table">
    <thead>
      <tr>
        <th>Ticker</th>
        <th>Nombre</th>
        <th>Tipo de contraprestación recibida a cambio</th>
        <th>Valor de transmisión en EUR</th>
        <th>Valor de adquisición en EUR</th>
        <th>Ganancia o pérdida de capital en EUR</th>
      </tr>
    </thead>
    <tbody>
      ${dataRows}
      <tr class="total-row">
        <td colspan="3">Total ${year}</td>
        <td>${fmtEurEs(totals.transmissionValueEur)}</td>
        <td>${fmtEurEs(totals.acquisitionValueEur)}</td>
        <td class="${totalClass}">${fmtEurEs(totals.capitalGainLossEur)}</td>
      </tr>
    </tbody>
  </table>
</section>`;
}

// ─── Staking section ─────────────────────────────────────────────────────────

function renderStakingSection(stakingRows: any[]): string {
  if (!stakingRows || stakingRows.length === 0) {
    return `<p style="color:#888">Sin rendimientos de staking/rewards este año.</p>`;
  }
  const totalEur = stakingRows.reduce((s, r) => s + parseFloat(r.total_eur ?? "0"), 0);
  const byAsset  = stakingRows.reduce((m: Record<string, any[]>, r) => {
    const k = r.asset ?? "—"; m[k] = m[k] ?? []; m[k].push(r); return m;
  }, {});

  const assetItems = Object.entries(byAsset).map(([asset, rows]) => {
    const assetTotal = rows.reduce((s, r) => s + parseFloat(r.total_eur ?? "0"), 0);
    return `
    <details><summary>${asset} — ${eur(assetTotal)} — ${rows.length} operaciones</summary>
      <div class="details-body">
        <table><thead><tr><th>Fecha</th><th>Exchange</th><th>Tipo</th><th>Cantidad</th><th>Valor EUR</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td>${fmtDate(r.executed_at)}</td><td>${r.exchange ?? "—"}</td><td>${r.op_type ?? "—"}</td>
          <td>${fmtQty(parseFloat(r.amount ?? "0"))}</td><td>${eur(parseFloat(r.total_eur ?? "0"))}</td>
        </tr>`).join("")}</tbody></table>
      </div>
    </details>`;
  }).join("");

  return `
  <div class="diagnostic-note">ℹ️ Estos importes se muestran separados de las ganancias/pérdidas por transmisión. El tratamiento fiscal del staking puede diferir según la normativa aplicable. Consulte con su asesor fiscal.</div>
  <p><strong>Total staking/rewards:</strong> <span class="ok">${eur(totalEur)}</span></p>
  ${assetItems}`;
}

// ─── Withdrawals / transfers section ─────────────────────────────────────────

function renderWithdrawalsSection(stmtItems: any[], krakenRec?: any): string {
  const withdrawalsNoStmt: any[] = krakenRec?.withdrawals_without_statement ?? [];

  // Show "no data" only if BOTH statement items and kraken warnings are empty
  if ((!stmtItems || stmtItems.length === 0) && withdrawalsNoStmt.length === 0) {
    return `<p style="color:#888">Sin retiradas o transferencias internas este año.</p>`;
  }

  let html = "";

  // Block 1 — Kraken withdrawals without statement item (from reconciliation)
  if (withdrawalsNoStmt.length > 0) {
    html += `
    <details open>
      <summary>⚠ Retiradas Kraken sin statement item (${withdrawalsNoStmt.length})</summary>
      <div class="details-body">
        <div class="warnings-box">
          <strong>Aviso no bloqueante:</strong> Existe${withdrawalsNoStmt.length === 1 ? " una retirada Kraken" : "n retiradas Kraken"} sin statement item enlazado.
          Se muestra como aviso informativo. No bloquea el informe fiscal global porque finalization-status está OK.
          Verificar si corresponde a una transferencia interna propia u otro movimiento.
        </div>
        <table><thead><tr>
          <th>Fecha</th><th>Exchange</th><th>Activo</th><th>Cantidad</th><th>External ID</th><th>Tipo</th><th>Estado</th>
        </tr></thead><tbody>
        ${withdrawalsNoStmt.map((r: any) => `<tr>
          <td>${fmtDate(r.executed_at)}</td>
          <td>Kraken</td>
          <td>${r.asset ?? "—"}</td>
          <td>${fmtQty(parseFloat(String(r.amount ?? "0")))}</td>
          <td style="font-size:.72rem;color:#888">${r.external_id ?? "—"}</td>
          <td>${badge("b-warn", "retirada sin statement item")}</td>
          <td>${badge("b-info", "Aviso no bloqueante")}</td>
        </tr>`).join("")}
        </tbody></table>
      </div>
    </details>`;
  }

  // Block 2 — Statement items from fisco_external_statement_items
  if (stmtItems && stmtItems.length > 0) {
    const byClass = stmtItems.reduce((m: Record<string, any[]>, r) => {
      const k = r.classification ?? "unknown"; m[k] = m[k] ?? []; m[k].push(r); return m;
    }, {});

    const classLabels: Record<string, string> = {
      internal_transfer:               "Transferencias internas conciliadas",
      conservative_external_disposal:  "Disposiciones conservadoras (sin statement)",
      pending:                         "Pendientes de conciliación",
    };

    html += Object.entries(byClass).map(([cls, rows]) => {
      const label  = classLabels[cls] ?? cls;
      const isWarn = cls === "conservative_external_disposal" || cls === "pending";

      return `
      <details>
        <summary>${isWarn ? "⚠ " : "✓ "}${label} (${rows.length})</summary>
        <div class="details-body">
          ${isWarn ? `<div class="warnings-box">Existen retiradas sin statement item enlazado. El sistema las muestra como aviso no bloqueante. Revisar si corresponden a transferencias internas o movimientos propios.</div>` : ""}
          <table><thead><tr>
            <th>Fecha</th><th>Exchange</th><th>Activo</th><th>Cantidad</th><th>Fee</th><th>Total</th><th>Clasificación</th><th>External ID</th>
          </tr></thead><tbody>
          ${rows.map((r: any) => `<tr>
            <td>${fmtDate(r.executed_at)}</td><td>${r.exchange ?? "—"}</td><td>${r.asset ?? "—"}</td>
            <td>${fmtQty(parseFloat(r.amount ?? "0"))}</td><td>${eur(parseFloat(r.fee_eur ?? "0"))}</td>
            <td>${eur(parseFloat(r.total_eur ?? "0"))}</td>
            <td>${badge(isWarn ? "b-warn" : "b-ok", label)}</td>
            <td style="font-size:.72rem;color:#888">${r.external_id ?? "—"}</td>
          </tr>`).join("")}
          </tbody></table>
        </div>
      </details>`;
    }).join("\n");
  }

  return html;
}

// ─── Resumen ejecutivo humano ─────────────────────────────────────────────────

function buildResumenEjecutivo(year: number, fin: any, krakenWarnings: string[]): string {
  const total     = fin.final_taxable_gain_loss_eur ?? 0;
  const totalStr  = eur(Math.abs(total));
  const sign      = total >= 0 ? "de ganancias netas" : "de pérdidas netas";
  const finaliz   = fin.report_can_be_finalized;
  const hasWarns  = krakenWarnings.length > 0;

  let texto = `En el ejercicio ${year} el resultado fiscal final por transmisiones de criptoactivos es de `;
  texto += `<strong class="${gainClass(total)}">${total < 0 ? "-" : ""}${totalStr}</strong> ${sign}. `;

  if (fin.fifo_status === "OK") {
    texto += `El método FIFO no presenta errores críticos. `;
  } else {
    texto += `<span class="err">Se detectaron errores en el cálculo FIFO. Revisar los bloqueantes antes de declarar.</span> `;
  }

  if (fin.portfolio_status === "OK") {
    texto += `La cartera FIFO histórica cuadra correctamente teniendo en cuenta lotes de años anteriores. `;
  }

  if (hasWarns) {
    texto += `Existen ${krakenWarnings.length} aviso(s) no bloqueante(s): `;
    texto += krakenWarnings.slice(0, 2).map(w => `<em>${w}</em>`).join("; ");
    if (krakenWarnings.length > 2) texto += ` y ${krakenWarnings.length - 2} más`;
    texto += ". ";
  } else {
    texto += `No existen avisos de conciliación Kraken. `;
  }

  if (finaliz) {
    texto += `El informe está listo para ser presentado${hasWarns ? " (con los avisos indicados)" : ""}.`;
  } else {
    texto += `<strong class="err">El informe NO está listo para ser presentado. Revisar los bloqueantes.</strong>`;
  }

  return texto;
}

// ─── Types for DB data ────────────────────────────────────────────────────────

export interface AssetSummary {
  asset:            string;
  exchanges:        string;
  acquisitions_qty: number;
  disposals_qty:    number;
  opening_qty:      number;
  closing_qty:      number;
  proceeds_eur:     number;
  cost_basis_eur:   number;
  fees_eur:         number;
  gain_loss_eur:    number;
  operations_count: number;
  disposals_count:  number;
}

export interface ExchangeSummary {
  exchange:               string;
  operations_count:       number;
  buys_count:             number;
  sells_count:            number;
  deposits_count:         number;
  withdrawals_count:      number;
  staking_count:          number;
  fees_eur:               number;
  gain_loss_eur:          number;
  reconciliation_status:  string;
  diagnostic_only?:       boolean;
  warnings:               string[];
}

// ─── DB queries ───────────────────────────────────────────────────────────────

export class FiscoHtmlRenderer {
  constructor(private readonly pool: Pool) {}

  private async fetchAssetSummaries(year: number, exchanges: string[]): Promise<AssetSummary[]> {
    const exFilter = exchanges.length > 0 && !exchanges.includes("all")
      ? `AND fo.exchange = ANY($2)`
      : "";
    const params: (number | string[])[] = exchanges.length > 0 && !exchanges.includes("all")
      ? [year, exchanges]
      : [year];

    const q = await this.pool.query(`
      SELECT
        fo.asset,
        STRING_AGG(DISTINCT fo.exchange, ', ' ORDER BY fo.exchange) AS exchanges,
        COALESCE(SUM(CASE WHEN fo.op_type IN ('trade_buy','deposit','staking','reward','distribution') THEN fo.amount::numeric ELSE 0 END), 0) AS acquisitions_qty,
        COALESCE(SUM(CASE WHEN fo.op_type IN ('trade_sell','withdrawal','conservative_external_disposal') THEN fo.amount::numeric ELSE 0 END), 0) AS disposals_qty,
        COALESCE(SUM(fo.fee_eur::numeric), 0) AS fees_eur,
        COUNT(*) AS operations_count
      FROM fisco_operations fo
      WHERE EXTRACT(YEAR FROM fo.executed_at) = $1
        ${exFilter}
        AND fo.asset NOT IN ('EUR','USD','USDT')
      GROUP BY fo.asset
      ORDER BY fo.asset
    `, params);

    // Opening/closing qty from lots
    const lotsQ = await this.pool.query(`
      SELECT
        fl.asset,
        COALESCE(SUM(CASE WHEN fo.executed_at < DATE_TRUNC('year', NOW() - INTERVAL '${2026 - year} year') THEN fl.quantity::numeric ELSE 0 END), 0) AS opening_qty,
        COALESCE(SUM(fl.quantity::numeric), 0) AS closing_qty
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      WHERE fl.asset NOT IN ('EUR','USD','USDT')
      GROUP BY fl.asset
    `);
    const lotsMap: Record<string, { opening_qty: number; closing_qty: number }> = {};
    for (const r of lotsQ.rows) lotsMap[r.asset] = { opening_qty: parseFloat(r.opening_qty), closing_qty: parseFloat(r.closing_qty) };

    // Disposals gain/loss — fisco_disposals has no asset column; JOIN via sell_operation_id
    const dispQ = await this.pool.query(`
      SELECT
        sell_op.asset,
        COALESCE(SUM(fd.proceeds_eur::numeric), 0)    AS proceeds_eur,
        COALESCE(SUM(fd.cost_basis_eur::numeric), 0)  AS cost_basis_eur,
        COALESCE(SUM(fd.gain_loss_eur::numeric), 0)   AS gain_loss_eur,
        COUNT(*) AS disposals_count
      FROM fisco_disposals fd
      JOIN fisco_operations sell_op ON sell_op.id = fd.sell_operation_id
      WHERE EXTRACT(YEAR FROM fd.disposed_at) = $1
      GROUP BY sell_op.asset
    `, [year]);
    const dispMap: Record<string, any> = {};
    for (const r of dispQ.rows) dispMap[r.asset] = r;

    return q.rows.map(r => ({
      asset:            r.asset,
      exchanges:        r.exchanges,
      acquisitions_qty: parseFloat(r.acquisitions_qty),
      disposals_qty:    parseFloat(r.disposals_qty),
      opening_qty:      lotsMap[r.asset]?.opening_qty ?? 0,
      closing_qty:      lotsMap[r.asset]?.closing_qty ?? 0,
      proceeds_eur:     parseFloat(dispMap[r.asset]?.proceeds_eur ?? "0"),
      cost_basis_eur:   parseFloat(dispMap[r.asset]?.cost_basis_eur ?? "0"),
      fees_eur:         parseFloat(r.fees_eur),
      gain_loss_eur:    parseFloat(dispMap[r.asset]?.gain_loss_eur ?? "0"),
      operations_count: parseInt(r.operations_count),
      disposals_count:  parseInt(dispMap[r.asset]?.disposals_count ?? "0"),
    }));
  }

  private async fetchDisposalsByAsset(year: number): Promise<Record<string, any[]>> {
    // fisco_disposals has no asset/exchange/fee_eur columns — obtain via JOIN.
    // fee_eur is derived per-lot using Opción B1:
    //   GREATEST(0, proceeds_eur - cost_basis_eur - gain_loss_eur)
    // This avoids repeating the total sell_op fee across every FIFO lot row.
    const q = await this.pool.query(`
      SELECT
        sell_op.asset,
        sell_op.exchange,
        fd.disposed_at,
        fd.quantity,
        fd.proceeds_eur,
        fd.cost_basis_eur,
        GREATEST(
          0,
          fd.proceeds_eur::numeric
          - fd.cost_basis_eur::numeric
          - fd.gain_loss_eur::numeric
        )                          AS fee_eur,
        fd.gain_loss_eur,
        fd.lot_id,
        fd.sell_operation_id
      FROM fisco_disposals fd
      JOIN fisco_operations sell_op ON sell_op.id = fd.sell_operation_id
      WHERE EXTRACT(YEAR FROM fd.disposed_at) = $1
      ORDER BY sell_op.asset, fd.disposed_at, fd.sell_operation_id, fd.id
    `, [year]);
    const m: Record<string, any[]> = {};
    for (const r of q.rows) { m[r.asset] = m[r.asset] ?? []; m[r.asset].push(r); }
    return m;
  }

  private async fetchOperationsByAsset(year: number, exchanges: string[]): Promise<Record<string, any[]>> {
    const exFilter = exchanges.length > 0 && !exchanges.includes("all")
      ? `AND fo.exchange = ANY($2)`
      : "";
    const params: (number | string[])[] = exchanges.length > 0 && !exchanges.includes("all")
      ? [year, exchanges]
      : [year];

    const q = await this.pool.query(`
      SELECT fo.asset, fo.executed_at, fo.exchange, fo.op_type, fo.amount,
             fo.price_eur, fo.total_eur, fo.fee_eur, fo.external_id
      FROM fisco_operations fo
      WHERE EXTRACT(YEAR FROM fo.executed_at) = $1
        ${exFilter}
      ORDER BY fo.asset, fo.executed_at
    `, params);
    const m: Record<string, any[]> = {};
    for (const r of q.rows) { m[r.asset] = m[r.asset] ?? []; m[r.asset].push(r); }
    return m;
  }

  private async fetchExchangeSummaries(year: number, exchanges: string[], krakenRec: any): Promise<ExchangeSummary[]> {
    const exFilter = exchanges.length > 0 && !exchanges.includes("all")
      ? `AND fo.exchange = ANY($2)`
      : "";
    const params: (number | string[])[] = exchanges.length > 0 && !exchanges.includes("all")
      ? [year, exchanges]
      : [year];

    const q = await this.pool.query(`
      SELECT
        fo.exchange,
        COUNT(*) AS operations_count,
        COUNT(*) FILTER (WHERE fo.op_type IN ('trade_buy')) AS buys_count,
        COUNT(*) FILTER (WHERE fo.op_type IN ('trade_sell')) AS sells_count,
        COUNT(*) FILTER (WHERE fo.op_type = 'deposit') AS deposits_count,
        COUNT(*) FILTER (WHERE fo.op_type = 'withdrawal') AS withdrawals_count,
        COUNT(*) FILTER (WHERE fo.op_type IN ('staking','reward','distribution')) AS staking_count,
        COALESCE(SUM(fo.fee_eur::numeric), 0) AS fees_eur
      FROM fisco_operations fo
      WHERE EXTRACT(YEAR FROM fo.executed_at) = $1
        ${exFilter}
      GROUP BY fo.exchange
      ORDER BY fo.exchange
    `, params);

    // gain_loss per exchange from disposals — no exchange col in fisco_disposals, JOIN needed
    const dispQ = await this.pool.query(`
      SELECT sell_op.exchange, COALESCE(SUM(fd.gain_loss_eur::numeric), 0) AS gain_loss_eur
      FROM fisco_disposals fd
      JOIN fisco_operations sell_op ON sell_op.id = fd.sell_operation_id
      WHERE EXTRACT(YEAR FROM fd.disposed_at) = $1
      GROUP BY sell_op.exchange
    `, [year]);
    const dispGain: Record<string, number> = {};
    for (const r of dispQ.rows) dispGain[r.exchange] = parseFloat(r.gain_loss_eur);

    const recStatus = krakenRec?.status ?? "OK";
    const recStatusMapped =
      recStatus === "DIFFERENCES"    ? "DIFFERENCES"    :
      recStatus === "WARNINGS"       ? "OK_WITH_WARNINGS" :
                                       "OK";

    return q.rows.map(r => ({
      exchange:              r.exchange,
      operations_count:      parseInt(r.operations_count),
      buys_count:            parseInt(r.buys_count),
      sells_count:           parseInt(r.sells_count),
      deposits_count:        parseInt(r.deposits_count),
      withdrawals_count:     parseInt(r.withdrawals_count),
      staking_count:         parseInt(r.staking_count),
      fees_eur:              parseFloat(r.fees_eur),
      gain_loss_eur:         dispGain[r.exchange] ?? 0,
      reconciliation_status: r.exchange === "kraken" ? recStatusMapped : "OK",
      diagnostic_only:       false,
      warnings:              r.exchange === "kraken" ? (krakenRec?.warnings ?? []) : [],
    }));
  }

  private async fetchStaking(year: number): Promise<any[]> {
    const q = await this.pool.query(`
      SELECT fo.executed_at, fo.exchange, fo.op_type, fo.asset, fo.amount, fo.total_eur
      FROM fisco_operations fo
      WHERE EXTRACT(YEAR FROM fo.executed_at) = $1
        AND fo.op_type IN ('staking','reward','distribution')
      ORDER BY fo.asset, fo.executed_at
    `, [year]);
    return q.rows;
  }

  private async fetchStatementItems(year: number): Promise<any[]> {
    // Real columns: event_at, asset, exchange, amount_sent, fee_amount, total_out, classification, transaction_identifier
    const q = await this.pool.query(`
      SELECT
        fsi.event_at        AS executed_at,
        fsi.exchange,
        fsi.asset,
        fsi.amount_sent     AS amount,
        COALESCE(fsi.fee_amount, 0)   AS fee_eur,
        COALESCE(fsi.total_out, fsi.amount_sent, 0) AS total_eur,
        fsi.classification,
        fsi.transaction_identifier    AS external_id
      FROM fisco_external_statement_items fsi
      WHERE fsi.year = $1
      ORDER BY fsi.event_at
    `, [year]);
    return q.rows;
  }

  private async fetchFinCounts(year: number): Promise<{ operations_count: number; disposals_count: number; open_lots_count: number }> {
    const [ops, disp, lots] = await Promise.all([
      this.pool.query(`SELECT COUNT(*) AS c FROM fisco_operations WHERE EXTRACT(YEAR FROM executed_at) = $1`, [year]),
      this.pool.query(`SELECT COUNT(*) AS c FROM fisco_disposals WHERE EXTRACT(YEAR FROM disposed_at) = $1`, [year]),
      this.pool.query(`SELECT COUNT(*) AS c FROM fisco_lots WHERE remaining_qty::numeric > 0.000001`),
    ]);
    return {
      operations_count: parseInt(ops.rows[0]?.c ?? "0"),
      disposals_count:  parseInt(disp.rows[0]?.c ?? "0"),
      open_lots_count:  parseInt(lots.rows[0]?.c ?? "0"),
    };
  }

  /**
   * Fetches per-sell-operation counter_asset data for the gain/loss summary.
   * Grouped by (asset, sell_operation_id, counter_asset, pair, op_type).
   * net_proceeds_eur = SUM(proceeds_eur) - GREATEST(0, SUM(fee_eur)) per Bit2Me convention.
   */
  private async fetchDisposalCounterAssets(year: number): Promise<DisposalCounterAssetRow[]> {
    const q = await this.pool.query(`
      SELECT
        sell_op.asset                                               AS asset,
        fd.sell_operation_id,
        sell_op.counter_asset,
        sell_op.pair,
        sell_op.op_type,
        COALESCE(SUM(fd.proceeds_eur::numeric), 0)
          - GREATEST(0, COALESCE(SUM(
              GREATEST(0, fd.proceeds_eur::numeric - fd.cost_basis_eur::numeric - fd.gain_loss_eur::numeric)
            ), 0))                                                  AS net_proceeds_eur,
        COALESCE(SUM(fd.cost_basis_eur::numeric), 0)               AS cost_basis_eur,
        COALESCE(SUM(fd.gain_loss_eur::numeric), 0)                AS gain_loss_eur,
        (sell_op.op_type IN ('fee','expense','fee_disposal','balancing',
                             'rounding','other','adjustment',
                             'conservative_external_disposal'))     AS is_fee_disposal
      FROM fisco_disposals fd
      JOIN fisco_operations sell_op ON sell_op.id = fd.sell_operation_id
      WHERE EXTRACT(YEAR FROM fd.disposed_at) = $1
      GROUP BY sell_op.asset, fd.sell_operation_id,
               sell_op.counter_asset, sell_op.pair,
               sell_op.op_type
      ORDER BY sell_op.asset
    `, [year]);

    return q.rows.map((r: any) => ({
      asset:             r.asset,
      sell_operation_id: parseInt(r.sell_operation_id),
      counter_asset:     r.counter_asset ?? null,
      pair:              r.pair ?? null,
      op_type:           r.op_type ?? null,
      net_proceeds_eur:  parseFloat(r.net_proceeds_eur),
      cost_basis_eur:    parseFloat(r.cost_basis_eur),
      gain_loss_eur:     parseFloat(r.gain_loss_eur),
      is_fee_disposal:   r.is_fee_disposal ?? false,
    }));
  }

  // ─── Main render: annual HTML report ──────────────────────────────────────

  async renderAnnualHtml(opts: {
    year: number;
    exchanges: string[];
    finStatus: any;   // FinalizationStatus + gains_eur + losses_eur (enriched by route)
    portfolio: any;
    krakenRec: any;
  }): Promise<string> {
    const { year, exchanges, finStatus, portfolio, krakenRec } = opts;

    // Each data block is independently fault-tolerant so a single table error
    // never breaks the full report.
    const safeLoad = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<{ data: T; error: string | null }> => {
      try { return { data: await fn(), error: null }; }
      catch (e: any) {
        console.error(`[FiscoHtmlRenderer:${label}] ${e.message}`);
        return { data: fallback, error: e.message ?? String(e) };
      }
    };

    const [rAssets, rDisposals, rOps, rExchanges, rStaking, rStmt, rCounts, rCounterAssets] = await Promise.all([
      safeLoad("fetchAssetSummaries",       () => this.fetchAssetSummaries(year, exchanges),            [] as AssetSummary[]),
      safeLoad("fetchDisposalsByAsset",     () => this.fetchDisposalsByAsset(year),                    {} as Record<string, any[]>),
      safeLoad("fetchOperationsByAsset",    () => this.fetchOperationsByAsset(year, exchanges),         {} as Record<string, any[]>),
      safeLoad("fetchExchangeSummaries",    () => this.fetchExchangeSummaries(year, exchanges, krakenRec), [] as ExchangeSummary[]),
      safeLoad("fetchStaking",              () => this.fetchStaking(year),                             [] as any[]),
      safeLoad("fetchStatementItems",       () => this.fetchStatementItems(year),                      [] as any[]),
      safeLoad("fetchFinCounts",            () => this.fetchFinCounts(year),
        { operations_count: 0, disposals_count: 0, open_lots_count: 0 }),
      safeLoad("fetchDisposalCounterAssets",() => this.fetchDisposalCounterAssets(year),               [] as DisposalCounterAssetRow[]),
    ]);

    const assetSummaries   = rAssets.data;
    const disposalsByAsset = rDisposals.data;
    const operationsByAsset= rOps.data;
    const exchangeSummaries= rExchanges.data;
    const stakingRows      = rStaking.data;
    const stmtItems        = rStmt.data;
    const counts           = rCounts.data;
    const counterAssetRows = rCounterAssets.data;

    // Build gain/loss summary grouped by (asset, F/N/O) from real counter_asset data
    const gainLossSummary = buildAnnualGainLossByAssetSummary(year, counterAssetRows);

    // Collect any partial errors to surface in HTML
    const partialErrors: string[] = [
      rAssets.error    && `Activos: ${rAssets.error}`,
      rDisposals.error && `Disposals: ${rDisposals.error}`,
      rOps.error       && `Operaciones: ${rOps.error}`,
      rExchanges.error && `Exchanges: ${rExchanges.error}`,
      rStaking.error   && `Staking: ${rStaking.error}`,
      rStmt.error      && `Statement items: ${rStmt.error}`,
      rCounts.error    && `Counts: ${rCounts.error}`,
    ].filter(Boolean) as string[];

    // Enrich finStatus with counts
    const finEnriched = { ...finStatus, ...counts };

    const krakenWarnings: string[] = krakenRec?.warnings ?? [];
    const totalGain  = finStatus.final_taxable_gain_loss_eur ?? 0;
    const isOk       = finStatus.report_can_be_finalized;
    const hasWarns   = krakenWarnings.length > 0;

    const exchangeList = exchanges.includes("all") ? "Todos los exchanges" : exchanges.join(", ");
    const portadaEstado = isOk && !hasWarns ? badge("b-ok", "✓ Finalizable") :
                          isOk && hasWarns  ? badge("b-warn", "⚠ Finalizable con avisos") :
                                              badge("b-err", "✗ No finalizable");

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Informe fiscal ${year} — FISCO</title>
  ${HTML_STYLE}
</head>
<body>

<div class="toolbar no-print">
  <strong style="margin-right:.5rem">Informe fiscal ${year}</strong>
  <button class="btn" onclick="expandAll()">▶ Expandir todo</button>
  <button class="btn" onclick="collapseAll()">◀ Contraer todo</button>
  <button class="btn btn-primary" onclick="preparePdf()">🖨 Preparar PDF completo</button>
  <button class="btn" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
</div>

<div class="portada">
  <h1>📊 Informe Fiscal ${year}</h1>
  <div class="grid3">
    <div class="card"><label>Año fiscal</label><span class="val">${year}</span></div>
    <div class="card"><label>Exchanges</label><span class="val" style="font-size:.85rem">${exchangeList}</span></div>
    <div class="card"><label>Fecha de generación</label><span class="val" style="font-size:.82rem">${new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>
    <div class="card"><label>Estado del informe</label><span class="val">${portadaEstado}</span></div>
    <div class="card"><label>Resultado fiscal final</label><span class="val ${gainClass(totalGain)}">${eur(totalGain)}</span></div>
    <div class="card"><label>Número de operaciones</label><span class="val">${counts.operations_count}</span></div>
  </div>
  <p style="font-size:.82rem;color:#555;margin-top:.75rem">
    ⚠ Este informe usa FIFO fiscal global multi-exchange. Cada año fiscal se declara por separado.
    El resultado mostrado corresponde únicamente al ejercicio ${year}.
  </p>
</div>

${renderAnnualGainLossSummarySection(gainLossSummary)}

${partialErrors.length > 0 ? `
<div class="warnings-box" style="margin:1rem 0">
  <strong>⚠ Advertencia: algunas secciones no pudieron cargarse correctamente</strong>
  <ul>${partialErrors.map(e => `<li class="err">${e}</li>`).join("")}</ul>
  <p style="font-size:.8rem;margin:.4rem 0 0">El informe fiscal base (resumen, validación) sigue siendo correcto. Solo el detalle auxiliar puede estar incompleto.</p>
</div>` : ""}

<h2>Resumen ejecutivo</h2>
<div class="resumen-ejecutivo">
  <p>${buildResumenEjecutivo(year, finStatus, krakenWarnings)}</p>
</div>

<h2>Tabla resumen fiscal</h2>
${renderFiscalSummaryTable(finEnriched)}

<h2>Estado de validación</h2>
${renderValidationState(finStatus, portfolio)}

<h2>Detalle por activo</h2>
${renderAssetSection(assetSummaries, disposalsByAsset, operationsByAsset)}

<h2>Detalle por exchange</h2>
<div class="section-block">
${renderExchangeSection(exchangeSummaries)}
</div>

<h2>Ventas y cálculo FIFO</h2>
<div class="section-block">
<p style="font-size:.85rem;color:#555;margin:.5rem 0">
  Una venta puede aparecer dividida en varias líneas porque el método FIFO consume varios lotes de compra distintos.
  La columna <strong>«Valor de adquisición FIFO»</strong> es el coste fiscal de las unidades vendidas.
  La columna <strong>«Comisión imputada»</strong> muestra la comisión atribuida a esa línea (evitando repetir la comisión total en todos los lotes).
  El resumen de cada venta agrupa todos sus lotes y muestra la comisión total una sola vez.
</p>
${assetSummaries.filter(a => (disposalsByAsset[a.asset] ?? []).length > 0).map(a => {
  const disposals = disposalsByAsset[a.asset] ?? [];
  const totalG = disposals.reduce((s: number, d: any) => s + parseFloat(d.gain_loss_eur ?? "0"), 0);

  // Agrupar por sell_operation_id para mostrar cada venta consolidada con sus lotes
  const byOp = new Map<string, any[]>();
  for (const d of disposals) {
    const k = String(d.sell_operation_id ?? "?");
    if (!byOp.has(k)) byOp.set(k, []);
    byOp.get(k)!.push(d);
  }

  const opRows = [...byOp.entries()].slice(0, 200).map(([opId, rows]) => {
    const first      = rows[0];
    const totalQty   = rows.reduce((s: number, r: any) => s + parseFloat(r.quantity ?? "0"), 0);
    const totalProc  = rows.reduce((s: number, r: any) => s + parseFloat(r.proceeds_eur ?? "0"), 0);
    const totalCost  = rows.reduce((s: number, r: any) => s + parseFloat(r.cost_basis_eur ?? "0"), 0);
    const totalFee   = rows.reduce((s: number, r: any) => s + parseFloat(r.fee_eur ?? "0"), 0);
    const totalGain  = rows.reduce((s: number, r: any) => s + parseFloat(r.gain_loss_eur ?? "0"), 0);
    const multiLot   = rows.length > 1;

    const lotRows = multiLot ? rows.map((r: any) => `<tr style="font-size:.8rem;color:#555">
      <td style="padding-left:1.5rem">↳ Lote ${r.lot_id ?? "—"}</td>
      <td>${fmtQty(parseFloat(r.quantity ?? "0"))}</td>
      <td>${eur(parseFloat(r.proceeds_eur ?? "0"))}</td>
      <td>${eur(parseFloat(r.cost_basis_eur ?? "0"))}</td>
      <td>—</td>
      <td class="${gainClass(parseFloat(r.gain_loss_eur ?? "0"))}">${eur(parseFloat(r.gain_loss_eur ?? "0"))}</td>
    </tr>`).join("") : "";

    return `<tr>
      <td>${fmtDate(first.disposed_at)}</td>
      <td>${first.exchange ?? "—"}</td>
      <td>${fmtQty(totalQty)}${multiLot ? ` <span style="font-size:.7rem;color:#888">(${rows.length} lotes)</span>` : ""}</td>
      <td>${eur(totalProc)}</td>
      <td>${eur(totalCost)}</td>
      <td>${eur(totalFee)}</td>
      <td class="${gainClass(totalGain)}">${eur(totalGain)}</td>
    </tr>${lotRows}`;
  }).join("");

  return `
  <details>
    <summary>${a.asset} — ${byOp.size} venta(s) — ${disposals.length} lote(s) FIFO — Ganancia/Pérdida: <span class="${gainClass(totalG)}">${eur(totalG)}</span></summary>
    <div class="details-body">
      <table><thead><tr>
        <th>Fecha venta</th><th>Exchange</th><th>Cantidad</th>
        <th>Valor de venta / transmisión</th><th>Valor de adquisición FIFO</th><th>Comisión imputada</th><th>Ganancia/Pérdida fiscal</th>
      </tr></thead><tbody>
      ${opRows}
      ${byOp.size > 200 ? `<tr><td colspan="7" style="color:#888">… y ${byOp.size - 200} ventas más (ver CSV para lista completa)</td></tr>` : ""}
      </tbody></table>
      <p style="font-size:.75rem;color:#888;margin:.4rem 0 0">Las filas ↳ muestran el detalle por lote FIFO. La comisión imputada se muestra en el resumen de venta, no repetida por lote.</p>
    </div>
  </details>`;
}).join("")}
</div>

<h2>Rendimientos / staking / rewards</h2>
<div class="section-block">
${renderStakingSection(stakingRows)}
</div>

<h2>Retiradas, depósitos y transferencias internas</h2>
<div class="section-block">
${renderWithdrawalsSection(stmtItems, krakenRec)}
</div>

<div class="annexe">
  <h3>Anexo técnico</h3>
  <ul>
    <li><strong>Método FIFO:</strong> First-In First-Out continuo, histórico multi-año.</li>
    <li><strong>Validation strength:</strong> ${translateStatus(portfolio?.validation_strength ?? "—")}</li>
    <li><strong>Código técnico FIFO:</strong> <code>${finStatus.fifo_status ?? "—"}</code></li>
    <li><strong>Código técnico portfolio:</strong> <code>${finStatus.portfolio_status ?? "—"}</code></li>
    <li><strong>Código técnico withdrawals:</strong> <code>${finStatus.withdrawals_status ?? "—"}</code></li>
    <li><strong>Conservative disposals:</strong> <code>${finStatus.conservative_disposals_status ?? "—"}</code></li>
    <li><strong>Fuentes de datos:</strong> Kraken + RevolutX (fisco_operations, fisco_lots, fisco_disposals).</li>
    <li><strong>Fecha de generación:</strong> ${new Date().toISOString()}</li>
    <li><strong>Nota fiscal:</strong> Cada año fiscal debe declararse por separado. Este informe es una herramienta de auditoría.</li>
  </ul>
</div>

${HTML_SCRIPTS}
</body>
</html>`;
  }
}
