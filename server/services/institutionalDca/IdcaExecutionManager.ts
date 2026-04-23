/**
 * IdcaExecutionManager — Servicio avanzado de ejecución de órdenes
 * 
 * Soporta múltiples estrategias de ejecución:
 * - Simple: Market/Limit orders directas
 * - Child Orders: Órdenes hijas con gestión parcial
 * - TWAP: Time-Weighted Average Price
 * - Adaptive: Ajuste dinámico según mercado
 */
import { InstitutionalDcaCycle, InstitutionalDcaAssetConfigRow } from "@shared/schema";
import { idcaMarketContextService, MarketContext } from "./IdcaMarketContextService";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";

export interface ExecutionConfig {
  // Estrategia de ejecución
  strategy: "simple" | "child_orders" | "twap" | "adaptive";
  
  // Parámetros generales
  orderType: "market" | "limit";
  slippageTolerancePct: number;    // Tolerancia a slippage
  maxRetries: number;              // Máximo reintentos
  retryDelayMs: number;            // Delay entre reintentos
  
  // Child Orders
  childOrderCount: number;         // Número de órdenes hijas
  childOrderDelayMs: number;       // Delay entre órdenes hijas
  minChildSizeUsd: number;         // Tamaño mínimo por orden hija
  
  // TWAP
  twapDurationMinutes: number;     // Duración total del TWAP
  twapSliceCount: number;          // Número de slices
  twapVariancePct: number;         // Varianza en tamaño de slices
  
  // Adaptive
  adaptiveEnabled: boolean;        // Activar ajuste adaptativo
  volatilityThreshold: number;     // Umbral de volatilidad para ajuste
  volumeThreshold: number;         // Umbral de volumen para ajuste
}

export interface ExecutionRequest {
  cycleId: number;
  pair: string;
  side: "buy" | "sell";
  totalQuantity: number;
  totalValueUsd: number;
  urgency: "low" | "medium" | "high" | "critical";
  reason: string;
  config: ExecutionConfig;
}

export interface ExecutionResult {
  success: boolean;
  executedQuantity: number;
  executedValueUsd: number;
  avgPrice: number;
  totalFeesUsd: number;
  slippagePct: number;
  executionTimeMs: number;
  orders: OrderResult[];
  warnings: string[];
}

export interface OrderResult {
  orderId: string;
  exchangeOrderId?: string;
  quantity: number;
  price: number;
  valueUsd: number;
  feesUsd: number;
  status: "filled" | "partial" | "failed" | "cancelled";
  executedAt: Date;
  retryCount: number;
}

export interface ExecutionState {
  cycleId: number;
  pair: string;
  side: "buy" | "sell";
  totalQuantity: number;
  executedQuantity: number;
  remainingQuantity: number;
  currentStrategy: string;
  startTime: Date;
  lastUpdate: Date;
  orders: OrderResult[];
  status: "pending" | "executing" | "completed" | "failed" | "cancelled";
}

class IdcaExecutionManager {
  private executionStates = new Map<number, ExecutionState>();

  /**
   * Crea configuración de ejecución desde asset config
   */
  createExecutionConfig(assetConfig: InstitutionalDcaAssetConfigRow): ExecutionConfig {
    return {
      strategy: "simple", // Default por seguridad
      orderType: "market",
      slippageTolerancePct: 0.5,
      maxRetries: 3,
      retryDelayMs: 1000,
      
      childOrderCount: 3,
      childOrderDelayMs: 500,
      minChildSizeUsd: 10,
      
      twapDurationMinutes: 5,
      twapSliceCount: 10,
      twapVariancePct: 20,
      
      adaptiveEnabled: true,
      volatilityThreshold: 2.0,
      volumeThreshold: 10000,
    };
  }

