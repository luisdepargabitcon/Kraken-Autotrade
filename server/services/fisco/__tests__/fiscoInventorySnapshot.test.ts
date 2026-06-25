/**
 * FiscoInventorySnapshotService — Tests
 *
 * Valida que el cálculo de inventario a cierre de año es correcto:
 *   closingQtyAsOfYearEnd = opening + acquiredInYear - disposedInYear
 *
 * Casos obligatorios del Lote 1:
 *  1. Lote comprado en 2025 y vendido parcialmente en 2025 → closing descuenta venta 2025
 *  2. Lote comprado en 2025 y vendido en 2026 → closing_2025 lo mantiene íntegro
 *  3. Lote comprado en 2026 → NO aparece en inventario 2025 (closingQty de ese asset = 0 o NO_DATA)
 *  4. Sin operaciones → NO_DATA
 *  5. Dust: closing > 0 pero < threshold → status DUST
 *  6. NEGATIVE: disposals > opening+acquired → status NEGATIVE
 *  7. Balance Check detecta reward sin precio
 *  8. Balance Check detecta deposit sin cost basis
 *  9. Balance Check detecta withdrawal sin transfer_link (suspected transfer)
 * 10. Balance Check detecta sell sin cost_basis
 * 11. currentVsYearEndDiff correcto cuando remaining difiere (venta en 2026)
 */

import { describe, it, expect, vi } from "vitest";
import { FiscoInventorySnapshotService } from "../FiscoInventorySnapshotService";
import type { Pool } from "pg";

// ─── Mock factory ─────────────────────────────────────────────────────────────

type QueryFn = (sql: string, params?: any[]) => { rows: any[] };

function makeMockPool(handler: QueryFn): Pool {
  return {
    query: vi.fn(async (sql: string, params?: any[]) => handler(sql, params)),
  } as unknown as Pool;
}

// ─── SQL matchers ─────────────────────────────────────────────────────────────

const isOpeningLots      = (sql: string) => sql.includes("fisco_lots") && sql.includes("fo.executed_at < $1") && !sql.includes(">=");
const isOpeningDisposals = (sql: string) => sql.includes("fisco_disposals") && sql.includes("fd.disposed_at < $1") && !sql.includes(">=");
const isAcquiredInYear   = (sql: string) => sql.includes("fisco_lots") && sql.includes("fo.executed_at >= $1");
const isDisposedInYear   = (sql: string) => sql.includes("fisco_disposals") && sql.includes("fd.disposed_at >= $1") && sql.includes("fd.disposed_at <  $2") && !sql.includes("cost_basis_eur::numeric = 0");
const isRemaining        = (sql: string) => sql.includes("remaining_qty") && !sql.includes("disposed_at") && !sql.includes("executed_at <") && !sql.includes("executed_at >=");
const isRewardsNoPrice   = (sql: string) => sql.includes("staking") && sql.includes("price_eur IS NULL");
const isDepositNoCost    = (sql: string) => sql.includes("op_type = 'deposit'") && sql.includes("total_eur IS NULL");
const isSellNoCost       = (sql: string) => sql.includes("cost_basis_eur::numeric = 0") && sql.includes("proceeds_eur") && sql.includes("proceeds_eur::numeric > 0");
const isUnlinkedWithdraw = (sql: string) => sql.includes("withdrawal") && sql.includes("fisco_transfer_links") && sql.includes("NOT EXISTS");
const isCryptoFees       = (sql: string) => sql.includes("fee_eur") && sql.includes("HAVING COUNT");
const isDustQ            = (sql: string) => sql.includes("remaining_qty::numeric > 0") && sql.includes("HAVING SUM");

// ─── Helper: build a pool for a scenario ─────────────────────────────────────

interface ScenarioData {
  openingLotsRows?: any[];
  openingDispRows?: any[];
  acquiredRows?:    any[];
  disposedRows?:    any[];
  remainingRows?:   any[];
  rewardsNoPriceRows?: any[];
  depositNoCostRows?:  any[];
  sellNoCostRows?:     any[];
  unlinkedWithdrawRows?: any[];
}

