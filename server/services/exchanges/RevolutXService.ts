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

  private async signedGetJson<T>(path: string, params?: Record<string, string | number | undefined>, orderedKeys?: string[]): Promise<T> {
    if (!this.initialized) throw new Error('Revolut X client not initialized');

    const queryString = params && orderedKeys ? this.buildQueryString(params, orderedKeys) : '';
    const fullUrl = `${API_BASE_URL}${path}${queryString ? `?${queryString}` : ''}`;
    const headers = this.getHeaders('GET', path, queryString, '');

    try {
      const response = await fetch(fullUrl, { headers });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`RevolutX API error ${response.status}: ${errorText}`);
      }
      return (await response.json()) as T;
    } catch (error: any) {
      console.error('[revolutx] signedGetJson error:', { path, error: error.message });
      throw error;
    }
  }

  private parseNumeric(val: any): number {
    if (val === null || val === undefined) return NaN;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseFloat(val);
    return NaN;
  }

  private parseOrderBookTopLevels(data: any): { bestBid?: number; bestAsk?: number } {
    const bids = data?.bids || data?.bid || data?.buy || data?.buys || [];
    const asks = data?.asks || data?.ask || data?.sell || data?.sells || [];

    const extractPrice = (lvl: any): number => {
      if (Array.isArray(lvl)) return this.parseNumeric(lvl[0]);
      return this.parseNumeric(lvl?.price ?? lvl?.p ?? lvl?.px ?? lvl?.rate ?? lvl?.value);
    };

    const bestBid = Array.isArray(bids) && bids.length > 0 ? extractPrice(bids[0]) : NaN;
    const bestAsk = Array.isArray(asks) && asks.length > 0 ? extractPrice(asks[0]) : NaN;

    return {
      bestBid: Number.isFinite(bestBid) && bestBid > 0 ? bestBid : undefined,
      bestAsk: Number.isFinite(bestAsk) && bestAsk > 0 ? bestAsk : undefined,
    };
  }

  private parseLastTradePrice(data: any): number | undefined {
    const records = Array.isArray(data) ? data : (data?.data || data?.trades || data?.items || []);
    if (!Array.isArray(records) || records.length === 0) return undefined;

    const first = records[0];
    const price = this.parseNumeric(first?.price ?? first?.p ?? first?.px ?? first?.rate);
    if (Number.isFinite(price) && price > 0) return price;
    return undefined;
  }

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
    const symbol = this.formatPair(pair);

    // Prefer order book to derive bid/ask + mid.
    // NOTE: Even though docs label some endpoints as "public", Revolut X REST authentication is generally required.
    const orderBookPaths = [
      `/api/1.0/order-book/${symbol}`,
      `/api/1.0/order_book/${symbol}`,
      `/api/1.0/orderbook/${symbol}`,
    ];

    let bestBid: number | undefined;
    let bestAsk: number | undefined;

    let lastError: any;
    for (const path of orderBookPaths) {
      try {
        const ob = await this.signedGetJson<any>(path);
        const top = this.parseOrderBookTopLevels(ob);
        if (top.bestBid || top.bestAsk) {
          bestBid = top.bestBid;
          bestAsk = top.bestAsk;
          break;
        }
      } catch (err: any) {
        lastError = err;
      }
    }

    // Last trades as a fallback for `last`
    const tradePaths = [
      `/api/1.0/trades/${symbol}`,
      `/api/1.0/trades/public/${symbol}`,
      `/api/1.0/trades/public/${symbol}/last`,
    ];

    let last: number | undefined;
    for (const path of tradePaths) {
      try {
        const trades = await this.signedGetJson<any>(path);
        last = this.parseLastTradePrice(trades);
        if (last) break;
      } catch {
        // ignore
      }
    }

    const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : undefined;
    const inferred = mid ?? last;
    if (!inferred) {
      throw new Error(`RevolutX ticker unavailable for ${pair}${lastError ? `: ${lastError.message}` : ''}`);
    }

    return {
      bid: bestBid ?? inferred,
      ask: bestAsk ?? inferred,
      last: last ?? inferred,
    };
  }

  private async getTickerFromOrderbook(pair: string): Promise<Ticker> {
    // DISABLED: Este endpoint NO EXISTE en RevolutX API (404)
    // El endpoint /api/1.0/orderbook devuelve "Endpoint GET /api/1.0/orderbook not found"
    throw new Error(`RevolutX orderbook endpoint does not exist (404). Use Kraken for market data.`);
  }

  async getOHLC(pair: string, interval: number = 5): Promise<OHLC[]> {
    const symbol = this.formatPair(pair);

    const candidates = [
      `/api/1.0/candles/${symbol}`,
      `/api/1.0/candles/${symbol}/history`,
      `/api/1.0/market-data/candles/${symbol}`,
    ];

    let lastErr: any;
    for (const path of candidates) {
      try {
        const data = await this.signedGetJson<any>(path, { interval }, ['interval']);

        const rows = Array.isArray(data)
          ? data
          : (data?.data || data?.candles || data?.items || []);

        if (!Array.isArray(rows)) return [];

        const parsed: OHLC[] = [];
        for (const r of rows) {
          // Common shapes:
          // - [time, open, high, low, close, volume]
          // - { t, o, h, l, c, v }
          // - { time/start, open, high, low, close, volume }
          if (Array.isArray(r) && r.length >= 6) {
            const t = this.parseNumeric(r[0]);
            const o = this.parseNumeric(r[1]);
            const h = this.parseNumeric(r[2]);
            const l = this.parseNumeric(r[3]);
            const c = this.parseNumeric(r[4]);
            const v = this.parseNumeric(r[5]);
            if ([t, o, h, l, c].every((x) => Number.isFinite(x))) {
              parsed.push({ time: t, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 });
            }
            continue;
          }

          const t = this.parseNumeric(r?.time ?? r?.t ?? r?.start ?? r?.start_time ?? r?.ts);
          const o = this.parseNumeric(r?.open ?? r?.o);
          const h = this.parseNumeric(r?.high ?? r?.h);
          const l = this.parseNumeric(r?.low ?? r?.l);
          const c = this.parseNumeric(r?.close ?? r?.c);
          const v = this.parseNumeric(r?.volume ?? r?.v);

          if ([t, o, h, l, c].every((x) => Number.isFinite(x))) {
            parsed.push({ time: t, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 });
          }
        }

        return parsed;
      } catch (err: any) {
        lastErr = err;
      }
    }

    console.warn(`[revolutx] getOHLC failed for ${pair}: ${lastErr?.message || 'unknown error'}`);
    return [];
  }

  async placeOrder(params: {
    pair: string;
    type: "buy" | "sell";
    ordertype: string;
    price?: string;
    volume: string;
    clientOrderId?: string; // CRITICAL: Use caller-provided clientOrderId for ID linking
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

    // CRITICAL FIX: Use caller-provided clientOrderId if available, otherwise generate new one
    // This ensures the tradingEngine's clientOrderId propagates to the exchange for ID linking
    const clientOrderId = params.clientOrderId || this.generateClientOrderId();
    console.log(`[revolutx] Using clientOrderId: ${clientOrderId} (caller-provided: ${!!params.clientOrderId})`);
    
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
      
      // RevolutX wraps response in { data: { venue_order_id, client_order_id, state, ... } }
      // Unwrap if needed
      const orderData = data.data || data;
      
      // CRITICAL: Extract the REAL exchange order ID - NEVER fall back to clientOrderId
      // RevolutX returns the order ID in 'venue_order_id' field (NOT 'id' or 'order_id')
      const exchangeOrderId = orderData.venue_order_id || orderData.id || orderData.order_id;
      const resolvedOrderId = exchangeOrderId || clientOrderId; // Only for logging, NOT for venue_order_id
      
      // MANDATORY LOGGING: Track exactly what RevolutX returns
      console.log(`[revolutx] placeOrder RESPONSE: { venue_order_id: ${orderData.venue_order_id}, state: ${orderData.state}, client_order_id: ${orderData.client_order_id}, clientOrderId: ${clientOrderId} }`);
      console.log('[revolutx] Order placed successfully:', resolvedOrderId);
      console.log('[revolutx] Order response data:', JSON.stringify(data, null, 2));
      
      // CRITICAL: If we don't have a real exchange order ID, this is a problem
      if (!exchangeOrderId) {
        console.error(`[revolutx] WARNING: No exchange order ID returned! venue_order_id=${orderData.venue_order_id}, id=${orderData.id}. FillWatcher will not be able to query order status.`);
      }
      
      // For market orders, Revolut X may not return executed_price immediately
      // Check both wrapped and unwrapped fields
      let executedPrice = parseFloat(orderData.executed_price || orderData.average_price || orderData.price || '0');

      const executedVolume = parseFloat(orderData.executed_size || orderData.filled_size || orderData.quantity || params.volume);
      const rawExecutedValue = orderData.executed_value || orderData.executed_notional || orderData.executed_quote_size || orderData.filled_value;
      const executedValue = parseFloat(rawExecutedValue || '0');

      // If API gives us value + size but no price, derive it.
      if ((!Number.isFinite(executedPrice) || executedPrice <= 0) && Number.isFinite(executedValue) && executedValue > 0 && Number.isFinite(executedVolume) && executedVolume > 0) {
        executedPrice = executedValue / executedVolume;
        console.log(`[revolutx] Executed price derived from value/size: ${executedPrice}`);
      }

      // If state=filled but no price, fetch order details to get execution price
      if ((!Number.isFinite(executedPrice) || executedPrice <= 0) && exchangeOrderId && orderData.state === 'filled') {
        console.log(`[revolutx] Order state=filled but no price in response. Fetching order details...`);
        try {
          const orderDetails = await this.getOrder(exchangeOrderId);
          if (orderDetails && orderDetails.averagePrice && orderDetails.averagePrice > 0) {
            executedPrice = orderDetails.averagePrice;
            console.log(`[revolutx] Got executed price from getOrder: ${executedPrice}`);
          } else if (orderDetails && orderDetails.executedValue && orderDetails.filledSize && orderDetails.filledSize > 0) {
            executedPrice = orderDetails.executedValue / orderDetails.filledSize;
            console.log(`[revolutx] Derived executed price from getOrder: ${executedPrice}`);
          }
        } catch (fetchErr: any) {
          console.warn(`[revolutx] Failed to fetch order details for price: ${fetchErr.message}`);
        }
      }

      // If order was ACCEPTED by exchange but price couldn't be determined,
      // return success with pendingFill flag so the engine can reconcile using fills.
      if (!Number.isFinite(executedPrice) || executedPrice <= 0) {
        // CRITICAL: Use exchangeOrderId (real ID from RevolutX), NOT resolvedOrderId which may be clientOrderId
        const venueOrderIdForFillWatcher = exchangeOrderId || resolvedOrderId;
        console.warn(`[revolutx] Order SUBMITTED but executed price not available. Marking as pendingFill.`);
        console.log(`[revolutx] PENDING_FILL IDs: exchangeOrderId=${exchangeOrderId}, venueOrderIdForFillWatcher=${venueOrderIdForFillWatcher}, clientOrderId=${clientOrderId}`);
        return {
          success: true,
          pendingFill: true,
          orderId: venueOrderIdForFillWatcher, // MUST be the real exchange order ID for FillWatcher
          txid: venueOrderIdForFillWatcher,
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

  /**
   * Get a specific order by ID
   * Used by FillWatcher to check order status and get fill details
   */
  async getOrder(orderId: string): Promise<{
    id: string;
    clientOrderId?: string;
    symbol: string;
    side: string;
    status: string;
    filledSize?: number;
    executedValue?: number;
    averagePrice?: number;
    createdAt?: Date;
  } | null> {
    if (!this.initialized) throw new Error('Revolut X client not initialized');

    const path = `/api/1.0/orders/${orderId}`;
    const headers = this.getHeaders('GET', path);

    try {
      const response = await fetch(API_BASE_URL + path, { headers });

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`[revolutx] Order not found: ${orderId}`);
          return null;
        }
        const errorText = await response.text();
        console.error(`[revolutx] getOrder error: ${response.status} ${errorText}`);
        return null;
      }

      const data = await response.json() as any;
      console.log(`[revolutx] getOrder response:`, JSON.stringify(data, null, 2));

      // RevolutX may wrap response in { data: { ... } }
      const orderData = data?.data || data;

      const parseNum = (v: any): number => {
        if (v === null || v === undefined) return NaN;
        if (typeof v === 'number') return v;
        if (typeof v === 'string') return parseFloat(v);
        return NaN;
      };

      let filledSize = parseNum(
        orderData.filled_size ??
          orderData.executed_size ??
          orderData.filled_quantity ??
          orderData.filled_qty ??
          orderData.quantity_filled ??
          orderData.filledSize ??
          orderData.executedSize
      );

      let executedValue = parseNum(
        orderData.executed_value ??
          orderData.filled_value ??
          orderData.executed_notional ??
          orderData.executed_quote_size ??
          orderData.filled_quote_size ??
          orderData.executedValue ??
          orderData.filledValue
      );

      let averagePrice = parseNum(
        orderData.average_fill_price ??
          orderData.avg_fill_price ??
          orderData.average_price ??
          orderData.avg_price ??
          orderData.executed_price ??
          orderData.averagePrice ??
          orderData.avgPrice
      );

      // Some endpoints may return fills array; derive aggregates if present
      const fillsArr = orderData.fills || orderData.executions || orderData.trades;
      if (Array.isArray(fillsArr) && fillsArr.length > 0) {
        let sumQty = 0;
        let sumQuote = 0;
        for (const f of fillsArr) {
          const qty = parseNum(f.quantity ?? f.qty ?? f.size ?? f.executed_size ?? f.filled_size);
          const px = parseNum(f.price ?? f.px ?? f.rate);
          const quote = parseNum(f.executed_value ?? f.value ?? f.notional ?? f.quote);

          if (Number.isFinite(qty) && qty > 0) {
            sumQty += qty;
            if (Number.isFinite(quote) && quote > 0) {
              sumQuote += quote;
            } else if (Number.isFinite(px) && px > 0) {
              sumQuote += px * qty;
            }
          }
        }

        if ((!Number.isFinite(filledSize) || filledSize <= 0) && sumQty > 0) {
          filledSize = sumQty;
        }
        if ((!Number.isFinite(executedValue) || executedValue <= 0) && sumQuote > 0) {
          executedValue = sumQuote;
        }
      }

      if (!Number.isFinite(filledSize) || filledSize < 0) filledSize = 0;
      if (!Number.isFinite(executedValue) || executedValue < 0) executedValue = 0;

      if ((!Number.isFinite(averagePrice) || averagePrice <= 0) && filledSize > 0 && executedValue > 0) {
        averagePrice = executedValue / filledSize;
      }

      if (!Number.isFinite(averagePrice) || averagePrice < 0) averagePrice = 0;

      const statusRaw = orderData.status || orderData.state || orderData.order_status || orderData.order_state;
      const normalizedStatus = typeof statusRaw === 'string' ? statusRaw.toUpperCase() : 'UNKNOWN';

      const createdAt = (() => {
        if (orderData.created_at) return new Date(orderData.created_at);
        const createdDateMs = parseNum(orderData.created_date);
        if (Number.isFinite(createdDateMs) && createdDateMs > 0) return new Date(createdDateMs);
        return undefined;
      })();

      return {
        id: orderData.venue_order_id || orderData.id || orderData.order_id || orderId,
        clientOrderId: orderData.client_order_id,
        symbol: orderData.symbol || '',
        side: orderData.side || '',
        status: normalizedStatus,
        filledSize,
        executedValue,
        averagePrice,
        createdAt,
      };
    } catch (error: any) {
      console.error(`[revolutx] getOrder exception:`, error.message);
      return null;
    }
  }

  /**
   * Get recent fills/trades for the account
   * FillWatcher uses this to find fills matching pending orders
   */
  async getFills(params?: {
    symbol?: string;
    orderId?: string;
    limit?: number;
    startMs?: number;
    endMs?: number;
  }): Promise<Array<{
    fill_id: string;
    order_id: string;
    client_order_id?: string;
    symbol: string;
    side: string;
    price: number;
    quantity: number;
    fee?: number;
    created_at: string;
  }>> {
    if (!this.initialized) throw new Error('Revolut X client not initialized');

    // If we have a symbol, use listPrivateTrades for that symbol
    if (params?.symbol) {
      try {
        const symbol = this.formatPair(params.symbol);
        const result = await this.listPrivateTrades({
          symbol,
          startMs: params.startMs,
          endMs: params.endMs,
          limit: params.limit || 50,
        });

        return result.trades.map((t: any) => ({
          fill_id: t.id || t.trade_id || t.txid || `${t.created_at}-${t.price}`,
          order_id: t.order_id || '',
          client_order_id: t.client_order_id,
          symbol: t.symbol || symbol,
          side: t.side || 'BUY',
          price: parseFloat(t.price || '0'),
          quantity: parseFloat(t.quantity || t.amount || t.vol || '0'),
          fee: parseFloat(t.fee || t.commission || '0'),
          created_at: t.created_at || t.timestamp || new Date().toISOString(),
        }));
      } catch (error: any) {
        console.error(`[revolutx] getFills error for ${params.symbol}:`, error.message);
        return [];
      }
    }

    // If we have an orderId, try to get order details first
    if (params?.orderId) {
      const order = await this.getOrder(params.orderId);
      if (order && order.filledSize && order.filledSize > 0) {
        // Order has fills - construct a synthetic fill from order data
        return [{
          fill_id: `${params.orderId}-fill`,
          order_id: params.orderId,
          client_order_id: order.clientOrderId,
          symbol: order.symbol,
          side: order.side,
          price: order.averagePrice || 0,
          quantity: order.filledSize,
          fee: 0,
          created_at: order.createdAt?.toISOString() || new Date().toISOString(),
        }];
      }
    }

    // Fallback: try to get fills from /api/1.0/fills endpoint
    const path = '/api/1.0/fills';
    const queryParams: Record<string, string | number | undefined> = {
      limit: params?.limit || 50,
    };
    if (params?.orderId) queryParams.order_id = params.orderId;
    if (params?.startMs) queryParams.start_date = params.startMs;
    if (params?.endMs) queryParams.end_date = params.endMs;

    const queryString = this.buildQueryString(queryParams, ['order_id', 'start_date', 'end_date', 'limit']);
    const fullUrl = `${API_BASE_URL}${path}${queryString ? `?${queryString}` : ''}`;
    const headers = this.getHeaders('GET', path, queryString, '');

    try {
      const response = await fetch(fullUrl, { headers });

      if (!response.ok) {
        // If /fills endpoint doesn't exist, that's OK - we'll use getOrder fallback
        if (response.status === 404) {
          console.log(`[revolutx] /fills endpoint not available, using getOrder fallback`);
          return [];
        }
        const errorText = await response.text();
        console.error(`[revolutx] getFills error: ${response.status} ${errorText}`);
        return [];
      }

      const data = await response.json() as any;
      const fills = Array.isArray(data) ? data : (data.data || data.fills || data.items || []);

      return fills.map((f: any) => ({
        fill_id: f.id || f.fill_id || f.trade_id || `${f.created_at}-${f.price}`,
        order_id: f.order_id || '',
        client_order_id: f.client_order_id,
        symbol: f.symbol || '',
        side: f.side || 'BUY',
        price: parseFloat(f.price || '0'),
        quantity: parseFloat(f.quantity || f.amount || f.size || '0'),
        fee: parseFloat(f.fee || f.commission || '0'),
        created_at: f.created_at || f.timestamp || new Date().toISOString(),
      }));
    } catch (error: any) {
      console.error(`[revolutx] getFills exception:`, error.message);
      return [];
    }
  }
}

export const revolutXService = RevolutXService.getInstance();
