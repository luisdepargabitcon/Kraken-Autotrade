import { IExchangeService } from './IExchangeService';
import { krakenService } from '../kraken';
import { revolutXService } from './RevolutXService';
import { krakenNonceManager } from './NonceManager';
import { balanceCache } from './BalanceCache';
import { krakenRateLimiter } from '../../utils/krakenRateLimiter';

export type ExchangeType = 'kraken' | 'revolutx';
export type ExecutionVenueType = 'revolutx';
export type ExecutionVenueUnavailableReason = 'not_selected' | 'disabled' | 'not_initialized' | 'forbidden_selection';

export interface ExchangeStatus {
  name: ExchangeType;
  displayName: string;
  configured: boolean;
  enabled: boolean;
  takerFeePct: number;
  makerFeePct: number;
}

interface ForbiddenSelectionDiagnostics {
  reason: ExecutionVenueUnavailableReason;
  configuredExchange: unknown;
  at: string;
}

export class ExchangeFactoryClass {
  private static instance: ExchangeFactoryClass;

  private activeExchange: ExchangeType | null = null;
  private tradingExchange: ExchangeType | null = null;
  private dataExchange: ExchangeType = 'kraken';
  private exchangeEnabled: Record<ExchangeType, boolean> = {
    kraken: true,
    revolutx: false
  };
  private forbiddenSelection: ForbiddenSelectionDiagnostics | null = null;

  static getInstance(): ExchangeFactoryClass {
    if (!ExchangeFactoryClass.instance) {
      ExchangeFactoryClass.instance = new ExchangeFactoryClass();
    }
    return ExchangeFactoryClass.instance;
  }

  getExchange(type?: ExchangeType): IExchangeService {
    if (!type) return this.getExecutionVenue();

    switch (type) {
      case 'revolutx':
        if (!revolutXService.isInitialized()) {
          console.error('[ExchangeFactory] VENUE_UNAVAILABLE:not_initialized: Revolut X not initialized; no fallback venue allowed');
          throw new Error('VENUE_UNAVAILABLE:not_initialized: Revolut X not initialized');
        }
        return revolutXService;
      case 'kraken':
        return krakenService;
    }
  }

  getExecutionVenue(): IExchangeService {
    if (this.tradingExchange !== 'revolutx') {
      const reason: ExecutionVenueUnavailableReason = this.tradingExchange === 'kraken'
        ? 'forbidden_selection'
        : this.forbiddenSelection?.reason ?? 'not_selected';
      return this.throwVenueUnavailable(reason);
    }
    if (!this.exchangeEnabled.revolutx) {
      return this.throwVenueUnavailable('disabled');
    }
    if (!revolutXService.isInitialized()) {
      return this.throwVenueUnavailable('not_initialized');
    }
    return revolutXService;
  }

  private throwVenueUnavailable(reason: ExecutionVenueUnavailableReason): never {
    console.error(`[ExchangeFactory] VENUE_UNAVAILABLE:${reason}: Revolut X execution venue unavailable`);
    throw new Error(`VENUE_UNAVAILABLE:${reason}: Revolut X execution venue unavailable`);
  }

  getTradingExchange(): IExchangeService {
    return this.getExecutionVenue();
  }

  getDataExchange(): IExchangeService {
    return this.getExchange(this.dataExchange);
  }

  getActiveExchange(): IExchangeService {
    return this.getExecutionVenue();
  }

  setTradingExchange(type: ExchangeType): void {
    if (type === 'kraken') {
      throw new Error('KRAKEN_TRADING_FORBIDDEN: Kraken is data-only; Revolut X is the sole execution venue');
    }
    if (!this.exchangeEnabled[type]) {
      throw new Error(`Exchange ${type} is not enabled`);
    }

    const exchange = this.getExchange(type);
    if (!exchange.isInitialized()) {
      throw new Error(`Exchange ${type} is not configured`);
    }

    this.tradingExchange = type;
    this.activeExchange = type;
    this.forbiddenSelection = null;
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
    this.setTradingExchange(type);
    console.log(`[ExchangeFactory] Active exchange set to: ${type}`);
  }