  /**
   * Ejecuta una orden usando la estrategia configurada
   */
  async executeOrder(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const state = this.initializeExecutionState(request);
    
    try {
      let result: ExecutionResult;
      
      switch (request.config.strategy) {
        case "simple":
          result = await this.executeSimple(request, state);
          break;
        case "child_orders":
          result = await this.executeChildOrders(request, state);
          break;
        case "twap":
          result = await this.executeTWAP(request, state);
          break;
        case "adaptive":
          result = await this.executeAdaptive(request, state);
          break;
        default:
          throw new Error(`Unknown execution strategy: ${request.config.strategy}`);
      }
      
      result.executionTimeMs = Date.now() - startTime;
      this.finalizeExecution(state, result);
      
      return result;
      
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      console.error(`[IdcaExecutionManager] Execution failed for ${request.pair}:`, error);
      
      return {
        success: false,
        executedQuantity: state.executedQuantity,
        executedValueUsd: state.orders.reduce((sum, o) => sum + o.valueUsd, 0),
        avgPrice: 0,
        totalFeesUsd: state.orders.reduce((sum, o) => sum + o.feesUsd, 0),
        slippagePct: 0,
        executionTimeMs,
        orders: state.orders,
        warnings: [`Execution failed: ${(error as Error).message}`],
      };
    }
  }

  /**
   * Estrategia simple: una orden directa
   */
  private async executeSimple(
    request: ExecutionRequest,
    state: ExecutionState
  ): Promise<ExecutionResult> {
    const exchange = ExchangeFactory.getTradingExchange();
    
    let orderResult: OrderResult;
    let retries = 0;
    
    while (retries <= request.config.maxRetries) {
      try {
        const order = await exchange.placeOrder({
          pair: request.pair,
          type: request.side as "buy" | "sell",
          ordertype: "market",
          volume: request.totalQuantity.toFixed(8),
        });
        
        if (order) {
          orderResult = await this.parseOrderResult(order, request, retries);
          state.orders.push(orderResult);
          state.executedQuantity += orderResult.quantity;
          break;
        }
      } catch (error) {
        retries++;
        if (retries > request.config.maxRetries) {
          throw new Error(`Simple execution failed after ${retries} retries: ${(error as Error).message}`);
        }
        
        await this.delay(request.config.retryDelayMs);
      }
    }
    
    return this.buildExecutionResult(state, request);
  }

  /**
   * Estrategia child orders: divide en múltiples órdenes
   */
  private async executeChildOrders(
    request: ExecutionRequest,
    state: ExecutionState
  ): Promise<ExecutionResult> {
    const childSize = request.totalQuantity / request.config.childOrderCount;
    const minValuePerChild = request.config.minChildSizeUsd;
    
    // Ajustar si el tamaño por child es muy pequeño
    const actualChildCount = Math.min(
      request.config.childOrderCount,
      Math.floor(request.totalValueUsd / minValuePerChild)
    );
    
    const adjustedChildSize = request.totalQuantity / actualChildCount;
    
    for (let i = 0; i < actualChildCount; i++) {
      const remainingQuantity = request.totalQuantity - state.executedQuantity;
      if (remainingQuantity <= 0) break;
      
      const currentChildSize = Math.min(adjustedChildSize, remainingQuantity);
      
      try {
        const exchange = ExchangeFactory.getTradingExchange();
        const order = await exchange.placeOrder({
          pair: request.pair,
          type: request.side as "buy" | "sell",
          ordertype: "market",
          volume: currentChildSize.toFixed(8),
        });
        
        if (order) {
          const orderResult = await this.parseOrderResult(order, request, 0);
          state.orders.push(orderResult);
          state.executedQuantity += orderResult.quantity;
        }
        
        // Delay entre órdenes hijas
        if (i < actualChildCount - 1) {
          await this.delay(request.config.childOrderDelayMs);
        }
        
      } catch (error) {
        console.warn(`[IdcaExecutionManager] Child order ${i + 1} failed:`, error);
        // Continuar con las siguientes órdenes hijas
      }
    }
    
    return this.buildExecutionResult(state, request);
  }

