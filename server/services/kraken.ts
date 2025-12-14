import * as KrakenAPI from "node-kraken-api";
import { telegramService } from "./telegram";
import { storage } from "../storage";

const { Kraken } = KrakenAPI as any;

interface KrakenConfig {
  apiKey: string;
  apiSecret: string;
}

const NONCE_ALERT_INTERVAL_MS = 30 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1000, 2000];

export class KrakenService {
  private client: any | null = null;
  private publicClient: any;
  private lastNonceAlertTime: number = 0;
  private lastNonce: number = 0;

  constructor() {
    this.publicClient = new Kraken();
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

  async getBalance() {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.executeWithNonceRetry("getBalance", () => this.client.balance());
  }

  async getTicker(pair: string) {
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
  }) {
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

  async cancelOrder(txid: string) {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.executeWithNonceRetry("cancelOrder", () => this.client.cancelOrder({ txid }));
  }

  async getOpenOrders() {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.executeWithNonceRetry("openOrders", () => this.client.openOrders());
  }

  async getClosedOrders(limit: number = 50) {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.executeWithNonceRetry("closedOrders", () => this.client.closedOrders({ ofs: 0 }));
  }

  async getTradesHistory(limit: number = 50): Promise<any> {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.executeWithNonceRetry("tradesHistory", () => this.client.tradesHistory({ type: "all" }));
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
}

export const krakenService = new KrakenService();
