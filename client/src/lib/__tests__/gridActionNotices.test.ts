import { describe, it, expect } from "vitest";
import {
  buildGridActionNotices,
  noticeIsBlocking,
  noticesByTab,
} from "../gridActionNotices";

const baseStatus = {
  mode: "SHADOW",
  activeRangeVersionId: "range-active",
  realOpenOrdersCount: 0,
  pumpDumpState: "normal",
  circuitBreakerOpen: false,
  lastReconciliationOk: true,
};

const baseAudit = {
  range: { rangeLifecycleStatus: "reusable" },
  levelsSummary: {},
};

const activeLevel = { id: "l1", status: "planned", rangeVersionId: "range-active" };
const historicalLevel = { id: "l2", status: "replaced", rangeVersionId: "range-old" };

describe("buildGridActionNotices", () => {
  it("generates SHADOW notice when mode is SHADOW", () => {
    const notices = buildGridActionNotices(baseStatus, baseAudit, [activeLevel], []);
    const shadow = notices.find(n => n.id === "shadow_mode");
    expect(shadow).toBeDefined();
    expect(shadow!.severity).toBe("shadow");
  });

  it("generates historical_levels notice when there are historical levels", () => {
    const notices = buildGridActionNotices(baseStatus, baseAudit, [activeLevel, historicalLevel], []);
    const hist = notices.find(n => n.id === "historical_levels");
    expect(hist).toBeDefined();
    expect(hist!.targetTab).toBe("niveles");
  });

  it("does NOT generate historical_levels when all levels are in active range", () => {
    const notices = buildGridActionNotices(baseStatus, baseAudit, [activeLevel], []);
    const hist = notices.find(n => n.id === "historical_levels");
    expect(hist).toBeUndefined();
  });

  it("generates pump_dump_guard notice when pump detected", () => {
    const status = { ...baseStatus, pumpDumpState: "pump_detected" };
    const notices = buildGridActionNotices(status, baseAudit, [], []);
    const pump = notices.find(n => n.id === "pump_dump_guard");
    expect(pump).toBeDefined();
    expect(pump!.severity).toBe("warning");
  });

  it("generates circuit_breaker notice when open", () => {
    const status = { ...baseStatus, circuitBreakerOpen: true };
    const notices = buildGridActionNotices(status, baseAudit, [], []);
    const cb = notices.find(n => n.id === "circuit_breaker");
    expect(cb).toBeDefined();
    expect(cb!.severity).toBe("error");
  });

  it("generates reconciliation_pending when lastReconciliationOk is false", () => {
    const status = { ...baseStatus, lastReconciliationOk: false };
    const notices = buildGridActionNotices(status, baseAudit, [], []);
    const rec = notices.find(n => n.id === "reconciliation_pending");
    expect(rec).toBeDefined();
  });

  it("SHADOW notice opens detail with ctaLabel", () => {
    const notices = buildGridActionNotices(baseStatus, baseAudit, [], []);
    const shadow = notices.find(n => n.id === "shadow_mode");
    expect(shadow?.ctaLabel).toBeTruthy();
  });

  it("historical notice points to niveles tab", () => {
    const notices = buildGridActionNotices(baseStatus, baseAudit, [historicalLevel], []);
    const hist = notices.find(n => n.id === "historical_levels");
    expect(hist?.targetTab).toBe("niveles");
  });

  it("objective_net notice points to ajustes and field", () => {
    const audit = {
      ...baseAudit,
      levelsSummary: { proximityWarning: { avgGapPct: 0.5 } },
    };
    const notices = buildGridActionNotices(baseStatus, audit, [], []);
    const prox = notices.find(n => n.id === "proximity_warning");
    expect(prox?.targetField).toBe("netProfitTargetPct");
  });

  it("ir al ajuste does not auto-save config (no apply side effect)", () => {
    const audit = {
      ...baseAudit,
      levelsSummary: { proximityWarning: { avgGapPct: 0.5 } },
    };
    const notices = buildGridActionNotices(baseStatus, audit, [], []);
    const prox = notices.find(n => n.id === "proximity_warning");
    expect(prox?.recommendedAction).not.toContain("guarda");
    expect(prox?.recommendedAction).not.toContain("activa");
  });
});

describe("noticeIsBlocking", () => {
  it("returns true for error severity", () => {
    const notices = buildGridActionNotices({ ...baseStatus, circuitBreakerOpen: true }, baseAudit, [], []);
    const cb = notices.find(n => n.id === "circuit_breaker")!;
    expect(noticeIsBlocking(cb)).toBe(true);
  });

  it("returns false for info severity", () => {
    const notices = buildGridActionNotices(baseStatus, baseAudit, [historicalLevel], []);
    const hist = notices.find(n => n.id === "historical_levels")!;
    expect(noticeIsBlocking(hist)).toBe(false);
  });
});

describe("noticesByTab", () => {
  it("filters by target tab", () => {
    const notices = buildGridActionNotices(baseStatus, baseAudit, [historicalLevel], []);
    const nivelesNotices = noticesByTab(notices, "niveles");
    expect(nivelesNotices.every(n => n.targetTab === "niveles")).toBe(true);
  });
});