  /**
   * Estrategia TWAP: ejecuta a lo largo del tiempo
   */
  private async executeTWAP(
    request: ExecutionRequest,
    state: ExecutionState
  ): Promise<ExecutionResult> {
    const sliceDuration = (request.config.twapDurationMinutes * 60 * 1000) / request.config.twapSliceCount;
    const baseSliceSize = request.totalQuantity / request.config.twapSliceCount;
    
    for (let i = 0; i < request.config.twapSliceCount; i++) {
      const remainingQuantity = request.totalQuantity - state.executedQuantity;
      if (remainingQuantity <= 0) break;
      
      // Aplicar varianza al tamaño del slice
      const variance = 1 + (Math.random() - 0.5) * 2 * (request.config.twapVariancePct / 100);
      const sliceSize = Math.min(baseSliceSize * variance, remainingQuantity);
      
      try {
        const exchange = ExchangeFactory.getTradingExchange();
        const order = await exchange.placeOrder({
          pair: request.pair,
          type: request.side as "buy" | "sell",
          ordertype: "market",
          volume: sliceSize.toFixed(8),
        });
        
        if (order) {
          const orderResult = await this.parseOrderResult(order, request, 0);
          state.orders.push(orderResult);
          state.executedQuantity += orderResult.quantity;
        }
        
      } catch (error) {
        console.warn(`[IdcaExecutionManager] TWAP slice ${i + 1} failed:`, error);
      }
      
      // Esperar hasta el siguiente slice
      if (i < request.config.twapSliceCount - 1) {
        await this.delay(sliceDuration);
      }
    }
    
    return this.buildExecutionResult(state, request);
  }

  /**
   * Estrategia adaptativa: ajusta según condiciones del mercado
   */
  private async executeAdaptive(
    request: ExecutionRequest,
    state: ExecutionState
  ): Promise<ExecutionResult> {
    const context = await idcaMarketContextService.getMarketContext(request.pair);
    
    // Decidir estrategia basada en condiciones
    let selectedStrategy: "simple" | "child_orders" | "twap";
    
    if (request.urgency === "critical" || request.urgency === "high") {
      selectedStrategy = "simple"; // Rápido y directo
    } else if (context.atrPct && context.atrPct > request.config.volatilityThreshold) {
      selectedStrategy = "twap"; // Alta volatilidad → distribuir en tiempo
    } else if (request.totalValueUsd > request.config.volumeThreshold) {
      selectedStrategy = "child_orders"; // Gran volumen → dividir
    } else {
      selectedStrategy = "simple"; // Condiciones normales
    }
    
    console.log(
      `[IdcaExecutionManager] Adaptive strategy for ${request.pair}: ${selectedStrategy} ` +
      `(urgency: ${request.urgency}, volatility: ${context.atrPct}%, value: $${request.totalValueUsd})`
    );
    
    // Ejecutar con la estrategia seleccionada
    const adaptiveRequest = { ...request, config: { ...request.config, strategy: selectedStrategy } };
    
    switch (selectedStrategy) {
      case "simple":
        return this.executeSimple(adaptiveRequest, state);
      case "child_orders":
        return this.executeChildOrders(adaptiveRequest, state);
      case "twap":
        return this.executeTWAP(adaptiveRequest, state);
      default:
        throw new Error(`Invalid adaptive strategy: ${selectedStrategy}`);
    }
  }

  /**
   * Inicializa estado de ejecución
   */
  private initializeExecutionState(request: ExecutionRequest): ExecutionState {
    const state: ExecutionState = {
      cycleId: request.cycleId,
      pair: request.pair,
      side: request.side,
      totalQuantity: request.totalQuantity,
      executedQuantity: 0,
      remainingQuantity: request.totalQuantity,
      currentStrategy: request.config.strategy,
      startTime: new Date(),
      lastUpdate: new Date(),
      orders: [],
      status: "executing",
    };
    
    this.executionStates.set(request.cycleId, state);
    return state;
  }

  /**
   * Parsea resultado de orden desde exchange
   */
  private async parseOrderResult(
    order: any,
    request: ExecutionRequest,
    retryCount: number
  ): Promise<OrderResult> {
    return {
      orderId: order.id || `temp_${Date.now()}`,
      exchangeOrderId: order.exchangeOrderId,
      quantity: parseFloat(String(order.filled || order.quantity || 0)),
      price: parseFloat(String(order.price || 0)),
      valueUsd: parseFloat(String(order.value || 0)),
      feesUsd: parseFloat(String(order.fees || 0)),
      status: order.status === "filled" ? "filled" : "partial",
      executedAt: new Date(),
      retryCount,
    };
  }

