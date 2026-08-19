/**
 * spotTerminalPagination.test.ts — Tests for terminal ring buffer pagination.
 *
 * Tests:
 *   - Paginated retrieval returns correct slice
 *   - Page clamping (out of range pages)
 *   - Page size limits
 *   - Total pages calculation
 *   - Empty buffer handling
 */

import { describe, it, expect, beforeEach } from "vitest";
import { terminalWsServer, formatTerminalLineEs, getTerminalLevelEs } from "../spotTerminalStream";

describe("spotTerminalPagination", () => {
  beforeEach(() => {
    terminalWsServer.clearRingBufferForTest();
  });

  it("should return empty result for empty buffer", () => {
    const result = terminalWsServer.getRingBufferPaginated(1, 50);

    expect(result.total).toBe(0);
    expect(result.lines.length).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
  });

  it("should return correct slice for first page", () => {
    // Emit lines to fill the ring buffer
    for (let i = 0; i < 75; i++) {
      terminalWsServer.emitForTest({
        id: `line-${i}`,
        ts: Date.now(),
        level: "INFO",
        source: "test",
        msg: `Message ${i}`,
        pair: null,
        mode: null,
      });
    }

    const result = terminalWsServer.getRingBufferPaginated(1, 50);

    expect(result.total).toBe(75);
    expect(result.lines.length).toBe(50);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(result.totalPages).toBe(2);
  });

  it("should return correct slice for second page", () => {
    for (let i = 0; i < 75; i++) {
      terminalWsServer.emitForTest({
        id: `line-${i}`,
        ts: Date.now(),
        level: "INFO",
        source: "test",
        msg: `Message ${i}`,
        pair: null,
        mode: null,
      });
    }

    const result = terminalWsServer.getRingBufferPaginated(2, 50);

    expect(result.lines.length).toBe(25);
    expect(result.page).toBe(2);
  });

  it("should clamp out-of-range page to last page", () => {
    for (let i = 0; i < 30; i++) {
      terminalWsServer.emitForTest({
        id: `line-${i}`,
        ts: Date.now(),
        level: "INFO",
        source: "test",
        msg: `Message ${i}`,
        pair: null,
        mode: null,
      });
    }

    const result = terminalWsServer.getRingBufferPaginated(999, 50);

    expect(result.page).toBe(1); // Only 1 page with 30 items
    expect(result.lines.length).toBe(30);
  });

  it("should clamp negative page to page 1", () => {
    for (let i = 0; i < 10; i++) {
      terminalWsServer.emitForTest({
        id: `line-${i}`,
        ts: Date.now(),
        level: "INFO",
        source: "test",
        msg: `Message ${i}`,
        pair: null,
        mode: null,
      });
    }

    const result = terminalWsServer.getRingBufferPaginated(-5, 50);

    expect(result.page).toBe(1);
  });

  // ─── Filter tests ───────────────────────────────────────────────────────

  it("should filter by level", () => {
    for (let i = 0; i < 20; i++) {
      terminalWsServer.emitForTest({
        id: `line-${i}`,
        ts: Date.now(),
        level: i < 10 ? "INFO" : "ERROR",
        source: "test",
        msg: `Message ${i}`,
        pair: null,
        mode: null,
      });
    }

    const result = terminalWsServer.getRingBufferPaginated(1, 50, { level: "ERROR" });
    expect(result.total).toBe(10);
    expect(result.lines.every(l => l.level === "ERROR")).toBe(true);
  });

  it("should filter by pair", () => {
    for (let i = 0; i < 20; i++) {
      terminalWsServer.emitForTest({
        id: `line-${i}`,
        ts: Date.now(),
        level: "INFO",
        source: "test",
        msg: `Message ${i}`,
        pair: i < 10 ? "BTC/USD" : "ETH/USD",
        mode: null,
      });
    }

    const result = terminalWsServer.getRingBufferPaginated(1, 50, { pair: "ETH/USD" });
    expect(result.total).toBe(10);
    expect(result.lines.every(l => l.pair === "ETH/USD")).toBe(true);
  });

  it("should filter by search query", () => {
    for (let i = 0; i < 20; i++) {
      terminalWsServer.emitForTest({
        id: `line-${i}`,
        ts: Date.now(),
        level: "INFO",
        source: "test",
        msg: i % 2 === 0 ? "Scan completed" : "Error in pipeline",
        pair: null,
        mode: null,
      });
    }

    const result = terminalWsServer.getRingBufferPaginated(1, 50, { search: "scan" });
    expect(result.total).toBe(10);
    expect(result.lines.every(l => l.msg.toLowerCase().includes("scan"))).toBe(true);
  });

  it("should combine multiple filters", () => {
    for (let i = 0; i < 30; i++) {
      terminalWsServer.emitForTest({
        id: `line-${i}`,
        ts: Date.now(),
        level: i < 15 ? "INFO" : "ERROR",
        source: "test",
        msg: i % 3 === 0 ? "Scan completed" : "Other message",
        pair: i < 15 ? "BTC/USD" : "ETH/USD",
        mode: null,
      });
    }

    const result = terminalWsServer.getRingBufferPaginated(1, 50, { level: "INFO", pair: "BTC/USD", search: "scan" });
    // INFO + BTC/USD = 15 lines, of which every 3rd has "Scan" → indices 0,3,6,9,12 → 5 lines
    expect(result.total).toBe(5);
    expect(result.lines.every(l => l.level === "INFO" && l.pair === "BTC/USD" && l.msg.toLowerCase().includes("scan"))).toBe(true);
  });
});

// ─── Spanish formatter tests ──────────────────────────────────────────────────

describe("formatTerminalLineEs", () => {
  it("should format a line with Spanish level label", () => {
    const line = {
      id: "test-1",
      ts: Date.now(),
      level: "MARKET" as const,
      source: "scan",
      msg: "Test message",
      pair: "BTC/USD",
      mode: null,
    };
    const formatted = formatTerminalLineEs(line);
    expect(formatted).toContain("MERCADO");
    expect(formatted).toContain("análisis");
    expect(formatted).toContain("BTC/USD");
    expect(formatted).toContain("Test message");
  });

  it("should format ERROR level in Spanish", () => {
    const line = {
      id: "test-2",
      ts: Date.now(),
      level: "ERROR" as const,
      source: "system",
      msg: "Something went wrong",
      pair: null,
      mode: null,
    };
    const formatted = formatTerminalLineEs(line);
    expect(formatted).toContain("ERROR");
    expect(formatted).toContain("sistema");
  });

  it("should handle all terminal levels", () => {
    const levels = ["INFO", "MARKET", "SIGNAL", "DECISION", "EXECUTION", "SUPERVISOR", "METADATA", "READINESS", "RISK", "ADAPTER", "SYSTEM", "ERROR"] as const;
    for (const level of levels) {
      const es = getTerminalLevelEs(level);
      expect(es).toBeDefined();
      expect(es.length).toBeGreaterThan(0);
    }
  });

  it("should handle unknown source gracefully", () => {
    const line = {
      id: "test-3",
      ts: Date.now(),
      level: "INFO" as const,
      source: "unknown_source",
      msg: "Test",
      pair: null,
      mode: null,
    };
    const formatted = formatTerminalLineEs(line);
    expect(formatted).toContain("unknown_source");
  });
});
