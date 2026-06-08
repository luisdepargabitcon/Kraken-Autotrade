/**
 * MultiYearReportService
 *
 * Aggregates fiscal data for multiple years and exchanges.
 * Delegates to existing services — never modifies fisco_lots / fisco_disposals / fisco_operations.
 *
 * INVARIANTS:
 *   - Annual report endpoint unchanged
 *   - validatePortfolio uses fifo_internal_historical_inventory (opening+acq-disp)
 *   - Kraken WARNINGS are non-blocking
 *   - RevolutX 2025 OK_INTERNAL_TRANSFER preserved
 */

import type { Pool } from "pg";
import { FiscoValidationService } from "./FiscoValidationService";
import { KrakenReconciliationService } from "./KrakenReconciliationService";

export interface YearSummary {
  year: number;
  ordinary_fifo_gain_loss_eur: number;
  conservative_external_disposals_gain_loss_eur: number;
  final_taxable_gain_loss_eur: number;
  staking_total_eur: number;
  portfolio_status: "OK" | "DIFFERENCES";
  validation_strength: string;
  exchange_reconciliation_status: string;
  withdrawals_status: string;
  conservative_disposals_status: string;
  fifo_status: string;
  report_can_be_finalized: boolean;
  blockers_count: number;
  warnings_count: number;
  blockers: Array<{ code: string; severity: string; detail: string }>;
  warnings: Array<{ code: string; severity: string; detail: string }>;
  kraken_reconciliation_status: string;
  kraken_warnings: string[];
  kraken_report_can_be_finalized: boolean;
}

export interface MultiYearReport {
  generated_at: string;
  years: number[];
  exchanges: string[];
  include_global: boolean;
  include_exchange_breakdown: boolean;
  audit_note: string;
  global_summary: {
    totals_by_year: YearSummary[];
    accumulated_total_for_audit_only: number;
  };
  reports: Array<{
    year: number;
    scope: "global" | "exchange";
    exchange: string | null;
    finalization_status: any;
    portfolio_validation: any;
    kraken_reconciliation?: any;
  }>;
}

export class MultiYearReportService {
  constructor(private readonly pool: Pool) {}