  /**
   * Construye resultado de ejecución
   */
  private buildExecutionResult(
    state: ExecutionState,
    request: ExecutionRequest
  ): ExecutionResult {
    const totalValue = state.orders.reduce((sum, o) => sum + o.valueUsd, 0);
    const totalFees = state.orders.reduce((sum, o) => sum + o.feesUsd, 0);
    const avgPrice = state.executedQuantity > 0 ? totalValue / state.executedQuantity : 0;
    
    // Calcular slippage (aproximado)
    const expectedPrice = request.totalValueUsd / request.totalQuantity;
    const slippagePct = expectedPrice > 0 ? Math.abs((avgPrice - expectedPrice) / expectedPrice) * 100 : 0;
    
    const warnings: string[] = [];
    if (slippagePct > request.config.slippageTolerancePct) {
      warnings.push(`High slippage: ${slippagePct.toFixed(2)}%`);
    }
    
    if (state.executedQuantity < request.totalQuantity * 0.95) {
      warnings.push(`Partial execution: ${(state.executedQuantity / request.totalQuantity * 100).toFixed(1)}%`);
    }
    
    return {
      success: state.executedQuantity > 0,
      executedQuantity: state.executedQuantity,
      executedValueUsd: totalValue,
      avgPrice,
      totalFeesUsd: totalFees,
      slippagePct,
      executionTimeMs: 0, // Se establece externamente
      orders: state.orders,
      warnings,
    };
  }

  /**
   * Finaliza estado de ejecución
   */
  private finalizeExecution(state: ExecutionState, result: ExecutionResult): void {
    state.status = result.success ? "completed" : "failed";
    state.lastUpdate = new Date();
    state.remainingQuantity = state.totalQuantity - state.executedQuantity;
  }

  /**
   * Delay utilitario
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Obtiene estado de ejecución para un ciclo
   */
  getExecutionState(cycleId: number): ExecutionState | undefined {
    return this.executionStates.get(cycleId);
  }

  /**
   * Limpia estado de ejecución para un ciclo
   */
  clearExecutionState(cycleId: number): void {
    this.executionStates.delete(cycleId);
  }

  /**
   * Obtiene todos los estados de ejecución activos
   */
  getAllExecutionStates(): ExecutionState[] {
    return Array.from(this.executionStates.values());
  }

  /**
   * Genera diagnóstico de sistema de ejecución
   */
  async generateExecutionDiagnostics(
    request: ExecutionRequest
  ): Promise<{
    request: ExecutionRequest;
    recommendation: string;
    expectedDuration: number;
    riskFactors: string[];
  }> {
    const context = await idcaMarketContextService.getMarketContext(request.pair);
    
    let recommendation = request.config.strategy;
    let expectedDuration = 1000; // 1 segundo base
    
    const riskFactors: string[] = [];
    
    // Analizar factores de riesgo
    if (context.atrPct && context.atrPct > 3.0) {
      riskFactors.push("High volatility - consider TWAP strategy");
    }
    
    if (request.totalValueUsd > 50000) {
      riskFactors.push("Large order size - consider child orders");
    }
    
    if (request.urgency === "critical") {
      riskFactors.push("Critical urgency - market order recommended");
    }
    
    if (context.dataQuality === "poor") {
      riskFactors.push("Poor market data quality");
    }
    
    // Recomendaciones basadas en análisis
    if (request.urgency === "critical" || request.urgency === "high") {
      recommendation = "simple";
      expectedDuration = 2000;
    } else if (context.atrPct && context.atrPct > 2.5) {
      recommendation = "twap";
      expectedDuration = request.config.twapDurationMinutes * 60 * 1000;
    } else if (request.totalValueUsd > 25000) {
      recommendation = "child_orders";
      expectedDuration = request.config.childOrderCount * request.config.childOrderDelayMs;
    }
    
    return {
      request,
      recommendation,
      expectedDuration,
      riskFactors,
    };
  }
}

// Singleton export
export const idcaExecutionManager = new IdcaExecutionManager();
