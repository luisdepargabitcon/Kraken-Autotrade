import crypto from 'crypto';
import { IExchangeService, ExchangeConfig, Ticker, OHLC, OrderResult, PairMetadata } from './IExchangeService';

const API_BASE_URL = 'https://revx.revolut.com';

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
    this.privateKey = this.normalizePemKey(config.privateKey);
    this.initialized = true;
    console.log('[revolutx] Initialized with Ed25519 authentication');
  }

  private normalizePemKey(key: string): string {
    const trimmed = key.trim();
    if (trimmed.includes('\n')) {
      return trimmed;
    }
    
    const beginPrivate = '-----BEGIN PRIVATE KEY-----';
    const endPrivate = '-----END PRIVATE KEY-----';
    const beginPublic = '-----BEGIN PUBLIC KEY-----';
    const endPublic = '-----END PUBLIC KEY-----';
    
    let cleaned = trimmed
      .replace(beginPrivate, '')
      .replace(endPrivate, '')
      .replace(beginPublic, '')
      .replace(endPublic, '')
      .replace(/\s+/g, '');
    
    const isPrivate = trimmed.includes('PRIVATE');
    const begin = isPrivate ? beginPrivate : beginPublic;
    const end = isPrivate ? endPrivate : endPublic;
    
    return `${begin}\n${cleaned}\n${end}`;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private sign(method: string, path: string, queryString?: string, body?: string): { timestamp: string; signature: string } {
    const timestamp = Date.now().toString();
    const message = timestamp + method + path + (queryString || '') + (body || '');
    
    try {
      const signatureBuffer = crypto.sign(null, Buffer.from(message), this.privateKey);
      return {
        timestamp,
        signature: signatureBuffer.toString('base64')
      };
    } catch (error: any) {
      console.error('[revolutx] Signing error:', error.message);
      throw new Error(`Failed to sign request: ${error.message}`);
    }
  }

  private getHeaders(method: string, path: string, queryString?: string, body?: string): Record<string, string> {
    const { timestamp, signature } = this.sign(method, path, queryString, body);
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
        const errorText = await response.text();
        console.error('[revolutx] getBalance response:', response.status, errorText);
        throw new Error(`Revolut X API error: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json() as any[];
      const balances: Record<string, number> = {};
      
      for (const item of data) {
        const currency = item.currency || item.asset;
        const available = parseFloat(item.available || item.balance || '0');
        if (currency) {
          balances[currency] = available;
        }
      }
      
      console.log('[revolutx] Balances fetched:', Object.keys(balances).length, 'currencies');
      return balances;
    } catch (error: any) {
      console.error('[revolutx] getBalance error:', error.message);
      throw error;
    }
  }

  async getTicker(pair: string): Promise<Ticker> {
    const symbol = this.formatPair(pair);
    const path = '/api/1.0/market-data/orderbook';
    const queryString = `symbol=${symbol}`;
    const fullUrl = `${API_BASE_URL}${path}?${queryString}`;
    
    try {
      const response = await fetch(fullUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[revolutx] getTicker response:', response.status, errorText);
        throw new Error(`Revolut X API error: ${response.status}`);
      }
      
      const data = await response.json() as any;
      
      const bids = data.bids || [];
      const asks = data.asks || [];
      
      const bestBid = bids.length > 0 ? parseFloat(bids[0].price || bids[0][0] || '0') : 0;
      const bestAsk = asks.length > 0 ? parseFloat(asks[0].price || asks[0][0] || '0') : 0;
      const last = (bestBid + bestAsk) / 2;
      
      return {
        bid: bestBid,
        ask: bestAsk,
        last: last,
        volume24h: 0
      };
    } catch (error: any) {
      console.error('[revolutx] getTicker error:', error.message);
      throw error;
    }
  }

  async getOHLC(pair: string, interval: number = 5): Promise<OHLC[]> {
    console.log(`[revolutx] getOHLC called for ${pair} - Revolut X REST API does not provide OHLC data`);
    return [];
  }

  async placeOrder(params: {
    pair: string;
    type: "buy" | "sell";
    ordertype: string;
    price?: string;
    volume: string;
  }): Promise<OrderResult> {
    if (!this.initialized) throw new Error('Revolut X client not initialized');

    const path = '/api/1.0/orders';
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
    const headers = this.getHeaders('POST', path, '', body);
    
    console.log('[revolutx] Placing order:', JSON.stringify(orderBody, null, 2));
    
    try {
      const response = await fetch(API_BASE_URL + path, {
        method: 'POST',
        headers,
        body
      });
      
      const data = await response.json() as any;
      
      if (!response.ok) {
        console.error('[revolutx] placeOrder error response:', data);
        return {
          success: false,
          error: data.message || data.error || data.description || `HTTP ${response.status}`
        };
      }
      
      console.log('[revolutx] Order placed successfully:', data.id || data.order_id);
      
      return {
        success: true,
        orderId: data.id || data.order_id,
        txid: data.id || data.order_id,
        price: parseFloat(data.executed_price || data.average_price || params.price || '0'),
        volume: parseFloat(data.executed_size || data.filled_size || params.volume),
        cost: parseFloat(data.executed_value || data.executed_notional || '0')
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

    const path = `/api/1.0/orders/${orderId}`;
    const headers = this.getHeaders('DELETE', path);
    
    try {
      const response = await fetch(API_BASE_URL + path, {
        method: 'DELETE',
        headers
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[revolutx] cancelOrder error:', response.status, errorText);
        return false;
      }
      
      console.log('[revolutx] Order cancelled:', orderId);
      return true;
    } catch (error: any) {
      console.error('[revolutx] cancelOrder error:', error.message);
      return false;
    }
  }

  async loadPairMetadata(pairs: string[]): Promise<void> {
    try {
      console.log(`[revolutx] Loading pair metadata for: ${pairs.join(', ')}`);
      
      const [currenciesRes, symbolsRes] = await Promise.all([
        fetch(API_BASE_URL + '/api/1.0/currencies'),
        fetch(API_BASE_URL + '/api/1.0/symbols')
      ]);
      
      const currencies = currenciesRes.ok ? await currenciesRes.json() as any[] : [];
      const symbols = symbolsRes.ok ? await symbolsRes.json() as any[] : [];
      
      for (const pair of pairs) {
        const [base] = pair.split('/');
        const revPair = this.formatPair(pair);
        
        const currencyInfo = currencies.find((c: any) => c.code === base || c.currency === base);
        const symbolInfo = symbols.find((s: any) => s.symbol === revPair || s.name === revPair);
        
        const lotDecimals = currencyInfo?.scale || currencyInfo?.decimals || 8;
        const orderMin = symbolInfo?.min_order_size || symbolInfo?.min_base_size || 0.0001;
        const pairDecimals = symbolInfo?.price_scale || 2;
        
        this.pairMetadataCache.set(pair, {
          lotDecimals,
          orderMin,
          pairDecimals,
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