  async generate(opts: {
    years: number[];
    exchanges: string[];
    includeGlobal: boolean;
    includeExchangeBreakdown: boolean;
  }): Promise<MultiYearReport> {
    const { years, exchanges, includeGlobal, includeExchangeBreakdown } = opts;
    const validationSvc = new FiscoValidationService(this.pool);
    const krakenSvc     = new KrakenReconciliationService(this.pool);

    const reports: MultiYearReport["reports"] = [];
    const totals_by_year: YearSummary[] = [];

    for (const year of years) {
      // ── Global per-year data ─────────────────────────────────────────────
      const [finStatus, portfolio, krakenRec, stakingQ] = await Promise.all([
        validationSvc.getFinalizationStatus(year),
        validationSvc.validatePortfolio(year, null),
        krakenSvc.reconcile(year),
        this.pool.query(`
          SELECT COALESCE(SUM(fo.total_eur::numeric), 0) AS total
          FROM fisco_operations fo
          WHERE fo.op_type IN ('staking','reward','distribution')
            AND EXTRACT(YEAR FROM fo.executed_at) = $1
        `, [year]),
      ]);

      const stakingTotal = parseFloat(stakingQ.rows[0]?.total ?? "0");

      // reconciliation summary: mirrors logic from fisco.routes.ts /reconciliation/summary
      const hasKrakenDiff     = krakenRec.status === "DIFFERENCES";
      const hasKrakenWarnings = krakenRec.status === "WARNINGS" || krakenRec.status === "DIFFERENCES";
      const globalRecStatus   =
        hasKrakenDiff     ? "DIFFERENCES"    :
        hasKrakenWarnings ? "OK_WITH_WARNINGS" :
                            "OK";

      const yearSummary: YearSummary = {
        year,
        ordinary_fifo_gain_loss_eur:                       finStatus.ordinary_fifo_gain_loss_eur,
        conservative_external_disposals_gain_loss_eur:     finStatus.conservative_external_disposals_gain_loss_eur,
        final_taxable_gain_loss_eur:                       finStatus.final_taxable_gain_loss_eur,
        staking_total_eur:                                 Math.round(stakingTotal * 100) / 100,
        portfolio_status:                                  finStatus.portfolio_status,
        validation_strength:                               portfolio.validation_strength,
        exchange_reconciliation_status:                    globalRecStatus,
        withdrawals_status:                                finStatus.withdrawals_status,
        conservative_disposals_status:                     finStatus.conservative_disposals_status,
        fifo_status:                                       finStatus.fifo_status,
        report_can_be_finalized:                           finStatus.report_can_be_finalized && !hasKrakenDiff,
        blockers_count:                                    finStatus.blockers.length,
        warnings_count:                                    finStatus.warnings.length + krakenRec.warnings.length,
        blockers:                                          finStatus.blockers,
        warnings:                                          finStatus.warnings,
        kraken_reconciliation_status:                      krakenRec.status,
        kraken_warnings:                                   krakenRec.warnings,
        kraken_report_can_be_finalized:                    krakenRec.report_can_be_finalized,
      };
      totals_by_year.push(yearSummary);

      if (includeGlobal) {
        reports.push({
          year,
          scope: "global",
          exchange: null,
          finalization_status:  finStatus,
          portfolio_validation: portfolio,
        });
      }

      if (includeExchangeBreakdown) {
        const EXCHANGE_PORTFOLIO_NOTE =
          "Diagnóstico por exchange. El FIFO fiscal oficial del bot es global multi-exchange. " +
          "Esta validación puede mostrar diferencias si existen transferencias internas, " +
          "withdrawals cross-exchange o movimientos cuyo lote de origen está en otro exchange. " +
          "No bloquea el informe fiscal global.";

        const krakenPortfolio = await validationSvc.validatePortfolio(year, "kraken");
        reports.push({
          year,
          scope:    "exchange",
          exchange: "kraken",
          finalization_status:   finStatus,
          portfolio_validation:  {
            ...krakenPortfolio,
            diagnostic_only:      true,
            affects_finalization: false,
            note: EXCHANGE_PORTFOLIO_NOTE,
          },
          kraken_reconciliation: krakenRec,
        });

        if (exchanges.includes("revolutx") || exchanges.includes("all")) {
          const revPortfolio = await validationSvc.validatePortfolio(year, "revolutx");
          reports.push({
            year,
            scope:    "exchange",
            exchange: "revolutx",
            finalization_status:  finStatus,
            portfolio_validation: {
              ...revPortfolio,
              diagnostic_only:      true,
              affects_finalization: false,
              note: EXCHANGE_PORTFOLIO_NOTE,
            },
          });
        }
      }
    }

    const accumulated = totals_by_year.reduce(
      (acc, y) => acc + y.final_taxable_gain_loss_eur, 0,
    );

    return {
      generated_at: new Date().toISOString(),
      years,
      exchanges,
      include_global: includeGlobal,
      include_exchange_breakdown: includeExchangeBreakdown,
      audit_note:
        "Cada año fiscal se declara por separado. " +
        "Este informe multi-año es una herramienta de auditoría global y NO constituye una declaración fiscal conjunta.",
      global_summary: {
        totals_by_year,
        accumulated_total_for_audit_only: Math.round(accumulated * 100) / 100,
      },
      reports,
    };
  }