function makeScenarioPool(data: ScenarioData): Pool {
  return makeMockPool((sql) => {
    if (isOpeningLots(sql))      return { rows: data.openingLotsRows      ?? [] };
    if (isOpeningDisposals(sql)) return { rows: data.openingDispRows      ?? [] };
    if (isAcquiredInYear(sql))   return { rows: data.acquiredRows         ?? [] };
    if (isDisposedInYear(sql))   return { rows: data.disposedRows         ?? [] };
    if (isRemaining(sql))        return { rows: data.remainingRows        ?? [] };
    if (isRewardsNoPrice(sql))   return { rows: data.rewardsNoPriceRows   ?? [] };
    if (isDepositNoCost(sql))    return { rows: data.depositNoCostRows    ?? [] };
    // isSellNoCost: has cost_basis_eur::numeric = 0 which isDisposedInYear does NOT have,
    // so if this matcher is true it must be the balance-check query (not the inventory query)
    if (isSellNoCost(sql))       return { rows: data.sellNoCostRows       ?? [] };
    if (isUnlinkedWithdraw(sql)) return { rows: data.unlinkedWithdrawRows ?? [] };
    if (isCryptoFees(sql))       return { rows: [] };
    if (isDustQ(sql))            return { rows: [] };
    return { rows: [] };
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FiscoInventorySnapshotService — cálculo closing_qty correcto", () => {

  it("SNAP-01: lote comprado en 2025 y vendido parcialmente en 2025 → closing descuenta venta 2025", async () => {
    // BTC: comprado 1.0 en 2025, vendido 0.4 en 2025
    // opening=0, acq=1.0, disp=0.4 → closing=0.6
    const pool = makeScenarioPool({
      openingLotsRows: [],
      openingDispRows: [],
      acquiredRows: [{ asset: "BTC", exchanges: ["kraken"], qty: "1.0", cost_eur: "50000" }],
      disposedRows: [{ asset: "BTC", qty: "0.4", cost_eur: "20000", proceeds_eur: "22000", gain_loss_eur: "2000" }],
      remainingRows: [{ asset: "BTC", qty: "0.6" }],
    });
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    const btc = result.rows.find(r => r.asset === "BTC")!;
    expect(btc).toBeDefined();
    expect(btc.openingQty).toBe(0);
    expect(btc.acquiredQtyInYear).toBeCloseTo(1.0, 6);
    expect(btc.disposedQtyInYear).toBeCloseTo(0.4, 6);
    expect(btc.closingQtyAsOfYearEnd).toBeCloseTo(0.6, 6);
    expect(btc.status).toBe("OK");
    expect(btc.gainLossEurInYear).toBeCloseTo(2000, 2);
  });

  it("SNAP-02: lote comprado en 2025 y vendido en 2026 → closing_2025 lo mantiene íntegro", async () => {
    // BTC: comprado 1.0 en 2025, no vendido en 2025 (disposal en 2026 no aparece)
    // opening=0, acq=1.0, disp=0 → closing=1.0
    // remaining actual=0 (se vendió en 2026) → diff=-1.0 → NEEDS_REVIEW
    const pool = makeScenarioPool({
      openingLotsRows: [],
      openingDispRows: [],
      acquiredRows: [{ asset: "BTC", exchanges: ["kraken"], qty: "1.0", cost_eur: "50000" }],
      disposedRows: [],  // no hay disposals EN 2025
      remainingRows: [{ asset: "BTC", qty: "0.0" }],  // se vendió en 2026
    });
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    const btc = result.rows.find(r => r.asset === "BTC")!;
    expect(btc.closingQtyAsOfYearEnd).toBeCloseTo(1.0, 6);  // closing 2025 = 1.0 (aún no vendido)
    expect(btc.currentRemainingQty).toBeCloseTo(0.0, 6);    // hoy = 0 (ya vendido en 2026)
    expect(btc.currentVsYearEndDiff).toBeCloseTo(-1.0, 6);  // diff negativa: vendido en año posterior
    // NEEDS_REVIEW porque diff > dust*100
    expect(btc.status).toBe("NEEDS_REVIEW");
    expect(btc.warnings.some(w => w.includes("años posteriores"))).toBe(true);
  });

  it("SNAP-03: lote comprado en 2026 → NO aparece en inventario 2025 (acq=0 para ese asset)", async () => {
    // SOL: comprado en 2026 — no está en acquired (query filtra por ejecutado < 2026-01-01)
    // Para el año 2025: opening=0, acq=0, disp=0 → closing=0 → NO_DATA o no aparece
    const pool = makeScenarioPool({
      openingLotsRows: [],
      openingDispRows: [],
      acquiredRows: [],   // SOL comprado en 2026 no aparece aquí
      disposedRows: [],
      remainingRows: [{ asset: "SOL", qty: "10.0" }],  // remaining global sí existe
    });
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    // SOL aparece porque tiene remaining, pero closing_2025 debe ser 0
    const sol = result.rows.find(r => r.asset === "SOL");
    if (sol) {
      expect(sol.closingQtyAsOfYearEnd).toBeCloseTo(0, 6);
    }
    // Si no aparece (filtrado como NO_DATA), también es correcto
    // La restricción es: no debe mostrar closing > 0 para SOL en 2025
  });

  it("SNAP-04: sin operaciones para un activo → status NO_DATA", async () => {
    const pool = makeScenarioPool({});
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);
    // Sin datos: la lista debe estar vacía o todos NO_DATA
    const nonFiat = result.rows.filter(r => !["EUR","USD","GBP"].includes(r.asset));
    expect(nonFiat.every(r => r.status === "NO_DATA" || r.closingQtyAsOfYearEnd === 0)).toBe(true);
  });

  it("SNAP-05: saldo muy pequeño → status DUST con warning", async () => {
    // BTC con 0.000001 restante (dust threshold = 0.00001)
    const pool = makeScenarioPool({
      acquiredRows: [{ asset: "BTC", exchanges: ["kraken"], qty: "0.000003", cost_eur: "0.15" }],
      disposedRows: [{ asset: "BTC", qty: "0.000002", cost_eur: "0.10", proceeds_eur: "0.11", gain_loss_eur: "0.01" }],
      remainingRows: [{ asset: "BTC", qty: "0.000001" }],
    });
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    const btc = result.rows.find(r => r.asset === "BTC")!;
    expect(btc.status).toBe("DUST");
    expect(btc.warnings.some(w => w.toLowerCase().includes("dust") || w.toLowerCase().includes("residual"))).toBe(true);
  });

  it("SNAP-06: disposals > opening+acquired → closing negativo → status NEGATIVE", async () => {
    // BTC: opening=0, acq=1.0, disposed=1.5 → closing=-0.5 → error FIFO estructural
    const pool = makeScenarioPool({
      acquiredRows: [{ asset: "BTC", exchanges: ["kraken"], qty: "1.0", cost_eur: "50000" }],
      disposedRows: [{ asset: "BTC", qty: "1.5", cost_eur: "75000", proceeds_eur: "80000", gain_loss_eur: "5000" }],
      remainingRows: [],
    });
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    const btc = result.rows.find(r => r.asset === "BTC")!;
    expect(btc.closingQtyAsOfYearEnd).toBeCloseTo(-0.5, 4);
    expect(btc.status).toBe("NEGATIVE");
    expect(btc.warnings.some(w => w.includes("negativo") || w.includes("FIFO"))).toBe(true);
  });

  it("SNAP-07: currentVsYearEndDiff correcto cuando remaining difiere de year-end", async () => {
    // ETH: closing_2025=5.0, remaining_hoy=3.0 (vendió 2 en 2026) → diff=-2.0
    const pool = makeScenarioPool({
      acquiredRows: [{ asset: "ETH", exchanges: ["kraken"], qty: "5.0", cost_eur: "10000" }],
      disposedRows: [],
      remainingRows: [{ asset: "ETH", qty: "3.0" }],
    });
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    const eth = result.rows.find(r => r.asset === "ETH")!;
    expect(eth.closingQtyAsOfYearEnd).toBeCloseTo(5.0, 4);
    expect(eth.currentRemainingQty).toBeCloseTo(3.0, 4);
    expect(eth.currentVsYearEndDiff).toBeCloseTo(-2.0, 4);
  });

});

