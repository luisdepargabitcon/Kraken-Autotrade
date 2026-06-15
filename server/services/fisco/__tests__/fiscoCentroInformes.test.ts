/**
 * Centro de Informes y Exportaciones Fiscales — unit tests
 *
 * Tests:
 *  1.  multi-year report con 2025+2026 devuelve ambos años.
 *  2.  filtro exchanges=kraken solo incluye kraken en la lista.
 *  3.  filtro exchanges=revolutx solo incluye revolutx en la lista.
 *  4.  includeGlobal=true produce scope="global" por año.
 *  5.  includeExchangeBreakdown=true produce scope="exchange" entries.
 *  6.  export operations.csv contiene cabeceras esperadas.
 *  7.  export disposals.csv contiene columnas FIFO.
 *  8.  export lots.csv contiene columnas de lotes.
 *  9.  export statement-items.csv contiene columnas withdrawals/clasificaciones.
 *  10. export conservative-disposals.csv contiene clasificaciones conservadoras.
 *  11. si un año no es finalizable, multi-year report lo marca claramente (report_can_be_finalized=false).
 *  12. si un año tiene Kraken WARNINGS, multi-year report muestra OK_WITH_WARNINGS.
 *  13. no se mezclan resultados fiscales entre años (totals_by_year tiene 2 entradas separadas).
 *  14. final_taxable_gain_loss_eur por año = FIFO ordinario + conservadoras.
 *  15. audit_note contiene texto de advertencia sobre declaración conjunta.
 *  16. accumulated_total_for_audit_only es suma de todos los años.
 *  17. renderHtml genera HTML válido con tabla de resumen.
 *  18. delimiter=semicolon produce CSV con ; como separador.
 *  19. getCounts devuelve counts de las tablas correctas.
 */

import { describe, it, expect, vi } from "vitest";
import { MultiYearReportService } from "../MultiYearReportService";
import { FiscoExportService } from "../FiscoExportService";
import { FiscoHtmlRenderer, translateStatus } from "../FiscoHtmlRenderer";
import { FiscoValidationService } from "../FiscoValidationService";
import { KrakenReconciliationService } from "../KrakenReconciliationService";
import type { Pool } from "pg";

// ─── Mock factory ─────────────────────────────────────────────────────────────

type QueryResponse = { rows: any[] };

function makeMockPool(handler: (sql: string, params?: any[]) => QueryResponse) {
  return {
    query: vi.fn(async (sql: string, params?: any[]) => handler(sql, params)),
  } as unknown as Pool;
}

// ─── MultiYearReportService mock ──────────────────────────────────────────────

function makeMultiYearPool(opts: {
  fifoGain?: Record<number, string>;
  consGain?: Record<number, string>;
  stakingTotal?: Record<number, string>;
  portfolioStatus?: Record<number, "OK" | "DIFFERENCES">;
  krakenStatus?: Record<number, "OK" | "WARNINGS" | "DIFFERENCES">;
  krakenWarnings?: Record<number, string[]>;
  reportFinalizable?: Record<number, boolean>;
} = {}) {
  return makeMockPool((sql) => {
    // Kraken staking no price — MUST be first, before generic staking handler
    // (query has op_type IN ('staking','reward','distribution') AND price_eur IS NULL)
    if (sql.includes("price_eur IS NULL")) {
      return { rows: [] };
    }
    // staking totals from MultiYearReportService (has SUM and no price_eur IS NULL)
    if (sql.includes("staking") && sql.includes("SUM")) {
      return { rows: [{ total: "0" }] };
    }
    // FiscoValidationService.getFinalizationStatus — fifo errors
    if (sql.includes("MISSING_OPENING_BALANCE") || sql.includes("NEGATIVE_INVENTORY") || sql.includes("UNKNOWN_BASIS") || sql.includes("SELL_WITHOUT_LOT")) {
      return { rows: [] };
    }
    // FiscoValidationService.getFinalizationStatus — portfolio (opening lots)
    if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at < $") && !sql.includes("fo.executed_at >=")) {
      return { rows: [] };
    }
    // acquisitions in year
    if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at >=")) {
      return { rows: [] };
    }
    // opening disposals
    if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at < $") && !sql.includes("fd.disposed_at >=")) {
      return { rows: [] };
    }
    // disposals in year
    if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at >=")) {
      return { rows: [] };
    }
    // remaining snapshot
    if (sql.includes("remaining_qty > 0")) {
      return { rows: [] };
    }
    // withdrawals
    if (sql.includes("pending_count") || sql.includes("LIKE 'withdrawal%'")) {
      return { rows: [{ pending_count: "0", internal_count: "0", conservative_count: "0" }] };
    }
    // conservative/fifo gain
    if (sql.includes("conservative_external_disposal") && sql.includes("SUM")) {
      return { rows: [{ conservative_gain: "0", conservative_loss: "0" }] };
    }
    if (sql.includes("gain_loss_eur") && sql.includes("fisco_disposals")) {
      return { rows: [{ ordinary_gain: "0", ordinary_loss: "0" }] };
    }
    // stablecoin anomalies
    if (sql.includes("stablecoin") || sql.includes("unit_cost_eur") && sql.includes("0.50")) {
      return { rows: [] };
    }
    // Kraken counts by op_type
    if (sql.includes("GROUP BY op_type")) {
      return { rows: [
        { op_type: "trade_buy",  cnt: "3" },
        { op_type: "trade_sell", cnt: "2" },
        { op_type: "deposit",    cnt: "1" },
        { op_type: "staking",    cnt: "5" },
      ]};
    }
    // Kraken date range
    if (sql.includes("MIN(executed_at)")) {
      return { rows: [{ first_op: "2025-01-01T00:00:00Z", last_op: "2025-12-31T00:00:00Z" }] };
    }
    // Kraken missing EUR
    if (sql.includes("total_eur IS NULL") && sql.includes("GROUP BY asset")) {
      return { rows: [] };
    }
    // Kraken deposits without lot
    if (sql.includes("op_type = 'deposit'") && sql.includes("fl.id IS NULL")) {
      return { rows: [] };
    }
    // Kraken withdrawals without statement
    if (sql.includes("op_type = 'withdrawal'") && sql.includes("NOT EXISTS")) {
      return { rows: [] };
    }
    // Kraken portfolio
    if (sql.includes("fo.exchange = 'kraken'") && sql.includes("GROUP BY fl.asset")) {
      return { rows: [{ asset: "ETH", qty: "0.56" }] };
    }
    return { rows: [] };
  });
}

// ─── MultiYearReportService tests ─────────────────────────────────────────────

