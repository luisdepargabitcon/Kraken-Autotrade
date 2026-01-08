import crypto from 'crypto';
import { IExchangeService, ExchangeConfig, Ticker, OHLC, OrderResult, PairMetadata } from './IExchangeService';

const API_BASE_URL = 'https://api.revolut.com';

export class RevolutXService implements IExchangeService {
  readonly exchangeName = 'revolutx';
  readonly takerFeePct = 0.09;
  readonly makerFeePct = 0.00;

  private apiKey: string = '';
  private privateKey: string = '';
  private initialized: boolean = false;
  private pairMetadataCache: Map<string, PairMetadata> = new Map();

  initialize(config: ExchangeConfig): void {
    if (!config.apiKey || !config.privateKey) {
      throw new Error('Revolut X requires apiKey and privateKey (Ed25519 PEM)');
    }
    this.apiKey = config.apiKey;
    this.privateKey = config.privateKey;
    this.initialized = true;
    console.log('[revolutx] Initialized with Ed25519 authentication');
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private sign(method: string, path: string, body?: string): { timestamp: string; signature: string } {
    const timestamp = Date.now().toString();
    const message = timestamp + method + path + (body || '');
    
    const signatureBuffer = crypto.sign(null, Buffer.from(message), this.privateKey);
    
    return {
      timestamp,
      signature: signatureBuffer.toString('base64')
    };
  }

  private getHeaders(method: string, path: string, body?: string): Record<string, string> {
    const { timestamp, signature } = this.sign(method, path, body);
    return {
      'Content-Type': 'application/json',
      'X-Revx-Api-Key': this.apiKey,
      'X-Revx-Timestamp': timestamp,
      'X-Revx-Signature': signature
    };
  }

  async getBalance(): Promise<Record<string, number>> {
    if (!this.initialized) throw new Error('Revolut X client not initialized');

    const path = '/api/1.0/balances';
    const headers = this.getHeaders('GET', path);
    
    try {
      const response = await fetch(API_BASE_URL + path, { headers });
      if (!response.ok) {
        throw new Error(`Revolut X API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json() as any[];
      const balances: Record<string, number> = {};
      
      for (const item of data) {
        const currency = item.currency || item.asset;
        const available = parseFloat(item.available || item.balance || '0');
        if (currency && available > 0) {
          balances[currency] = available;
        }
      }
      
      return balances;
    } catch (error: any) {
      console.error('[revolutx] getBalance error:', error.message);
      throw error;
    }
  }

  async getTicker(pair: string): Promise<Ticker> {
    const symbol = this.formatPair(pair);
    const path = `/api/1.0/public/ticker?symbol=${symbol}`;
    
    try {
      const response = await fetch(API_BASE_URL + path);
      if (!response.ok) {
        throw new Error(`Revolut X API error: ${response.status}`);
      }
      
      const data = await response.json() as any;
      
      return {
        bid: parseFloat(data.best_bid_price || data.bid || '0'),
        ask: parseFloat(data.best_ask_price || data.ask || '0'),
        last: parseFloat(data.last_trade_price || data.last || '0'),
        volume24h: parseFloat(data.volume_24h || '0')
      };
    } catch (error: any) {
      console.error('[revolutx] getTicker error:', error.message);
      throw error;
    }
  }

  async getOHLC(pair: string, interval: number = 5): Promise<OHLC[]> {
    const symbol = this.formatPair(pair);
    const path = `/api/1.0/public/candles?symbol=${symbol}&resolution=${interval}`;
    
    try {
      const response = await fetch(API_BASE_URL + path);
      if (!response.ok) {
        throw new Error(`Revolut X API error: ${response.status}`);
      }
      
      const data = await response.json() as any[];
      
      return data.map((candle: any) => ({
        time: candle.timestamp || candle.t || 0,
        open: parseFloat(candle.open || candle.o || '0'),
        high: parseFloat(candle.high || candle.h || '0'),
        low: parseFloat(candle.low || candle.l || '0'),
        close: parseFloat(candle.close || candle.c || '0'),
        volume: parseFloat(candle.volume || candle.v || '0')
      }));
    } catch (error: any) {
      console.error('[revolutx] getOHLC error:', error.message);
      return [];
    }
  }

  async placeOrder(params: {
    pair: string;
    type: "buy" | "sell";
    ordertype: string;
    price?: string;
    volume: string;
  }): Promise<OrderResult> {
    if (!this.initialized) throw new Error('Revolut X client not initialized');

    const path = '/api/1.0/crypto-exchange/orders';
    const symbol = this.formatPair(params.pair);
    
    const orderBody: any = {
      client_order_id: `kb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: symbol,
      side: params.type.toUpperCase(),
      order_configuration: {}
    };
    
    if (params.ordertype === 'market') {
      orderBody.order_configuration.market = {
        base_size: params.volume
      };
    } else {
      orderBody.order_configuration.limit = {
        base_size: params.volume,
        price: params.price
      };
    }
    
    const body = JSON.stringify(orderBody);
    const headers = this.getHeaders('POST', path, body);
    
    try {
      const response = await fetch(API_BASE_URL + path, {
        method: 'POST',
        headers,
        body
      });
      
      const data = await response.json() as any;
      
      if (!response.ok) {
        return {
          success: false,
          error: data.message || data.error || `HTTP ${response.status}`
        };
      }
      
      return {
        success: true,
        orderId: data.order_id || data.id,
        txid: data.order_id || data.id,
        price: parseFloat(data.executed_price || params.price || '0'),
        volume: parseFloat(data.executed_size || params.volume),
        cost: parseFloat(data.executed_value || '0')
      };
    } catch (error: any) {
      console.error('[revolutx] placeOrder error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.initialized) throw new Error('Revolut X client not initialized');

    const path = `/api/1.0/crypto-exchange/orders/${orderId}`;
    const headers = this.getHeaders('DELETE', path);
    
    try {
      const response = await fetch(API_BASE_URL + path, {
        method: 'DELETE',
        headers
      });
      
      return response.ok;
    } catch (error: any) {
      console.error('[revolutx] cancelOrder error:', error.message);
      return false;
    }
  }

  async loadPairMetadata(pairs: string[]): Promise<void> {
    try {
      console.log(`[revolutx] Loading pair metadata for: ${pairs.join(', ')}`);
      
      const path = '/api/1.0/currencies';
      const response = await fetch(API_BASE_URL + path);
      
      if (!response.ok) {
        console.warn('[revolutx] Failed to fetch currencies metadata');
        return;
      }
      
      const currencies = await response.json() as any[];
      
      for (const pair of pairs) {
        const [base] = pair.split('/');
        const currencyInfo = currencies.find((c: any) => c.code === base || c.symbol === base);
        
        const lotDecimals = currencyInfo?.decimals || 8;
        const orderMin = currencyInfo?.min_order_size || 0.0001;
        
        this.pairMetadataCache.set(pair, {
          lotDecimals,
          orderMin,
          pairDecimals: 2,
          stepSize: Math.pow(10, -lotDecimals)
        });
        
        console.log(`[revolutx] ${pair}: lotDecimals=${lotDecimals}, orderMin=${orderMin}`);
      }
      
      console.log(`[revolutx] Pair metadata loaded for ${this.pairMetadataCache.size} pairs`);
    } catch (error: any) {
      console.error('[revolutx] Failed to load pair metadata:', error.message);
    }
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

  formatPair(pair: string): string {
    return pair.replace('/', '-');
  }

  normalizePairFromExchange(exchangePair: string): string {
    return exchangePair.replace('-', '/');
  }
}

export const revolutXService = new RevolutXService();
