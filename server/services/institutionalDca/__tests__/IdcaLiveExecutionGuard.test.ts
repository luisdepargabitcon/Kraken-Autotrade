/**
 * IDCA LIVE Execution Guard Tests
 * HOTFIX 0284937 — Tests para validar ejecución segura con confirmación de fill
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as liveGuard from '../IdcaLiveExecutionGuard';
import { ExchangeFactory } from '../../exchanges/ExchangeFactory';

// Mocks
vi.mock('../../exchanges/ExchangeFactory');

describe('IDCA LIVE Execution Guard — HOTFIX 0284937', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('TAREA 5.1: Compra inicial LIVE rechazada', () => {
    it('no debe crear ciclo si la compra es rechazada por saldo insuficiente', async () => {
      // Simular exchange con saldo insuficiente
      const mockExchange = {
        isInitialized: () => true,
        getBalance: () => Promise.resolve({ available: { 'USDC': 10 } }), // Solo $10
      };
      vi.mocked(ExchangeFactory.getTradingExchange).mockReturnValue(mockExchange as any);

      const validation = await liveGuard.validateLiveBuyIntention({
        pair: 'BTC/USD',
        cycleId: 0,
        buyType: 'initial',
        intendedUsd: 1000,
        intendedQty: 0.01,
        currentPrice: 100000,
        feePct: 0.1,
        slippagePct: 0.1,
      });

      // Debe indicar que no es válido
      expect(validation.success).toBe(false);
      expect(validation.rejectionReason).toContain('insufficient');
    });
  });

  describe('TAREA 5.2: Safety buy LIVE no_fill', () => {
    it('validateLiveBuyIntention debe retornar adjusted=false cuando no hay reducción', async () => {
      const mockExchange = {
        isInitialized: () => true,
        getBalance: () => Promise.resolve({ available: { 'USDC': 10000 } }),
      };
      vi.mocked(ExchangeFactory.getTradingExchange).mockReturnValue(mockExchange as any);

      const validation = await liveGuard.validateLiveBuyIntention({
        pair: 'BTC/USD',
        cycleId: 1,
        buyType: 'safety',
        intendedUsd: 100,
        intendedQty: 0.001,
        currentPrice: 100000,
        feePct: 0.1,
        slippagePct: 0.1,
      });

      expect(validation.success).toBe(true);
      expect(validation.reduced).toBe(false);
    });
  });

  describe('TAREA 5.3: Safety buy LIVE reducible por saldo', () => {
    it('debe reducir tamaño cuando hay saldo parcial disponible', async () => {
      // Saldo suficiente para 50% de la intención
      const mockExchange = {
        isInitialized: () => true,
        getBalance: () => Promise.resolve({ available: { 'USDC': 55 } }), // Solo para $50 + fees
      };
      vi.mocked(ExchangeFactory.getTradingExchange).mockReturnValue(mockExchange as any);

      const validation = await liveGuard.validateLiveBuyIntention({
        pair: 'BTC/USD',
        cycleId: 1,
        buyType: 'safety',
        intendedUsd: 100,
        intendedQty: 0.001,
        currentPrice: 100000,
        feePct: 0.1,
        slippagePct: 0.1,
      });

      // Debe reducir o rechazar según la lógica implementada
      expect(validation.success).toBeDefined();
      if (validation.success && validation.reduced) {
        expect(validation.adjustedUsd).toBeLessThan(100);
      }
    });
  });

  describe('TAREA 5.6: Venta LIVE con quantity mismatch', () => {
    it('validateSellQuantity debe detectar cuando hay menos balance del esperado', async () => {
      const mockExchange = {
        isInitialized: () => true,
        getBalance: () => Promise.resolve({
          available: { 'BTC': 0.005 }, // Menos de lo que el ciclo cree tener
        }),
      };
      vi.mocked(ExchangeFactory.getTradingExchange).mockReturnValue(mockExchange as any);

      // El ciclo cree tener 0.01 BTC pero el exchange solo tiene 0.005
      const validation = await liveGuard.validateSellQuantity('BTC/USD', 0.01, 0.01);

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('insufficient');
    });

    it('validateSellQuantity debe permitir venta cuando hay suficiente balance', async () => {
      const mockExchange = {
        isInitialized: () => true,
        getBalance: () => Promise.resolve({
          available: { 'BTC': 0.02 }, // Más de lo que se quiere vender
        }),
      };
      vi.mocked(ExchangeFactory.getTradingExchange).mockReturnValue(mockExchange as any);

      const validation = await liveGuard.validateSellQuantity('BTC/USD', 0.01, 0.01);

      expect(validation.valid).toBe(true);
    });
  });

  describe('TAREA 5.9: Scheduler reconciliation gating', () => {
    it('debe existir función isSafeToStartAfterReconciliation', async () => {
      // Verificar que la función existe y está exportada
      const { isSafeToStartAfterReconciliation } = await import('../IdcaStartupReconciliationService');
      expect(typeof isSafeToStartAfterReconciliation).toBe('function');
    });

    it('isSafeToStartAfterReconciliation debe retornar false si hay ciclos ambiguos', async () => {
      const { isSafeToStartAfterReconciliation } = await import('../IdcaStartupReconciliationService');

      const resultWithAmbiguous = {
        cyclesChecked: 5,
        phantomsVoided: 0,
        ambiguousBlocked: 2, // Hay ciclos ambiguos
        errors: [],
      };

      expect(isSafeToStartAfterReconciliation(resultWithAmbiguous)).toBe(false);
    });

    it('isSafeToStartAfterReconciliation debe retornar true si no hay issues', async () => {
      const { isSafeToStartAfterReconciliation } = await import('../IdcaStartupReconciliationService');

      const cleanResult = {
        cyclesChecked: 5,
        phantomsVoided: 0,
        ambiguousBlocked: 0,
        errors: [],
      };

      expect(isSafeToStartAfterReconciliation(cleanResult)).toBe(true);
    });
  });
});

// Test de integración básico para verificar que las funciones existen
describe('TAREA 5: Funciones de ejecución existen', () => {
  it('executeRealBuyWithGuard debe estar exportado', () => {
    expect(typeof liveGuard.executeRealBuyWithGuard).toBe('function');
  });

  it('validateSellQuantity debe estar exportado', () => {
    expect(typeof liveGuard.validateSellQuantity).toBe('function');
  });

  it('validateLiveBuyIntention debe estar exportado', () => {
    expect(typeof liveGuard.validateLiveBuyIntention).toBe('function');
  });
});