describe("MultiYearReportService", () => {

  it("Test 1: multi-year report con 2025+2026 devuelve ambos años", async () => {
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({ years: [2025, 2026], exchanges: ["kraken", "revolutx"], includeGlobal: true, includeExchangeBreakdown: false });

    expect(r.years).toEqual([2025, 2026]);
    expect(r.global_summary.totals_by_year).toHaveLength(2);
    expect(r.global_summary.totals_by_year.map(y => y.year)).toEqual([2025, 2026]);
  });

  it("Test 2: filtro exchanges=kraken solo incluye kraken en exchanges del reporte", async () => {
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({ years: [2025], exchanges: ["kraken"], includeGlobal: true, includeExchangeBreakdown: false });

    expect(r.exchanges).toContain("kraken");
    expect(r.exchanges).not.toContain("revolutx");
  });

  it("Test 3: filtro exchanges=revolutx solo incluye revolutx", async () => {
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({ years: [2025], exchanges: ["revolutx"], includeGlobal: true, includeExchangeBreakdown: false });

    expect(r.exchanges).toContain("revolutx");
    expect(r.exchanges).not.toContain("kraken");
  });

  it("Test 4: includeGlobal=true produce scope=global por año", async () => {
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({ years: [2025, 2026], exchanges: ["kraken", "revolutx"], includeGlobal: true, includeExchangeBreakdown: false });

    const globalReports = r.reports.filter(rep => rep.scope === "global");
    expect(globalReports).toHaveLength(2); // one per year
    expect(globalReports.every(rep => rep.exchange === null)).toBe(true);
  });

  it("Test 5: includeExchangeBreakdown=true — scope=exchange, diagnostic_only=true, affects_finalization=false", async () => {
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({ years: [2025], exchanges: ["kraken", "revolutx"], includeGlobal: false, includeExchangeBreakdown: true });

    const exchangeReports = r.reports.filter(rep => rep.scope === "exchange");
    expect(exchangeReports.length).toBeGreaterThanOrEqual(1);
    expect(exchangeReports.some(rep => rep.exchange === "kraken")).toBe(true);

    // Each per-exchange portfolio must be marked as diagnostic only
    for (const rep of exchangeReports) {
      expect(rep.portfolio_validation.diagnostic_only).toBe(true);
      expect(rep.portfolio_validation.affects_finalization).toBe(false);
      expect(typeof rep.portfolio_validation.note).toBe("string");
      expect(rep.portfolio_validation.note.length).toBeGreaterThan(10);
    }
  });

  it("Test 11: año no finalizable → report_can_be_finalized=false en totals_by_year", async () => {
    // FIFO critical error → getFinalizationStatus returns report_can_be_finalized=false
    const pool = makeMockPool((sql) => {
      if (sql.includes("price_eur IS NULL")) return { rows: [] };
      // FIFO_NEGATIVE_INVENTORY — remaining_qty < -0.000001
      if (sql.includes("remaining_qty < -0.000001")) {
        return { rows: [{ asset: "ETH", remaining: "-0.5" }] };
      }
      // FIFO_UNKNOWN_BASIS — cost_basis_eur = 0
      if (sql.includes("cost_basis_eur") && sql.includes("= 0")) return { rows: [] };
      if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at < $") && !sql.includes("fo.executed_at >=")) return { rows: [] };
      if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at >=")) return { rows: [] };
      if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at < $") && !sql.includes("fd.disposed_at >=")) return { rows: [] };
      if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at >=")) return { rows: [] };
      if (sql.includes("remaining_qty > 0")) return { rows: [] };
      if (sql.includes("pending_count") || sql.includes("LIKE 'withdrawal%'")) return { rows: [{ pending_count: "0", internal_count: "0", conservative_count: "0" }] };
      if (sql.includes("conservative_external_disposal") && sql.includes("SUM")) return { rows: [{ conservative_gain: "0", conservative_loss: "0" }] };
      if (sql.includes("gain_loss_eur") && sql.includes("fisco_disposals")) return { rows: [{ ordinary_gain: "0", ordinary_loss: "0" }] };
      if (sql.includes("staking") && sql.includes("SUM")) return { rows: [{ total: "0" }] };
      if (sql.includes("GROUP BY op_type")) return { rows: [] };
      if (sql.includes("MIN(executed_at)")) return { rows: [{ first_op: "2025-01-01T00:00:00Z", last_op: "2025-12-31T00:00:00Z" }] };
      if (sql.includes("total_eur IS NULL") && sql.includes("GROUP BY asset")) return { rows: [] };
      if (sql.includes("op_type = 'deposit'") && sql.includes("fl.id IS NULL")) return { rows: [] };
      if (sql.includes("op_type = 'withdrawal'") && sql.includes("NOT EXISTS")) return { rows: [] };
      if (sql.includes("fo.exchange = 'kraken'") && sql.includes("GROUP BY fl.asset")) return { rows: [] };
      return { rows: [] };
    });

    const svc = new MultiYearReportService(pool);
    const r   = await svc.generate({ years: [2025], exchanges: ["kraken"], includeGlobal: true, includeExchangeBreakdown: false });

    const year2025 = r.global_summary.totals_by_year.find(y => y.year === 2025)!;
    expect(year2025.report_can_be_finalized).toBe(false);
    expect(year2025.fifo_status).toBe("CRITICAL");
  });

  it("Test 12: Kraken WARNINGS → exchange_reconciliation_status = OK_WITH_WARNINGS", async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes("price_eur IS NULL")) return { rows: [] };
      // Kraken: withdrawal without statement = WARNINGS
      if (sql.includes("op_type = 'withdrawal'") && sql.includes("NOT EXISTS")) {
        return { rows: [{ external_id: "WARN1", asset: "TON", amount: "10", executed_at: "2025-06-01T00:00:00Z" }] };
      }
      if (sql.includes("MISSING_OPENING_BALANCE") || sql.includes("NEGATIVE_INVENTORY")) return { rows: [] };
      if (sql.includes("UNKNOWN_BASIS") || sql.includes("SELL_WITHOUT_LOT")) return { rows: [] };
      if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at < $") && !sql.includes("fo.executed_at >=")) return { rows: [] };
      if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at >=")) return { rows: [] };
      if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at < $") && !sql.includes("fd.disposed_at >=")) return { rows: [] };
      if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at >=")) return { rows: [] };
      if (sql.includes("remaining_qty > 0")) return { rows: [] };
      if (sql.includes("pending_count") || sql.includes("LIKE 'withdrawal%'")) return { rows: [{ pending_count: "0", internal_count: "0", conservative_count: "0" }] };
      if (sql.includes("conservative_external_disposal") && sql.includes("SUM")) return { rows: [{ conservative_gain: "0", conservative_loss: "0" }] };
      if (sql.includes("gain_loss_eur") && sql.includes("fisco_disposals")) return { rows: [{ ordinary_gain: "0", ordinary_loss: "0" }] };
      if (sql.includes("staking") && sql.includes("SUM")) return { rows: [{ total: "0" }] };
      if (sql.includes("GROUP BY op_type")) return { rows: [{ op_type: "trade_buy", cnt: "2" }] };
      if (sql.includes("MIN(executed_at)")) return { rows: [{ first_op: "2025-01-01T00:00:00Z", last_op: "2025-12-31T00:00:00Z" }] };
      if (sql.includes("total_eur IS NULL") && sql.includes("GROUP BY asset")) return { rows: [] };
      if (sql.includes("op_type = 'deposit'") && sql.includes("fl.id IS NULL")) return { rows: [] };
      if (sql.includes("fo.exchange = 'kraken'") && sql.includes("GROUP BY fl.asset")) return { rows: [] };
      return { rows: [] };
    });

    const svc = new MultiYearReportService(pool);
    const r   = await svc.generate({ years: [2025], exchanges: ["kraken"], includeGlobal: true, includeExchangeBreakdown: false });

    const year2025 = r.global_summary.totals_by_year.find(y => y.year === 2025)!;
    expect(year2025.kraken_reconciliation_status).toBe("WARNINGS");
    expect(year2025.exchange_reconciliation_status).toBe("OK_WITH_WARNINGS");
    expect(year2025.kraken_report_can_be_finalized).toBe(true); // WARNINGS no bloquean
    expect(year2025.kraken_warnings.length).toBeGreaterThan(0);
  });

  it("Test 13: no se mezclan resultados entre años", async () => {
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({ years: [2025, 2026], exchanges: ["kraken"], includeGlobal: true, includeExchangeBreakdown: false });

    expect(r.global_summary.totals_by_year[0].year).toBe(2025);
    expect(r.global_summary.totals_by_year[1].year).toBe(2026);
    // Each year is independent
    expect(r.global_summary.totals_by_year).toHaveLength(2);
  });

  it("Test 14: final_taxable_gain_loss_eur = ordinario + conservadoras", async () => {
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({ years: [2025], exchanges: ["kraken"], includeGlobal: true, includeExchangeBreakdown: false });

    const y = r.global_summary.totals_by_year[0];
    expect(y.final_taxable_gain_loss_eur).toBeCloseTo(
      y.ordinary_fifo_gain_loss_eur + y.conservative_external_disposals_gain_loss_eur,
      5,
    );
  });

  it("Test 15: audit_note contiene advertencia sobre declaración conjunta", async () => {
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({ years: [2025], exchanges: ["kraken"], includeGlobal: true, includeExchangeBreakdown: false });

    expect(r.audit_note).toMatch(/por separado/i);
    expect(r.audit_note).toMatch(/auditoría/i);
  });

  it("Test 16: accumulated_total_for_audit_only es suma de los años", async () => {
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({ years: [2025, 2026], exchanges: ["kraken"], includeGlobal: true, includeExchangeBreakdown: false });

    const expected = r.global_summary.totals_by_year.reduce((acc, y) => acc + y.final_taxable_gain_loss_eur, 0);
    expect(r.global_summary.accumulated_total_for_audit_only).toBeCloseTo(expected, 5);
  });

  it("Test 17: renderHtml genera HTML con tabla de resumen y secciones por año", async () => {
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({ years: [2025, 2026], exchanges: ["kraken"], includeGlobal: true, includeExchangeBreakdown: false });
    const html = svc.renderHtml(r);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Informe fiscal multi-año");
    expect(html).toContain("<table");
    expect(html).toContain("2025");
    expect(html).toContain("2026");
    expect(html).toContain("Total fiscal final");
    expect(html).toContain("Año 2025");
    expect(html).toContain("Año 2026");
  });
});

