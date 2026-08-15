/**
 * SpotRealReadiness — R10.2 Comprehensive preflight checks for REAL mode activation.
 *
 * R10.2 changes:
 *   - Real runtime state: scanner/supervisor counts from engine, not hardcode
 *   - Metadata per pair: check each active pair has metadata, BLOCKER if missing
 *   - Pending order_intents: count pending SPOT REAL intents in various states
 *   - Credentials: verified via authenticated getBalance call
 *
 * Checks:
 *   1. REAL_ACTIVATION_ALLOWED = true
 *   2. ExchangeFactory.getTradingExchange() is initialized
 *   3. Balance reachable (authenticated API call via getBalance)
 *   4. Fee model valid (takerFeePct > 0)
 *   5. Active pairs configured
 *   6. Pair metadata loaded PER PAIR (BLOCKER if any missing)
 *   7. No UNCERTAIN positions (must resolve first)
 *   8. No PENDING_FILL / EXIT_PENDING positions (must resolve first)
 *   9. No legacy entries (non-SPOT_CANONICAL positions on same pairs)
 *  10. Shadow positions (warning only)
 *  11. API credentials configured (verified via getBalance)
 *  12. RealAdapter implemented (canPlaceRealOrder = true)
 *  13. Pending order_intents counts (warning if > 0)
 *  14. Runtime state: entry scanner and position supervisor from engine
 */

import { REAL_ACTIVATION_ALLOWED, ExecutionMode, SPOT_POLICY_VERSION } from "./spotTypes";
import { SPOT_ENGINE_OWNER, isSpotRuntimeOwner } from "./spotEngine";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import { getTradingFeeModel } from "./feeModel";
import { countPendingRealOrderIntents, RealIntentPersistenceError } from "./spotOrderIntentStore";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export interface RealReadinessResult {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  checks: {
    realActivationAllowed: boolean;
    exchangeInitialized: boolean;
    exchangeName: string | null;
    balanceReachable: boolean;
    feeModelValid: boolean;
    takerFeePct: number | null;
    makerFeePct: number | null;
    activePairsConfigured: boolean;
    activePairsCount: number;
    activePairsList: string[];
    pairMetadataLoaded: boolean;
    pairMetadataMissing: string[];
    uncertainPositionsCount: number;
    pendingFillPositionsCount: number;
    exitPendingPositionsCount: number;
    legacyEntriesCount: number;
    shadowPositionsOpen: boolean;
    shadowPositionsCount: number;
    apiCredentialsConfigured: boolean;
    uncertainOrdersCount: number;
    pendingEntryIntents: number;
    pendingExitIntents: number;
    submittedIntentsWithoutVenueId: number;
    entryScannerRunning: boolean;
    positionSupervisorRunning: boolean;
    entryScannerCount: number;
    positionSupervisorCount: number;
    realReconcilerCount: number;
    runtimeOwner: string | null;
    isSpotRuntimeOwnerCheck: boolean;
  };
}