  /** Render multi-year report as HTML string */
  renderHtml(report: MultiYearReport): string {
    const statusBadge = (ok: boolean, warn?: boolean) =>
      ok   ? `<span class="badge ok">✓ Finalizable</span>`
      : warn ? `<span class="badge warn">⚠ Con warnings</span>`
             : `<span class="badge err">✗ No finalizable</span>`;

    const recBadge = (s: string) =>
      s === "OK"               ? `<span class="badge ok">OK</span>` :
      s === "OK_WITH_WARNINGS" ? `<span class="badge warn">OK_WITH_WARNINGS</span>` :
      s === "WARNINGS"         ? `<span class="badge warn">WARNINGS</span>` :
                                 `<span class="badge err">DIFFERENCES</span>`;

    const rows = report.global_summary.totals_by_year.map(y => `
      <tr>
        <td>${y.year}</td>
        <td class="${y.fifo_status === "OK" ? "ok" : "err"}">${y.fifo_status}</td>
        <td>${y.ordinary_fifo_gain_loss_eur.toFixed(2)} €</td>
        <td>${y.conservative_external_disposals_gain_loss_eur.toFixed(2)} €</td>
        <td><strong>${y.final_taxable_gain_loss_eur.toFixed(2)} €</strong></td>
        <td>${y.staking_total_eur.toFixed(2)} €</td>
        <td class="${y.portfolio_status === "OK" ? "ok" : "err"}">${y.portfolio_status}</td>
        <td><small>${y.validation_strength}</small></td>
        <td>${recBadge(y.exchange_reconciliation_status)}</td>
        <td class="${y.withdrawals_status === "OK" ? "ok" : y.withdrawals_status === "PENDING" ? "err" : "warn"}">${y.withdrawals_status}</td>
        <td>${statusBadge(y.report_can_be_finalized, y.warnings_count > 0 && y.report_can_be_finalized)}</td>
      </tr>
    `).join("");

    const yearSections = report.global_summary.totals_by_year.map(y => {
      const blockersHtml = y.blockers.length > 0
        ? `<div class="blockers"><strong>Blockers:</strong><ul>${y.blockers.map(b => `<li class="err">[${b.code}] ${b.detail}</li>`).join("")}</ul></div>`
        : `<div class="ok-msg">Sin blockers ✓</div>`;
      const warnsHtml = y.kraken_warnings.length > 0
        ? `<div class="warnings"><strong>Kraken warnings:</strong><ul>${y.kraken_warnings.map(w => `<li class="warn">⚠ ${w}</li>`).join("")}</ul></div>`
        : `<div class="ok-msg">Sin warnings ✓</div>`;

      return `
        <section class="year-section">
          <h2>Año ${y.year}</h2>
          <div class="grid2">
            <div class="card"><label>FIFO status</label><span class="${y.fifo_status === "OK" ? "ok" : "err"}">${y.fifo_status}</span></div>
            <div class="card"><label>Portfolio</label><span class="${y.portfolio_status === "OK" ? "ok" : "err"}">${y.portfolio_status}</span></div>
            <div class="card"><label>Validación</label><span>${y.validation_strength}</span></div>
            <div class="card"><label>Conciliación</label>${recBadge(y.exchange_reconciliation_status)}</div>
            <div class="card"><label>Withdrawals</label><span>${y.withdrawals_status}</span></div>
            <div class="card"><label>Conservative disposals</label><span>${y.conservative_disposals_status}</span></div>
          </div>
          <table>
            <tr><td>FIFO ordinario</td><td>${y.ordinary_fifo_gain_loss_eur.toFixed(2)} €</td></tr>
            <tr><td>Disposiciones conservadoras</td><td>${y.conservative_external_disposals_gain_loss_eur.toFixed(2)} €</td></tr>
            <tr><th>Total fiscal final</th><th>${y.final_taxable_gain_loss_eur.toFixed(2)} €</th></tr>
            <tr><td>Staking/rewards</td><td>${y.staking_total_eur.toFixed(2)} €</td></tr>
          </table>
          ${blockersHtml}
          ${warnsHtml}
          <div class="finalize">${statusBadge(y.report_can_be_finalized)}</div>
        </section>`;
    }).join("\n");

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Informe fiscal multi-año — ${report.years.join(", ")}</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
    h1{color:#1a1a2e;border-bottom:2px solid #1a1a2e;padding-bottom:.5rem}
    h2{color:#16213e;margin-top:2rem;border-left:4px solid #0f3460;padding-left:.75rem}
    table{border-collapse:collapse;width:100%;margin:1rem 0}
    th,td{padding:.5rem .75rem;border:1px solid #ddd;text-align:left;font-size:.85rem}
    th{background:#f5f5f5}
    .badge{display:inline-block;padding:.2rem .5rem;border-radius:4px;font-size:.75rem;font-weight:600}
    .badge.ok{background:#d4edda;color:#155724}
    .badge.warn{background:#fff3cd;color:#856404}
    .badge.err{background:#f8d7da;color:#721c24}
    .ok{color:#155724;font-weight:600} .err{color:#721c24;font-weight:600} .warn{color:#856404;font-weight:600}
    .ok-msg{color:#155724;margin:.5rem 0} .grid2{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1rem 0}
    .card{background:#f9f9f9;border:1px solid #e0e0e0;border-radius:6px;padding:.75rem}
    .card label{display:block;font-size:.7rem;text-transform:uppercase;color:#666;margin-bottom:.25rem}
    .blockers,.warnings{background:#fff8f8;border:1px solid #f5c6cb;border-radius:6px;padding:.75rem;margin:.5rem 0}
    .warnings{background:#fffbf0;border-color:#ffc107}
    .warnings li{color:#856404} .blockers li{color:#721c24}
    .finalize{margin-top:1rem} .year-section{border:1px solid #e0e0e0;border-radius:8px;padding:1.5rem;margin:1.5rem 0}
    .portada{background:#f0f4ff;border-radius:8px;padding:2rem;margin-bottom:2rem}
    .annexe{background:#f9f9f9;border:1px solid #ddd;border-radius:8px;padding:1.5rem;margin-top:2rem;font-size:.85rem}
  </style>
</head>
<body>

<div class="portada">
  <h1>📊 Informe fiscal multi-año / auditoría FISCO</h1>
  <p><strong>Años incluidos:</strong> ${report.years.join(", ")}</p>
  <p><strong>Exchanges:</strong> ${report.exchanges.join(", ")}</p>
  <p><strong>Fecha de generación:</strong> ${new Date(report.generated_at).toLocaleString("es-ES")}</p>
  <p class="warn">⚠ ${report.audit_note}</p>
</div>

<h2>Resumen consolidado por año</h2>
<table>
  <thead>
    <tr>
      <th>Año</th><th>FIFO</th><th>FIFO ordinario</th><th>Conservadoras</th>
      <th>Total fiscal</th><th>Staking</th><th>Cartera</th><th>Validation</th>
      <th>Conciliación</th><th>Withdrawals</th><th>Finalizable</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<p><strong>Total acumulado (solo auditoría, NO declaración conjunta):</strong>
   <strong>${report.global_summary.accumulated_total_for_audit_only.toFixed(2)} €</strong></p>

${yearSections}

<div class="annexe">
  <h3>Anexo técnico</h3>
  <ul>
    <li><strong>Método FIFO:</strong> First-In First-Out continuo, histórico multi-año.</li>
    <li><strong>Inventario FIFO histórico:</strong> opening_qty_at_year_start + acquisitions_qty_in_year - disposals_qty_in_year = expected_closing_qty.
        Una venta en enero de un activo comprado en diciembre del año anterior es válida y no bloquea.</li>
    <li><strong>Conservative external disposal:</strong> Retiros sin statement clasificados conservadoramente como venta al precio de mercado.</li>
    <li><strong>Fuentes de datos:</strong> Kraken (fisco_operations exchange=kraken) + RevolutX (exchange=revolutx).</li>
    <li><strong>Validation strength:</strong> fifo_internal_historical_inventory — sin snapshot externo de exchange.</li>
    <li><strong>Endpoints usados:</strong> /api/fisco/finalization-status, /api/fisco/validate/portfolio, /api/fisco/reconciliation/kraken.</li>
    <li><strong>Fecha de generación:</strong> ${new Date(report.generated_at).toISOString()}</li>
    <li><strong>Nota fiscal:</strong> Cada año fiscal debe declararse por separado. Este informe es una herramienta de auditoría.</li>
  </ul>
</div>

</body>
</html>`;
  }
}
