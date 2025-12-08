import * as KrakenAPI from "node-kraken-api";

const { Kraken } = KrakenAPI as any;

interface KrakenConfig {
  apiKey: string;
  apiSecret: string;
}

export class KrakenService {
  private client: any | null = null;
  private publicClient: any;

  constructor() {
    this.publicClient = new Kraken();
  }

  initialize(config: KrakenConfig) {
    this.client = new Kraken({
      key: config.apiKey,
      secret: config.apiSecret,
    });
  }

  isInitialized(): boolean {
    return this.client !== null;
  }

  async getBalance() {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.client.balance();
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

    return await this.client.addOrder(orderParams);
  }

  async cancelOrder(txid: string) {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.client.cancelOrder({ txid });
  }

  async getOpenOrders() {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.client.openOrders();
  }

  async getClosedOrders(limit: number = 50) {
    if (!this.client) throw new Error("Kraken client not initialized");
    return await this.client.closedOrders({ ofs: 0 });
  }

  private formatPair(pair: string): string {
    const pairMap: Record<string, string> = {
      "BTC/USD": "XXBTZUSD",
      "ETH/USD": "XETHZUSD",
      "SOL/USD": "SOLUSD",
      "BTC/ETH": "XXBTZXETH",
      "SOL/ETH": "SOLETH",
    };
    return pairMap[pair] || pair;
  }
}

export const krakenService = new KrakenService();
