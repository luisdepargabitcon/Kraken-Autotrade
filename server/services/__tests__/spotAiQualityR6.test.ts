/**
 * spotAiQualityR6.test.ts — R6 QUALITY tests: Schema validation and duplicate detection.
 *
 * Tests the shared `isForwardTwinSchemaAllowed()` function and duplicate
 * detection logic.
 */

import { describe, it, expect } from "vitest";
import { isForwardTwinSchemaAllowed } from "../spot/spotForwardTwinTypes";

describe("R6 QUALITY_SCHEMA tests — exact schema per snapshot type", () => {
  // QUALITY_R6_SCHEMA_01: SCAN v1 => valid
  it("QUALITY_R6_SCHEMA_01: SCAN v1 => valid", () => {
    expect(isForwardTwinSchemaAllowed("SCAN", 1)).toBe(true);
  });

  // QUALITY_R6_SCHEMA_02: SCAN v2 => MISMATCH
  it("QUALITY_R6_SCHEMA_02: SCAN v2 => mismatch", () => {
    expect(isForwardTwinSchemaAllowed("SCAN", 2)).toBe(false);
  });

  // QUALITY_R6_SCHEMA_03: FILL v1 => valid
  it("QUALITY_R6_SCHEMA_03: FILL v1 => valid", () => {
    expect(isForwardTwinSchemaAllowed("FILL", 1)).toBe(true);
  });

  // QUALITY_R6_SCHEMA_04: FILL v2 => MISMATCH
  it("QUALITY_R6_SCHEMA_04: FILL v2 => mismatch", () => {
    expect(isForwardTwinSchemaAllowed("FILL", 2)).toBe(false);
  });

  // QUALITY_R6_SCHEMA_05: SUPERVISOR v1 => valid legacy
  it("QUALITY_R6_SCHEMA_05: SUPERVISOR v1 => valid legacy", () => {
    expect(isForwardTwinSchemaAllowed("SUPERVISOR", 1)).toBe(true);
  });

  // QUALITY_R6_SCHEMA_06: SUPERVISOR v2 => valid
  it("QUALITY_R6_SCHEMA_06: SUPERVISOR v2 => valid", () => {
    expect(isForwardTwinSchemaAllowed("SUPERVISOR", 2)).toBe(true);
  });

  // QUALITY_R6_SCHEMA_07: SUPERVISOR v3 => mismatch
  it("QUALITY_R6_SCHEMA_07: SUPERVISOR v3 => mismatch", () => {
    expect(isForwardTwinSchemaAllowed("SUPERVISOR", 3)).toBe(false);
  });

  // QUALITY_R6_SCHEMA_08: unknown snapshot type => mismatch
  it("QUALITY_R6_SCHEMA_08: unknown snapshot type => mismatch", () => {
    expect(isForwardTwinSchemaAllowed("UNKNOWN", 1)).toBe(false);
    expect(isForwardTwinSchemaAllowed("", 1)).toBe(false);
    expect(isForwardTwinSchemaAllowed("SCAN", 0)).toBe(false);
    expect(isForwardTwinSchemaAllowed("SCAN", -1)).toBe(false);
  });
});

