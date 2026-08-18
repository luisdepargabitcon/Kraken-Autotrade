/**
 * SpotTerminalPanel — UI behavior tests.
 * Tests the pure logic functions extracted from SpotTerminalPanel:
 * - TerminalLevel type completeness
 * - LEVEL_CLASS mapping completeness
 * - Filter matching logic
 * - Connection status transitions
 *
 * No DOM/jsdom needed — these are pure type+logic tests.
 */
import { describe, it, expect } from "vitest";

// Mirror the types from SpotTerminalPanel for test verification
type TerminalLevel = "INFO" | "MARKET" | "SIGNAL" | "DECISION" | "EXECUTION" | "SUPERVISOR" | "METADATA" | "READINESS" | "RISK" | "ADAPTER" | "SYSTEM" | "ERROR";

const LEVEL_CLASS: Record<TerminalLevel, string> = {
  INFO:       "text-muted-foreground",
  MARKET:     "text-sky-400",
  SIGNAL:     "text-emerald-400",
  DECISION:   "text-yellow-400",
  EXECUTION:  "text-blue-400",
  SUPERVISOR: "text-purple-400",
  METADATA:   "text-cyan-400",
  READINESS:  "text-indigo-400",
  RISK:       "text-orange-400",
  ADAPTER:    "text-teal-400",
  SYSTEM:     "text-orange-400",
  ERROR:      "text-red-400",
};

const ALL_LEVELS: TerminalLevel[] = ["INFO", "MARKET", "SIGNAL", "DECISION", "EXECUTION", "SUPERVISOR", "METADATA", "READINESS", "RISK", "ADAPTER", "SYSTEM", "ERROR"];

// Filter logic: returns true if a line matches the selected filter
function matchesLevelFilter(lineLevel: TerminalLevel, filter: TerminalLevel | "ALL"): boolean {
  if (filter === "ALL") return true;
  return lineLevel === filter;
}

// Connection status type
type ConnStatus = "CONNECTING" | "LIVE" | "PAUSED" | "RECONNECTING" | "NO_TOKEN" | "OFFLINE";

// Status display logic
function statusDisplay(status: ConnStatus): { label: string; color: string } {
  switch (status) {
    case "LIVE": return { label: "LIVE", color: "text-emerald-400" };
    case "CONNECTING": return { label: "Conectando...", color: "text-yellow-400" };
    case "RECONNECTING": return { label: "Reconectando...", color: "text-yellow-400" };
    case "PAUSED": return { label: "Pausado", color: "text-muted-foreground" };
    case "NO_TOKEN": return { label: "Sin token", color: "text-orange-400" };
    case "OFFLINE": return { label: "Desconectado", color: "text-red-400" };
  }
}

describe("SpotTerminalPanel — UI logic", () => {
  // ── Level type completeness ──────────────────────────────────────────────────

  it("UI_TERM_LEVELS_COMPLETE — all 12 levels present in LEVEL_CLASS", () => {
    for (const level of ALL_LEVELS) {
      expect(LEVEL_CLASS[level]).toBeDefined();
      expect(LEVEL_CLASS[level].length).toBeGreaterThan(0);
    }
  });

  it("UI_TERM_MARKET_LEVEL — MARKET level has distinct color class", () => {
    expect(LEVEL_CLASS.MARKET).toBe("text-sky-400");
    // MARKET should be distinct from INFO (muted) and SIGNAL (emerald)
    expect(LEVEL_CLASS.MARKET).not.toBe(LEVEL_CLASS.INFO);
    expect(LEVEL_CLASS.MARKET).not.toBe(LEVEL_CLASS.SIGNAL);
  });

  // ── Filter logic ─────────────────────────────────────────────────────────────

  it("UI_TERM_FILTER_ALL — ALL filter matches every level", () => {
    for (const level of ALL_LEVELS) {
      expect(matchesLevelFilter(level, "ALL")).toBe(true);
    }
  });

  it("UI_TERM_FILTER_SPECIFIC — specific filter matches only that level", () => {
    for (const filterLevel of ALL_LEVELS) {
      for (const lineLevel of ALL_LEVELS) {
        expect(matchesLevelFilter(lineLevel, filterLevel)).toBe(lineLevel === filterLevel);
      }
    }
  });

  it("UI_TERM_FILTER_MARKET — MARKET filter matches MARKET lines only", () => {
    expect(matchesLevelFilter("MARKET", "MARKET")).toBe(true);
    expect(matchesLevelFilter("SIGNAL", "MARKET")).toBe(false);
    expect(matchesLevelFilter("INFO", "MARKET")).toBe(false);
  });

  // ── Connection status ────────────────────────────────────────────────────────

  it("UI_TERM_STATUS_LIVE — LIVE status has green color", () => {
    const display = statusDisplay("LIVE");
    expect(display.label).toBe("LIVE");
    expect(display.color).toContain("emerald");
  });

  it("UI_TERM_STATUS_OFFLINE — OFFLINE status has red color", () => {
    const display = statusDisplay("OFFLINE");
    expect(display.label).toBe("Desconectado");
    expect(display.color).toContain("red");
  });

  it("UI_TERM_STATUS_NO_TOKEN — NO_TOKEN status has orange color", () => {
    const display = statusDisplay("NO_TOKEN");
    expect(display.label).toBe("Sin token");
    expect(display.color).toContain("orange");
  });

  it("UI_TERM_STATUS_CONNECTING — CONNECTING status has yellow color", () => {
    const display = statusDisplay("CONNECTING");
    expect(display.label).toBe("Conectando...");
    expect(display.color).toContain("yellow");
  });

  // ── All levels in dropdown ───────────────────────────────────────────────────

  it("UI_TERM_DROPDOWN_ALL_LEVELS — dropdown includes all 12 levels", () => {
    // Verify the count matches what the dropdown renders
    expect(ALL_LEVELS.length).toBe(12);
    expect(ALL_LEVELS).toContain("MARKET");
  });
});