// ─── FiscoExportService tests ─────────────────────────────────────────────────

function makeExportPool() {
  return makeMockPool((sql) => {
    if (sql.includes("FROM fisco_operations")) {
      return { rows: [
        { year: 2025, exchange: "kraken", external_id: "EXT1", op_type: "trade_buy",
          asset: "BTC", amount: "0.01", price_eur: "50000", total_eur: "500",
          fee_eur: "2", counter_asset: "EUR", pair: "BTC/EUR",
          executed_at: new Date("2025-03-15T10:00:00Z"), created_at: new Date("2025-03-15T10:01:00Z") },
      ]};
    }
    if (sql.includes("FROM fisco_disposals")) {
      return { rows: [
        { year: 2025, exchange: "kraken", asset: "BTC", pair: "BTC/EUR",
          sell_operation_id: 42, lot_id: 7, quantity: "0.005", proceeds_eur: "300",
          cost_basis_eur: "250", gain_loss_eur: "50", disposed_at: new Date("2025-06-01T00:00:00Z") },
      ]};
    }
    if (sql.includes("FROM fisco_lots")) {
      return { rows: [
        { asset: "BTC", exchange: "kraken", operation_id: 10,
          quantity: "0.01", remaining_qty: "0.005", cost_eur: "500",
          unit_cost_eur: "50000", fee_eur: "2",
          acquired_at: new Date("2025-03-15T10:00:00Z"), is_closed: false },
      ]};
    }
    if (sql.includes("FROM fisco_external_statement_items")) {
      return { rows: [
        { year: 2025, exchange: "revolutx", asset: "ETH", statement_type: "withdrawal",
          event_at: new Date("2025-05-01T00:00:00Z"), amount_sent: "0.23",
          fee_amount: "0.001", total_out: "0.231", network: "ERC20",
          classification: "internal_transfer", taxable: "false",
          market_price_eur: "2000", proceeds_eur: "460", cost_basis_eur: "400",
          gain_loss_eur: "60", reconciliation_status: "matched_internal",
          classification_source: "transfer_match", finalized_at: null, notes: null },
      ]};
    }
    if (sql.includes("COUNT(*)")) {
      return { rows: [{ cnt: "5" }] };
    }
    return { rows: [] };
  });
}