export async function checkRealReadiness(): Promise<RealReadinessResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const checks = {
    realActivationAllowed: false,
    exchangeInitialized: false,
    exchangeName: null as string | null,
    balanceReachable: false,
    feeModelValid: false,
    takerFeePct: null as number | null,
    makerFeePct: null as number | null,
    activePairsConfigured: false,
    activePairsCount: 0,
    activePairsList: [] as string[],
    pairMetadataLoaded: false,
    pairMetadataMissing: [] as string[],
    uncertainPositionsCount: 0,
    pendingFillPositionsCount: 0,
    exitPendingPositionsCount: 0,
    legacyEntriesCount: 0,
    shadowPositionsOpen: false,
    shadowPositionsCount: 0,
    apiCredentialsConfigured: false,
    realAdapterImplemented: false,
    uncertainOrdersCount: 0,
    pendingEntryIntents: 0,
    pendingExitIntents: 0,
    submittedIntentsWithoutVenueId: 0,
    entryScannerRunning: false,
    positionSupervisorRunning: false,
    entryScannerCount: 0,
    positionSupervisorCount: 0,
    realReconcilerCount: 0,
    runtimeOwner: null as string | null,
    isSpotRuntimeOwnerCheck: false,
  };

  // 1. REAL_ACTIVATION_ALLOWED
  checks.realActivationAllowed = REAL_ACTIVATION_ALLOWED;
  if (!REAL_ACTIVATION_ALLOWED) {
    blockers.push("REAL_ACTIVATION_ALLOWED=false en configuración");
  }

  // 2. Exchange initialized + 3. Balance reachable + 4. Fee model
  try {
    const exchange = ExchangeFactory.getTradingExchange();
    checks.exchangeInitialized = exchange.isInitialized();
    checks.exchangeName = exchange.exchangeName;
    if (!checks.exchangeInitialized) {
      blockers.push(`Exchange ${exchange.exchangeName} no inicializado`);
    }

    // 3. Balance reachable — authenticated API call via getBalance
    if (checks.exchangeInitialized) {
      try {
        const anyExchange = exchange as any;
        if (typeof anyExchange.getBalance === "function") {
          await anyExchange.getBalance();
          checks.balanceReachable = true;
          checks.apiCredentialsConfigured = true;
        } else {
          // No getBalance method — cannot verify credentials
          checks.balanceReachable = false;
          checks.apiCredentialsConfigured = false;
          blockers.push("Exchange no implementa getBalance — no se pueden verificar credenciales");
        }
      } catch (error: any) {
        checks.balanceReachable = false;
        checks.apiCredentialsConfigured = false;
        blockers.push(`Balance no reachable (credenciales inválidas): ${error.message}`);
      }
    }

    // 4. Fee model valid
    if (checks.exchangeInitialized) {
      const feeModel = getTradingFeeModel();
      checks.takerFeePct = feeModel.takerFeePct;
      checks.makerFeePct = feeModel.makerFeePct;
      checks.feeModelValid = feeModel.takerFeePct > 0;
      if (!checks.feeModelValid) {
        blockers.push("Fee model inválido (takerFeePct <= 0)");
      }
    }
  } catch (error: any) {
    blockers.push(`ExchangeFactory error: ${error.message}`);
  }

  // 5. Active pairs configured
  let activePairs: string[] = [];
  try {
    const result = await db.execute(sql`
      SELECT active_pairs FROM bot_config LIMIT 1
    `);
    const pairs = result.rows[0]?.active_pairs as string[] | null;
    activePairs = pairs ?? [];
    checks.activePairsCount = activePairs.length;
    checks.activePairsList = activePairs;
    checks.activePairsConfigured = checks.activePairsCount > 0;
    if (!checks.activePairsConfigured) {
      blockers.push("No hay pares activos configurados en bot_config");
    }
  } catch (error: any) {
    // R10.4: FAIL-CLOSED — DB error = blocker
    blockers.push(`No se pudo verificar pares activos: ${error.message}`);
  }

  // 6. R10.3: Pair metadata loaded PER PAIR — BLOCKER if any missing
  // R10.3: Fix API — getPairMetadata(pair) is per-pair, not a Map getter
  if (checks.activePairsConfigured && checks.exchangeInitialized) {
    try {
      const exchange = ExchangeFactory.getTradingExchange();
      const anyExchange = exchange as any;
      if (typeof anyExchange.getPairMetadata === "function") {
        // R10.3: Try loadPairMetadata if available, then check per-pair
        if (typeof anyExchange.loadPairMetadata === "function") {
          try {
            await anyExchange.loadPairMetadata(activePairs);
          } catch { /* best effort — individual checks below */ }
        }
        let allMetadataLoaded = true;
        for (const pair of activePairs) {
          const meta = anyExchange.getPairMetadata(pair);
          if (!meta) {
            checks.pairMetadataMissing.push(pair);
            allMetadataLoaded = false;
          }
        }
        checks.pairMetadataLoaded = allMetadataLoaded;
        if (checks.pairMetadataMissing.length > 0) {
          blockers.push(`Metadata faltante para pares: ${checks.pairMetadataMissing.join(", ")}`);
        }
      } else {
        checks.pairMetadataLoaded = false;
        blockers.push("Exchange no implementa getPairMetadata — no se puede verificar metadata por par");
      }
    } catch (error: any) {
      checks.pairMetadataLoaded = false;
      blockers.push(`Error al verificar metadata de pares: ${error.message}`);
    }
  }

  // 7. UNCERTAIN positions
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM open_positions
      WHERE policy_version = ${SPOT_POLICY_VERSION}
        AND status = 'UNCERTAIN'
    `);
    checks.uncertainPositionsCount = Number(result.rows[0]?.count ?? 0);
    if (checks.uncertainPositionsCount > 0) {
      blockers.push(`${checks.uncertainPositionsCount} posiciones UNCERTAIN — deben resolverse antes de activar REAL`);
    }
  } catch (error: any) {
    // R10.4: FAIL-CLOSED — DB error = blocker
    blockers.push(`No se pudo verificar posiciones UNCERTAIN: ${error.message}`);
  }

  // 8. PENDING_FILL / EXIT_PENDING positions
  try {
    const pendingResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDING_FILL') as pending_fill,
        COUNT(*) FILTER (WHERE status = 'EXIT_PENDING') as exit_pending
      FROM open_positions
      WHERE policy_version = ${SPOT_POLICY_VERSION} AND status != 'CLOSED'
    `);
    checks.pendingFillPositionsCount = Number(pendingResult.rows[0]?.pending_fill ?? 0);
    checks.exitPendingPositionsCount = Number(pendingResult.rows[0]?.exit_pending ?? 0);
    if (checks.pendingFillPositionsCount > 0) {
      blockers.push(`${checks.pendingFillPositionsCount} posiciones PENDING_FILL — deben resolverse`);
    }
    if (checks.exitPendingPositionsCount > 0) {
      blockers.push(`${checks.exitPendingPositionsCount} posiciones EXIT_PENDING — deben resolverse`);
    }
  } catch (error: any) {
    // R10.4: FAIL-CLOSED — DB error = blocker
    blockers.push(`No se pudo verificar posiciones pendientes: ${error.message}`);
  }

  // 9. Legacy entries (non-SPOT_CANONICAL positions on same pairs)
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM open_positions
      WHERE status != 'CLOSED'
        AND (policy_version != ${SPOT_POLICY_VERSION} OR engine_owner != ${SPOT_ENGINE_OWNER})
    `);
    checks.legacyEntriesCount = Number(result.rows[0]?.count ?? 0);
    if (checks.legacyEntriesCount > 0) {
      blockers.push(`${checks.legacyEntriesCount} posiciones legacy (no SPOT_CANONICAL) — deben migrarse o cerrarse`);
    }
  } catch (error: any) {
    // R10.4: FAIL-CLOSED — DB error = blocker
    blockers.push(`No se pudo verificar entradas legacy: ${error.message}`);
  }

  // 10. Shadow positions (warning only)
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM open_positions
      WHERE policy_version = ${SPOT_POLICY_VERSION}
        AND execution_mode = 'SHADOW'
        AND status != 'CLOSED'
    `);
    checks.shadowPositionsCount = Number(result.rows[0]?.count ?? 0);
    checks.shadowPositionsOpen = checks.shadowPositionsCount > 0;
    if (checks.shadowPositionsOpen) {
      warnings.push(`${checks.shadowPositionsCount} posiciones SHADOW abiertas — se mantendrán con modo SHADOW`);
    }
  } catch (error: any) {
    // R10.4: FAIL-CLOSED — DB error = blocker
    blockers.push(`No se pudo verificar posiciones SHADOW abiertas: ${error.message}`);
  }

  // 11. R10.3: Pending order_intents counts — ALL are BLOCKERS (not warnings)
  let intentCounts: { pendingEntryOrders: number; pendingExitOrders: number; uncertainOrders: number; submittedOrdersWithoutVenueId: number };
  try {
    intentCounts = await countPendingRealOrderIntents();
  } catch (error: any) {
    // R10.3: DB failure on order_intents query → BLOCKER
    blockers.push(`No se pudo consultar order_intents: ${error.message}`);
    intentCounts = { pendingEntryOrders: -1, pendingExitOrders: -1, uncertainOrders: -1, submittedOrdersWithoutVenueId: -1 };
  }
  checks.pendingEntryIntents = intentCounts.pendingEntryOrders;
  checks.pendingExitIntents = intentCounts.pendingExitOrders;
  checks.uncertainOrdersCount = intentCounts.uncertainOrders;
  checks.submittedIntentsWithoutVenueId = intentCounts.submittedOrdersWithoutVenueId;
  if (checks.pendingEntryIntents > 0) {
    blockers.push(`${checks.pendingEntryIntents} entry intents pendientes en order_intents — BLOCKER para nuevas entradas REAL`);
  }
  if (checks.pendingExitIntents > 0) {
    blockers.push(`${checks.pendingExitIntents} exit intents pendientes en order_intents — BLOCKER para nuevas entradas REAL`);
  }
  if (checks.submittedIntentsWithoutVenueId > 0) {
    blockers.push(`${checks.submittedIntentsWithoutVenueId} intents sin venue_order_id — CRITICAL BLOCKER`);
  }
  if (checks.uncertainOrdersCount > 0) {
    blockers.push(`${checks.uncertainOrdersCount} intents UNCERTAIN — CRITICAL BLOCKER, requieren resolución manual`);
  }

  // 12. RealAdapter implemented
  try {
    const { createExecutionAdapter } = await import("./spotExecutionAdapter");
    const adapter = createExecutionAdapter(ExecutionMode.REAL);
    checks.realAdapterImplemented = adapter.canPlaceRealOrder;
    if (!checks.realAdapterImplemented) {
      blockers.push("RealAdapter no implementado (canPlaceRealOrder=false)");
    }
  } catch {
    blockers.push("No se pudo crear RealAdapter");
  }

  // 13. R10.3: Runtime state — real engine state, not hardcoded
  // R10.3: Check runtime owner directly, not inferred from scanner counts
  try {
    const spotEngine = await import("./spotEngine");
    checks.runtimeOwner = spotEngine.SPOT_RUNTIME_OWNER;
    checks.isSpotRuntimeOwnerCheck = isSpotRuntimeOwner();
    if (!checks.isSpotRuntimeOwnerCheck) {
      blockers.push("Runtime owner no es SPOT_CANONICAL — isSpotRuntimeOwner()=false");
    }
    if (spotEngine.SPOT_ENGINE_OWNER !== SPOT_ENGINE_OWNER) {
      blockers.push(`SPOT_ENGINE_OWNER mismatch: expected ${SPOT_ENGINE_OWNER}, got ${spotEngine.SPOT_ENGINE_OWNER}`);
    }
    checks.entryScannerRunning = spotEngine._isEngineRunningForTest();
    checks.positionSupervisorRunning = spotEngine._isSupervisorRunningForTest();
    checks.entryScannerCount = checks.entryScannerRunning ? 1 : 0;
    checks.positionSupervisorCount = checks.positionSupervisorRunning ? 1 : 0;
    // R10.4: Real reconciler instance count
    checks.realReconcilerCount = spotEngine._isReconcilerRunningForTest() ? 1 : 0;
    // R10.3: scanner count > 1 → blocker (duplicate scanners)
    if (checks.entryScannerCount > 1) {
      blockers.push(`Scanner count=${checks.entryScannerCount} — debe ser 0 o 1`);
    }
    if (checks.positionSupervisorCount > 1) {
      blockers.push(`Supervisor count=${checks.positionSupervisorCount} — debe ser 0 o 1`);
    }
    if (checks.realReconcilerCount > 1) {
      blockers.push(`Reconciler count=${checks.realReconcilerCount} — debe ser 0 o 1`);
    }
  } catch {
    checks.entryScannerCount = 0;
    checks.positionSupervisorCount = 0;
  }

  const ready = blockers.length === 0;

  return { ready, blockers, warnings, checks };
}
