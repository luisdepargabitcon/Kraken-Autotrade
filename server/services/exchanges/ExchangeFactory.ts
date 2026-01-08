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

  getActiveExchange(): IExchangeService {
    return this.getExchange(this.activeExchange);
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
    console.log(`[ExchangeFactory] Active exchange set to: ${type}`);
  }

  getActiveExchangeType(): ExchangeType {
    return this.activeExchange;
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

    if (config.activeExchange && this.exchangeEnabled[config.activeExchange]) {
      const exchange = this.getExchange(config.activeExchange);
      if (exchange.isInitialized()) {
        this.activeExchange = config.activeExchange;
      }
    }

    console.log(`[ExchangeFactory] Active exchange: ${this.activeExchange}`);
  }
}

export const ExchangeFactory = new ExchangeFactoryClass();
