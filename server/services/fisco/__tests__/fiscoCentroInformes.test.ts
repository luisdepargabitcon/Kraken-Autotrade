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

  it("Test 5: includeExchangeBreakdown=true produce scope=exchange entries", async () => {
    const pool = makeMultiYearPool();
    const svc  = new MultiYearReportService(pool);
    const r    = await svc.generate({ years: [2025], exchanges: ["kraken", "revolutx"], includeGlobal: false, includeExchangeBreakdown: true });

    const exchangeReports = r.reports.filter(rep => rep.scope === "exchange");
    expect(exchangeReports.length).toBeGreaterThanOrEqual(1);
    expect(exchangeReports.some(rep => rep.exchange === "kraken")).toBe(true);
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
