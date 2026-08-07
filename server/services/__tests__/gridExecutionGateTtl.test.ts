import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeGateTtl } from "../gridIsolated/gridExecutionGateTtl";
import type { GridExecutionMarketSnapshot } from "../gridIsolated/gridExecutionMarketSnapshot";
import type { RevolutXPairConstraints } from "../exchanges/RevolutXService";

const BASE_TIME = new Date("2026-08-01T12:00:00Z");

function makeSnapshot(overrides: Partial<GridExecutionMarketSnapshot> = {}): GridExecutionMarketSnapshot {
  return {
    pair: "BTC/USD",
    venue: "REVOLUT_X",
    bid: 94990,
    ask: 95010,
    last: 95000,
    spreadUsd: 20,
    spreadPct: 0.02,
    priceTickSize: 0.01,
    priceTickPct: 0.01,
    source: "REVOLUT_X_TICKER",
    timestamp: BASE_TIME,
    acquiredAt: BASE_TIME,
    fetchedAt: BASE_TIME,
    maxAgeMs: 30000,
    fresh: true,
    verified: true,
    reasonCode: null,
    explanation: "ok",
    ...overrides,
  };
}

function makeConstraints(overrides: Partial<RevolutXPairConstraints> = {}): RevolutXPairConstraints {
  return {
    pair: "BTC/USD",
    normalizedPair: "BTC-USD",
    executionVenue: "REVOLUT_X",
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    priceTickSize: 0.01,
    quantityStep: 0.0001,
    minOrderBase: 0.0001,
    minOrderQuote: 1,
    minOrderUsd: 1,
    maxOrderBase: null,
    pricePrecision: 2,
    quantityPrecision: 4,
    status: "active",
    region: "EU",
    source: "revolutx",
    fetchedAt: BASE_TIME,
    expiresAt: null,
    verified: true,
    reasonCode: null,
    ...overrides,
  };
}

