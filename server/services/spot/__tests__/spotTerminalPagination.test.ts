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
import { terminalWsServer } from "../spotTerminalStream";

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
});
