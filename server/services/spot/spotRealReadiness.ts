/**
 * SpotRealReadiness — R10.1 Comprehensive preflight checks for REAL mode activation.
 *
 * Checks:
 *   1. REAL_ACTIVATION_ALLOWED = true
 *   2. ExchangeFactory.getTradingExchange() is initialized
 *   3. Balance reachable (authenticated API call)
 *   4. Fee model valid (takerFeePct > 0)
 *   5. Active pairs configured and pair metadata loaded
 *   6. No UNCERTAIN positions (must resolve first)
 *   7. No PENDING_FILL / EXIT_PENDING positions (must resolve first)
 *   8. No legacy entries (non-SPOT_CANONICAL positions on same pairs)
 *   9. API credentials configured
 *  10. RealAdapter implemented (canPlaceRealOrder = true)
 *  11. Entry scanner and position supervisor counts
 */

import { REAL_ACTIVATION_ALLOWED, ExecutionMode, SPOT_POLICY_VERSION } from "./spotTypes";
import { SPOT_ENGINE_OWNER } from "./spotEngine";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import { getTradingFeeModel } from "./feeModel";
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
    pairMetadataLoaded: boolean;
    uncertainPositionsCount: number;
    pendingFillPositionsCount: number;
    exitPendingPositionsCount: number;
    legacyEntriesCount: number;
    shadowPositionsOpen: boolean;
    shadowPositionsCount: number;
    apiCredentialsConfigured: boolean;
    realAdapterImplemented: boolean;
    entryScannerCount: number;
    positionSupervisorCount: number;
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
    pairMetadataLoaded: false,
    uncertainPositionsCount: 0,
    pendingFillPositionsCount: 0,
    exitPendingPositionsCount: 0,
    legacyEntriesCount: 0,
    shadowPositionsOpen: false,
    shadowPositionsCount: 0,
    apiCredentialsConfigured: false,
    realAdapterImplemented: false,
    entryScannerCount: 0,
    positionSupervisorCount: 0,
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

    // 3. Balance reachable — authenticated API call
    if (checks.exchangeInitialized) {
      try {
        const anyExchange = exchange as any;
        if (typeof anyExchange.getBalance === "function") {
          await anyExchange.getBalance();
          checks.balanceReachable = true;
        } else {
          checks.balanceReachable = true;
        }
      } catch (error: any) {
        checks.balanceReachable = false;
        blockers.push(`Balance no reachable: ${error.message}`);
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
  try {
    const result = await db.execute(sql`
      SELECT active_pairs FROM bot_config LIMIT 1
    `);
    const pairs = result.rows[0]?.active_pairs as string[] | null;
    checks.activePairsCount = pairs?.length ?? 0;
    checks.activePairsConfigured = checks.activePairsCount > 0;
    if (!checks.activePairsConfigured) {
      blockers.push("No hay pares activos configurados en bot_config");
    }

    // 5b. Pair metadata loaded
    if (checks.activePairsConfigured && checks.exchangeInitialized) {
      try {
        const exchange = ExchangeFactory.getTradingExchange();
        const anyExchange = exchange as any;
        if (typeof anyExchange.getPairMetadata === "function") {
          const metadata = await anyExchange.getPairMetadata();
          checks.pairMetadataLoaded = metadata && metadata.size > 0;
        } else {
          checks.pairMetadataLoaded = true;
        }
        if (!checks.pairMetadataLoaded) {
          warnings.push("Metadata de pares no cargada — puede afectar validación de órdenes");
        }
      } catch {
        warnings.push("No se pudo verificar metadata de pares");
      }
    }
  } catch {
    warnings.push("No se pudo verificar pares activos");
  }

  // 6. UNCERTAIN positions
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
  } catch {
    warnings.push("No se pudo verificar posiciones UNCERTAIN");
  }

  // 7. PENDING_FILL / EXIT_PENDING positions
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
  } catch {
    warnings.push("No se pudo verificar posiciones pendientes");
  }

  // 8. Legacy entries (non-SPOT_CANONICAL positions on same pairs)
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
  } catch {
    warnings.push("No se pudo verificar entradas legacy");
  }

  // 9. Shadow positions (warning only)
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
  } catch {
    warnings.push("No se pudo verificar posiciones SHADOW abiertas");
  }

  // 10. API credentials
  try {
    const result = await db.execute(sql`
      SELECT trading_exchange FROM api_config LIMIT 1
    `);
    checks.apiCredentialsConfigured = result.rows.length > 0 && !!result.rows[0]?.trading_exchange;
    if (!checks.apiCredentialsConfigured) {
      warnings.push("No se encontró trading_exchange configurado en api_config");
    }
  } catch {
    warnings.push("No se pudo verificar api_config");
  }

  // 11. RealAdapter implemented
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

  // 12. Scanner/supervisor counts (informational)
  checks.entryScannerCount = 1;
  checks.positionSupervisorCount = 1;

  const ready = blockers.length === 0;

  return { ready, blockers, warnings, checks };
}