describe("gridExecutionGateTtl — REV-C12B", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. snapshot and constraints valid → fresh=true", () => {
    const result = computeGateTtl(makeSnapshot(), makeConstraints(), new Date());
    expect(result.fresh).toBe(true);
    expect(result.validUntil).not.toBeNull();
    expect(result.staleReason).toBeNull();
  });

  it("2. snapshot expires before constraints → staleReason=SNAPSHOT_STALE", () => {
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 31000)); // 31s later, snapshot maxAge=30s
    const result = computeGateTtl(makeSnapshot(), makeConstraints({ expiresAt: new Date(BASE_TIME.getTime() + 60000) }), new Date());
    expect(result.fresh).toBe(false);
    expect(result.staleReason).toBe("SNAPSHOT_STALE");
  });

  it("3. constraints expire before snapshot → staleReason=CONSTRAINTS_STALE", () => {
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 10000)); // 10s later
    const result = computeGateTtl(
      makeSnapshot({ maxAgeMs: 60000 }),
      makeConstraints({ expiresAt: new Date(BASE_TIME.getTime() + 5000) }), // expired 5s ago
      new Date(),
    );
    expect(result.fresh).toBe(false);
    expect(result.staleReason).toBe("CONSTRAINTS_STALE");
  });

  it("4. constraints without expiresAt → TTL governed by snapshot only", () => {
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 31000)); // snapshot expired
    const result = computeGateTtl(makeSnapshot(), makeConstraints({ expiresAt: null }), new Date());
    expect(result.fresh).toBe(false);
    expect(result.staleReason).toBe("SNAPSHOT_STALE");
    expect(result.constraintsValidUntil).toBeNull();
  });

  it("5. fetchedAt invalid (NaN) → fail-closed", () => {
    const badSnapshot = makeSnapshot({ fetchedAt: new Date("invalid") as any });
    const result = computeGateTtl(badSnapshot, makeConstraints(), new Date());
    expect(result.fresh).toBe(false);
  });

  it("6. maxAgeMs invalid (0) → fail-closed", () => {
    const result = computeGateTtl(makeSnapshot({ maxAgeMs: 0 }), makeConstraints(), new Date());
    expect(result.fresh).toBe(false);
  });

  it("7. reading before limit → fresh=true", () => {
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 29000)); // 29s, maxAge=30s
    const result = computeGateTtl(makeSnapshot(), makeConstraints(), new Date());
    expect(result.fresh).toBe(true);
  });

  it("8. reading after limit → fresh=false", () => {
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 31000)); // 31s, maxAge=30s
    const result = computeGateTtl(makeSnapshot(), makeConstraints(), new Date());
    expect(result.fresh).toBe(false);
  });

  it("9. multiple readings do not renew validUntil", () => {
    const now1 = new Date(BASE_TIME.getTime() + 10000);
    const r1 = computeGateTtl(makeSnapshot(), makeConstraints(), now1);
    const vu1 = r1.validUntil;

    const now2 = new Date(BASE_TIME.getTime() + 20000);
    const r2 = computeGateTtl(makeSnapshot(), makeConstraints(), now2);
    const vu2 = r2.validUntil;

    // validUntil is derived from fetchedAt + maxAgeMs, not from reading time
    expect(vu1).toEqual(vu2);
    expect(vu1?.getTime()).toBe(BASE_TIME.getTime() + 30000);
  });

  it("10. validUntil is exactly the minimum of snapshot and constraints", () => {
    const snapshot = makeSnapshot({ maxAgeMs: 30000 }); // validUntil = BASE + 30s
    const constraints = makeConstraints({ expiresAt: new Date(BASE_TIME.getTime() + 20000) }); // expires in 20s
    const result = computeGateTtl(snapshot, constraints, new Date());
    expect(result.validUntil?.getTime()).toBe(BASE_TIME.getTime() + 20000); // min(30s, 20s) = 20s
  });

  it("11. staleReason=SNAPSHOT_STALE when only snapshot is stale", () => {
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 31000));
    const result = computeGateTtl(makeSnapshot(), makeConstraints({ expiresAt: new Date(BASE_TIME.getTime() + 60000) }), new Date());
    expect(result.staleReason).toBe("SNAPSHOT_STALE");
  });

  it("12. staleReason=CONSTRAINTS_STALE when only constraints are stale", () => {
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 10000));
    const result = computeGateTtl(
      makeSnapshot({ maxAgeMs: 60000 }),
      makeConstraints({ expiresAt: new Date(BASE_TIME.getTime() + 5000) }),
      new Date(),
    );
    expect(result.staleReason).toBe("CONSTRAINTS_STALE");
  });

  it("13. both invalid → staleReason=TIMESTAMP_INVALID", () => {
    const badSnapshot = makeSnapshot({ fetchedAt: new Date("invalid") as any });
    const badConstraints = makeConstraints({ expiresAt: new Date("invalid") as any });
    const result = computeGateTtl(badSnapshot, badConstraints, new Date());
    expect(result.fresh).toBe(false);
    expect(result.staleReason).toBe("TIMESTAMP_INVALID");
  });

  it("14. input objects are not modified", () => {
    const snapshot = makeSnapshot();
    const constraints = makeConstraints();
    const snapshotCopy = { ...snapshot, fetchedAt: new Date(snapshot.fetchedAt) };
    const constraintsCopy = { ...constraints, expiresAt: constraints.expiresAt ? new Date(constraints.expiresAt) : null };

    computeGateTtl(snapshot, constraints, new Date());

    expect(snapshot.fetchedAt).toEqual(snapshotCopy.fetchedAt);
    expect(snapshot.maxAgeMs).toBe(snapshotCopy.maxAgeMs);
    expect(constraints.expiresAt).toEqual(constraintsCopy.expiresAt);
    expect(constraints.verified).toBe(constraintsCopy.verified);
  });
});
