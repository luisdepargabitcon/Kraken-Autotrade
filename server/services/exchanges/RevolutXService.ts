import crypto from 'crypto';
import { IExchangeService, ExchangeConfig, Ticker, OHLC, OrderResult, PairMetadata } from './IExchangeService';
import { errorAlertService, ErrorAlertService } from '../ErrorAlertService';

const API_BASE_URL = 'https://revx.revolut.com';

export class RevolutXService implements IExchangeService {
  private static instance: RevolutXService;
  private initialized = false;
  private apiKey: string | null = null;
  private apiSecret: string | null = null;
  private publicKey: string | null = null;
  private privateKey: string | null = null;
  public readonly exchangeName = 'revolutx';
  public readonly takerFeePct = 0.09;
  public readonly makerFeePct = 0.00;

  // Circuit breaker para endpoints rotos
  private circuitBreakers = new Map<string, {
    isOpen: boolean;
    openedAt: number;
    retryAfter: number;
    failureCount: number;
  }>();

  private pairMetadataCache: Map<string, PairMetadata> = new Map();

  private constructor() {}

  private generateClientOrderId(): string {
    // RevolutX order endpoint is Coinbase-style; it expects a UUID client_order_id.
    // Using a non-UUID value is rejected with "Invalid client order ID".
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    // Fallback for older runtimes
    const bytes = crypto.randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  public static getInstance(): RevolutXService {
    if (!RevolutXService.instance) {
      RevolutXService.instance = new RevolutXService();
    }
    return RevolutXService.instance;
  }

  private checkCircuitBreaker(endpoint: string): boolean {
    const breaker = this.circuitBreakers.get(endpoint);
    if (!breaker) return false;
    
    const now = Date.now();
    if (breaker.isOpen && now < breaker.retryAfter) {
      return true; // Still in cooldown
    }
    
    if (breaker.isOpen && now >= breaker.retryAfter) {
      // Try to close circuit breaker
      this.circuitBreakers.delete(endpoint);
      console.log(`[revolutx] Circuit breaker closed for ${endpoint}`);
      return false;
    }
    
    return false;
  }

  private recordFailure(endpoint: string): void {
    const now = Date.now();
    const breaker = this.circuitBreakers.get(endpoint) || {
      isOpen: false,
      openedAt: 0,
      retryAfter: 0,
      failureCount: 0
    };
    
    breaker.failureCount++;
    
    // Open circuit breaker after 3 failures
    if (breaker.failureCount >= 3 && !breaker.isOpen) {
      breaker.isOpen = true;
      breaker.openedAt = now;
      breaker.retryAfter = now + (5 * 60 * 1000); // 5 minutes
      this.circuitBreakers.set(endpoint, breaker);
      console.log(`[revolutx] Circuit breaker OPENED for ${endpoint} (retry after 5 minutes)`);
      
      // Send alert about circuit breaker
      const alert = ErrorAlertService.createFromError(
        new Error(`Circuit breaker opened for ${endpoint} after ${breaker.failureCount} failures`),
        'API_ERROR',
        'HIGH',
        'recordFailure',
        'server/services/exchanges/RevolutXService.ts',
        'unknown',
        { endpoint, failureCount: breaker.failureCount, retryAfter: new Date(breaker.retryAfter).toISOString() }
      );
      errorAlertService.sendCriticalError(alert);
    }
    
    this.circuitBreakers.set(endpoint, breaker);
  }

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
    const message = timestamp + method.toUpperCase() + path + (queryString || '') + (body || '');
    
    try {
      if (!this.privateKey) {
        throw new Error('Private key not initialized');
      }
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
      'X-Revx-API-Key': this.apiKey || '',
      'X-Revx-Timestamp': timestamp,
      'X-Revx-Signature': signature
    };
  }

