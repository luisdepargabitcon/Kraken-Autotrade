import type { Express } from "express";
import type { TradingEngine } from "../services/tradingEngine";
import { krakenService } from "../services/kraken";
import { revolutXService } from "../services/exchanges/RevolutXService";

/**
 * Shared dependencies injected into route modules.
 * Each route module receives these via its register function.
 */
export interface RouterDeps {
  tradingEngine: TradingEngine | null;
  getTradingEngine: () => TradingEngine | null;
  setTradingEngine: (engine: TradingEngine) => void;
  krakenService: typeof krakenService;
  revolutxService: typeof revolutXService;
}

/**
 * Standard signature for route module registration.
 */
export type RegisterRoutes = (app: Express, deps: RouterDeps) => void | Promise<void>;