// ─── Balance Check tests ───────────────────────────────────────────────────────

describe("FiscoInventorySnapshotService — Balance Check", () => {

  it("BC-01: detecta reward/staking sin precio EUR", async () => {
    const pool = makeScenarioPool({
      rewardsNoPriceRows: [{ asset: "FLR", cnt: "3", total_amount: "150.5" }],
    });
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    expect(result.balanceCheck.rewards_without_price).toHaveLength(1);
    expect(result.balanceCheck.rewards_without_price[0].asset).toBe("FLR");
    expect(result.balanceCheck.rewards_without_price[0].count).toBe(3);

    const issue = result.balanceCheck.issues.find(i => i.code === "REWARD_WITHOUT_PRICE");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("WARNING");
    expect(result.balanceCheck.overallStatus).toBe("WARNINGS");
  });

  it("BC-02: detecta deposit sin cost basis", async () => {
    const pool = makeScenarioPool({
      depositNoCostRows: [{ asset: "BTC", exchange: "kraken", cnt: "1", total_amount: "0.5" }],
    });
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    expect(result.balanceCheck.deposits_without_cost).toHaveLength(1);
    const issue = result.balanceCheck.issues.find(i => i.code === "DEPOSIT_WITHOUT_COST");
    expect(issue).toBeDefined();
    expect(issue!.asset).toBe("BTC");
    expect(issue!.severity).toBe("WARNING");
  });

  it("BC-03: detecta sell sin cost_basis → CRITICAL", async () => {
    const pool = makeScenarioPool({
      sellNoCostRows: [{ asset: "ETH", cnt: "2", total_proceeds: "3000", total_proceeds_eur: "3000" }],
    });
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    expect(result.balanceCheck.sells_without_cost_basis).toHaveLength(1);
    const issue = result.balanceCheck.issues.find(i => i.code === "SELL_WITHOUT_COST_BASIS");
    expect(issue!.severity).toBe("CRITICAL");
    expect(issue!.estimatedImpactEur).toBeCloseTo(3000, 2);
    expect(result.balanceCheck.overallStatus).toBe("CRITICAL");
  });

  it("BC-04: detecta withdrawal sin transfer_link (suspected duplicate transfer)", async () => {
    const pool = makeScenarioPool({
      unlinkedWithdrawRows: [
        { asset: "USDC", from_exchange: "revolutx", cnt: "1", total_amount: "360" },
      ],
    });
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    expect(result.balanceCheck.suspected_duplicate_transfers).toHaveLength(1);
    const t = result.balanceCheck.suspected_duplicate_transfers[0];
    expect(t.asset).toBe("USDC");
    expect(t.from_exchange).toBe("revolutx");

    const issue = result.balanceCheck.issues.find(i => i.code === "UNLINKED_WITHDRAWAL");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("WARNING");
  });

  it("BC-05: sin problemas → overallStatus OK", async () => {
    const pool = makeScenarioPool({});
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    expect(result.balanceCheck.issues).toHaveLength(0);
    expect(result.balanceCheck.overallStatus).toBe("OK");
  });

});