  getActiveExchangeType(): ExecutionVenueType | null {
    return this.activeExchange === 'revolutx' ? 'revolutx' : null;
  }

  getTradingExchangeType(): ExecutionVenueType | null {
    return this.tradingExchange === 'revolutx' ? 'revolutx' : null;
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

    const hasRevolutXCredentials = !!(config.revolutxApiKey && config.revolutxPrivateKey);
    if (hasRevolutXCredentials) {
      revolutXService.initialize({
        apiKey: config.revolutxApiKey!,
        apiSecret: '',
        privateKey: config.revolutxPrivateKey!
      });
      this.exchangeEnabled.revolutx = config.revolutxEnabled === true;
      console.log('[ExchangeFactory] Revolut X initialized');
    } else {
      this.exchangeEnabled.revolutx = false;
    }

    const configuredExchange = config.tradingExchange ?? config.activeExchange;
    let unavailableReason: ExecutionVenueUnavailableReason | null = null;

    if (configuredExchange === 'kraken') {
      unavailableReason = 'forbidden_selection';
    } else if (configuredExchange !== 'revolutx') {
      unavailableReason = configuredExchange == null ? 'not_selected' : 'forbidden_selection';
    } else if (!hasRevolutXCredentials) {
      unavailableReason = 'not_initialized';
    } else if (!this.exchangeEnabled.revolutx) {
      unavailableReason = 'disabled';
    } else if (!revolutXService.isInitialized()) {
      unavailableReason = 'not_initialized';
    }

    if (unavailableReason) {
      this.tradingExchange = null;
      this.activeExchange = null;
      this.forbiddenSelection = {
        reason: unavailableReason,
        configuredExchange,
        at: new Date().toISOString(),
      };
      console.error(
        `[ExchangeFactory] EXECUTION_VENUE_NOT_SELECTED reason=${unavailableReason} configured=${String(configuredExchange)}; ` +
        'no fallback or automatic Revolut X authorization is allowed'
      );
    } else {
      this.tradingExchange = 'revolutx';
      this.activeExchange = 'revolutx';
      this.forbiddenSelection = null;
    }

    // Data exchange is ALWAYS Kraken - it has the best OHLC/market data API
    // This is intentionally hardcoded and ignores config.dataExchange
    this.dataExchange = 'kraken';

    console.log(`[ExchangeFactory] Trading: ${this.tradingExchange ?? 'none'}, Data: ${this.dataExchange}`);
  }

  getTradingExchangeFees(): { takerFeePct: number; makerFeePct: number } {
    const exchange = this.getTradingExchange();
    return {
      takerFeePct: exchange.takerFeePct,
      makerFeePct: exchange.makerFeePct
    };
  }

  /**
   * Diagnóstico completo del sistema de coordinación privada.
   * Incluye: nonce stats, rate limiter, balance cache, exchange status.
   */
  getDiagnostics(): Record<string, any> {
    return {
      timestamp: new Date().toISOString(),
      exchanges: {
        active: this.activeExchange ?? 'none',
        trading: this.tradingExchange ?? 'none',
        data: this.dataExchange,
        kraken: {
          initialized: krakenService.isInitialized(),
          enabled: this.exchangeEnabled.kraken,
        },
        revolutx: {
          initialized: revolutXService.isInitialized(),
          enabled: this.exchangeEnabled.revolutx,
          rateLimiter: revolutXService.getRateLimiterStats(),
        },
      },
      forbiddenSelection: this.forbiddenSelection,
      nonceManager: krakenNonceManager.getStats(),
      krakenRateLimiter: krakenRateLimiter.getStats(),
      balanceCache: balanceCache.getStats(),
    };
  }
}

export const ExchangeFactory = new ExchangeFactoryClass();
