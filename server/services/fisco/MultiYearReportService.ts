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
import { translateStatus, HTML_STYLE, HTML_SCRIPTS } from "./FiscoHtmlRenderer";

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

  /** Render multi-year report as interactive HTML in Spanish */
  renderHtml(report: MultiYearReport): string {
    const eur = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
    const gainCls = (n: number) => n > 0.01 ? "gain-pos" : n < -0.01 ? "gain-neg" : "gain-zero";

    const badge = (cls: string, t: string) => `<span class="badge ${cls}">${t}</span>`;
    const statusBadge = (ok: boolean, warn?: boolean) =>
      ok && !warn ? badge("b-ok", "✓ Finalizable") :
      warn        ? badge("b-warn", "⚠ Finalizable con avisos") :
                    badge("b-err", "✗ No finalizable");
    const recBadge = (s: string) =>
      s === "OK"               ? badge("b-ok", "Correcto") :
      s === "OK_WITH_WARNINGS" ? badge("b-warn", "Correcto con avisos") :
      s === "WARNINGS"         ? badge("b-warn", "Avisos") :
                                 badge("b-err", "Diferencias");

    const rows = report.global_summary.totals_by_year.map(y => `
      <tr>
        <td><strong>${y.year}</strong></td>
        <td>${badge(y.fifo_status === "OK" ? "b-ok" : "b-err", translateStatus(y.fifo_status))}</td>
        <td class="${gainCls(y.ordinary_fifo_gain_loss_eur)}">${eur(y.ordinary_fifo_gain_loss_eur)}</td>
        <td>${eur(y.conservative_external_disposals_gain_loss_eur)}</td>
        <td><strong class="${gainCls(y.final_taxable_gain_loss_eur)}">${eur(y.final_taxable_gain_loss_eur)}</strong></td>
        <td>${eur(y.staking_total_eur)}</td>
        <td>${badge(y.portfolio_status === "OK" ? "b-ok" : "b-err", translateStatus(y.portfolio_status))}</td>
        <td style="font-size:.75rem">${translateStatus(y.validation_strength)}</td>
        <td>${recBadge(y.exchange_reconciliation_status)}</td>
        <td>${badge(y.withdrawals_status === "OK" ? "b-ok" : y.withdrawals_status === "PENDING" ? "b-err" : "b-warn", translateStatus(y.withdrawals_status))}</td>
        <td>${statusBadge(y.report_can_be_finalized, y.warnings_count > 0 && y.report_can_be_finalized)}</td>
      </tr>
    `).join("");

    const yearSections = report.global_summary.totals_by_year.map(y => {
      const blockersHtml = y.blockers.length > 0
        ? `<div class="blockers"><strong>Bloqueantes:</strong><ul>${y.blockers.map(b => `<li class="err">[${b.code}] ${b.detail}</li>`).join("")}</ul></div>`
        : `<p class="ok">Sin bloqueantes ✓</p>`;
      const warnsHtml = y.kraken_warnings.length > 0
        ? `<div class="warnings-box"><strong>Avisos Kraken (no bloquean):</strong><ul>${y.kraken_warnings.map(w => `<li class="warn">⚠ ${w}</li>`).join("")}</ul></div>`
        : `<p class="ok">Sin avisos de conciliación ✓</p>`;

      const total = y.final_taxable_gain_loss_eur;
      const totalSign = total >= 0 ? "de ganancias netas" : "de pérdidas netas";
      const resumenText = `En el ejercicio ${y.year} el resultado fiscal final por transmisiones de criptoactivos es de <strong class="${gainCls(total)}">${eur(Math.abs(total))}</strong> ${totalSign}. ` +
        (y.fifo_status === "OK" ? "El FIFO no presenta errores críticos. " : `<span class="err">Errores críticos FIFO detectados. </span>`) +
        (y.warnings_count > 0 ? `Existen ${y.warnings_count} aviso(s) no bloqueante(s).` : "Sin avisos de conciliación.");

      return `
      <details class="year-section" open>
        <summary>📅 Año ${y.year} — ${eur(total)} — ${statusBadge(y.report_can_be_finalized, y.warnings_count > 0 && y.report_can_be_finalized)}</summary>
        <div class="details-body">
          <div class="resumen-ejecutivo"><p>${resumenText}</p></div>
          <div class="grid3">
            <div class="card"><label>FIFO</label><span class="val">${badge(y.fifo_status === "OK" ? "b-ok" : "b-err", translateStatus(y.fifo_status))}</span></div>
            <div class="card"><label>Cartera (portfolio)</label><span class="val">${badge(y.portfolio_status === "OK" ? "b-ok" : "b-err", translateStatus(y.portfolio_status))}</span></div>
            <div class="card"><label>Método validación</label><span style="font-size:.78rem">${translateStatus(y.validation_strength)}</span></div>
            <div class="card"><label>Conciliación Kraken</label>${recBadge(y.exchange_reconciliation_status)}</div>
            <div class="card"><label>Retiradas</label><span>${translateStatus(y.withdrawals_status)}</span></div>
            <div class="card"><label>Disposiciones conserv.</label><span>${translateStatus(y.conservative_disposals_status)}</span></div>
          </div>
          <table>
            <tr><th>Concepto</th><th>Importe</th></tr>
            <tr><td>FIFO ordinario</td><td class="${gainCls(y.ordinary_fifo_gain_loss_eur)}">${eur(y.ordinary_fifo_gain_loss_eur)}</td></tr>
            <tr><td>Disposiciones externas conservadoras</td><td>${eur(y.conservative_external_disposals_gain_loss_eur)}</td></tr>
            <tr><th>Total fiscal final</th><th class="${gainCls(total)}">${eur(total)}</th></tr>
            <tr><td>Staking / rewards (informativo)</td><td>${eur(y.staking_total_eur)}</td></tr>
          </table>
          ${blockersHtml}${warnsHtml}
        </div>
      </details>`;
    }).join("\n");

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Informe fiscal multi-año — ${report.years.join(", ")}</title>
  ${HTML_STYLE}
</head>
<body>

<div class="toolbar no-print">
  <strong style="margin-right:.5rem">Informe multi-año ${report.years.join(", ")}</strong>
  <button class="btn" onclick="expandAll()">▶ Expandir todo</button>
  <button class="btn" onclick="collapseAll()">◀ Contraer todo</button>
  <button class="btn btn-primary" onclick="preparePdf()">🖨 Preparar PDF completo</button>
  <button class="btn" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
</div>

<div class="portada">
  <h1>📊 Informe Fiscal Multi-año / Auditoría FISCO</h1>
  <div class="grid3">
    <div class="card"><label>Años incluidos</label><span class="val">${report.years.join(", ")}</span></div>
    <div class="card"><label>Exchanges</label><span class="val" style="font-size:.85rem">${report.exchanges.join(", ")}</span></div>
    <div class="card"><label>Fecha de generación</label><span class="val" style="font-size:.8rem">${new Date(report.generated_at).toLocaleString("es-ES")}</span></div>
  </div>
  <p style="font-size:.82rem;color:#856404;margin:.5rem 0">⚠ ${report.audit_note}</p>
</div>

<h2>Resumen consolidado por año</h2>
<table>
  <thead>
    <tr>
      <th>Año</th><th>FIFO</th><th>FIFO ordinario</th><th>Conservadoras</th>
      <th>Total fiscal</th><th>Staking</th><th>Cartera</th><th>Método validación</th>
      <th>Conciliación</th><th>Retiradas</th><th>Finalizable</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<p style="background:#f0f4ff;border:1px solid #c5d3f0;border-radius:6px;padding:.6rem 1rem;margin:1rem 0">
  <strong>Total acumulado (solo auditoría — NO es declaración fiscal conjunta):</strong>
  <strong class="${report.global_summary.accumulated_total_for_audit_only >= 0 ? "gain-pos" : "gain-neg"}">
    ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(report.global_summary.accumulated_total_for_audit_only)}
  </strong>
  &nbsp;&nbsp;<span style="font-size:.8rem;color:#856404">⚠ Total acumulado solo para auditoría. No es una declaración fiscal conjunta.</span>
</p>

<h2>Detalle por año</h2>
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
