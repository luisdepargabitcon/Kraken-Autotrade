import { IExchangeService } from './IExchangeService';
import { krakenService } from '../kraken';
import { revolutXService } from './RevolutXService';

export type ExchangeType = 'kraken' | 'revolutx';

export interface ExchangeStatus {
  name: ExchangeType;
  displayName: string;
  configured: boolean;
  enabled: boolean;
  takerFeePct: number;
  makerFeePct: number;
}

class ExchangeFactoryClass {
  private activeExchange: ExchangeType = 'kraken';
  private tradingExchange: ExchangeType = 'kraken';
  private dataExchange: ExchangeType = 'kraken';
  private exchangeEnabled: Record<ExchangeType, boolean> = {
    kraken: true,
    revolutx: false
  };

  getExchange(type?: ExchangeType): IExchangeService {
    const exchangeType = type || this.activeExchange;
    
    switch (exchangeType) {
      case 'revolutx':
        if (!revolutXService.isInitialized()) {
          console.warn('[ExchangeFactory] Revolut X not initialized, falling back to Kraken');
          return krakenService;
        }
        return revolutXService;
      case 'kraken':
      default:
        return krakenService;
    }
  }

  getTradingExchange(): IExchangeService {
    return this.getExchange(this.tradingExchange);
  }

  getDataExchange(): IExchangeService {
    return this.getExchange(this.dataExchange);
  }

  getActiveExchange(): IExchangeService {
    return this.getExchange(this.activeExchange);
  }

  setTradingExchange(type: ExchangeType): void {
    if (!this.exchangeEnabled[type]) {
      throw new Error(`Exchange ${type} is not enabled`);
    }
    
    const exchange = this.getExchange(type);
    if (!exchange.isInitialized()) {
      throw new Error(`Exchange ${type} is not configured`);
    }
    
    this.tradingExchange = type;
    this.activeExchange = type;
    console.log(`[ExchangeFactory] Trading exchange set to: ${type}`);
  }

  setDataExchange(type: ExchangeType): void {
    if (!this.exchangeEnabled[type]) {
      throw new Error(`Exchange ${type} is not enabled`);
    }
    
    const exchange = this.getExchange(type);
    if (!exchange.isInitialized()) {
      throw new Error(`Exchange ${type} is not configured`);
    }
    
    this.dataExchange = type;
    console.log(`[ExchangeFactory] Data exchange set to: ${type}`);
  }

  setActiveExchange(type: ExchangeType): void {
    if (!this.exchangeEnabled[type]) {
      throw new Error(`Exchange ${type} is not enabled`);
    }
    
    const exchange = this.getExchange(type);
    if (!exchange.isInitialized()) {
      throw new Error(`Exchange ${type} is not configured`);
    }
    
    this.activeExchange = type;
    this.tradingExchange = type;
    console.log(`[ExchangeFactory] Active exchange set to: ${type}`);
  }

  getActiveExchangeType(): ExchangeType {
    return this.activeExchange;
  }

  getTradingExchangeType(): ExchangeType {
    return this.tradingExchange;
  }

  getDataExchangeType(): ExchangeType {
    return this.dataExchange;
  }

  isExchangeEnabled(type: ExchangeType): boolean {
    return this.exchangeEnabled[type];
  }

  setExchangeEnabled(type: ExchangeType, enabled: boolean): void {
    if (type === this.activeExchange && !enabled) {
      throw new Error('Cannot disable the active exchange');
    }
    
    const enabledCount = Object.values(this.exchangeEnabled).filter(Boolean).length;
    if (!enabled && enabledCount <= 1) {
      throw new Error('At least one exchange must be enabled');
    }
    
    this.exchangeEnabled[type] = enabled;
    console.log(`[ExchangeFactory] Exchange ${type} enabled: ${enabled}`);
  }

  getExchangeStatus(): ExchangeStatus[] {
    return [
      {
        name: 'kraken',
        displayName: 'Kraken',
        configured: krakenService.isInitialized(),
        enabled: this.exchangeEnabled.kraken,
        takerFeePct: 0.40,
        makerFeePct: 0.25
      },
      {
        name: 'revolutx',
        displayName: 'Revolut X',
        configured: revolutXService.isInitialized(),
        enabled: this.exchangeEnabled.revolutx,
        takerFeePct: 0.09,
        makerFeePct: 0.00
      }
    ];
  }

  getActiveExchangeFees(): { takerFeePct: number; makerFeePct: number } {
    const exchange = this.getActiveExchange();
    return {
      takerFeePct: exchange.takerFeePct,
      makerFeePct: exchange.makerFeePct
    };
  }

  async initializeFromConfig(config: {
    krakenApiKey?: string;
    krakenApiSecret?: string;
    krakenEnabled?: boolean;
    revolutxApiKey?: string;
    revolutxPrivateKey?: string;
    revolutxEnabled?: boolean;
    activeExchange?: ExchangeType;
    tradingExchange?: ExchangeType;
    dataExchange?: ExchangeType;
  }): Promise<void> {
    if (config.krakenApiKey && config.krakenApiSecret) {
      krakenService.initialize({
        apiKey: config.krakenApiKey,
        apiSecret: config.krakenApiSecret
      });
      this.exchangeEnabled.kraken = config.krakenEnabled !== false;
      console.log('[ExchangeFactory] Kraken initialized');
    }

    if (config.revolutxApiKey && config.revolutxPrivateKey) {
      revolutXService.initialize({
        apiKey: config.revolutxApiKey,
        apiSecret: '',
        privateKey: config.revolutxPrivateKey
      });
      this.exchangeEnabled.revolutx = config.revolutxEnabled === true;
      console.log('[ExchangeFactory] Revolut X initialized');
    }

    const tradingEx = config.tradingExchange || config.activeExchange || 'kraken';
    if (this.exchangeEnabled[tradingEx]) {
      const exchange = this.getExchange(tradingEx);
      if (exchange.isInitialized()) {
        this.tradingExchange = tradingEx;
        this.activeExchange = tradingEx;
      }
    }

    // Data exchange is ALWAYS Kraken - it has the best OHLC/market data API
    // This is intentionally hardcoded and ignores config.dataExchange
    this.dataExchange = 'kraken';

    console.log(`[ExchangeFactory] Trading: ${this.tradingExchange}, Data: ${this.dataExchange}`);
  }

  getTradingExchangeFees(): { takerFeePct: number; makerFeePct: number } {
    const exchange = this.getTradingExchange();
    return {
      takerFeePct: exchange.takerFeePct,
      makerFeePct: exchange.makerFeePct
    };
  }
}

export const ExchangeFactory = new ExchangeFactoryClass();