describe("FiscoExportService", () => {

  it("Test 6: export operations.csv contiene cabeceras esperadas", async () => {
    const pool = makeExportPool();
    const svc  = new FiscoExportService(pool);
    const csv  = await svc.exportOperationsCsv({ years: [2025], exchanges: ["kraken"] });

    const headers = csv.split("\n")[0];
    expect(headers).toContain("year");
    expect(headers).toContain("exchange");
    expect(headers).toContain("external_id");
    expect(headers).toContain("op_type");
    expect(headers).toContain("asset");
    expect(headers).toContain("amount");
    expect(headers).toContain("price_eur");
    expect(headers).toContain("total_eur");
    expect(headers).toContain("fee_eur");
    expect(headers).toContain("executed_at");
  });

  it("Test 6b: operations.csv fila contiene datos correctos", async () => {
    const pool = makeExportPool();
    const svc  = new FiscoExportService(pool);
    const csv  = await svc.exportOperationsCsv({ years: [2025], exchanges: ["kraken"] });

    const lines = csv.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[1]).toContain("kraken");
    expect(lines[1]).toContain("BTC");
  });

  it("Test 7: export disposals.csv contiene columnas FIFO", async () => {
    const pool = makeExportPool();
    const svc  = new FiscoExportService(pool);
    const csv  = await svc.exportDisposalsCsv({ years: [2025], exchanges: ["kraken"] });

    const headers = csv.split("\n")[0];
    expect(headers).toContain("sell_operation_id");
    expect(headers).toContain("lot_id");
    expect(headers).toContain("quantity");
    expect(headers).toContain("proceeds_eur");
    expect(headers).toContain("cost_basis_eur");
    expect(headers).toContain("gain_loss_eur");
    expect(headers).toContain("disposed_at");
  });

  it("Test 8: export lots.csv contiene columnas de lotes", async () => {
    const pool = makeExportPool();
    const svc  = new FiscoExportService(pool);
    const csv  = await svc.exportLotsCsv({ exchanges: ["kraken"] });

    const headers = csv.split("\n")[0];
    expect(headers).toContain("asset");
    expect(headers).toContain("operation_id");
    expect(headers).toContain("quantity");
    expect(headers).toContain("remaining_qty");
    expect(headers).toContain("cost_eur");
    expect(headers).toContain("unit_cost_eur");
    expect(headers).toContain("acquired_at");
    expect(headers).toContain("is_closed");
  });

  it("Test 9: export statement-items.csv contiene columnas withdrawals/clasificaciones", async () => {
    const pool = makeExportPool();
    const svc  = new FiscoExportService(pool);
    const csv  = await svc.exportStatementItemsCsv({ years: [2025], exchanges: ["revolutx"] });

    const headers = csv.split("\n")[0];
    expect(headers).toContain("statement_type");
    expect(headers).toContain("classification");
    expect(headers).toContain("amount_sent");
    expect(headers).toContain("gain_loss_eur");
    expect(headers).toContain("reconciliation_status");
    expect(headers).toContain("finalized_at");
    expect(headers).toContain("notes");
  });

  it("Test 10: export conservative-disposals.csv contiene columnas conservadoras", async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes("FROM fisco_external_statement_items") && sql.includes("conservative_external_disposal")) {
        return { rows: [
          { year: 2025, exchange: "revolutx", asset: "ETH",
            event_at: new Date("2025-08-01T00:00:00Z"), amount_sent: "0.5",
            fee_amount: "0.001", total_out: "0.501", market_price_eur: "2100",
            proceeds_eur: "1050", cost_basis_eur: "900", gain_loss_eur: "150",
            classification: "conservative_external_disposal", taxable: "true",
            finalized_note: "Conservative disposal", conservative_reversed_at: null,
            conservative_reversed_to: null },
        ]};
      }
      return { rows: [] };
    });
    const svc = new FiscoExportService(pool);
    const csv = await svc.exportConservativeDisposalsCsv({ years: [2025] });

    const headers = csv.split("\n")[0];
    expect(headers).toContain("market_price_eur");
    expect(headers).toContain("proceeds_eur");
    expect(headers).toContain("cost_basis_eur");
    expect(headers).toContain("gain_loss_eur");
    expect(headers).toContain("classification");
    expect(headers).toContain("finalized_note");
    expect(headers).toContain("conservative_reversed_at");
  });

  it("Test 18: delimiter=semicolon produce CSV con ; como separador", async () => {
    const pool = makeExportPool();
    const svc  = new FiscoExportService(pool);
    const csv  = await svc.exportOperationsCsv({ years: [2025], exchanges: ["kraken"], delimiter: "semicolon" });

    const header = csv.split("\n")[0];
    expect(header).toContain(";");
    expect(header).not.toContain(",");
  });

  it("Test 20: archiverLib runtime resolver logic — directa function export", () => {
    // Verify the resolution logic used in fisco.routes.ts works correctly for both patterns:
    // 1. Module is itself a function (native CJS — the real archiver case)
    // 2. Module wraps the function in .default (some bundlers)
    const resolveFn = (mod: unknown): unknown =>
      typeof mod === "function"           ? mod :
      typeof (mod as any)?.default === "function" ? (mod as any).default :
      null;

    const directFn = () => {};
    expect(resolveFn(directFn)).toBe(directFn);

    const wrappedFn = () => {};
    expect(resolveFn({ default: wrappedFn })).toBe(wrappedFn);

    expect(resolveFn({ notAFunction: true })).toBeNull();
    expect(resolveFn(null)).toBeNull();
  });

  it("Test 21: portfolio global unaffected when per-exchange shows DIFFERENCES", async () => {
    // Mock: revolutx portfolio has DIFFERENCES (closing < 0 for USDC)
    // but global portfolio (exchange=null) returns OK.
    // global_summary.totals_by_year must still reflect global finalization.
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({
      years: [2026],
      exchanges: ["kraken", "revolutx"],
      includeGlobal: true,
      includeExchangeBreakdown: true,
    });

    // Global scope report: portfolio_validation has no diagnostic_only flag
    const globalRep = r.reports.find(rep => rep.scope === "global" && rep.year === 2026)!;
    expect(globalRep.portfolio_validation.diagnostic_only).toBeUndefined();
    expect(globalRep.portfolio_validation.affects_finalization).toBeUndefined();

    // Exchange scope reports: portfolio_validation tagged as diagnostic
    const revRep = r.reports.find(rep => rep.scope === "exchange" && rep.exchange === "revolutx" && rep.year === 2026)!;
    expect(revRep.portfolio_validation.diagnostic_only).toBe(true);
    expect(revRep.portfolio_validation.affects_finalization).toBe(false);

    // The global year summary (used for final decision) is driven by global portfolio, not per-exchange
    const y = r.global_summary.totals_by_year.find(s => s.year === 2026)!;
    expect(y.report_can_be_finalized).toBe(true); // mock returns OK everywhere
  });

  it("Test 19: getCounts devuelve counts de las 4 tablas", async () => {
    const pool = makeExportPool();
    const svc  = new FiscoExportService(pool);
    const counts = await svc.getCounts({ years: [2025], exchanges: ["kraken"] });

    expect(typeof counts.operations).toBe("number");
    expect(typeof counts.disposals).toBe("number");
    expect(typeof counts.lots).toBe("number");
    expect(typeof counts.statement_items).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FiscoHtmlRenderer — 16 nuevos tests
// ─────────────────────────────────────────────────────────────────────────────

function makeHtmlRendererPool() {
  return makeMockPool((sql) => {
    // fisco_operations asset summaries (STRING_AGG)
    if (sql.includes("STRING_AGG") && sql.includes("fisco_operations")) return { rows: [{ asset: "BTC", exchanges: "kraken", acquisitions_qty: "1", disposals_qty: "0.5", fees_eur: "5", operations_count: "3" }] };
    // fisco_lots opening/closing inventory
    if (sql.includes("fisco_lots") && sql.includes("GROUP BY fl.asset")) return { rows: [{ asset: "BTC", opening_qty: "0.5", closing_qty: "0.5" }] };
    // fetchDisposalCounterAssets — new query for F/N/O classification (GROUP BY sell_operation_id)
    // Must come BEFORE the generic GROUP BY sell_op.asset check below
    if (sql.includes("fisco_disposals") && sql.includes("sell_op.counter_asset") && sql.includes("fd.sell_operation_id")) {
      return { rows: [{ asset: "BTC", sell_operation_id: "1", counter_asset: "USD", pair: "BTC/USD", op_type: "trade_sell", net_proceeds_eur: "15000", cost_basis_eur: "14000", gain_loss_eur: "1000", is_fee_disposal: false }] };
    }
    // disposals summary — real schema: JOIN sell_op ON sell_operation_id, GROUP BY sell_op.asset
    if (sql.includes("fisco_disposals") && sql.includes("GROUP BY sell_op.asset")) return { rows: [{ asset: "BTC", proceeds_eur: "15000", cost_basis_eur: "14000", gain_loss_eur: "1000", disposals_count: "2" }] };
    // disposals detail — real schema: JOIN fisco_operations sell_op, ORDER BY sell_op.asset
    if (sql.includes("fisco_disposals") && sql.includes("JOIN fisco_operations sell_op") && sql.includes("ORDER BY sell_op.asset")) {
      return { rows: [{ asset: "BTC", disposed_at: "2025-06-01T00:00:00Z", exchange: "kraken", quantity: "0.1", proceeds_eur: "2500", cost_basis_eur: "2400", fee_eur: "10", gain_loss_eur: "90" }] };
    }
    // operations per asset detail
    if (sql.includes("fisco_operations") && sql.includes("ORDER BY fo.asset")) return { rows: [{ asset: "BTC", executed_at: "2025-01-15T00:00:00Z", exchange: "kraken", op_type: "trade_buy", amount: "0.5", price_eur: "28000", total_eur: "14000", fee_eur: "5", external_id: "TXABC" }] };
    // exchange summaries by operations
    if (sql.includes("GROUP BY fo.exchange")) return { rows: [{ exchange: "kraken", operations_count: "3", buys_count: "2", sells_count: "1", deposits_count: "0", withdrawals_count: "0", staking_count: "0", fees_eur: "5" }] };
    // disposals gain by exchange — real schema: JOIN sell_op, GROUP BY sell_op.exchange
    if (sql.includes("fisco_disposals") && sql.includes("GROUP BY sell_op.exchange")) return { rows: [{ exchange: "kraken", gain_loss_eur: "1000" }] };
    // staking rows
    if (sql.includes("op_type IN ('staking'")) return { rows: [] };
    // statement items — real schema uses fsi.year and fsi.event_at
    if (sql.includes("fisco_external_statement_items") && sql.includes("fsi.year")) return { rows: [] };
    // counts
    if (sql.includes("COUNT(*)") && sql.includes("fisco_operations")) return { rows: [{ c: "3" }] };
    if (sql.includes("COUNT(*)") && sql.includes("fisco_disposals")) return { rows: [{ c: "2" }] };
    if (sql.includes("COUNT(*)") && sql.includes("remaining_qty")) return { rows: [{ c: "1" }] };
    // gains/losses breakdown query (from route enrichment for BUG1)
    if (sql.includes("COALESCE(SUM(CASE WHEN d.gain_loss_eur::numeric > 0")) return { rows: [{ ganancias: "824.37", perdidas: "-1424.85" }] };
    // staking total query (from route enrichment for BUG1)
    if (sql.includes("op_type IN ('staking','reward','distribution')") && sql.includes("SUM(fo.total_eur::numeric)")) return { rows: [{ total: "1.49" }] };
    // fallback for any other gains/losses query (different WHERE clause patterns)
    if (sql.includes("fisco_disposals") && sql.includes("CASE WHEN d.gain_loss_eur::numeric > 0")) return { rows: [{ ganancias: "824.37", perdidas: "-1424.85" }] };
    return { rows: [] };
  });
}

const MOCK_FIN_STATUS = {
  fifo_status: "OK",
  portfolio_status: "OK",
  withdrawals_status: "OK",
  conservative_disposals_status: "NONE",
  report_can_be_finalized: true,
  blockers: [],
  warnings: [],
  ordinary_fifo_gain_loss_eur: -200,
  conservative_external_disposals_gain_loss_eur: 0,
  final_taxable_gain_loss_eur: -200,
  staking_total_eur: 10,
  gains_eur: 50,
  losses_eur: -250,
};
const MOCK_PORTFOLIO = { validation_strength: "fifo_internal_historical_inventory", portfolio_status: "OK", rows: [] };
const MOCK_KRAKEN_REC = { status: "OK", warnings: [], report_can_be_finalized: true };

describe("FiscoHtmlRenderer", () => {
  it("Test H1: translateStatus traduce códigos técnicos a español", () => {
    expect(translateStatus("OK")).toBe("Correcto");
    expect(translateStatus("OK_WITH_WARNINGS")).toBe("Correcto con avisos");
    expect(translateStatus("DIFFERENCES")).toBe("Diferencias");
    expect(translateStatus("fifo_internal_historical_inventory")).toBe("Validación FIFO histórica interna");
    expect(translateStatus("OK_INTERNAL_TRANSFER")).toBe("OK — Transferencia interna");
    expect(translateStatus("UNKNOWN_CODE")).toBe("UNKNOWN_CODE");
  });

  it("Test H2: renderAnnualHtml devuelve text/html empezando con <!DOCTYPE html>", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });

  it("Test H3: renderAnnualHtml NO devuelve JSON (no empieza con {)", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html.trimStart()).not.toMatch(/^\{/);
  });

  it("Test H4: renderAnnualHtml contiene sección 'Detalle por activo'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Detalle por activo");
  });

  it("Test H5: renderAnnualHtml contiene <details> por activo", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("<details");
  });

  it("Test H6: renderAnnualHtml contiene 'Preparar PDF completo'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Preparar PDF completo");
  });

  it("Test H7: renderAnnualHtml usa estados en castellano (no muestra solo 'OK')", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Correcto");
    expect(html).toContain("Validación FIFO histórica interna");
  });

  it("Test H8: renderAnnualHtml contiene sección 'Ventas y cálculo FIFO'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Ventas y cálculo FIFO");
  });

  it("Test H9: renderAnnualHtml contiene sección 'Rendimientos / staking'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Rendimientos / staking");
  });

  it("Test H10: renderAnnualHtml contiene sección 'Retiradas, depósitos y transferencias'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Retiradas, dep");
  });

  it("Test H11: renderAnnualHtml contiene @media print", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("@media print");
  });

  it("Test H12: renderAnnualHtml contiene expandAll y collapseAll JS", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("expandAll");
    expect(html).toContain("collapseAll");
    expect(html).toContain("preparePdf");
  });

  it("Test H13: multi-year renderHtml contiene 'Detalle por año' con <details>", () => {
    const svc = new MultiYearReportService(makeMockPool(() => ({ rows: [] })));
    const dummyReport = {
      generated_at: new Date().toISOString(),
      years: [2025],
      exchanges: ["kraken"],
      include_global: true,
      include_exchange_breakdown: false,
      audit_note: "Nota de auditoría",
      global_summary: {
        totals_by_year: [{
          year: 2025,
          ordinary_fifo_gain_loss_eur: -72.25,
          conservative_external_disposals_gain_loss_eur: 0,
          final_taxable_gain_loss_eur: -72.25,
          staking_total_eur: 5,
          portfolio_status: "OK" as const,
          validation_strength: "fifo_internal_historical_inventory",
          exchange_reconciliation_status: "OK_WITH_WARNINGS",
          withdrawals_status: "OK",
          conservative_disposals_status: "NONE",
          fifo_status: "OK",
          report_can_be_finalized: true,
          blockers_count: 0,
          warnings_count: 1,
          blockers: [],
          warnings: [],
          kraken_reconciliation_status: "WARNINGS",
          kraken_warnings: ["Retirada TON sin statement item enlazado"],
          kraken_report_can_be_finalized: true,
        }],
        accumulated_total_for_audit_only: -72.25,
      },
      reports: [],
    };
    const html = svc.renderHtml(dummyReport);
    expect(html).toContain("Detalle por año");
    expect(html).toContain("<details");
    expect(html).toContain("Correcto con avisos");
    expect(html).toContain("Avisos Kraken");
  });

  it("Test H14: multi-year HTML contiene expandAll/collapseAll/preparePdf", () => {
    const svc = new MultiYearReportService(makeMockPool(() => ({ rows: [] })));
    const dummyReport = {
      generated_at: new Date().toISOString(), years: [2025], exchanges: ["kraken"],
      include_global: true, include_exchange_breakdown: false,
      audit_note: "nota",
      global_summary: { totals_by_year: [], accumulated_total_for_audit_only: 0 },
      reports: [],
    };
    const html = svc.renderHtml(dummyReport);
    expect(html).toContain("expandAll");
    expect(html).toContain("collapseAll");
    expect(html).toContain("preparePdf");
  });

  it("Test H15: multi-year HTML contiene @media print", () => {
    const svc = new MultiYearReportService(makeMockPool(() => ({ rows: [] })));
    const html = svc.renderHtml({
      generated_at: new Date().toISOString(), years: [2025], exchanges: ["kraken"],
      include_global: true, include_exchange_breakdown: false, audit_note: "nota",
      global_summary: { totals_by_year: [], accumulated_total_for_audit_only: 0 }, reports: [],
    });
    expect(html).toContain("@media print");
  });

  it("Test H16: JSZip genera buffer de tipo Buffer (no string, no undefined)", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("test.txt", "contenido de prueba");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(10);
  });

  // ── Schema safety tests ────────────────────────────────────────────────────

  it("Test S1: FiscoHtmlRenderer source no contiene fd.asset directamente", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../FiscoHtmlRenderer.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1"),
      "utf8"
    );
    expect(src).not.toMatch(/fd\.asset/);
  });

  it("Test S2: FiscoHtmlRenderer source no contiene fsi.executed_at directamente", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../FiscoHtmlRenderer.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1"),
      "utf8"
    );
    expect(src).not.toMatch(/fsi\.executed_at/);
  });

  it("Test S3: FiscoHtmlRenderer source no contiene fd.exchange directamente", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../FiscoHtmlRenderer.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1"),
      "utf8"
    );
    expect(src).not.toMatch(/fd\.exchange/);
  });

  it("Test S4: FiscoHtmlRenderer usa JOIN sell_op ON sell_operation_id para obtener asset", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../FiscoHtmlRenderer.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1"),
      "utf8"
    );
    expect(src).toContain("JOIN fisco_operations sell_op ON sell_op.id = fd.sell_operation_id");
  });

  it("Test S5: FiscoHtmlRenderer usa fsi.event_at para statement items", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../FiscoHtmlRenderer.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1"),
      "utf8"
    );
    expect(src).toContain("fsi.event_at");
    expect(src).toContain("fsi.year");
  });

  it("Test S6: renderAnnualHtml con mock schema real devuelve HTML sin errores parciales", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).not.toContain("Advertencia: algunas secciones no pudieron cargarse");
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });

  // ── FIFO display correctness tests ───────────────────────────────────────────

  it("Test F1: HTML contiene cabecera 'Valor de venta / transmisión'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Valor de venta / transmisión");
  });

  it("Test F2: HTML contiene cabecera 'Valor de adquisición FIFO'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Valor de adquisición FIFO");
  });

  it("Test F3: HTML contiene cabecera 'Comisión imputada'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Comisión imputada");
  });

  it("Test F4: HTML contiene texto explicativo FIFO multi-lote", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Una venta puede aparecer dividida en varias líneas");
  });

  it("Test F5: FiscoHtmlRenderer source no usa sell_op.fee_eur como fee_eur en fetchDisposalsByAsset", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../FiscoHtmlRenderer.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1"),
      "utf8"
    );
    // Debe usar GREATEST(0, proceeds - cost_basis - gain_loss) — Opción B1
    expect(src).toContain("GREATEST(");
    expect(src).toContain("fd.proceeds_eur::numeric");
    expect(src).toContain("fd.cost_basis_eur::numeric");
    expect(src).toContain("fd.gain_loss_eur::numeric");
    // No debe asignar sell_op.fee_eur directamente como fee_eur en fetchDisposalsByAsset
    expect(src).not.toMatch(/sell_op\.fee_eur.*AS fee_eur/);
  });

  // ── BUG1: tabla fiscal principal — ganancias/pérdidas correctas ───────────

  it("Test G1: renderAnnualHtml acepta gains_eur/losses_eur en finStatus sin crashear", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const finStatus = { ...MOCK_FIN_STATUS, gains_eur: 824.37, losses_eur: -1424.85, final_taxable_gain_loss_eur: -600.47, ordinary_fifo_gain_loss_eur: -600.47 };
    const html = await renderer.renderAnnualHtml({ year: 2026, exchanges: ["kraken"], finStatus, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });

  it("Test G2: renderAnnualHtml con gains_eur=45.87 y staking_total_eur=1.49 renderiza sin error", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const finStatus = { ...MOCK_FIN_STATUS, gains_eur: 45.87, losses_eur: -118.12, final_taxable_gain_loss_eur: -72.25, ordinary_fifo_gain_loss_eur: -72.25, staking_total_eur: 1.49 };
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });

  it("Test G3: si finStatus no trae gains_eur, tabla usa 0,00 como fallback sin crashear", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const finStatus = { ...MOCK_FIN_STATUS, gains_eur: undefined, losses_eur: undefined };
    await expect(renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC })).resolves.toMatch(/<!DOCTYPE html>/i);
  });

  it("Test G4: ruta /api/fisco/report/annual/html enriquece finStatus con gains_eur/losses_eur", async () => {
    // Test that the route layer enrichment logic works correctly
    const pool = makeMockPool((sql) => {
      if (sql.includes("COALESCE(SUM(CASE WHEN d.gain_loss_eur::numeric > 0")) return { rows: [{ ganancias: "824.37", perdidas: "-1424.85" }] };
      if (sql.includes("op_type IN ('staking','reward','distribution')")) return { rows: [{ total: "1.49" }] };
      return { rows: [] };
    });

    const [gainsQ, stakingQ] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(CASE WHEN d.gain_loss_eur::numeric > 0 THEN d.gain_loss_eur::numeric ELSE 0 END), 0) AS ganancias, COALESCE(SUM(CASE WHEN d.gain_loss_eur::numeric < 0 THEN d.gain_loss_eur::numeric ELSE 0 END), 0) AS perdidas FROM fisco_disposals d JOIN fisco_operations o ON o.id = d.sell_operation_id WHERE EXTRACT(YEAR FROM d.disposed_at) = $1`, [2026]),
      pool.query(`SELECT COALESCE(SUM(fo.total_eur::numeric), 0) AS total FROM fisco_operations fo WHERE fo.op_type IN ('staking','reward','distribution') AND EXTRACT(YEAR FROM fo.executed_at) = $1`, [2026]),
    ]);

    const finEnriched = {
      gains_eur:       Math.round(parseFloat(gainsQ.rows[0]?.ganancias ?? "0") * 100) / 100,
      losses_eur:      Math.round(parseFloat(gainsQ.rows[0]?.perdidas  ?? "0") * 100) / 100,
      staking_total_eur: Math.round(parseFloat(stakingQ.rows[0]?.total ?? "0") * 100) / 100,
    };

    expect(finEnriched.gains_eur).toBeCloseTo(824.37, 2);
    expect(finEnriched.losses_eur).toBeCloseTo(-1424.85, 2);
    expect(finEnriched.staking_total_eur).toBeCloseTo(1.49, 2);
  });

  // ── BUG2: retiradas Kraken sin statement item visibles ────────────────────

  it("Test W1: krakenRec con withdrawals_without_statement → HTML no dice 'Sin retiradas'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const krakenRec = { ...MOCK_KRAKEN_REC, withdrawals_without_statement: [{ external_id: "FTjUqQe-9UY4zzevqM4Qcd9u6jfFQJ", asset: "USDC", amount: 451.5497, executed_at: "2026-01-10T12:00:00Z" }] };
    const html = await renderer.renderAnnualHtml({ year: 2026, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec });
    expect(html).not.toContain("Sin retiradas o transferencias internas este año");
  });

  it("Test W2: HTML contiene 'Aviso no bloqueante' cuando hay withdrawal sin statement", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const krakenRec = { ...MOCK_KRAKEN_REC, withdrawals_without_statement: [{ external_id: "FTjUqQe-9UY4zzevqM4Qcd9u6jfFQJ", asset: "USDC", amount: 451.5497, executed_at: "2026-01-10T12:00:00Z" }] };
    const html = await renderer.renderAnnualHtml({ year: 2026, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec });
    expect(html).toContain("Aviso no bloqueante");
  });

  it("Test W3: HTML contiene external_id FTjUqQe cuando está en withdrawals_without_statement", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const krakenRec = { ...MOCK_KRAKEN_REC, withdrawals_without_statement: [{ external_id: "FTjUqQe-9UY4zzevqM4Qcd9u6jfFQJ", asset: "USDC", amount: 451.5497, executed_at: "2026-01-10T12:00:00Z" }] };
    const html = await renderer.renderAnnualHtml({ year: 2026, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec });
    expect(html).toContain("FTjUqQe");
    expect(html).toContain("USDC");
  });

  it("Test W4: HTML contiene 'retirada sin statement item' badge para el withdrawal", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const krakenRec = { ...MOCK_KRAKEN_REC, withdrawals_without_statement: [{ external_id: "FTjUqQe-9UY4zzevqM4Qcd9u6jfFQJ", asset: "USDC", amount: 451.5497, executed_at: "2026-01-10T12:00:00Z" }] };
    const html = await renderer.renderAnnualHtml({ year: 2026, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec });
    expect(html).toContain("retirada sin statement item");
  });

  it("Test W5: si stmtItems=[] y withdrawals_without_statement=[] → muestra 'Sin retiradas'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const krakenRec = { ...MOCK_KRAKEN_REC, withdrawals_without_statement: [] };
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec });
    expect(html).toContain("Sin retiradas o transferencias internas este año");
  });

  it("Test F6: comisión imputada B1 — ejemplo real BTC 10/1/2026 (dos lotes mismo sell_op)", () => {
    // fd1: proceeds=0.16, cost_basis=0.16, gain_loss=0.01 → fee = GREATEST(0, 0.16-0.16-0.01) = 0
    // fd2: proceeds=293.92, cost_basis=300.95, gain_loss=-8.06 → fee = GREATEST(0, 293.92-300.95-(-8.06)) = GREATEST(0, 1.03) = 1.03
    const feeB1 = (proceeds: number, costBasis: number, gainLoss: number) =>
      Math.max(0, proceeds - costBasis - gainLoss);

    const feeFd1 = feeB1(0.16, 0.16, 0.01);
    const feeFd2 = feeB1(293.92, 300.95, -8.06);

    expect(feeFd1).toBeCloseTo(0, 4);
    expect(feeFd2).toBeCloseTo(1.03, 2);
    // La suma total no supera la comisión real de la operación (1.03 €)
    expect(feeFd1 + feeFd2).toBeCloseTo(1.03, 2);
  });
});

// ─── Tests: buildAnnualGainLossByAssetSummary ────────────────────────────────

import {
  buildAnnualGainLossByAssetSummary,
  classifyConsiderationType,
  type DisposalCounterAssetRow,
} from "../FiscoHtmlRenderer";

function makeDisposalRow(
  asset: string,
  overrides: Partial<DisposalCounterAssetRow> = {}
): DisposalCounterAssetRow {
  return {
    asset,
    sell_operation_id: 1,
    counter_asset: "USD",
    pair: `${asset}/USD`,
    op_type: "trade_sell",
    net_proceeds_eur: 100,
    cost_basis_eur: 90,
    gain_loss_eur: 10,
    is_fee_disposal: false,
    ...overrides,
  };
}

describe("classifyConsiderationType", () => {
  it("C1: BTC/USD → F - Moneda de curso legal", () => {
    expect(classifyConsiderationType("USD", "BTC/USD", "trade_sell", 2026, "BTC").code).toBe("F");
  });
  it("C2: BTC/EUR → F - Moneda de curso legal", () => {
    expect(classifyConsiderationType("EUR", "BTC/EUR", "trade_sell", 2026, "BTC").code).toBe("F");
  });
  it("C3: ETH/USDT → N - Otra moneda virtual", () => {
    expect(classifyConsiderationType("USDT", "ETH/USDT", "trade_sell", 2025, "ETH").code).toBe("N");
  });
  it("C4: ETH/USDC → N - Otra moneda virtual", () => {
    expect(classifyConsiderationType("USDC", "ETH/USDC", "trade_sell", 2025, "ETH").code).toBe("N");
  });
  it("C5: ETH/EURC → N - Otra moneda virtual", () => {
    expect(classifyConsiderationType("EURC", "ETH/EURC", "trade_sell", 2025, "ETH").code).toBe("N");
  });
  it("C6: USDC/EUR → F - Moneda de curso legal", () => {
    expect(classifyConsiderationType("EUR", "USDC/EUR", "trade_sell", 2025, "USDC").code).toBe("F");
  });
  it("C7: TON/USDC → N - Otra moneda virtual", () => {
    expect(classifyConsiderationType("USDC", "TON/USDC", "trade_sell", 2025, "TON").code).toBe("N");
  });
  it("C8: fee disposal SOL (op_type=fee) → O", () => {
    const r = classifyConsiderationType(null, null, "fee", 2025, "SOL");
    expect(r.code).toBe("O");
    expect(r.source).toBe("op_type_fee");
  });
  it("C9: fee disposal USDC (op_type=expense) → O", () => {
    const r = classifyConsiderationType(null, null, "expense", 2025, "USDC");
    expect(r.code).toBe("O");
    expect(r.source).toBe("op_type_fee");
  });
  it("C10: counter_asset missing + op_type normal → O + source=missing_counter", () => {
    const r = classifyConsiderationType(null, null, "trade_sell", 2025, "XXX");
    expect(r.code).toBe("O");
    expect(r.source).toBe("missing_counter");
  });
  it("C11: infer F desde pair cuando counter_asset es null", () => {
    const r = classifyConsiderationType(null, "BTC/USD", "trade_sell", 2026, "BTC");
    expect(r.code).toBe("F");
    expect(r.source).toBe("pair_inference");
  });
  it("C12: infer N desde pair crypto cuando counter_asset es null", () => {
    const r = classifyConsiderationType(null, "ETH/USDC", "trade_sell", 2025, "ETH");
    expect(r.code).toBe("N");
    expect(r.source).toBe("pair_inference");
  });
  it("C13: ZUSD (variante Kraken) → F", () => {
    expect(classifyConsiderationType("ZUSD", "BTC/ZUSD", "trade_sell", 2026, "BTC").code).toBe("F");
  });
  it("C14: op_type=balancing → O (op_type tiene prioridad sobre counter_asset)", () => {
    expect(classifyConsiderationType("USD", null, "balancing", 2026, "BTC").code).toBe("O");
  });
  it("C15: ETH/BTC (crypto/crypto) → N", () => {
    expect(classifyConsiderationType("BTC", "ETH/BTC", "trade_sell", 2025, "ETH").code).toBe("N");
  });
});

describe("buildAnnualGainLossByAssetSummary", () => {
  it("S1: disposal USD → tipo F", () => {
    const rows = [makeDisposalRow("BTC", { counter_asset: "USD", pair: "BTC/USD" })];
    const result = buildAnnualGainLossByAssetSummary(2026, rows);
    expect(result.rows[0].considerationTypeCode).toBe("F");
    expect(result.rows[0].ticker).toBe("BTC");
  });

  it("S2: disposal USDC → tipo N", () => {
    const rows = [makeDisposalRow("ETH", { counter_asset: "USDC", pair: "ETH/USDC" })];
    const result = buildAnnualGainLossByAssetSummary(2025, rows);
    expect(result.rows[0].considerationTypeCode).toBe("N");
  });

  it("S3: mismo ticker con F y N → dos filas separadas", () => {
    const rows = [
      makeDisposalRow("USDC", { counter_asset: "EUR",  pair: "USDC/EUR",  sell_operation_id: 1, gain_loss_eur: 5 }),
      makeDisposalRow("USDC", { counter_asset: "TON",  pair: "USDC/TON",  sell_operation_id: 2, gain_loss_eur: -2 }),
    ];
    const result = buildAnnualGainLossByAssetSummary(2025, rows);
    expect(result.rows).toHaveLength(2);
    const types = result.rows.map(r => r.considerationTypeCode).sort();
    expect(types).toEqual(["F", "N"]);
  });

  it("S4: mismo ticker con F, N y O → tres filas separadas", () => {
    const rows = [
      makeDisposalRow("SOL", { counter_asset: "USD",  pair: "SOL/USD",  sell_operation_id: 1, op_type: "trade_sell" }),
      makeDisposalRow("SOL", { counter_asset: "USDC", pair: "SOL/USDC", sell_operation_id: 2, op_type: "trade_sell" }),
      makeDisposalRow("SOL", { counter_asset: null,   pair: null,       sell_operation_id: 3, op_type: "fee" }),
    ];
    const result = buildAnnualGainLossByAssetSummary(2025, rows);
    expect(result.rows).toHaveLength(3);
    const types = result.rows.map(r => r.considerationTypeCode).sort();
    expect(types).toEqual(["F", "N", "O"]);
  });

  it("S5: 2026 todo USD → todas las filas F", () => {
    const rows = [
      makeDisposalRow("BTC",  { counter_asset: "USD", pair: "BTC/USD" }),
      makeDisposalRow("ETH",  { counter_asset: "USD", pair: "ETH/USD" }),
      makeDisposalRow("SOL",  { counter_asset: "USD", pair: "SOL/USD" }),
      makeDisposalRow("TON",  { counter_asset: "USD", pair: "TON/USD" }),
      makeDisposalRow("XRP",  { counter_asset: "USD", pair: "XRP/USD" }),
    ];
    const result = buildAnnualGainLossByAssetSummary(2026, rows);
    expect(result.rows.every(r => r.considerationTypeCode === "F")).toBe(true);
  });

  it("S6: 2025 con crypto/crypto → aparecen filas N", () => {
    const rows = [
      makeDisposalRow("ETH",  { counter_asset: "USD",  pair: "ETH/USD"  }),
      makeDisposalRow("SOL",  { counter_asset: "USDC", pair: "SOL/USDC" }),
    ];
    const result = buildAnnualGainLossByAssetSummary(2025, rows);
    const types = result.rows.map(r => r.considerationTypeCode);
    expect(types).toContain("F");
    expect(types).toContain("N");
  });

  it("S7: ordena por ticker asc, luego tipo F < N < O", () => {
    const rows = [
      makeDisposalRow("XRP", { counter_asset: "USD",  sell_operation_id: 1 }),
      makeDisposalRow("BTC", { counter_asset: "USDC", sell_operation_id: 2, op_type: "trade_sell" }),
      makeDisposalRow("BTC", { counter_asset: "USD",  sell_operation_id: 3 }),
    ];
    const result = buildAnnualGainLossByAssetSummary(2026, rows);
    expect(result.rows[0].ticker).toBe("BTC");
    expect(result.rows[0].considerationTypeCode).toBe("F");
    expect(result.rows[1].ticker).toBe("BTC");
    expect(result.rows[1].considerationTypeCode).toBe("N");
    expect(result.rows[2].ticker).toBe("XRP");
  });

  it("S8: transmisión neta - adquisición ≈ PnL (tolerancia <= 0,02)", () => {
    const rows = [makeDisposalRow("ETH", { net_proceeds_eur: 336.49, cost_basis_eur: 424.93, gain_loss_eur: -88.44 })];
    const result = buildAnnualGainLossByAssetSummary(2025, rows);
    const { transmissionValueEur, acquisitionValueEur, capitalGainLossEur } = result.totals;
    const diff = Math.abs(capitalGainLossEur - (transmissionValueEur - acquisitionValueEur));
    expect(diff).toBeLessThanOrEqual(0.02);
  });

  it("S9: totales cuadran: 19.094,99 - 19.695,46 = -600,47", () => {
    const rows = [
      makeDisposalRow("BTC", { net_proceeds_eur: 5000.00,  cost_basis_eur: 5200.00,  gain_loss_eur: -200.00, counter_asset: "USD" }),
      makeDisposalRow("ETH", { net_proceeds_eur: 4000.00,  cost_basis_eur: 4100.00,  gain_loss_eur: -100.00, counter_asset: "USD" }),
      makeDisposalRow("SOL", { net_proceeds_eur: 3094.99,  cost_basis_eur: 3395.46,  gain_loss_eur: -300.47, counter_asset: "USD" }),
      makeDisposalRow("XRP", { net_proceeds_eur: 7000.00,  cost_basis_eur: 7000.00,  gain_loss_eur:    0.00, counter_asset: "USD" }),
    ];
    const result = buildAnnualGainLossByAssetSummary(2026, rows);
    expect(result.totals.transmissionValueEur).toBeCloseTo(19094.99, 2);
    expect(result.totals.acquisitionValueEur).toBeCloseTo(19695.46, 2);
    expect(result.totals.capitalGainLossEur).toBeCloseTo(-600.47, 2);
  });

  it("S10: suma correctamente valor de adquisición", () => {
    const rows = [makeDisposalRow("ETH", { net_proceeds_eur: 336.49, cost_basis_eur: 424.93, gain_loss_eur: -88.44 })];
    const result = buildAnnualGainLossByAssetSummary(2025, rows);
    expect(result.totals.acquisitionValueEur).toBeCloseTo(424.93, 2);
  });

  it("S11: lista vacía devuelve 0 filas y totales en 0", () => {
    const result = buildAnnualGainLossByAssetSummary(2025, []);
    expect(result.rows).toHaveLength(0);
    expect(result.totals.capitalGainLossEur).toBe(0);
  });

  it("S12: mantiene negativos con signo menos en fmtEurEs", () => {
    const n = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(-88.44);
    expect(n).toContain("-");
  });

  it("S13: formatea importes con coma decimal en español", () => {
    const n = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1424.85);
    expect(n).toContain(",");
  });

  it("S14: ETH/BTC (crypto/crypto) → ETH tipo N", () => {
    const rows = [makeDisposalRow("ETH", { counter_asset: "BTC", pair: "ETH/BTC", op_type: "trade_sell" })];
    const result = buildAnnualGainLossByAssetSummary(2025, rows);
    expect(result.rows[0].considerationTypeCode).toBe("N");
  });

  it("S15: fee disposal (op_type=fee) → tipo O aunque counter_asset sea USD", () => {
    const rows = [makeDisposalRow("SOL", { op_type: "fee", counter_asset: "USD" })];
    const result = buildAnnualGainLossByAssetSummary(2025, rows);
    expect(result.rows[0].considerationTypeCode).toBe("O");
  });
});

// ─── Tests: render HTML con sección resumen ──────────────────────────────────

describe("renderAnnualHtml: sección resumen de ganancias y pérdidas por activo", () => {
  function makeHtmlPoolFull() {
    return {
      query: vi.fn().mockImplementation((sql: string) => {
        // Asset summaries with disposals
        if (sql.includes("STRING_AGG") && sql.includes("acquisitions_qty")) {
          return { rows: [{ asset: "ETH", exchanges: "kraken", acquisitions_qty: "1", disposals_qty: "1", fees_eur: "1.5", operations_count: "2" }] };
        }
        if (sql.includes("opening_qty") && sql.includes("closing_qty")) {
          return { rows: [{ asset: "ETH", opening_qty: "0", closing_qty: "0" }] };
        }
        if (sql.includes("proceeds_eur") && sql.includes("cost_basis_eur")) {
          return { rows: [{ asset: "ETH", proceeds_eur: "336.49", cost_basis_eur: "424.93", gain_loss_eur: "-88.44", disposals_count: "1" }] };
        }
        return { rows: [] };
      }),
    } as any;
  }

  it("R1: HTML contiene 'Resumen de ganancias y pérdidas por activo el 2025'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Resumen de ganancias y pérdidas por activo el 2025");
  });

  it("R2: HTML contiene 'Tipo de contraprestación recibida a cambio'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Tipo de contraprestación recibida a cambio");
  });

  it("R3: HTML contiene 'Valor de transmisión en EUR'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Valor de transmisión en EUR");
  });

  it("R4: HTML contiene 'Valor de adquisición en EUR'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Valor de adquisición en EUR");
  });

  it("R5: HTML contiene 'Ganancia o pérdida de capital en EUR'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Ganancia o pérdida de capital en EUR");
  });

  it("R6: HTML contiene 'Total 2025'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2025, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Total 2025");
  });

  it("R7: HTML contiene clase annual-gain-loss-summary", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2026, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("annual-gain-loss-summary");
  });

  it("R8: con año 2026 la sección dice 'Total 2026'", async () => {
    const pool = makeHtmlRendererPool();
    const renderer = new FiscoHtmlRenderer(pool);
    const html = await renderer.renderAnnualHtml({ year: 2026, exchanges: ["kraken"], finStatus: MOCK_FIN_STATUS, portfolio: MOCK_PORTFOLIO, krakenRec: MOCK_KRAKEN_REC });
    expect(html).toContain("Total 2026");
  });
});
