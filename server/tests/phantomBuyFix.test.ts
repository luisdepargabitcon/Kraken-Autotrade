import { describe, expect, it } from "vitest";
import { buildTradeId } from "../utils/tradeId";

describe("Phantom Buy Fix - Trade ID Consistency", () => {
  it("generates identical trade IDs for bot and sync with same canonical input", () => {
    const canonicalInput = {
      exchange: "revolutx",
      pair: "BTC/USD",
      executedAt: new Date("2024-01-15T10:30:00Z"),
      type: "buy",
      price: "45000.50",
      amount: "0.00500000",
      externalId: "REVOLUTX-ORDER-123",
    };

    const botTradeId = buildTradeId(canonicalInput);
    const syncTradeId = buildTradeId(canonicalInput);

    expect(botTradeId).toBe(syncTradeId);
    expect(botTradeId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates different trade IDs for different trades", () => {
    const trade1 = {
      exchange: "revolutx",
      pair: "BTC/USD",
      executedAt: new Date("2024-01-15T10:30:00Z"),
      type: "buy",
      price: "45000.50",
      amount: "0.00500000",
      externalId: "ORDER-1",
    };

    const trade2 = {
      exchange: "revolutx",
      pair: "BTC/USD",
      executedAt: new Date("2024-01-15T10:30:01Z"), // Different timestamp
      type: "buy",
      price: "45000.50",
      amount: "0.00500000",
      externalId: "ORDER-2",
    };

    const tradeId1 = buildTradeId(trade1);
    const tradeId2 = buildTradeId(trade2);

    expect(tradeId1).not.toBe(tradeId2);
  });

  it("normalizes price and amount for consistency", () => {
    const input1 = {
      exchange: "revolutx",
      pair: "BTC/USD",
      executedAt: new Date("2024-01-15T10:30:00Z"),
      type: "buy",
      price: "45000.5",
      amount: "0.005",
      externalId: "ORDER-1",
    };

    const input2 = {
      exchange: "revolutx",
      pair: "BTC/USD",
      executedAt: new Date("2024-01-15T10:30:00Z"),
      type: "buy",
      price: "45000.50",
      amount: "0.00500000",
      externalId: "ORDER-1",
    };

    const tradeId1 = buildTradeId(input1);
    const tradeId2 = buildTradeId(input2);

    expect(tradeId1).toBe(tradeId2);
  });

  it("handles missing externalId gracefully", () => {
    const withExternalId = {
      exchange: "revolutx",
      pair: "BTC/USD",
      executedAt: new Date("2024-01-15T10:30:00Z"),
      type: "buy",
      price: "45000.50",
      amount: "0.00500000",
      externalId: "ORDER-1",
    };

    const withoutExternalId = {
      exchange: "revolutx",
      pair: "BTC/USD",
      executedAt: new Date("2024-01-15T10:30:00Z"),
      type: "buy",
      price: "45000.50",
      amount: "0.00500000",
      externalId: undefined,
    };

    const tradeId1 = buildTradeId(withExternalId);
    const tradeId2 = buildTradeId(withoutExternalId);

    expect(tradeId1).not.toBe(tradeId2);
    expect(tradeId1).toMatch(/^[a-f0-9]{64}$/);
    expect(tradeId2).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic across multiple calls", () => {
    const input = {
      exchange: "revolutx",
      pair: "ETH/USD",
      executedAt: new Date("2024-01-15T10:30:00Z"),
      type: "sell",
      price: "2500.75",
      amount: "1.50000000",
      externalId: "SELL-ORDER-456",
    };

    const ids = Array.from({ length: 100 }, () => buildTradeId(input));
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(1);
  });

  it("handles Kraken vs RevolutX exchanges consistently", () => {
    const baseInput = {
      pair: "BTC/USD",
      executedAt: new Date("2024-01-15T10:30:00Z"),
      type: "buy",
      price: "45000.50",
      amount: "0.00500000",
      externalId: "ORDER-1",
    };

    const krakenId = buildTradeId({ ...baseInput, exchange: "kraken" });
    const revolutxId = buildTradeId({ ...baseInput, exchange: "revolutx" });

    expect(krakenId).not.toBe(revolutxId);
    expect(krakenId).toMatch(/^[a-f0-9]{64}$/);
    expect(revolutxId).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("Phantom Buy Fix - Idempotency Guarantees", () => {
  it("validates trade ID format", () => {
    const input = {
      exchange: "revolutx",
      pair: "BTC/USD",
      executedAt: new Date(),
      type: "buy",
      price: "45000",
      amount: "0.005",
      externalId: "TEST-ORDER",
    };

    const tradeId = buildTradeId(input);
    
    expect(tradeId).toBeTruthy();
    expect(typeof tradeId).toBe("string");
    expect(tradeId.length).toBe(64);
    expect(tradeId).toMatch(/^[a-f0-9]+$/);
  });

  it("ensures canonical input includes all required fields", () => {
    const completeInput = {
      exchange: "revolutx",
      pair: "BTC/USD",
      executedAt: new Date("2024-01-15T10:30:00Z"),
      type: "buy",
      price: "45000.50",
      amount: "0.00500000",
      externalId: "ORDER-1",
    };

    expect(() => buildTradeId(completeInput)).not.toThrow();
  });
});
