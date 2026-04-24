/**
 * Tests específicos para IdcaMessageFormatter
 * Validan: terminología correcta, timestamps, ausencia de términos legacy
 */

import { describe, it, expect } from "vitest";
import { formatTelegramMessage, type FormatContext } from "../institutionalDca/IdcaMessageFormatter";

describe("IdcaMessageFormatter - Telegram messages", () => {
  const baseCtx: FormatContext = {
    eventType: "entry_check_blocked",
    pair: "BTC/USD",
    mode: "SMART_GUARD",
  };

  describe("entry_check_blocked con VWAP Anchor", () => {
    it("debe contener 'Precio de referencia de entrada'", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
        priceUpdatedAt: "2025-04-24T10:30:00Z",
        entryDipPct: 1.54,
        effectiveMinDip: 2.0,
      };
      const html = formatTelegramMessage(ctx);
      expect(html).toContain("Precio de referencia de entrada");
    });

    it("debe contener 'Fuente' y 'VWAP Anclado'", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
        priceUpdatedAt: "2025-04-24T10:30:00Z",
      };
      const html = formatTelegramMessage(ctx);
      expect(html).toContain("Fuente");
      expect(html).toContain("VWAP Anclado");
    });

    it("debe contener 'Precio actual'", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
        priceUpdatedAt: "2025-04-24T10:30:00Z",
      };
      const html = formatTelegramMessage(ctx);
      expect(html).toContain("Precio actual");
    });

    it("debe contener 'Actualizado' con timestamp válido", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
        priceUpdatedAt: "2025-04-24T10:30:00Z",
      };
      const html = formatTelegramMessage(ctx);
      expect(html).toContain("Actualizado");
      expect(html).not.toContain("Invalid Date");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("null");
    });

    it("debe contener 'Caída desde referencia'", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
        entryDipPct: 1.54,
      };
      const html = formatTelegramMessage(ctx);
      expect(html).toContain("Caída desde referencia");
    });

    it("NO debe contener 'BasePrice' (término legacy)", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
      };
      const html = formatTelegramMessage(ctx);
      expect(html).not.toContain("BasePrice");
    });

    it("NO debe contener 'BaseType' (término legacy)", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
      };
      const html = formatTelegramMessage(ctx);
      expect(html).not.toContain("BaseType");
    });

    it("NO debe contener 'anchor_price' (término legacy)", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
      };
      const html = formatTelegramMessage(ctx);
      expect(html).not.toContain("anchor_price");
    });

    it("NO debe contener 'undefined', 'null', 'NaN'", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
        priceUpdatedAt: "2025-04-24T10:30:00Z",
      };
      const html = formatTelegramMessage(ctx);
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("null");
      expect(html).not.toContain("NaN");
    });

    it("NO debe contener 'Invalid Date'", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
        priceUpdatedAt: "2025-04-24T10:30:00Z",
      };
      const html = formatTelegramMessage(ctx);
      expect(html).not.toContain("Invalid Date");
    });
  });

  describe("entry_check_blocked con Hybrid fallback", () => {
    it("debe contener 'Hybrid V2.1 fallback'", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "hybrid_v2_fallback",
        currentPrice: 64000,
        priceUpdatedAt: "2025-04-24T10:30:00Z",
      };
      const html = formatTelegramMessage(ctx);
      expect(html).toContain("Hybrid V2.1 fallback");
    });

    it("debe contener 'Precio actual'", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "hybrid_v2_fallback",
        currentPrice: 64000,
        priceUpdatedAt: "2025-04-24T10:30:00Z",
      };
      const html = formatTelegramMessage(ctx);
      expect(html).toContain("Precio actual");
    });

    it("NO debe contener términos legacy", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "hybrid_v2_fallback",
        currentPrice: 64000,
      };
      const html = formatTelegramMessage(ctx);
      expect(html).not.toContain("BasePrice");
      expect(html).not.toContain("BaseType");
      expect(html).not.toContain("anchor_price");
      expect(html).not.toContain("ancla operativa");
      expect(html).not.toContain("ancla secundaria");
    });
  });

  describe("compras", () => {
    it("base_buy_executed debe usar 'Precio de compra'", () => {
      const ctx: FormatContext = {
        eventType: "base_buy_executed",
        pair: "BTC/USD",
        mode: "SMART_GUARD",
        price: 64000,
        quantity: 0.1,
      };
      const html = formatTelegramMessage(ctx);
      expect(html).toContain("Precio de compra");
    });

    it("safety_buy_executed debe usar 'Precio de compra'", () => {
      const ctx: FormatContext = {
        eventType: "safety_buy_executed",
        pair: "BTC/USD",
        mode: "SMART_GUARD",
        price: 63000,
        quantity: 0.05,
        buyCount: 2,
      };
      const html = formatTelegramMessage(ctx);
      expect(html).toContain("Precio de compra");
    });

    it("compras NO deben usar 'Precio de cierre' ni 'Precio de salida'", () => {
      const ctx: FormatContext = {
        eventType: "base_buy_executed",
        pair: "BTC/USD",
        mode: "SMART_GUARD",
        price: 64000,
      };
      const html = formatTelegramMessage(ctx);
      expect(html).not.toContain("Precio de cierre");
      expect(html).not.toContain("Precio de salida");
    });
  });

  describe("salidas", () => {
    it("trailing_exit debe usar 'Precio de cierre' o 'Precio de salida'", () => {
      const ctx: FormatContext = {
        eventType: "trailing_exit",
        pair: "BTC/USD",
        mode: "SMART_GUARD",
        price: 70000,
        avgEntry: 64000,
        pnlUsd: 6000,
        pnlPct: 9.375,
      };
      const html = formatTelegramMessage(ctx);
      const hasClose = html.includes("Precio de cierre") || html.includes("Precio de salida");
      expect(hasClose).toBe(true);
    });

    it("breakeven_exit debe usar 'Precio de cierre' o 'Precio de salida'", () => {
      const ctx: FormatContext = {
        eventType: "breakeven_exit",
        pair: "BTC/USD",
        mode: "SMART_GUARD",
        price: 64000,
        avgEntry: 64000,
      };
      const html = formatTelegramMessage(ctx);
      const hasClose = html.includes("Precio de cierre") || html.includes("Precio de salida");
      expect(hasClose).toBe(true);
    });

    it("imported_position_closed debe usar 'Precio de cierre' o 'Precio de salida'", () => {
      const ctx: FormatContext = {
        eventType: "imported_position_closed",
        pair: "BTC/USD",
        mode: "SMART_GUARD",
        price: 70000,
        realizedPnl: 6000,
        pnlPct: 9.375,
      };
      const html = formatTelegramMessage(ctx);
      const hasClose = html.includes("Precio de cierre") || html.includes("Precio de salida");
      expect(hasClose).toBe(true);
    });

    it("salidas NO deben usar 'Precio de compra'", () => {
      const ctx: FormatContext = {
        eventType: "trailing_exit",
        pair: "BTC/USD",
        mode: "SMART_GUARD",
        price: 70000,
      };
      const html = formatTelegramMessage(ctx);
      expect(html).not.toContain("Precio de compra");
    });
  });

  describe("timestamp", () => {
    it("con priceUpdatedAt válido debe mostrar 'Actualizado'", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
        priceUpdatedAt: "2025-04-24T10:30:00Z",
      };
      const html = formatTelegramMessage(ctx);
      expect(html).toContain("Actualizado");
    });

    it("con fecha inválida NO debe mostrar 'Invalid Date'", () => {
      const ctx: FormatContext = {
        ...baseCtx,
        entryBasePrice: 65000,
        entryBasePriceType: "vwap_anchor",
        currentPrice: 64000,
        priceUpdatedAt: "invalid-date",
      };
      const html = formatTelegramMessage(ctx);
      expect(html).not.toContain("Invalid Date");
    });
  });
});