  private buildQueryString(params: Record<string, string | number | undefined>, orderedKeys: string[]): string {
    const parts: string[] = [];
    for (const key of orderedKeys) {
      const value = params[key];
      if (value === undefined || value === null || value === '') continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return parts.join('&');
  }

  async listPrivateTrades(params: {
    symbol: string;
    startMs?: number;
    endMs?: number;
    cursor?: string;
    limit?: number;
    debug?: boolean;
  }): Promise<{ trades: any[]; nextCursor?: string }> {
    if (!this.initialized) throw new Error('Revolut X client not initialized');

    const symbol = params.symbol;
    const path = `/api/1.0/trades/private/${symbol}`;

    const queryString = this.buildQueryString(
      {
        start_date: params.startMs,
        end_date: params.endMs,
        cursor: params.cursor,
        limit: params.limit,
      },
      ['start_date', 'end_date', 'cursor', 'limit']
    );

    const fullUrl = `${API_BASE_URL}${path}${queryString ? `?${queryString}` : ''}`;
    const headers = this.getHeaders('GET', path, queryString, '');

    try {
      const response = await fetch(fullUrl, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        if (params.debug) {
          const timestamp = headers['X-Revx-Timestamp'] || '';
          const message = timestamp + 'GET' + path + (queryString || '') + '';
          const msgHash = crypto.createHash('sha256').update(message).digest('hex');
          const sigPrefix = (headers['X-Revx-Signature'] || '').slice(0, 12);
          console.error('[revolutx] listPrivateTrades DEBUG:', {
            status: response.status,
            path,
            queryString,
            msgHash,
            sigPrefix,
          });
        }
        console.error('[revolutx] listPrivateTrades response:', response.status, errorText);
        throw new Error(`RevolutX API error ${response.status}: ${errorText}`);
      }

      const data = await response.json() as any;

      const trades = Array.isArray(data)
        ? data
        : (data.data || data.trades || data.items || []);

      const nextCursor =
        data?.metadata?.next_cursor ||
        data?.metadata?.nextCursor ||
        data?.metadata?.cursor ||
        data?.next_cursor ||
        data?.nextCursor ||
        undefined;

      return { trades, nextCursor };
    } catch (error: any) {
      console.error('[revolutx] listPrivateTrades error:', error.message);
      throw error;
    }
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
    // RevolutX NO tiene endpoint público de ticker ni orderbook
    // El endpoint /api/1.0/orderbook NO EXISTE (404)
    // Usar último trade del historial como fallback
    throw new Error(`RevolutX ticker not available - use Kraken for price data. Pair: ${pair}`);
  }

  private async getTickerFromOrderbook(pair: string): Promise<Ticker> {
    // DISABLED: Este endpoint NO EXISTE en RevolutX API (404)
    // El endpoint /api/1.0/orderbook devuelve "Endpoint GET /api/1.0/orderbook not found"
    throw new Error(`RevolutX orderbook endpoint does not exist (404). Use Kraken for market data.`);
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

    // SAFETY: Validate volume is finite before sending to API (prevents Infinity/NaN errors)
    const volumeNum = parseFloat(params.volume);
    if (!Number.isFinite(volumeNum) || volumeNum <= 0) {
      console.error('[revolutx] placeOrder BLOCKED: Invalid volume', { 
        volume: params.volume, 
        volumeNum,
        pair: params.pair,
        type: params.type
      });
      return { 
        success: false, 
        error: `Invalid volume: ${params.volume} (must be finite positive number)` 
      };
    }

    const path = '/api/1.0/orders';
    const symbol = this.formatPair(params.pair);

    const clientOrderId = this.generateClientOrderId();
    
    const orderBody: any = {
      client_order_id: clientOrderId,
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
      
      const resolvedOrderId = data.id || data.order_id || clientOrderId;
      console.log('[revolutx] Order placed successfully:', resolvedOrderId);
      console.log('[revolutx] Order response data:', JSON.stringify(data, null, 2));
      
      // For market orders, Revolut X may not return executed_price immediately
      // We need to fetch the current ticker price as a fallback
      let executedPrice = parseFloat(data.executed_price || data.average_price || data.price || '0');

      const executedVolume = parseFloat(data.executed_size || data.filled_size || params.volume);
      const rawExecutedValue = data.executed_value || data.executed_notional || data.executed_quote_size || data.filled_value;
      const executedValue = parseFloat(rawExecutedValue || '0');

      // If API gives us value + size but no price, derive it.
      if ((!Number.isFinite(executedPrice) || executedPrice <= 0) && Number.isFinite(executedValue) && executedValue > 0 && Number.isFinite(executedVolume) && executedVolume > 0) {
        executedPrice = executedValue / executedVolume;
        console.log(`[revolutx] Executed price derived from value/size: ${executedPrice}`);
      }
      
      if (executedPrice === 0 && params.ordertype === 'market') {
        try {
          const ticker = await this.getTicker(params.pair);
          // For buy, use ask price; for sell, use bid price
          executedPrice = params.type === 'buy' ? ticker.ask : ticker.bid;
          console.log(`[revolutx] Market order price estimated from ticker: ${executedPrice}`);
        } catch (tickerError) {
          console.warn('[revolutx] Could not fetch ticker for price estimation, trying orderbook fallback');
          try {
            const ticker = await this.getTickerFromOrderbook(params.pair);
            executedPrice = params.type === 'buy' ? ticker.ask : ticker.bid;
            console.log(`[revolutx] Market order price estimated from orderbook: ${executedPrice}`);
          } catch {
            console.warn('[revolutx] Could not fetch orderbook for price estimation');
          }
        }
      }
      
      // FIX: If order was ACCEPTED by exchange (we have order_id) but price couldn't be determined,
      // this is NOT a failure. The order was submitted and likely filled.
      // Return success with pendingFill flag so the engine can reconcile.
      if (!Number.isFinite(executedPrice) || executedPrice <= 0) {
        console.warn(`[revolutx] Order ${resolvedOrderId} SUBMITTED but executed price not available. Marking as pendingFill for reconciliation.`);
        return {
          success: true,
          pendingFill: true,
          orderId: resolvedOrderId,
          txid: resolvedOrderId,
          clientOrderId: clientOrderId,
          // price is undefined - must be resolved via reconcile
          volume: executedVolume,
        };
      }

      const executedCost = executedPrice > 0 && executedVolume > 0 ? executedPrice * executedVolume : executedValue;
      
      return {
        success: true,
        orderId: resolvedOrderId,
        txid: resolvedOrderId,
        clientOrderId: clientOrderId,
        price: executedPrice,
        volume: executedVolume,
        cost: executedCost
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

export const revolutXService = RevolutXService.getInstance();
