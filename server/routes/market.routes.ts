import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { storage } from "../storage";
import { krakenService } from "../services/kraken";
import { revolutXService } from "../services/exchanges/RevolutXService";
import { telegramService } from "../services/telegram";
import { botLogger } from "../services/botLogger";
import { getActivePairsAllowlist, isPairAllowed, normalizePair } from "../services/pairAllowlist";
import { normalizeRevolutXTrade } from "../utils/revolutxTradeNormalization";

const externalTradeAlertThrottle = new Map<string, number>();

export const registerMarketRoutes: RegisterRoutes = (app, _deps) => {

  app.get("/api/market/:pair", async (req, res) => {
    try {
      const { pair } = req.params;
      const ticker = await krakenService.getTickerRaw(pair);
      
      const tickerData: any = Object.values(ticker)[0] || {};
      const data = await storage.saveMarketData({
        pair,
        price: tickerData.c?.[0] || "0",
        volume24h: tickerData.v?.[1] || "0",
        change24h: "0",
      });
      
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to get market data" });
    }
  });

  app.get("/api/balance", async (req, res) => {
    try {
      if (!krakenService.isInitialized()) {
        return res.status(400).json({ error: "Kraken not configured" });
      }
      
      const balance = await krakenService.getBalance();
      res.json(balance);
    } catch (error) {
      res.status(500).json({ error: "Failed to get balance" });
    }
  });

  // Multi-exchange balances endpoint
  app.get("/api/balances/all", async (req, res) => {
    try {
      const apiConfig = await storage.getApiConfig();
      const result: {
        kraken: { connected: boolean; balances: Record<string, number>; error?: string };
        revolutx: { connected: boolean; balances: Record<string, number>; error?: string };
        activeExchange: string;
        tradingExchange: string;
      } = {
        kraken: { connected: false, balances: {} },
        revolutx: { connected: false, balances: {} },
        activeExchange: apiConfig?.activeExchange || 'kraken',
        tradingExchange: apiConfig?.tradingExchange || apiConfig?.activeExchange || 'kraken',
      };

      // Fetch Kraken balances
      if (krakenService.isInitialized()) {
        result.kraken.connected = true;
        try {
          const rawBalances = await krakenService.getBalanceRaw();
          for (const [key, value] of Object.entries(rawBalances)) {
            const numValue = parseFloat(value);
            if (numValue > 0) {
              result.kraken.balances[key] = numValue;
            }
          }
        } catch (e: any) {
          result.kraken.error = e.message;
        }
      }

      // Fetch Revolut X balances
      if (revolutXService.isInitialized()) {
        result.revolutx.connected = true;
        try {
          const balances = await revolutXService.getBalance();
          for (const [key, val] of Object.entries(balances)) {
            const numVal = typeof val === 'number' ? val : parseFloat(String(val));
            if (numVal > 0) {
              result.revolutx.balances[key] = numVal;
            }
          }
        } catch (e: any) {
          result.revolutx.error = e.message;
        }
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to get multi-exchange balances" });
    }
  });

  // Get prices for all portfolio assets dynamically
  app.get("/api/prices/portfolio", async (req, res) => {
    try {
      const prices: Record<string, { price: number; source: string }> = {};
      const stablecoins = ["USD", "ZUSD", "USDC", "USDT", "EUR"];

      const botConfig = await storage.getBotConfig();
      const activePairsAllowlist = getActivePairsAllowlist((botConfig as any)?.activePairs);
      
      // Normalize Kraken symbols to standard tickers
      const krakenToStandard: Record<string, string> = {
        "XXBT": "BTC", "XBT": "BTC", "XETH": "ETH", "XXRP": "XRP",
        "XXLM": "XLM", "XLTC": "LTC", "XXDG": "DOGE", "ZUSD": "USD",
        "ZEUR": "EUR", "ZGBP": "GBP", "ZCAD": "CAD",
      };
      
      // Collect all unique assets from both exchanges (normalized)
      const assetBalances: Map<string, { balance: number; originalSymbol: string; exchange: string }> = new Map();
      
      if (krakenService.isInitialized()) {
        try {
          const rawBalances = await krakenService.getBalanceRaw();
          for (const [key, value] of Object.entries(rawBalances)) {
            const balance = parseFloat(value);
            if (balance > 0) {
              const normalized = krakenToStandard[key] || key;
              assetBalances.set(key, { balance, originalSymbol: key, exchange: 'kraken' });
              // Also add normalized version
              if (krakenToStandard[key]) {
                assetBalances.set(normalized, { balance, originalSymbol: key, exchange: 'kraken' });
              }
            }
          }
        } catch (e) { /* ignore */ }
      }
      
      if (revolutXService.isInitialized()) {
        try {
          const balances = await revolutXService.getBalance();
          for (const [key, val] of Object.entries(balances)) {
            const numVal = typeof val === 'number' ? val : parseFloat(String(val));
            if (numVal > 0) {
              assetBalances.set(key, { balance: numVal, originalSymbol: key, exchange: 'revolutx' });
            }
          }
        } catch (e) { /* ignore */ }
      }
      
      // Stablecoins have fixed USD value
      for (const stable of stablecoins) {
        if (assetBalances.has(stable)) {
          prices[stable] = { price: stable === "EUR" ? 1.08 : 1, source: "fixed" };
        }
      }
      
      // Map standard symbols to Kraken trading pairs
      const krakenPairMap: Record<string, string> = {
        "XXBT": "XXBTZUSD", "BTC": "XXBTZUSD",
        "XETH": "XETHZUSD", "ETH": "XETHZUSD",
        "SOL": "SOLUSD", "XXRP": "XXRPZUSD", "XRP": "XXRPZUSD",
        "TON": "TONUSD", "DOT": "DOTUSD", "ADA": "ADAUSD",
        "LINK": "LINKUSD", "AVAX": "AVAXUSD", "MATIC": "MATICUSD",
        "XLM": "XLMUSD", "LTC": "XLTCZUSD", "DOGE": "XDGUSD",
      };
      
      // CoinGecko ID mapping for common assets
      const coinGeckoIds: Record<string, string> = {
        "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana",
        "XRP": "ripple", "TON": "the-open-network", "DOT": "polkadot",
        "ADA": "cardano", "LINK": "chainlink", "AVAX": "avalanche-2",
        "MATIC": "matic-network", "XLM": "stellar", "LTC": "litecoin",
        "DOGE": "dogecoin", "VET": "vechain", "FLR": "flare-networks",
        "MEW": "cat-in-a-dogs-world", "LMWR": "limewire", "ZKJ": "polyhedra-network",
        "USDC": "usd-coin", "USDT": "tether",
      };
      
      // Collect assets that need prices
      const assetsNeedingPrices: string[] = [];
      for (const [asset] of Array.from(assetBalances.entries())) {
        if (stablecoins.includes(asset)) continue;
        if (prices[asset]) continue;
        // Normalize Kraken prefixes
        const normalized = krakenToStandard[asset] || asset;
        if (!assetsNeedingPrices.includes(normalized)) {
          assetsNeedingPrices.push(normalized);
        }
      }
      
      // Try to fetch all prices from CoinGecko in one request (most efficient)
      const coinGeckoIdsToFetch = assetsNeedingPrices
        .map(a => coinGeckoIds[a])
        .filter(Boolean);
      
      if (coinGeckoIdsToFetch.length > 0) {
        try {
          const ids = coinGeckoIdsToFetch.join(',');
          const cgResponse = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
            { headers: { 'Accept': 'application/json' } }
          );
          if (cgResponse.ok) {
            const cgPrices = await cgResponse.json() as Record<string, { usd?: number }>;
            // Map CoinGecko prices back to symbols
            for (const [symbol, cgId] of Object.entries(coinGeckoIds)) {
              if (cgPrices[cgId]?.usd) {
                prices[symbol] = { price: cgPrices[cgId].usd, source: "coingecko" };
                // Also add Kraken prefix version
                const krakenSymbol = Object.entries(krakenToStandard).find(([_, v]) => v === symbol)?.[0];
                if (krakenSymbol) {
                  prices[krakenSymbol] = prices[symbol];
                }
              }
            }
          }
        } catch (e: any) {
          console.log('[prices/portfolio] CoinGecko fallback failed:', e.message);
        }
      }
      
      // Fetch remaining prices from exchanges
      for (const [asset, info] of Array.from(assetBalances.entries())) {
        if (stablecoins.includes(asset)) continue;
        if (prices[asset]) continue; // Already have price from CoinGecko
        
        // Skip Kraken prefix duplicates (we'll use the normalized version)
        const normalized = krakenToStandard[asset];
        if (normalized && prices[normalized]) {
          prices[asset] = prices[normalized];
          continue;
        }
        
        // Try Revolut X for altcoins
        if (revolutXService.isInitialized()) {
          try {
            const normalizedAsset = krakenToStandard[asset] || asset;
            const pair = `${normalizedAsset}-USD`;

            if (isPairAllowed(pair, activePairsAllowlist)) {
              const ticker = await revolutXService.getTicker(pair);
              if (ticker && ticker.last > 0) {
                prices[asset] = { price: ticker.last, source: "revolutx" };
                continue;
              }
            }
          } catch (e: any) {
            // Log only if not a 404/not found error
            if (!e.message?.includes('404') && !e.message?.includes('not found')) {
              console.log(`[prices/portfolio] RevolutX ${asset}: ${e.message}`);
            }
          }
        }
        
        // Try Kraken
        if (krakenService.isInitialized()) {
          try {
            const krakenPair = krakenPairMap[asset] || krakenPairMap[info.originalSymbol];
            if (krakenPair) {
              const ticker = await krakenService.getTicker(krakenPair) as any;
              if (ticker && ticker.c && ticker.c[0]) {
                prices[asset] = { price: parseFloat(ticker.c[0]), source: "kraken" };
                continue;
              }
            }
          } catch (e) { /* ignore */ }
        }
        
        // No price found - mark as unavailable
        prices[asset] = { price: 0, source: "unavailable" };
      }
      
      res.json({ prices, fetchedAt: new Date().toISOString() });
    } catch (error: any) {
      console.error("[api/prices/portfolio] Error:", error.message);
      res.status(500).json({ error: "Failed to get portfolio prices" });
    }
  });

  app.post("/api/trade", async (req, res) => {
    try {
      if (String(process.env.TRADING_ENABLED ?? 'true').toLowerCase() !== 'true') {
        return res.status(403).json({
          error: 'TRADING_DISABLED',
          message: 'Trading deshabilitado por kill-switch (TRADING_ENABLED!=true).',
        });
      }

      if (!krakenService.isInitialized()) {
        return res.status(400).json({ error: "Kraken not configured" });
      }

      const { pair, type, ordertype, volume, price } = req.body;
      
      const tradeId = `T-${Date.now()}`;
      
      const trade = await storage.createTrade({
        tradeId,
        exchange: 'kraken',
        origin: 'manual',  // Manual API call
        pair,
        type,
        price: price || "0",
        amount: volume,
        status: "pending",
      });

      const order = await krakenService.placeOrder({
        pair,
        type,
        ordertype,
        volume,
        price,
      });

      await storage.updateTradeStatus(tradeId, "filled", (order as any).txid?.[0]);
      
      await telegramService.sendTradeNotification({
        type,
        pair,
        price: price || "market",
        amount: volume,
        status: "filled",
      });

      res.json({ success: true, trade, order });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to place trade" });
    }
  });

  // Endpoint para trading con RevolutX
  app.post("/api/trade/revolutx", async (req, res) => {
    try {
      if (String(process.env.TRADING_ENABLED ?? 'true').toLowerCase() !== 'true') {
        return res.status(403).json({
          error: 'TRADING_DISABLED',
          message: 'Trading deshabilitado por kill-switch (TRADING_ENABLED!=true).',
        });
      }

      const { pair, type, ordertype, volume } = req.body;
      
      if (!pair || !type || !volume) {
        return res.status(400).json({ 
          error: "Missing required parameters: pair, type, volume" 
        });
      }
      
      if (!["buy", "sell"].includes(type)) {
        return res.status(400).json({ 
          error: "Invalid order type. Must be 'buy' or 'sell'" 
        });
      }
      
      const botConfig = await storage.getBotConfig();
      const activePairsAllowlist = getActivePairsAllowlist((botConfig as any)?.activePairs);
      const normalizedPair = normalizePair(String(pair));
      if (!isPairAllowed(normalizedPair, activePairsAllowlist)) {
        return res.status(400).json({
          error: "PAIR_NOT_ALLOWED",
          message: `Par no permitido: ${normalizedPair}. Solo se permiten pares activos.`,
        });
      }

      const pairForUse = normalizedPair;
      
      // Usar RevolutXService ya inicializado globalmente
      if (!revolutXService.isInitialized()) {
        return res.status(400).json({ 
          error: "RevolutX not initialized" 
        });
      }
      
      console.log(`[API] RevolutX trade request: ${type} ${volume} ${pair}`);
      
      // Ejecutar la orden
      const order = await revolutXService.placeOrder({
        pair: pairForUse,
        type: type as "buy" | "sell",
        ordertype: ordertype || "market",
        volume: volume.toString()
      });
      
      if (!order.success) {
        console.error(`[API] RevolutX trade failed:`, order.error);
        return res.status(400).json({ 
          error: order.error || "Trade failed" 
        });
      }

      // If RevolutX accepted the order but price is not yet available, do NOT fail.
      // Return pendingFill so caller can reconcile via FillWatcher/sync.
      if ((order as any)?.pendingFill === true) {
        return res.status(202).json({
          success: true,
          pendingFill: true,
          orderId: (order as any)?.orderId,
          clientOrderId: (order as any)?.clientOrderId,
          message: 'Order accepted by RevolutX but execution price not yet available. Reconcile via fills/getOrder.',
          order,
        });
      }
      
      // Guardar en base de datos usando el ID de RevolutX
      const tradeId = order.orderId || `RX-${Date.now()}`;

      let resolvedPrice = typeof order.price === 'number' ? order.price : parseFloat(String(order.price || '0'));
      const resolvedVol = typeof order.volume === 'number' ? order.volume : parseFloat(String(order.volume || volume || '0'));
      const resolvedCost = typeof order.cost === 'number' ? order.cost : parseFloat(String(order.cost || '0'));

      if ((!Number.isFinite(resolvedPrice) || resolvedPrice <= 0) && Number.isFinite(resolvedCost) && resolvedCost > 0 && Number.isFinite(resolvedVol) && resolvedVol > 0) {
        resolvedPrice = resolvedCost / resolvedVol;
      }

      if (!Number.isFinite(resolvedPrice) || resolvedPrice <= 0) {
        try {
          const ticker = await revolutXService.getTicker(pairForUse);
          resolvedPrice = type === 'buy' ? ticker.ask : ticker.bid;
        } catch {
          // Ignore
        }
      }

      if (!Number.isFinite(resolvedPrice) || resolvedPrice <= 0) {
        return res.status(400).json({ error: 'RevolutX order executed but price could not be determined (avoiding price=0 trade)' });
      }

      const trade = await storage.createTrade({
        tradeId,
        exchange: 'revolutx',
        origin: 'manual',  // Manual API call
        pair: pairForUse,
        type,
        price: resolvedPrice.toString(),
        amount: (Number.isFinite(resolvedVol) && resolvedVol > 0 ? resolvedVol : parseFloat(volume.toString())).toString(),
        status: "filled",
      });
      
      // Enviar notificación a Telegram
      await telegramService.sendTradeNotification({
        type,
        pair: pairForUse,
        price: resolvedPrice.toString(),
        amount: (Number.isFinite(resolvedVol) && resolvedVol > 0 ? resolvedVol : parseFloat(volume.toString())).toString(),
        status: "filled",
      });
      
      console.log(`[API] RevolutX trade executed: ${tradeId}`);
      
      res.json({ 
        success: true, 
        trade: {
          tradeId,
          pair: pairForUse,
          type,
          amount: order.volume?.toString() || volume.toString(),
          price: order.price,
          cost: order.cost,
          status: "filled"
        },
        order 
      });
      
    } catch (error: any) {
      console.error(`[API] RevolutX trade error:`, error);
      res.status(500).json({ 
        error: error.message || "Failed to place RevolutX trade" 
      });
    }
  });

  app.get("/api/notifications", async (req, res) => {
    try {
      const notifications = await storage.getUnsentNotifications();
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ error: "Failed to get notifications" });
    }
  });

  app.post("/api/trades/sync-revolutx", async (req, res) => {
    try {
      if (String(process.env.REVOLUTX_SYNC_ENABLED || '').toLowerCase() !== 'true') {
        return res.status(403).json({
          error: 'REVOLUTX_SYNC_DISABLED',
          message: 'RevolutX sync deshabilitado en este entorno (REVOLUTX_SYNC_ENABLED!=true). RevolutX real solo funciona en VPS con IP whitelisted.',
        });
      }

      if (!revolutXService.isInitialized()) {
        return res.status(400).json({ error: "RevolutX not configured" });
      }

      const pairRaw = (req.body?.pair ?? req.query?.pair ?? '').toString().trim();
      const scope = pairRaw ? pairRaw : 'ALL';

      const now = new Date();
      const nowMs = now.getTime();

      const limit = Math.min(100, Math.max(1, Number(req.body?.limit ?? req.query?.limit ?? 100)));
      const debug = String(req.body?.debug ?? req.query?.debug ?? '').toLowerCase() === 'true' || String(req.query?.debug) === '1';
      const allowAssumedSide = String(req.body?.allowAssumedSide ?? req.query?.allowAssumedSide ?? '').toLowerCase() === 'true' || String(req.query?.allowAssumedSide) === '1';

      const sinceDefaultIso = (process.env.REVOLUTX_SYNC_SINCE_DEFAULT || '2026-01-17T00:00:00Z');
      const sinceDefault = new Date(sinceDefaultIso);
      if (isNaN(sinceDefault.getTime())) {
        return res.status(500).json({ error: 'INVALID_REVOLUTX_SYNC_SINCE_DEFAULT', message: `REVOLUTX_SYNC_SINCE_DEFAULT inválido: ${sinceDefaultIso}` });
      }

      const sinceOverrideRaw = (req.body?.since ?? req.query?.since ?? '').toString().trim();
      const sinceOverride = sinceOverrideRaw ? new Date(sinceOverrideRaw) : null;
      if (sinceOverrideRaw && (!sinceOverride || isNaN(sinceOverride.getTime()))) {
        return res.status(400).json({ error: 'INVALID_SINCE', message: `since inválido: ${sinceOverrideRaw}` });
      }

      let synced = 0;
      let skipped = 0;
      let assumedSideCount = 0;
      const errors: string[] = [];
      let totalFetched = 0;
      const debugSamples: any[] = [];

      const botConfig = await storage.getBotConfig();
      const activePairs = (botConfig as any)?.activePairs as string[] | undefined;
      const pairsToSync = pairRaw ? [pairRaw] : (Array.isArray(activePairs) && activePairs.length > 0 ? activePairs : []);
      if (!pairRaw && pairsToSync.length === 0) {
        return res.status(400).json({
          error: 'ACTIVE_PAIRS_REQUIRED',
          message: 'No hay pares activos en config (botConfig.activePairs). Define activePairs o envía pair específico para debug.',
        });
      }

      const stateBefore = await storage.getExchangeSyncState('revolutx', scope);
      const sinceFromState = stateBefore?.cursorValue ? new Date(stateBefore.cursorValue) : null;
      const since = sinceOverride || sinceFromState || sinceDefault;

      await storage.upsertExchangeSyncState({
        exchange: 'revolutx',
        scope,
        cursorType: 'timestamp',
        cursorValue: stateBefore?.cursorValue ?? null,
        lastRunAt: now,
        lastOkAt: stateBefore?.lastOkAt ?? null,
        lastError: null,
      });

      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const sinceMs = since.getTime();
      if (!Number.isFinite(sinceMs) || sinceMs <= 0 || sinceMs > nowMs) {
        return res.status(400).json({ error: 'INVALID_SINCE_RANGE', message: `since fuera de rango: ${since.toISOString()}` });
      }

      const byPair: Record<string, { fetched: number; inserted: number; skipped: number; assumedSideCount: number; errors: number }> = {};
      let maxExecutedAtSeenMs = sinceMs;

      const normalizeTrade = (t: any) => normalizeRevolutXTrade(t, allowAssumedSide);

      const syncPair = async (pairToSync: string) => {
        const symbol = pairToSync.replace('/', '-');
        const pair = symbol.replace('-', '/');
        if (!byPair[pair]) {
          byPair[pair] = { fetched: 0, inserted: 0, skipped: 0, assumedSideCount: 0, errors: 0 };
        }

        const fetchWindow = async (windowStart: number, windowEnd: number) => {
          let ws = windowStart;
          let loop = 0;
          while (ws < windowEnd) {
            loop++;
            const fills = await revolutXService.getFills({
              symbol: pair,
              startMs: ws,
              endMs: windowEnd,
              limit,
            });

            if (!Array.isArray(fills) || fills.length === 0) break;

            const trades = fills
              .map((f: any) => ({
                tid: f.fill_id,
                order_id: f.order_id,
                client_order_id: f.client_order_id,
                symbol: f.symbol || symbol,
                side: f.side,
                p: f.price,
                q: f.quantity,
                tdt: new Date(f.created_at).getTime(),
                raw: f,
              }))
              .sort((a: any, b: any) => Number(a.tdt) - Number(b.tdt));

            totalFetched += trades.length;
            byPair[pair].fetched += trades.length;

            let maxSeenMs = ws;
            for (const t of trades) {
              const n = normalizeTrade(t);
              if (!n.tradeId) {
                skipped++;
                byPair[pair].skipped++;
                continue;
              }
              if (!n.type) {
                if (debug && debugSamples.length < 5) {
                  debugSamples.push({
                    tradeId: String(n.tradeId),
                    keys: Object.keys(t || {}),
                    sample: t,
                    normalized: n,
                  });
                }
                errors.push(`${pair}:${n.tradeId}: missing side/type`);
                byPair[pair].errors++;
                skipped++;
                byPair[pair].skipped++;
                continue;
              }

              if (debug && debugSamples.length < 2) {
                debugSamples.push({
                  tradeId: String(n.tradeId),
                  sample: t,
                  normalized: n,
                });
              }

              if (n.assumed) {
                assumedSideCount++;
                byPair[pair].assumedSideCount++;
              }
              if (!(n.executedAt instanceof Date) || isNaN(n.executedAt.getTime())) {
                errors.push(`${pair}:${n.tradeId}: invalid executedAt`);
                byPair[pair].errors++;
                skipped++;
                byPair[pair].skipped++;
                continue;
              }

              const executedAtMs = n.executedAt.getTime();
              if (Number.isFinite(executedAtMs) && executedAtMs > maxExecutedAtSeenMs) {
                maxExecutedAtSeenMs = executedAtMs;
              }

              if (Number.isFinite(executedAtMs) && executedAtMs > maxSeenMs) {
                maxSeenMs = executedAtMs;
              }

              const priceStr = n.price != null ? String(n.price) : "0";
              const amountStr = n.amount != null ? String(n.amount) : "0";

              const tradeIdFinal = String(n.tradeId);

              try {
                const patchExtId = (t as any)?.order_id ? String((t as any).order_id) : undefined;
                const { inserted, trade: insertedTrade } = await storage.insertTradeIgnoreDuplicate({
                  tradeId: tradeIdFinal,
                  krakenOrderId: patchExtId,
                  pair,
                  type: n.type,
                  price: priceStr,
                  amount: amountStr,
                  status: 'filled',
                  executedAt: n.executedAt,
                  exchange: 'revolutx',
                  origin: 'sync',
                });

                if (!inserted && patchExtId) {
                  const existing = insertedTrade ?? await storage.getTradeByComposite('revolutx', pair, tradeIdFinal);
                  if (existing && (!(existing as any).krakenOrderId || String((existing as any).krakenOrderId).trim().length === 0)) {
                    await storage.updateTradeByCompositeKey('revolutx', pair, tradeIdFinal, {
                      krakenOrderId: patchExtId,
                    } as any);
                  }
                }

                if (inserted && insertedTrade) {
                  synced++;
                  byPair[pair].inserted++;

                  // BOT ORDER ATTRIBUTION: Try to match this trade with a pending order intent
                  try {
                    const pendingIntents = await storage.getPendingOrderIntents('revolutx');
                    
                    // Find matching intent by pair, side, and approximate volume (within 5%)
                    const tradeVolume = parseFloat(amountStr);
                    const matchingIntent = pendingIntents.find(intent => {
                      if (intent.pair !== pair || intent.side !== n.type) return false;
                      const intentVolume = parseFloat(intent.volume);
                      const volumeDiff = Math.abs(tradeVolume - intentVolume) / intentVolume;
                      return volumeDiff < 0.05; // Within 5% tolerance
                    });
                    
                    if (matchingIntent) {
                      // Mark trade as executed by bot
                      await storage.markTradeAsExecutedByBot(insertedTrade.id, matchingIntent.id);
                      await storage.matchOrderIntentToTrade(matchingIntent.clientOrderId, insertedTrade.id);
                      console.log(`[sync-revolutx] Trade ${insertedTrade.id} matched to bot order intent ${matchingIntent.clientOrderId}`);
                      await botLogger.info("TRADE_EXECUTED" as any, `Trade matched to bot order intent`, {
                        tradeId: insertedTrade.id,
                        clientOrderId: matchingIntent.clientOrderId,
                        pair,
                        type: n.type,
                        volume: amountStr,
                      });
                    }
                  } catch (matchErr: any) {
                    console.error(`[sync-revolutx] Error matching trade to intent:`, matchErr.message);
                  }

                  // NOTE: Position creation/deletion is now handled by reconcile-with-balance
                  // Sync only imports trades to DB, reconcile handles position state based on real balances
                  // This prevents "resurrection" of sold positions
                  console.log(`[sync-revolutx] Trade synced: ${n.type} ${pair} ${amountStr} @ ${priceStr}`);

                  if (String(process.env.ALERT_EXTERNAL_TRADES ?? 'false').toLowerCase() === 'true') {
                    const executedAt = n.executedAt instanceof Date ? n.executedAt : null;
                    const windowMin = Math.max(1, Number(process.env.EXTERNAL_ALERT_WINDOW_MIN ?? 10));
                    const rateLimitSec = Math.max(10, Number(process.env.EXTERNAL_ALERT_RATE_LIMIT_SEC ?? 60));
                    const key = `revolutx:${pair}`;
                    const lastSent = externalTradeAlertThrottle.get(key) || 0;
                    const nowTs = Date.now();

                    if (executedAt && (nowTs - executedAt.getTime()) <= windowMin * 60 * 1000 && (nowTs - lastSent) >= rateLimitSec * 1000) {
                      externalTradeAlertThrottle.set(key, nowTs);
                      if (telegramService?.isInitialized()) {
                        const msg = [
                          `<b>⚠️ Trade importado detectado (SYNC)</b>`,
                          `Exchange: <code>REVOLUTX</code>`,
                          `Par: <code>${pair}</code>`,
                          `Tipo: <code>${n.type}</code>`,
                          `Cantidad: <code>${amountStr}</code>`,
                          `Precio: <code>${priceStr}</code>`,
                          `ExecutedAt: <code>${executedAt.toISOString()}</code>`,
                        ].join("\n");
                        await telegramService.sendAlertToMultipleChats(msg, "trades");
                      }
                    }
                  }
                } else {
                  skipped++;
                  byPair[pair].skipped++;
                }
              } catch (e: any) {
                console.error('[sync-revolutx] Error syncing trade:', n.tradeId, e.message);
                errors.push(`${pair}:${n.tradeId}: ${e.message}`);
                byPair[pair].errors++;
              }
            }

            if (!Number.isFinite(maxSeenMs) || maxSeenMs <= ws) break;
            ws = maxSeenMs + 1;

            if (loop > 2000) {
              errors.push(`Pagination safety break after ${loop} loops for ${symbol}`);
              break;
            }
          }
        };

        if (nowMs - sinceMs <= WEEK_MS) {
          await fetchWindow(sinceMs, nowMs);
        } else {
          let ws = sinceMs;
          while (ws < nowMs) {
            const we = Math.min(nowMs, ws + WEEK_MS);
            await fetchWindow(ws, we);
            ws = we;
          }
        }
      };

      try {
        for (const p of pairsToSync) {
          await syncPair(p);
        }

        const cursorValueToSave = maxExecutedAtSeenMs > sinceMs ? new Date(maxExecutedAtSeenMs) : since;
        await storage.upsertExchangeSyncState({
          exchange: 'revolutx',
          scope,
          cursorType: 'timestamp',
          cursorValue: cursorValueToSave,
          lastRunAt: now,
          lastOkAt: now,
          lastError: null,
        });

        // Auto-rebuild P&L for any sells that still lack it
        let pnlRebuilt = 0;
        try {
          const rebuildResult = await storage.rebuildPnlForAllSells();
          pnlRebuilt = rebuildResult.updated;
          if (pnlRebuilt > 0) {
            console.log(`[sync-revolutx] P&L rebuild: ${pnlRebuilt} updated, ${rebuildResult.skipped} skipped`);
          }
        } catch (e: any) {
          console.warn(`[sync-revolutx] P&L rebuild failed: ${e.message}`);
        }

        res.json({
          scope,
          pairsToSync,
          since: since.toISOString(),
          cursorBefore: stateBefore?.cursorValue ? new Date(stateBefore.cursorValue).toISOString() : undefined,
          cursorAfter: cursorValueToSave.toISOString(),
          synced,
          skipped,
          pnlRebuilt,
          assumedSideCount: assumedSideCount > 0 ? assumedSideCount : undefined,
          fetched: totalFetched,
          byPair,
          limit,
          allowAssumedSide: allowAssumedSide ? true : undefined,
          errors: errors.length > 0 ? errors.slice(0, 50) : undefined,
          debugSamples: debug ? debugSamples : undefined,
        });
      } catch (e: any) {
        await storage.upsertExchangeSyncState({
          exchange: 'revolutx',
          scope,
          cursorType: 'timestamp',
          cursorValue: stateBefore?.cursorValue ?? null,
          lastRunAt: now,
          lastOkAt: stateBefore?.lastOkAt ?? null,
          lastError: e?.message || String(e),
        });
        throw e;
      }
    } catch (error: any) {
      console.error('[sync-revolutx] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // RECONCILE: Limpia posiciones del bot que no tienen balance real
  // REGLA ÚNICA: open_positions = solo posiciones del bot (engine), nunca balances externos
  // 
  // FUNCIONAMIENTO:
  // - Elimina posiciones del bot si balance real del asset es 0 (autoClean)
  // - Actualiza qty SOLO si la posición es del bot (engine-managed)
  // - PROHIBIDO: crear posiciones desde balances externos
  app.post("/api/positions/reconcile", async (req, res) => {
    try {
      const { exchange = 'kraken', dryRun = false, autoClean = true } = req.body;
      
      // Dust threshold per asset (minimum tradeable amount)
      const dustThresholds: Record<string, number> = {
        BTC: 0.0001,
        ETH: 0.001,
        SOL: 0.01,
        XRP: 1,
        TON: 1,
        USD: 1,
        EUR: 1,
      };
      
      // Asset to pair mapping
      const assetToPair: Record<string, string> = {
        BTC: 'BTC/USD',
        ETH: 'ETH/USD',
        SOL: 'SOL/USD',
        XRP: 'XRP/USD',
        TON: 'TON/USD',
      };
      
      let realBalances: Record<string, number> = {};
      
      // Get real balances from exchange
      if (exchange === 'revolutx') {
        if (!revolutXService.isInitialized()) {
          return res.status(400).json({ error: 'RevolutX not configured' });
        }
        realBalances = await revolutXService.getBalance();
      } else if (exchange === 'kraken') {
        if (!krakenService.isInitialized()) {
          return res.status(400).json({ error: 'Kraken not configured' });
        }
        const krakenBalances = await krakenService.getBalanceRaw();
        // Map Kraken asset names to standard names
        const krakenAssetMap: Record<string, string> = {
          XXBT: 'BTC', XBT: 'BTC',
          XETH: 'ETH', ETH: 'ETH',
          SOL: 'SOL',
          XXRP: 'XRP', XRP: 'XRP',
          TON: 'TON',
          ZUSD: 'USD', USD: 'USD',
          ZEUR: 'EUR', EUR: 'EUR',
        };
        for (const [key, val] of Object.entries(krakenBalances)) {
          const standardAsset = krakenAssetMap[key] || key;
          realBalances[standardAsset] = parseFloat(String(val) || '0');
        }
      } else {
        return res.status(400).json({ error: `Exchange '${exchange}' not supported for reconcile` });
      }
      
      console.log(`[reconcile] Real balances from ${exchange}:`, realBalances);
      
      // Get current config for SMART_GUARD snapshot
      const currentConfig = await storage.getBotConfig();
      const positionMode = currentConfig?.positionMode || "SMART_GUARD";
      
      const buildConfigSnapshot = (pair: string) => {
        const snapshot: any = {
          stopLossPercent: parseFloat(currentConfig?.stopLossPercent?.toString() || "5"),
          takeProfitPercent: parseFloat(currentConfig?.takeProfitPercent?.toString() || "7"),
          trailingStopEnabled: currentConfig?.trailingStopEnabled ?? false,
          trailingStopPercent: parseFloat(currentConfig?.trailingStopPercent?.toString() || "2"),
          positionMode,
        };
        if (positionMode === "SMART_GUARD") {
          const overrides = (currentConfig?.sgPairOverrides as Record<string, any>)?.[pair];
          snapshot.sgMinEntryUsd = parseFloat(overrides?.sgMinEntryUsd?.toString() || currentConfig?.sgMinEntryUsd?.toString() || "100");
          snapshot.sgAllowUnderMin = overrides?.sgAllowUnderMin ?? currentConfig?.sgAllowUnderMin ?? true;
          snapshot.sgBeAtPct = parseFloat(overrides?.sgBeAtPct?.toString() || currentConfig?.sgBeAtPct?.toString() || "1.5");
          snapshot.sgFeeCushionPct = parseFloat(overrides?.sgFeeCushionPct?.toString() || currentConfig?.sgFeeCushionPct?.toString() || "0.45");
          snapshot.sgFeeCushionAuto = overrides?.sgFeeCushionAuto ?? currentConfig?.sgFeeCushionAuto ?? true;
          snapshot.sgTrailStartPct = parseFloat(overrides?.sgTrailStartPct?.toString() || currentConfig?.sgTrailStartPct?.toString() || "2");
          snapshot.sgTrailDistancePct = parseFloat(overrides?.sgTrailDistancePct?.toString() || currentConfig?.sgTrailDistancePct?.toString() || "1.5");
          snapshot.sgTrailStepPct = parseFloat(overrides?.sgTrailStepPct?.toString() || currentConfig?.sgTrailStepPct?.toString() || "0.25");
          snapshot.sgTpFixedEnabled = overrides?.sgTpFixedEnabled ?? currentConfig?.sgTpFixedEnabled ?? false;
          snapshot.sgTpFixedPct = parseFloat(overrides?.sgTpFixedPct?.toString() || currentConfig?.sgTpFixedPct?.toString() || "10");
          snapshot.sgScaleOutEnabled = overrides?.sgScaleOutEnabled ?? currentConfig?.sgScaleOutEnabled ?? false;
          snapshot.sgScaleOutPct = parseFloat(overrides?.sgScaleOutPct?.toString() || currentConfig?.sgScaleOutPct?.toString() || "35");
          snapshot.sgMinPartUsd = parseFloat(overrides?.sgMinPartUsd?.toString() || currentConfig?.sgMinPartUsd?.toString() || "50");
          snapshot.sgScaleOutThreshold = parseFloat(overrides?.sgScaleOutThreshold?.toString() || currentConfig?.sgScaleOutThreshold?.toString() || "80");
        }
        return snapshot;
      };
      
      // Get existing positions for this exchange
      const existingPositions = await storage.getOpenPositions();
      const exchangePositions = existingPositions.filter(p => 
        (p.exchange || 'kraken').toLowerCase() === exchange.toLowerCase()
      );
      
      const results: any[] = [];
      let created = 0;
      let deleted = 0;
      let updated = 0;
      let unchanged = 0;
      
      // Build set of pairs with positions
      const positionsByPair = new Map<string, typeof exchangePositions[0]>();
      for (const pos of exchangePositions) {
        positionsByPair.set(pos.pair, pos);
      }
      
      // 1) Check each asset with balance > dust → create position if missing
      for (const [asset, balance] of Object.entries(realBalances)) {
        const pair = assetToPair[asset];
        if (!pair) continue; // Skip non-tradeable assets (USD, EUR, etc.)
        
        const dust = dustThresholds[asset] || 0.0001;
        const existingPos = positionsByPair.get(pair);
        
        if (balance <= dust) {
          // Balance is dust or zero
          if (existingPos) {
            // Position exists but balance is 0 → DELETE (prevent resurrection)
            if (dryRun) {
              results.push({ pair, asset, action: 'would_delete', reason: 'balance_zero', balance, dust, lotId: existingPos.lotId });
            } else if (autoClean) {
              await storage.deleteOpenPositionByLotId(existingPos.lotId);
              await botLogger.info("POSITION_DELETED_RECONCILE", `Position deleted: balance is zero/dust`, {
                pair, asset, balance, dust, lotId: existingPos.lotId, exchange,
              });
              results.push({ pair, asset, action: 'deleted', reason: 'balance_zero', balance, dust, lotId: existingPos.lotId });
              deleted++;
            } else {
              results.push({ pair, asset, action: 'orphan', reason: 'balance_zero_no_autoclean', balance, dust, lotId: existingPos.lotId });
            }
          }
          // No position and no balance → nothing to do
        } else {
          // Balance > dust
          if (!existingPos) {
            // REGLA ESTRICTA: Reconciliación NUNCA crea posiciones
            // Las posiciones SOLO las crea el bot por señal válida
            // Si hay balance sin posición, es balance externo (depósito manual, transferencia, etc.)
            results.push({ 
              pair, asset, action: 'skipped_external_balance', balance, 
              reason: 'External balance detected - reconcile does NOT create positions (only trading engine by signal)' 
            });
          } else {
            // Position exists and has balance → check if qty matches
            const posAmount = parseFloat(existingPos.amount || '0');
            const diff = Math.abs(balance - posAmount);
            const diffPct = posAmount > 0 ? (diff / posAmount) * 100 : 100;
            
            // REGLA ÚNICA: Solo actualizar qty si la posición es del bot (engine-managed)
            // Las posiciones del bot tienen configSnapshot y lotId sin prefijos especiales
            const isBotPosition = existingPos.configSnapshotJson != null && 
                                 existingPos.entryMode === 'SMART_GUARD' &&
                                 !existingPos.lotId?.startsWith('reconcile-') &&
                                 !existingPos.lotId?.startsWith('sync-') &&
                                 !existingPos.lotId?.startsWith('adopt-');
            
            if (diffPct > 5) { // More than 5% difference
              if (!isBotPosition) {
                // NO actualizar posiciones que no son del bot
                results.push({ 
                  pair, asset, action: 'skipped_not_bot_position', 
                  balance, posAmount, diffPct: diffPct.toFixed(2),
                  reason: 'Position is not a bot position (no configSnapshot or has special lotId prefix)',
                  lotId: existingPos.lotId,
                });
              } else if (dryRun) {
                results.push({ pair, asset, action: 'would_update', balance, posAmount, diffPct: diffPct.toFixed(2) });
              } else {
                // Update position amount to match real balance (only for bot positions)
                // Also recalculate average_entry_price from trades if available
                let newAvgPrice = existingPos.entryPrice;
                let totalCost = parseFloat(existingPos.totalCostQuote || '0');
                let totalAmount = parseFloat(existingPos.totalAmountBase || '0');
                
                // Recalculate aggregates from trades if position has clientOrderId
                if (existingPos.clientOrderId) {
                  const positionTrades = await storage.getRecentTradesForReconcile({
                    pair,
                    exchange: exchange === 'revolutx' ? 'revolutx' : 'kraken',
                    origin: 'sync',
                    since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days
                    limit: 100,
                    executedByBot: true,
                  });
                  
                  if (positionTrades.length > 0) {
                    totalCost = 0;
                    totalAmount = 0;
                    for (const trade of positionTrades) {
                      const tradePrice = parseFloat(trade.price);
                      const tradeAmount = parseFloat(trade.amount);
                      totalCost += tradePrice * tradeAmount;
                      totalAmount += tradeAmount;
                    }
                    newAvgPrice = totalAmount > 0 ? (totalCost / totalAmount).toFixed(8) : existingPos.entryPrice;
                  }
                }
                
                await storage.saveOpenPositionByLotId({
                  pair: existingPos.pair,
                  exchange: existingPos.exchange,
                  lotId: existingPos.lotId,
                  amount: balance.toFixed(8),
                  entryPrice: newAvgPrice,
                  highestPrice: existingPos.highestPrice,
                  entryMode: existingPos.entryMode || undefined,
                  configSnapshotJson: existingPos.configSnapshotJson as any,
                  sgBreakEvenActivated: existingPos.sgBreakEvenActivated ?? false,
                  sgTrailingActivated: existingPos.sgTrailingActivated ?? false,
                  sgScaleOutDone: existingPos.sgScaleOutDone ?? false,
                  // Include new fields for average entry price
                  totalCostQuote: totalCost.toFixed(8),
                  totalAmountBase: totalAmount.toFixed(8),
                  averageEntryPrice: newAvgPrice,
                } as any);
                await botLogger.info("POSITION_UPDATED_RECONCILE", `Bot position updated (qty + avgPrice recalculated)`, {
                  pair, asset, oldAmount: posAmount, newAmount: balance, diffPct: diffPct.toFixed(2), exchange,
                  avgPrice: newAvgPrice, totalCost, totalAmount,
                });
                results.push({ pair, asset, action: 'updated', balance, oldAmount: posAmount, diffPct: diffPct.toFixed(2), avgPrice: newAvgPrice });
                updated++;
              }
            } else {
              results.push({ pair, asset, action: 'unchanged', balance, posAmount });
              unchanged++;
            }
          }
        }
      }
      
      // 2) Check positions without corresponding balance (orphans)
      for (const pos of exchangePositions) {
        const asset = pos.pair.split('/')[0]; // e.g., "BTC" from "BTC/USD"
        const balance = realBalances[asset] || 0;
        const dust = dustThresholds[asset] || 0.0001;
        
        // Skip if already processed above
        if (results.some(r => r.pair === pos.pair)) continue;
        
        if (balance <= dust) {
          if (dryRun) {
            results.push({ pair: pos.pair, asset, action: 'would_delete', reason: 'no_balance', balance, lotId: pos.lotId });
          } else if (autoClean) {
            await storage.deleteOpenPositionByLotId(pos.lotId);
            await botLogger.info("POSITION_DELETED_RECONCILE", `Orphan position deleted: no balance`, {
              pair: pos.pair, asset, lotId: pos.lotId, exchange,
            });
            results.push({ pair: pos.pair, asset, action: 'deleted', reason: 'no_balance', lotId: pos.lotId });
            deleted++;
          } else {
            results.push({ pair: pos.pair, asset, action: 'orphan', reason: 'no_balance_no_autoclean', lotId: pos.lotId });
          }
        }
      }
      
      res.json({
        success: true,
        exchange,
        dryRun,
        autoClean,
        positionMode,
        summary: { created, deleted, updated, unchanged, total: results.length },
        realBalances,
        results,
      });
    } catch (error: any) {
      console.error('[reconcile] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
};
