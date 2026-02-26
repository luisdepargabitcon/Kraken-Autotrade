/**
 * FISCO Sync Service - Unificado para sincronización de exchanges
 * Reutiliza la lógica existente de fisco.routes.ts pero como servicio reutilizable
 */

import { krakenService } from "./kraken";
import { revolutXService } from "./exchanges/RevolutXService";
import { normalizeKrakenLedger, normalizeRevolutXOrders, type NormalizedOperation } from "./fisco/normalizer";
import { db } from "../db";
import { 
  FiscoSyncResult, 
  FiscoSyncHistoryRow, 
  InsertFiscoSyncHistory,
  fiscoSyncHistory,
  fiscoOperations
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface SyncOptions {
  runId?: string;
  mode: 'auto' | 'manual';
  triggeredBy: 'scheduler' | 'ui_button' | 'telegram_command';
  fullSync?: boolean; // Si true, sincroniza todo el histórico
}

export interface SyncSummary {
  runId: string;
  mode: string;
  triggeredBy: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed';
  results: FiscoSyncResult[];
  totalOperations: number;
  errors: string[];
}

export class FiscoSyncService {
  private static instance: FiscoSyncService;

  public static getInstance(): FiscoSyncService {
    if (!FiscoSyncService.instance) {
      FiscoSyncService.instance = new FiscoSyncService();
    }
    return FiscoSyncService.instance;
  }

  /**
   * Sincroniza todos los exchanges configurados
   */
  async syncAllExchanges(options: SyncOptions): Promise<SyncSummary> {
    const runId = options.runId || randomUUID();
    const startedAt = new Date();
    
    // Crear registro de historial
    await this.createSyncHistory({
      runId,
      mode: options.mode,
      triggeredBy: options.triggeredBy,
      startedAt,
      status: 'running'
    });

    const results: FiscoSyncResult[] = [];
    const errors: string[] = [];

    try {
      // Sincronizar Kraken
      if (krakenService.isInitialized()) {
        try {
          const krakenResult = await this.syncKraken(runId, options.fullSync);
          results.push(krakenResult);
        } catch (error: any) {
          const errorMsg = `Kraken sync failed: ${error.message}`;
          errors.push(errorMsg);
          results.push({
            exchange: 'Kraken',
            status: 'error',
            tradesImported: 0,
            depositsImported: 0,
            withdrawalsImported: 0,
            stakingRewardsImported: 0,
            totalOperations: 0,
            assetsAffected: [],
            error: errorMsg
          });
        }
      }

      // Sincronizar RevolutX
      if (revolutXService.isInitialized()) {
        try {
          const revolutxResult = await this.syncRevolutX(runId, options.fullSync);
          results.push(revolutxResult);
        } catch (error: any) {
          const errorMsg = `RevolutX sync failed: ${error.message}`;
          errors.push(errorMsg);
          results.push({
            exchange: 'RevolutX',
            status: 'error',
            tradesImported: 0,
            depositsImported: 0,
            withdrawalsImported: 0,
            stakingRewardsImported: 0,
            totalOperations: 0,
            assetsAffected: [],
            error: errorMsg
          });
        }
      }

      const completedAt = new Date();
      const totalOperations = results.reduce((sum, r) => sum + r.totalOperations, 0);
      const status = errors.length > 0 ? 'failed' : 'completed';

      // Actualizar registro de historial
      await this.updateSyncHistory(runId, {
        completedAt,
        status,
        resultsJson: results,
        errorJson: errors.length > 0 ? errors : null
      });

      return {
        runId,
        mode: options.mode,
        triggeredBy: options.triggeredBy,
        startedAt,
        completedAt,
        status,
        results,
        totalOperations,
        errors
      };

    } catch (error: any) {
      const completedAt = new Date();
      const errorMsg = `Sync failed: ${error.message}`;
      
      await this.updateSyncHistory(runId, {
        completedAt,
        status: 'failed',
        errorJson: [errorMsg]
      });

      return {
        runId,
        mode: options.mode,
        triggeredBy: options.triggeredBy,
        startedAt,
        completedAt,
        status: 'failed',
        results,
        totalOperations: 0,
        errors: [errorMsg]
      };
    }
  }

  /**
   * Sincroniza datos de Kraken
   */
  private async syncKraken(runId: string, fullSync?: boolean): Promise<FiscoSyncResult> {
    console.log(`[FISCO Sync] Starting Kraken sync (runId: ${runId})`);
    
    const startTime = new Date();
    let tradesImported = 0;
    let depositsImported = 0;
    let withdrawalsImported = 0;
    let stakingRewardsImported = 0;
    const assetsAffected = new Set<string>();

    try {
      // Obtener ledger de Kraken (incluye trades, depósitos, retiros, etc.)
      const ledgerResp = await krakenService.getLedgers({ fetchAll: fullSync !== false });
      const ledger = ledgerResp?.ledger || {};

      // Convertir ledger entries al formato esperado por normalizeKrakenLedger
      const ledgerEntries = Object.entries(ledger).map(([id, e]: [string, any]) => ({
        id,
        refid: e.refid,
        type: e.type,
        subtype: e.subtype,
        aclass: e.aclass,
        asset: e.asset,
        amount: typeof e.amount === "string" ? parseFloat(e.amount) : e.amount,
        fee: typeof e.fee === "string" ? parseFloat(e.fee) : e.fee,
        balance: typeof e.balance === "string" ? parseFloat(e.balance) : e.balance,
        time: e.time,
      }));

      // Normalizar y guardar operaciones
      const normalizedOps = await normalizeKrakenLedger(ledgerEntries);
      
      for (const op of normalizedOps) {
        try {
          // Insertar operación (ignorar duplicados)
          await db.insert(fiscoOperations).values({
            exchange: 'kraken',
            externalId: op.externalId,
            opType: op.opType,
            asset: op.asset,
            amount: op.amount.toString(),
            priceEur: op.priceEur?.toString() ?? null,
            totalEur: op.totalEur?.toString() ?? null,
            feeEur: op.feeEur?.toString() || "0",
            counterAsset: op.counterAsset,
            pair: op.pair,
            executedAt: op.executedAt,
            rawData: op.rawData
          }).onConflictDoNothing();

          // Contar por tipo
          switch (op.opType) {
            case 'trade_buy':
            case 'trade_sell':
              tradesImported++;
              break;
            case 'deposit':
              depositsImported++;
              break;
            case 'withdrawal':
              withdrawalsImported++;
              break;
            case 'staking':
            case 'conversion':
              stakingRewardsImported++;
              break;
          }

          assetsAffected.add(op.asset);
        } catch (error: any) {
          // Ignorar errores de duplicados
          if (!error.message?.includes('duplicate')) {
            console.error(`[FISCO Sync] Error inserting operation ${op.externalId}:`, error);
          }
        }
      }

      const totalOperations = tradesImported + depositsImported + withdrawalsImported + stakingRewardsImported;
      const endTime = new Date();

      console.log(`[FISCO Sync] Kraken sync completed: ${totalOperations} operations imported`);

      return {
        exchange: 'Kraken',
        status: totalOperations > 0 ? 'success' : 'warning',
        tradesImported,
        depositsImported,
        withdrawalsImported,
        stakingRewardsImported,
        totalOperations,
        assetsAffected: Array.from(assetsAffected),
        lastSyncAt: endTime.toISOString()
      };

    } catch (error: any) {
      console.error(`[FISCO Sync] Kraken sync error:`, error);
      throw error;
    }
  }

  /**
   * Sincroniza datos de RevolutX
   */
  private async syncRevolutX(runId: string, fullSync?: boolean): Promise<FiscoSyncResult> {
    console.log(`[FISCO Sync] Starting RevolutX sync (runId: ${runId})`);
    
    const startTime = new Date();
    let tradesImported = 0;
    let depositsImported = 0;
    let withdrawalsImported = 0;
    let stakingRewardsImported = 0;
    const assetsAffected = new Set<string>();

    try {
      // Obtener órdenes históricas de RevolutX
      const orders = await revolutXService.getHistoricalOrders({
        startMs: new Date('2020-01-01').getTime(),
        endMs: Date.now(),
        states: ['filled']
      });
      
      // Normalizar operaciones
      const normalizedOps = await normalizeRevolutXOrders(orders);
      
      for (const op of normalizedOps) {
        try {
          // Insertar operación (ignorar duplicados)
          await db.insert(fiscoOperations).values({
            exchange: 'revolutx',
            externalId: op.externalId,
            opType: op.opType,
            asset: op.asset,
            amount: op.amount.toString(),
            priceEur: op.priceEur?.toString() ?? null,
            totalEur: op.totalEur?.toString() ?? null,
            feeEur: op.feeEur?.toString() || "0",
            counterAsset: op.counterAsset,
            pair: op.pair,
            executedAt: op.executedAt,
            rawData: op.rawData
          }).onConflictDoNothing();

          // Contar por tipo
          switch (op.opType) {
            case 'trade_buy':
            case 'trade_sell':
              tradesImported++;
              break;
            case 'deposit':
              depositsImported++;
              break;
            case 'withdrawal':
              withdrawalsImported++;
              break;
            case 'staking':
            case 'conversion':
              stakingRewardsImported++;
              break;
          }

          assetsAffected.add(op.asset);
        } catch (error: any) {
          // Ignorar errores de duplicados
          if (!error.message?.includes('duplicate')) {
            console.error(`[FISCO Sync] Error inserting operation ${op.externalId}:`, error);
          }
        }
      }

      const totalOperations = tradesImported + depositsImported + withdrawalsImported + stakingRewardsImported;
      const endTime = new Date();

      console.log(`[FISCO Sync] RevolutX sync completed: ${totalOperations} operations imported`);

      return {
        exchange: 'RevolutX',
        status: totalOperations > 0 ? 'success' : 'warning',
        tradesImported,
        depositsImported,
        withdrawalsImported,
        stakingRewardsImported,
        totalOperations,
        assetsAffected: Array.from(assetsAffected),
        lastSyncAt: endTime.toISOString()
      };

    } catch (error: any) {
      console.error(`[FISCO Sync] RevolutX sync error:`, error);
      throw error;
    }
  }

  /**
   * Crea un registro de historial de sincronización
   */
  private async createSyncHistory(data: InsertFiscoSyncHistory): Promise<void> {
    await db.insert(fiscoSyncHistory).values(data);
  }

  /**
   * Actualiza un registro de historial de sincronización
   */
  private async updateSyncHistory(runId: string, updates: Partial<FiscoSyncHistoryRow>): Promise<void> {
    await db
      .update(fiscoSyncHistory)
      .set(updates)
      .where(eq(fiscoSyncHistory.runId, runId));
  }

  /**
   * Obtiene el historial de sincronizaciones
   */
  async getSyncHistory(limit: number = 50): Promise<FiscoSyncHistoryRow[]> {
    try {
      return await db
        .select()
        .from(fiscoSyncHistory)
        .orderBy(desc(fiscoSyncHistory.startedAt))
        .limit(limit);
    } catch (error: any) {
      console.error('[FiscoSyncService] getSyncHistory error:', error?.message || error);
      return [];
    }
  }

  /**
   * Obtiene una sincronización específica por runId
   */
  async getSyncByRunId(runId: string): Promise<FiscoSyncHistoryRow | undefined> {
    const results = await db
      .select()
      .from(fiscoSyncHistory)
      .where(eq(fiscoSyncHistory.runId, runId))
      .limit(1);
    
    return results[0];
  }
}

export const fiscoSyncService = FiscoSyncService.getInstance();
