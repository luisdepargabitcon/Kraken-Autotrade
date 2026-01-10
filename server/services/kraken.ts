import * as KrakenAPI from "node-kraken-api";
import { telegramService } from "./telegram";
import { storage } from "../storage";
import { IExchangeService, ExchangeConfig, Ticker, OHLC, OrderResult } from "./exchanges/IExchangeService";
import type { PairMetadata } from "./exchanges/IExchangeService";

const { Kraken } = KrakenAPI as any;

interface KrakenConfig {
  apiKey: string;
  apiSecret: string;
}

export type { PairMetadata };

const NONCE_ALERT_INTERVAL_MS = 30 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1000, 2000];
const METADATA_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class KrakenService implements IExchangeService {
  readonly exchangeName = 'kraken';
  readonly takerFeePct = 0.40;
  readonly makerFeePct = 0.25;
  private client: any | null = null;
  private publicClient: any;
  private lastNonceAlertTime: number = 0;
  private lastNonce: number = 0;
  private pairMetadataCache: Map<string, PairMetadata> = new Map();
  private metadataLastRefresh: number = 0;
  private metadataRefreshTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.publicClient = new Kraken();
  }

  async loadPairMetadata(pairs: string[]): Promise<void> {
    try {
      console.log(`[kraken] Loading pair metadata for: ${pairs.join(", ")}`);
      const response = await this.publicClient.assetPairs();
      
      for (const pair of pairs) {
        const krakenPair = this.formatPair(pair);
        const pairData = response[krakenPair];
        
        if (pairData) {
          const lotDecimals = pairData.lot_decimals || 8;
          const orderMin = parseFloat(pairData.ordermin) || 0.01;
          const pairDecimals = pairData.pair_decimals || 5;
          const stepSize = Math.pow(10, -lotDecimals);
          
          this.pairMetadataCache.set(pair, {
            lotDecimals,
            orderMin,
            pairDecimals,
            stepSize,
          });
          
          console.log(`[kraken] ${pair}: lotDecimals=${lotDecimals}, orderMin=${orderMin}, stepSize=${stepSize}`);
        } else {
          console.warn(`[kraken] No metadata found for ${pair} (${krakenPair})`);
        }
      }
      
      this.metadataLastRefresh = Date.now();
      console.log(`[kraken] Pair metadata loaded successfully for ${this.pairMetadataCache.size} pairs`);
    } catch (error: any) {
      console.error(`[kraken] Failed to load pair metadata: ${error.message}`);
      if (this.pairMetadataCache.size === 0) {
        console.error(`[kraken] CRITICAL: No pair metadata available - trades will be skipped`);
      }
    }
  }

  startMetadataRefresh(pairs: string[]): void {
    if (this.metadataRefreshTimer) {
      clearInterval(this.metadataRefreshTimer);
    }
    
    this.metadataRefreshTimer = setInterval(async () => {
      console.log(`[kraken] Refreshing pair metadata...`);
      await this.loadPairMetadata(pairs);
    }, METADATA_REFRESH_INTERVAL_MS);
    
    console.log(`[kraken] Metadata refresh scheduled every ${METADATA_REFRESH_INTERVAL_MS / 3600000}h`);
  }

  getPairMetadata(pair: string): PairMetadata | null {
    return this.pairMetadataCache.get(pair) || null;
  }

  getStepSize(pair: string): number | null {
    const metadata = this.pairMetadataCache.get(pair);
    return metadata ? metadata.stepSize : null;
  }

  getOrderMin(pair: string): number | null {
    const metadata = this.pairMetadataCache.get(pair);
    return metadata ? metadata.orderMin : null;
  }

  hasMetadata(pair: string): boolean {
    return this.pairMetadataCache.has(pair);
  }

  initialize(config: KrakenConfig) {
    this.client = new Kraken({
      key: config.apiKey,
      secret: config.apiSecret,
      gennonce: () => this.generateNonce(),
    });
  }

  private generateNonce(): number {
    let nonce = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    if (nonce <= this.lastNonce) {
      nonce = this.lastNonce + 1;
    }
    this.lastNonce = nonce;
    return nonce;
  }

  isInitialized(): boolean {
    return this.client !== null;
  }

  private async executeWithNonceRetry<T>(
    endpoint: string,
    operation: () => Promise<T>
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 2]));
        }
        return await operation();
      } catch (error: any) {
        const isNonceError = error.message?.includes("EAPI:Invalid nonce") || 
                            error.message?.includes("Invalid nonce");
        
        if (isNonceError) {
          console.log(`[kraken] Nonce error on '${endpoint}', retrying (${attempt}/${MAX_RETRIES})...`);
          
          if (attempt === MAX_RETRIES) {
            console.error(`[kraken] CRITICAL: Persistent nonce error on '${endpoint}' after ${attempt}/${MAX_RETRIES} attempts`);
            await this.sendNonceAlert(endpoint);
            throw new Error(`Persistent nonce error on '${endpoint}' - possible duplicate instance running`);
          }
          continue;
        }
        throw error;
      }
    }
    throw new Error(`Failed after ${MAX_RETRIES} retries on '${endpoint}'`);
  }

  private async sendNonceAlert(endpoint: string): Promise<void> {
    const now = Date.now();
    
    if (now - this.lastNonceAlertTime < NONCE_ALERT_INTERVAL_MS) {
      console.log(`[kraken] Skipping Telegram nonce alert (rate limited, last sent ${Math.round((now - this.lastNonceAlertTime) / 1000)}s ago)`);
      return;
    }

    try {
      const config = await storage.getBotConfig();
      if (config && config.nonceErrorAlertsEnabled === false) {
        console.log(`[kraken] Nonce error alerts disabled in config, skipping Telegram notification`);
        return;
      }

      await telegramService.sendAlert(
        "Error de Nonce con Kraken",
        `Error persistente de nonce en '${endpoint}' después de 3 intentos.\n\n` +
        `⚠️ Verifica que no haya otra instancia del bot usando la misma API key de Kraken.\n\n` +
        `_Este mensaje se enviará máximo cada 30 minutos mientras persista el problema._`
      );
      this.lastNonceAlertTime = now;
      console.log(`[kraken] Nonce alert sent to Telegram`);
    } catch (alertError) {
      console.error(`[kraken] Failed to send nonce alert to Telegram:`, alertError);
    }
  }

  async getBalance(): Promise<Record<string, number>> {
    if (!this.client) throw new Error("Kraken client not initialized");
    const rawBalance = await this.executeWithNonceRetry("getBalance", () => this.client.balance());
    const result: Record<string, number> = {};
    for (const [asset, value] of Object.entries(rawBalance as Record<string, string>)) {
      result[asset] = parseFloat(value);
    }
    return result;
  }

  async getBalanceRaw(): Promise<Record<string, string>> {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.executeWithNonceRetry("getBalance", () => this.client.balance());
  }

  async getTicker(pair: string): Promise<Ticker> {
    const krakenPair = this.formatPair(pair);
    const response = await this.publicClient.ticker({ pair: krakenPair });
    const tickerData = response[krakenPair] || Object.values(response)[0];
    return {
      bid: parseFloat(tickerData?.b?.[0] || '0'),
      ask: parseFloat(tickerData?.a?.[0] || '0'),
      last: parseFloat(tickerData?.c?.[0] || '0'),
      volume24h: parseFloat(tickerData?.v?.[1] || '0')
    };
  }

  async getTickerRaw(pair: string): Promise<any> {
    const krakenPair = this.formatPair(pair);
    const response = await this.publicClient.ticker({ pair: krakenPair });
    return response;
  }

  async getAssetPairs() {
    return await this.publicClient.assetPairs();
  }

  async placeOrder(params: {
    pair: string;
    type: "buy" | "sell";
    ordertype: string;
    price?: string;
    volume: string;
  }): Promise<OrderResult> {
    if (!this.client) throw new Error("Kraken client not initialized");
    
    const krakenPair = this.formatPair(params.pair);
    const orderParams: any = {
      pair: krakenPair,
      type: params.type,
      ordertype: params.ordertype,
      volume: params.volume,
    };

    if (params.price) {
      orderParams.price = params.price;
    }

    try {
      const result = await this.executeWithNonceRetry("addOrder", () => this.client.addOrder(orderParams)) as { txid?: string[] };
      const txids = result?.txid || [];
      return {
        success: txids.length > 0,
        orderId: txids[0],
        txid: txids[0],
        volume: parseFloat(params.volume),
        price: params.price ? parseFloat(params.price) : undefined
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async placeOrderRaw(params: {
    pair: string;
    type: "buy" | "sell";
    ordertype: string;
    price?: string;
    volume: string;
  }): Promise<any> {
    if (!this.client) throw new Error("Kraken client not initialized");
    
    const krakenPair = this.formatPair(params.pair);
    const orderParams: any = {
      pair: krakenPair,
      type: params.type,
      ordertype: params.ordertype,
      volume: params.volume,
    };

    if (params.price) {
      orderParams.price = params.price;
    }

    return await this.executeWithNonceRetry("addOrder", () => this.client.addOrder(orderParams));
  }

  async cancelOrder(txid: string): Promise<boolean> {
    if (!this.client) throw new Error("Kraken client not initialized");
    try {
      await this.executeWithNonceRetry("cancelOrder", () => this.client.cancelOrder({ txid }));
      return true;
    } catch {
      return false;
    }
  }

  async getOpenOrders() {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.executeWithNonceRetry("openOrders", () => this.client.openOrders());
  }

  async getClosedOrders(limit: number = 50) {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.executeWithNonceRetry("closedOrders", () => this.client.closedOrders({ ofs: 0 }));
  }

  async getTradesHistory(options?: { start?: number; end?: number; fetchAll?: boolean }): Promise<any> {
    if (!this.client) throw new Error("Kraken client not initialized");
    
    const params: any = { type: "all" };
    if (options?.start) params.start = options.start;
    if (options?.end) params.end = options.end;
    
    // Si no se pide todo el historial, devolver solo la primera página
    if (!options?.fetchAll) {
      return await this.executeWithNonceRetry("tradesHistory", () => this.client.tradesHistory(params));
    }
    
    // Fetch all trades with pagination
    const allTrades: Record<string, any> = {};
    let offset = 0;
    let totalCount = 0;
    const RATE_LIMIT_DELAY = 2000; // 2 segundos entre llamadas
    
    console.log("[kraken] Fetching all trades history with pagination...");
    
    while (true) {
      const paginatedParams = { ...params, ofs: offset };
      
      const response: any = await this.executeWithNonceRetry("tradesHistory", () => 
        this.client.tradesHistory(paginatedParams)
      );
      
      const trades = response.trades || {};
      const count = response.count || 0;
      
      if (offset === 0) {
        totalCount = count;
        console.log(`[kraken] Total trades in Kraken: ${totalCount}`);
      }
      
      const tradeIds = Object.keys(trades);
      if (tradeIds.length === 0) {
        console.log(`[kraken] No more trades at offset ${offset}`);
        break;
      }
      
      // Merge trades
      for (const [id, trade] of Object.entries(trades)) {
        allTrades[id] = trade;
      }
      
      console.log(`[kraken] Fetched ${tradeIds.length} trades at offset ${offset}, total collected: ${Object.keys(allTrades).length}`);
      
      offset += 50;
      
      if (offset >= totalCount) {
        console.log(`[kraken] Reached end of trades history`);
        break;
      }
      
      // Rate limiting - esperar entre llamadas
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
    
    console.log(`[kraken] Finished fetching ${Object.keys(allTrades).length} total trades`);
    
    return { trades: allTrades, count: Object.keys(allTrades).length };
  }

  async getOHLC(pair: string, interval: number = 5): Promise<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[]> {
    const krakenPair = this.formatPair(pair);
    const response = await this.publicClient.ohlc({ pair: krakenPair, interval });
    
    const pairData = Object.values(response).find(Array.isArray) as any[];
    if (!pairData) return [];
    
    return pairData.map((candle: any[]) => ({
      time: candle[0],
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[6]),
    }));
  }

  formatPairReverse(krakenPair: string): string {
    return this.normalizePairFromExchange(krakenPair);
  }

  normalizePairFromExchange(krakenPair: string): string {
    const pairMap: Record<string, string> = {
      "XXBTZUSD": "BTC/USD",
      "XETHZUSD": "ETH/USD",
      "SOLUSD": "SOL/USD",
      "XXRPZUSD": "XRP/USD",
      "XRPUSD": "XRP/USD",
      "TONUSD": "TON/USD",
      "XXBTZXETH": "BTC/ETH",
      "XETHXXBT": "ETH/BTC",
      "ETHXBT": "ETH/BTC",
      "SOLETH": "SOL/ETH",
    };
    return pairMap[krakenPair] || krakenPair;
  }

  formatPair(pair: string): string {
    const pairMap: Record<string, string> = {
      "BTC/USD": "XXBTZUSD",
      "ETH/USD": "XETHZUSD",
      "SOL/USD": "SOLUSD",
      "XRP/USD": "XXRPZUSD",
      "TON/USD": "TONUSD",
      "ETH/BTC": "XETHXXBT",
      "BTC/ETH": "XXBTZXETH",
      "SOL/ETH": "SOLETH",
    };
    return pairMap[pair] || pair;
  }

  // Normalize Kraken asset symbols to generic symbols (e.g., XXBT -> BTC, ZUSD -> USD)
  normalizeAsset(krakenSymbol: string): string {
    // Remove staking suffixes (.S, .M, .F, etc.)
    let s = krakenSymbol.replace(/\.\w+$/, "");
    
    // Explicit mappings for common assets (including staking/derivative variants)
    const explicitMap: Record<string, string> = {
      "ZUSD": "USD", "ZEUR": "EUR", "ZGBP": "GBP", "ZCAD": "CAD", "ZJPY": "JPY",
      "XXBT": "BTC", "XBT": "BTC", "XETH": "ETH", "XXRP": "XRP", "XLTC": "LTC", 
      "XXDG": "DOGE", "XETC": "ETC", "XXMR": "XMR", "XZEC": "ZEC", "XXLM": "XLM",
      "XADA": "ADA", "XTRX": "TRX", "XNANO": "NANO", "XDOT": "DOT",
      // Staking/derivative variants
      "ETH2": "ETH", "ETHW": "ETH", "FLOWH": "FLOW", "MATICM": "MATIC",
      "SOLW": "SOL", "ATOM21": "ATOM", "DOT28": "DOT"
    };
    
    if (explicitMap[s]) return explicitMap[s];
    
    // Auto-strip X prefix for crypto (4+ chars starting with X, not XRP)
    if (s.length >= 4 && s.startsWith("X") && !s.startsWith("XRP")) {
      const stripped = s.slice(1);
      if (/^[A-Z]{3,5}$/.test(stripped)) return stripped;
    }
    
    // Auto-strip Z prefix for fiat (4 chars starting with Z)
    if (s.length === 4 && s.startsWith("Z")) {
      return s.slice(1);
    }
    
    return s;
  }
}

export const krakenService = new KrakenService();
