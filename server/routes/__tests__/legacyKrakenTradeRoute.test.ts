import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const createTrade = vi.fn();
const placeOrder = vi.fn();

vi.mock("../../storage", () => ({ storage: { createTrade: (...a: unknown[]) => createTrade(...a) } }));
vi.mock("../../services/kraken", () => ({
  krakenService: { isInitialized: () => true, placeOrder: (...a: unknown[]) => placeOrder(...a), getTickerRaw: vi.fn() },
}));
vi.mock("../../services/telegram", () => ({ telegramService: { sendTradeNotification: vi.fn() } }));

import { registerMarketRoutes } from "../market.routes";

describe("POST /api/trade (ruta legacy de Kraken)", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    createTrade.mockReset();
    placeOrder.mockReset();
    const app = express();
    app.use(express.json());
    registerMarketRoutes(app, {} as any);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("responde 410 KRAKEN_EXECUTION_FORBIDDEN sin crear trade ni llamar a placeOrder, con cualquier cuerpo", async () => {
    for (const body of [
      { pair: "BTC/USD", type: "buy", ordertype: "market", volume: "0.001" },
      { pair: "ETH/USD", type: "sell", ordertype: "limit", volume: "0.1", price: "3000" },
      {},
    ]) {
      const res = await fetch(`${baseUrl}/api/trade`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      expect(res.status).toBe(410);
      const json: any = await res.json();
      expect(json.error).toBe("KRAKEN_EXECUTION_FORBIDDEN");
    }
    expect(createTrade).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
  });
});