// ─── Structural tests ──────────────────────────────────────────────────────────

describe("FiscoInventorySnapshotService — estructura de respuesta", () => {

  it("STRUCT-01: resultado incluye summary, rows, balanceCheck y generatedAt", async () => {
    const pool = makeScenarioPool({});
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    expect(result.year).toBe(2025);
    expect(result.generatedAt).toBeTruthy();
    expect(result.rows).toBeInstanceOf(Array);
    expect(result.balanceCheck).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalClosingValueEur).toBe("number");
    expect(typeof result.summary.totalGainLossEurInYear).toBe("number");
  });

  it("STRUCT-02: cost basis a cierre de año calculado correctamente", async () => {
    // BTC: opening_cost=30000 (1 BTC de 2024), acq_cost=50000 (1 BTC en 2025),
    //      disposed_cost=30000 (1 BTC vendido en 2025 — FIFO usa el más antiguo)
    // closing_cost = 30000 + 50000 - 30000 = 50000 (1 BTC queda, valorado a coste 2025)
    const pool = makeScenarioPool({
      openingLotsRows: [{ asset: "BTC", qty: "1.0", cost_eur: "30000" }],
      openingDispRows: [],
      acquiredRows: [{ asset: "BTC", exchanges: ["kraken"], qty: "1.0", cost_eur: "50000" }],
      disposedRows: [{ asset: "BTC", qty: "1.0", cost_eur: "30000", proceeds_eur: "35000", gain_loss_eur: "5000" }],
      remainingRows: [{ asset: "BTC", qty: "1.0" }],
    });
    const svc = new FiscoInventorySnapshotService(pool);
    const result = await svc.getInventorySnapshot(2025);

    const btc = result.rows.find(r => r.asset === "BTC")!;
    expect(btc.openingQty).toBeCloseTo(1.0, 4);
    expect(btc.acquiredQtyInYear).toBeCloseTo(1.0, 4);
    expect(btc.disposedQtyInYear).toBeCloseTo(1.0, 4);
    expect(btc.closingQtyAsOfYearEnd).toBeCloseTo(1.0, 4);
    expect(btc.closingCostBasisEurAsOfYearEnd).toBeCloseTo(50000, 2);
    expect(btc.closingUnitCostEurAsOfYearEnd).toBeCloseTo(50000, 2);
  });

});
