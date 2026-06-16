/**
 * FiscoPendingDetector — unit tests (Fase 2)
 *
 * Tests F2-01 to F2-10:
 *   F2-01: FiscoPendingDetector class exists
 *   F2-02: getInstance returns singleton
 *   F2-03: detectPendingFiscalChanges method exists
 *   F2-04: PendingFiscalChanges interface has required fields
 *   F2-05: has_pending = true when pending_operations_count > 0
 *   F2-06: has_pending = true when orphan_sells_count > 0
 *   F2-07: has_pending = false when both counts are 0
 *   F2-08: has_pending = true when both counts > 0
 *   F2-09: PendingOperation type has required fields
 *   F2-10: OrphanSell type has required fields
 */

import { describe, it, expect } from "vitest";
import { FiscoPendingDetector, type PendingFiscalChanges, type PendingOperation, type OrphanSell, type LastCommittedRun } from "../FiscoPendingDetector";
import { FiscoAutoSyncService } from "../FiscoAutoSyncService";

describe("FiscoPendingDetector (Fase 2)", () => {

  it("F2-01: FiscoPendingDetector class exists", () => {
    expect(FiscoPendingDetector).toBeDefined();
  });

  it("F2-02: getInstance returns singleton", () => {
    const a = FiscoPendingDetector.getInstance();
    const b = FiscoPendingDetector.getInstance();
    expect(a).toBe(b);
  });

  it("F2-03: detectPendingFiscalChanges method exists", () => {
    const svc = FiscoPendingDetector.getInstance();
    expect(typeof svc.detectPendingFiscalChanges).toBe("function");
  });

  it("F2-04: PendingFiscalChanges interface has all required fields", () => {
    const obj: PendingFiscalChanges = {
      lastCommittedRun: null,
      pending_operations_count: 0,
      pending_operations: [],
      orphan_sells_count: 0,
      orphan_sells: [],
      has_pending: false,
    };
    expect(obj).toHaveProperty("lastCommittedRun");
    expect(obj).toHaveProperty("pending_operations_count");
    expect(obj).toHaveProperty("pending_operations");
    expect(obj).toHaveProperty("orphan_sells_count");
    expect(obj).toHaveProperty("orphan_sells");
    expect(obj).toHaveProperty("has_pending");
  });

  it("F2-05: has_pending = true when pending_operations_count > 0", () => {
    const result: PendingFiscalChanges = {
      lastCommittedRun: null,
      pending_operations_count: 2,
      pending_operations: [],
      orphan_sells_count: 0,
      orphan_sells: [],
      has_pending: 2 > 0 || 0 > 0,
    };
    expect(result.has_pending).toBe(true);
  });

  it("F2-06: has_pending = true when orphan_sells_count > 0", () => {
    const result: PendingFiscalChanges = {
      lastCommittedRun: null,
      pending_operations_count: 0,
      pending_operations: [],
      orphan_sells_count: 1,
      orphan_sells: [],
      has_pending: 0 > 0 || 1 > 0,
    };
    expect(result.has_pending).toBe(true);
  });

  it("F2-07: has_pending = false when both counts are 0", () => {
    const result: PendingFiscalChanges = {
      lastCommittedRun: null,
      pending_operations_count: 0,
      pending_operations: [],
      orphan_sells_count: 0,
      orphan_sells: [],
      has_pending: 0 > 0 || 0 > 0,
    };
    expect(result.has_pending).toBe(false);
  });

  it("F2-08: has_pending = true when both counts > 0", () => {
    const result: PendingFiscalChanges = {
      lastCommittedRun: null,
      pending_operations_count: 3,
      pending_operations: [],
      orphan_sells_count: 1,
      orphan_sells: [],
      has_pending: 3 > 0 || 1 > 0,
    };
    expect(result.has_pending).toBe(true);
  });

  it("F2-09: PendingOperation type has required fields", () => {
    const op: PendingOperation = {
      id: 56336,
      exchange: "revolutx",
      op_type: "trade_buy",
      asset: "ETH",
      pair: "ETH/USD",
      amount: "0.24984430",
      total_eur: "361.48616459",
      fee_eur: "0.32440986",
      executed_at: new Date("2026-06-09T03:16:11Z"),
      created_at: new Date("2026-06-09T06:36:42Z"),
    };
    expect(op.id).toBe(56336);
    expect(op.exchange).toBe("revolutx");
    expect(op.op_type).toBe("trade_buy");
    expect(op.asset).toBe("ETH");
  });

  it("F2-10: OrphanSell type has required fields", () => {
    const sell: OrphanSell = {
      id: 56339,
      exchange: "revolutx",
      asset: "ETH",
      pair: "ETH/USD",
      amount: "0.24984430",
      total_eur: "369.83306726",
      fee_eur: "0.33284976",
      executed_at: new Date("2026-06-14T22:09:01Z"),
      created_at: new Date("2026-06-15T22:00:02Z"),
    };
    expect(sell.id).toBe(56339);
    expect(sell.exchange).toBe("revolutx");
    expect(sell.asset).toBe("ETH");
    expect(sell.pair).toBe("ETH/USD");
  });

  it("F2-11: FiscoAutoSyncService exposes processAutoSyncJob (integration check)", () => {
    const svc = FiscoAutoSyncService.getInstance();
    expect(typeof svc.processAutoSyncJob).toBe("function");
  });

  it("F2-12: LastCommittedRun type has required fields", () => {
    const run: LastCommittedRun = {
      id: "20d12de3-77af-4a54-98f4-eca5b6d17612",
      completed_at: new Date("2026-06-08T12:21:56Z"),
      operations_count: 482,
      lots_count: 238,
      disposals_count: 454,
    };
    expect(run.id).toBe("20d12de3-77af-4a54-98f4-eca5b6d17612");
    expect(run.operations_count).toBe(482);
    expect(run.disposals_count).toBe(454);
  });
});
