/**
 * Tests for AMA Functional Closure Services — R2.22-R2.31
 * amaRealStateService, amaSchedulerStateService, amaHwmBootstrapService
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "../../../db";
import {
  amaRealStateService,
  amaSchedulerStateService,
  amaHwmBootstrapService,
} from "../amaFunctionalClosure";

function mockRow(overrides: Record<string, unknown> = {}) {
  return {
    rows: [{
      operational_state: "NOT_READY",
      previous_state: null,
      transition_reason: null,
      transitioned_at: null,
      transitioned_by: null,
      requires_manual_resume: false,
      auto_block_reason: null,
      kill_switch_active: false,
      kill_switch_reason: null,
      kill_switch_at: null,
      updated_at: new Date().toISOString(),
      ...overrides,
    }],
  };
}

describe("AmaRealStateService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getState returns current real state", async () => {
    vi.mocked(pool.query).mockResolvedValue(mockRow({ operational_state: "ARMED" }) as any);
    const state = await amaRealStateService.getState();
    expect(state.operationalState).toBe("ARMED");
  });

  it("transition updates state and preserves previous", async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce(mockRow({ operational_state: "ARMED" }) as any) // getState
      .mockResolvedValueOnce(mockRow({ operational_state: "ACTIVE", previous_state: "ARMED" }) as any); // UPDATE RETURNING

    const result = await amaRealStateService.transition("ACTIVE", "User activated");
    expect(result.operationalState).toBe("ACTIVE");
    expect(result.previousState).toBe("ARMED");
  });

  it("activateKillSwitch sets KILL_SWITCHED and requires_manual_resume", async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce(mockRow({ operational_state: "ACTIVE" }) as any)
      .mockResolvedValueOnce(mockRow({
        operational_state: "KILL_SWITCHED",
        kill_switch_active: true,
        requires_manual_resume: true,
        kill_switch_reason: "Manual kill",
      }) as any);

    const result = await amaRealStateService.activateKillSwitch("Manual kill");
    expect(result.operationalState).toBe("KILL_SWITCHED");
    expect(result.killSwitchActive).toBe(true);
    expect(result.requiresManualResume).toBe(true);
  });

  it("canExecute returns true only when ACTIVE and no kill switch", async () => {
    vi.mocked(pool.query).mockResolvedValue(mockRow({
      operational_state: "ACTIVE",
      kill_switch_active: false,
    }) as any);
    expect(await amaRealStateService.canExecute()).toBe(true);

    vi.mocked(pool.query).mockResolvedValue(mockRow({
      operational_state: "ACTIVE",
      kill_switch_active: true,
    }) as any);
    expect(await amaRealStateService.canExecute()).toBe(false);

    vi.mocked(pool.query).mockResolvedValue(mockRow({
      operational_state: "ARMED",
      kill_switch_active: false,
    }) as any);
    expect(await amaRealStateService.canExecute()).toBe(false);
  });
});

describe("AmaSchedulerStateService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getState returns scheduler state", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{
        current_mode: "AMA",
        last_tick_at: null,
        last_cycle_id: null,
        tick_count: "5",
        error_count: "0",
        last_error: null,
        advisory_lock_held: false,
        updated_at: new Date().toISOString(),
      }],
    } as any);
    const state = await amaSchedulerStateService.getState();
    expect(state.currentMode).toBe("AMA");
    expect(state.tickCount).toBe(5);
  });

  it("recordTick increments tick count", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);
    await amaSchedulerStateService.recordTick("cycle-1");
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("tick_count = tick_count + 1"),
      ["cycle-1"],
    );
  });

  it("acquireAdvisoryLock returns true when lock acquired", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ id: 1 }] } as any);
    const acquired = await amaSchedulerStateService.acquireAdvisoryLock();
    expect(acquired).toBe(true);
  });

  it("acquireAdvisoryLock returns false when already held", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);
    const acquired = await amaSchedulerStateService.acquireAdvisoryLock();
    expect(acquired).toBe(false);
  });
});

describe("AmaHwmBootstrapService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getState returns bootstrap state", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{
        pair: "BTC/USD",
        hwm: "120000",
        hwm_timestamp: "2025-01-01T00:00:00Z",
        bootstrap_status: "COMPLETED",
        data_coverage_pct: "100",
        candles_processed: "1000",
        candles_total: "1000",
        error_message: null,
        updated_at: new Date().toISOString(),
      }],
    } as any);
    const state = await amaHwmBootstrapService.getState();
    expect(state.bootstrapStatus).toBe("COMPLETED");
    expect(state.hwm).toBe(120000);
  });

  it("isReady returns true when COMPLETED with hwm", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{
        pair: "BTC/USD",
        hwm: "120000",
        hwm_timestamp: "2025-01-01T00:00:00Z",
        bootstrap_status: "COMPLETED",
        data_coverage_pct: "100",
        candles_processed: "1000",
        candles_total: "1000",
        error_message: null,
        updated_at: new Date().toISOString(),
      }],
    } as any);
    expect(await amaHwmBootstrapService.isReady()).toBe(true);
  });

  it("isReady returns false when PENDING", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{
        pair: "BTC/USD",
        hwm: null,
        hwm_timestamp: null,
        bootstrap_status: "PENDING",
        data_coverage_pct: "0",
        candles_processed: "0",
        candles_total: "1000",
        error_message: null,
        updated_at: new Date().toISOString(),
      }],
    } as any);
    expect(await amaHwmBootstrapService.isReady()).toBe(false);
  });

  it("startBootstrap sets IN_PROGRESS", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);
    await amaHwmBootstrapService.startBootstrap("BTC/USD", 1000);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("IN_PROGRESS"),
      ["BTC/USD", 1000],
    );
  });

  it("failBootstrap sets FAILED with error", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);
    await amaHwmBootstrapService.failBootstrap("Connection timeout");
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("FAILED"),
      ["Connection timeout"],
    );
  });
});
