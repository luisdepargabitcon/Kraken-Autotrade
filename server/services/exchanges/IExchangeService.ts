export interface OHLC {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  bid: number;
  ask: number;
  last: number;
  volume24h?: number;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  txid?: string;
  error?: string;
  price?: number;
  volume?: number;
  cost?: number;
  // NEW: For RevolutX orders that were SUBMITTED but price couldn't be determined immediately
  // This is NOT a failure - the order was accepted by the exchange
  pendingFill?: boolean;
  clientOrderId?: string;
}

export interface PairMetadata {
  lotDecimals: number;
  orderMin: number;
  pairDecimals: number;
  stepSize: number;
}

export interface ExchangeConfig {
  apiKey: string;
  apiSecret: string;
  privateKey?: string;
}

export interface IExchangeService {
  readonly exchangeName: string;
  readonly takerFeePct: number;
  readonly makerFeePct: number;

  initialize(config: ExchangeConfig): void;
  isInitialized(): boolean;

  getBalance(): Promise<Record<string, number>>;

  getTicker(pair: string): Promise<Ticker>;
  getOHLC(pair: string, interval: number): Promise<OHLC[]>;

  placeOrder(params: {
    pair: string;
    type: "buy" | "sell";
    ordertype: string;
    price?: string;
    volume: string;
  }): Promise<OrderResult>;

  cancelOrder(orderId: string): Promise<boolean>;

  loadPairMetadata(pairs: string[]): Promise<void>;
  getPairMetadata(pair: string): PairMetadata | null;
  getStepSize(pair: string): number | null;
  getOrderMin(pair: string): number | null;
  hasMetadata(pair: string): boolean;

  formatPair(pair: string): string;
  normalizePairFromExchange(exchangePair: string): string;
}