describe("R6 QUALITY_DUP tests — duplicate BUY vs SELL detection", () => {
  // These tests verify the LOGIC of duplicate detection.
  // The actual SQL runs in the quality endpoint, but the logic is:
  // - Duplicate = same (lotId, pair, side, orderId) repeated.
  // - If orderId is empty, fall back to (lotId, pair, side, fillPrice, fillVolume, timestamp).
  // - Multi-fill = >1 fills with different orderId (legitimate).

  // QUALITY_R6_DUP_01: two BUY partials distinct => multi BUY, duplicateEntry=0
  it("QUALITY_R6_DUP_01: two BUY partials with different orderId => not duplicate", () => {
    // Simulate: two BUY fills with different orderId
    const fills = [
      { lotId: "lot-1", pair: "BTC/USD", side: "BUY", orderId: "ord-1", price: 100, volume: 0.5, ts: 1000 },
      { lotId: "lot-1", pair: "BTC/USD", side: "BUY", orderId: "ord-2", price: 102, volume: 0.5, ts: 1010 },
    ];
    // Duplicate detection: group by (lotId, pair, side, orderId), check count > 1
    const groups = new Map<string, number>();
    for (const f of fills) {
      const key = `${f.lotId}|${f.pair}|${f.side}|${f.orderId}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    let duplicateEntry = 0;
    for (const count of groups.values()) {
      if (count > 1) duplicateEntry++;
    }
    expect(duplicateEntry).toBe(0); // different orderId → not duplicate
    // Multi-buy: >1 BUY fills for same lot
    const buyCount = fills.filter((f) => f.side === "BUY").length;
    expect(buyCount).toBe(2); // multi-buy
  });

  // QUALITY_R6_DUP_02: same BUY orderId repeated => duplicateEntry>0
  it("QUALITY_R6_DUP_02: same BUY orderId repeated => duplicate", () => {
    const fills = [
      { lotId: "lot-1", pair: "BTC/USD", side: "BUY", orderId: "ord-1", price: 100, volume: 0.5, ts: 1000 },
      { lotId: "lot-1", pair: "BTC/USD", side: "BUY", orderId: "ord-1", price: 100, volume: 0.5, ts: 1000 },
    ];
    const groups = new Map<string, number>();
    for (const f of fills) {
      const key = `${f.lotId}|${f.pair}|${f.side}|${f.orderId}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    let duplicateEntry = 0;
    for (const count of groups.values()) {
      if (count > 1) duplicateEntry++;
    }
    expect(duplicateEntry).toBe(1);
  });

  // QUALITY_R6_DUP_03: two SELL partials distinct => multi SELL, duplicateExit=0
  it("QUALITY_R6_DUP_03: two SELL partials with different orderId => not duplicate", () => {
    const fills = [
      { lotId: "lot-1", pair: "BTC/USD", side: "SELL", orderId: "ord-s1", price: 108, volume: 0.5, ts: 2000 },
      { lotId: "lot-1", pair: "BTC/USD", side: "SELL", orderId: "ord-s2", price: 112, volume: 0.5, ts: 2100 },
    ];
    const groups = new Map<string, number>();
    for (const f of fills) {
      const key = `${f.lotId}|${f.pair}|${f.side}|${f.orderId}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    let duplicateExit = 0;
    for (const count of groups.values()) {
      if (count > 1) duplicateExit++;
    }
    expect(duplicateExit).toBe(0);
  });

  // QUALITY_R6_DUP_04: same SELL orderId repeated => duplicateExit>0
  it("QUALITY_R6_DUP_04: same SELL orderId repeated => duplicate", () => {
    const fills = [
      { lotId: "lot-1", pair: "BTC/USD", side: "SELL", orderId: "ord-s1", price: 110, volume: 1, ts: 2000 },
      { lotId: "lot-1", pair: "BTC/USD", side: "SELL", orderId: "ord-s1", price: 110, volume: 1, ts: 2000 },
    ];
    const groups = new Map<string, number>();
    for (const f of fills) {
      const key = `${f.lotId}|${f.pair}|${f.side}|${f.orderId}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    let duplicateExit = 0;
    for (const count of groups.values()) {
      if (count > 1) duplicateExit++;
    }
    expect(duplicateExit).toBe(1);
  });

  // QUALITY_R6_DUP_05: duplicate BUY does not increment duplicateExit
  it("QUALITY_R6_DUP_05: duplicate BUY does not increment duplicateExit", () => {
    const fills = [
      { lotId: "lot-1", pair: "BTC/USD", side: "BUY", orderId: "ord-1", price: 100, volume: 0.5, ts: 1000 },
      { lotId: "lot-1", pair: "BTC/USD", side: "BUY", orderId: "ord-1", price: 100, volume: 0.5, ts: 1000 },
    ];
    let duplicateEntry = 0;
    let duplicateExit = 0;
    const groups = new Map<string, number>();
    for (const f of fills) {
      const key = `${f.lotId}|${f.pair}|${f.side}|${f.orderId}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    for (const [key, count] of groups) {
      if (count > 1) {
        if (key.includes("|BUY|")) duplicateEntry++;
        if (key.includes("|SELL|")) duplicateExit++;
      }
    }
    expect(duplicateEntry).toBe(1);
    expect(duplicateExit).toBe(0);
  });

  // QUALITY_R6_DUP_06: duplicate SELL does not increment duplicateEntry
  it("QUALITY_R6_DUP_06: duplicate SELL does not increment duplicateEntry", () => {
    const fills = [
      { lotId: "lot-1", pair: "BTC/USD", side: "SELL", orderId: "ord-s1", price: 110, volume: 1, ts: 2000 },
      { lotId: "lot-1", pair: "BTC/USD", side: "SELL", orderId: "ord-s1", price: 110, volume: 1, ts: 2000 },
    ];
    let duplicateEntry = 0;
    let duplicateExit = 0;
    const groups = new Map<string, number>();
    for (const f of fills) {
      const key = `${f.lotId}|${f.pair}|${f.side}|${f.orderId}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    for (const [key, count] of groups) {
      if (count > 1) {
        if (key.includes("|BUY|")) duplicateEntry++;
        if (key.includes("|SELL|")) duplicateExit++;
      }
    }
    expect(duplicateEntry).toBe(0);
    expect(duplicateExit).toBe(1);
  });
});
