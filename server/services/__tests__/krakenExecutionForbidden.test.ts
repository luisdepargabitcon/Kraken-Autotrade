import { describe, expect, it } from "vitest";
import { krakenService } from "../kraken";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";

// P0 security characterization tests (H-001/H-003/H-004):
// Kraken is a data-only venue. Order placement, raw placement and cancellation
// must be unconditionally impossible, with any configuration, credentials or
// client state — and never fall back silently. These tests must never touch the
// network: every assertion expects the call to fail BEFORE any HTTP happens.

describe("Kraken execution prohibition (P0)", () => {
  it("placeOrder throws KRAKEN_EXECUTION_FORBIDDEN without initialized client", async () => {
    await expect(
      krakenService.placeOrder({ pair: "BTC/USD", type: "buy", ordertype: "market", volume: "0.001" })
    ).rejects.toThrow("KRAKEN_EXECUTION_FORBIDDEN");
  });

  it("placeOrder throws KRAKEN_EXECUTION_FORBIDDEN even with credentials configured", async () => {
    krakenService.initialize({ apiKey: "test-key", apiSecret: "dGVzdC1zZWNyZXQ=" });
    await expect(
      krakenService.placeOrder({ pair: "BTC/USD", type: "sell", ordertype: "market", volume: "0.001" })
    ).rejects.toThrow("KRAKEN_EXECUTION_FORBIDDEN");
    await expect(
      krakenService.placeOrder({ pair: "ETH/USD", type: "buy", ordertype: "limit", price: "3000", volume: "0.01" })
    ).rejects.toThrow("KRAKEN_EXECUTION_FORBIDDEN");
  });

  it("placeOrderRaw throws KRAKEN_EXECUTION_FORBIDDEN", async () => {
    await expect(
      krakenService.placeOrderRaw({ pair: "BTC/USD", type: "buy", ordertype: "market", volume: "0.001" })
    ).rejects.toThrow("KRAKEN_EXECUTION_FORBIDDEN");
  });

  it("cancelOrder throws KRAKEN_EXECUTION_FORBIDDEN", async () => {
    await expect(krakenService.cancelOrder("OXXXXX-TEST-000000")).rejects.toThrow("KRAKEN_EXECUTION_FORBIDDEN");
  });

  it("read-only methods remain available on the service contract", () => {
    // The venue split must not break legitimate reads (market data, FISCO).
    expect(typeof krakenService.getTicker).toBe("function");
    expect(typeof krakenService.getOHLC).toBe("function");
    expect(typeof krakenService.getBalance).toBe("function");
    expect(typeof krakenService.getTradesHistory).toBe("function");
  });
});

describe("ExchangeFactory fail-closed venue selection (P0)", () => {
  it("rejects Kraken as trading exchange", () => {
    expect(() => ExchangeFactory.setTradingExchange("kraken")).toThrow("KRAKEN_TRADING_FORBIDDEN");
  });

  it("rejects Kraken as active exchange", () => {
    expect(() => ExchangeFactory.setActiveExchange("kraken")).toThrow("KRAKEN_TRADING_FORBIDDEN");
  });

  it("getExchange('revolutx') throws VENUE_UNAVAILABLE instead of falling back to Kraken when uninitialized", () => {
    // In the test environment Revolut X is never initialized.
    expect(() => ExchangeFactory.getExchange("revolutx")).toThrow("VENUE_UNAVAILABLE");
  });

  it("data exchange remains Kraken (data-only reads are legitimate)", () => {
    const dataEx = ExchangeFactory.getExchange("kraken");
    expect(dataEx.exchangeName).toBe("kraken");
  });

  it("initializeFromConfig coerces persisted kraken trading selection to revolutx fail-closed", async () => {
    await ExchangeFactory.initializeFromConfig({
      tradingExchange: "kraken",
      activeExchange: "kraken",
    });
    expect(ExchangeFactory.getTradingExchangeType()).toBe("revolutx");
  });
});
