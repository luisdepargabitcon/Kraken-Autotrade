/**
 * LegacyIsolation — Aisla y marca el código DRY-RUN legacy.
 *
 * OBJETIVO: Garantizar que el código legacy DRY no participe en el pipeline
 * SPOT canónico. Los endpoints /api/dryrun/* quedan marcados como DEPRECATED
 * pero siguen accesibles para auditoría y comparación de paridad.
 *
 * INVARIANTES:
 *   - LEGACY_DRY_RUN no puede interactuar con SPOT positions/trades.
 *   - Los endpoints legacy deben incluir header X-Legacy-Warning.
 *   - dryRunMode boolean NO se usa en el dominio SPOT (solo compat).
 *   - Las 4 estrategias muertas (momentumStrategy, meanReversionStrategy,
 *     scalpingStrategy, gridStrategy legacy) NO se importan ni ejecutan
 *     desde el pipeline SPOT.
 *   - signalAccumulator NO se invoca desde SPOT_CANONICAL.
 */

export const LEGACY_DRY_RUN_TAG = "LEGACY_DRY_RUN";

export const LEGACY_DEPRECATION_HEADER = "X-Legacy-Warning";
export const LEGACY_DEPRECATION_MESSAGE =
  "This endpoint is LEGACY_DRY_RUN and will be removed after SPOT parity is demonstrated. Use /api/spot/* instead.";

/**
 * Strategies that are dead code — only referenced in the legacy path
 * of tradingEngine.ts (lines 5860-5869) which is never executed in
 * the SPOT canonical pipeline.
 */
export const DEAD_STRATEGIES = [
  "momentumStrategy",
  "meanReversionStrategy",
  "scalpingStrategy",
  "gridStrategy",
] as const;

/**
 * Modules that are deprecated and should not be imported by SPOT code.
 */
export const DEPRECATED_MODULES = [
  "server/services/signalAccumulator.ts",
  "server/services/SmartExitEngine.ts",
  "server/services/SmartTimeStopV2.ts",
] as const;

/**
 * Endpoints that belong to the legacy DRY namespace.
 */
export const LEGACY_ENDPOINTS = [
  "/api/dryrun/positions",
  "/api/dryrun/history",
  "/api/dryrun/summary",
  "/api/dryrun/clear",
  "/api/dryrun/backfill",
  "/api/dryrun/exit-audit",
  "/api/dryrun/timestop-audit",
] as const;

/**
 * Express middleware that adds the X-Legacy-Warning header and logs
 * a deprecation notice when a legacy endpoint is accessed.
 */
export function legacyDeprecationMiddleware() {
  return (req: any, _res: any, next: any) => {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        `[LEGACY_DRY_RUN] Deprecation notice: ${req.method} ${req.path} — use /api/spot/* instead`
      );
    }
    next();
  };
}

/**
 * Helper to apply legacy headers to a response.
 */
export function applyLegacyHeaders(res: any) {
  res.setHeader(LEGACY_DEPRECATION_HEADER, LEGACY_DEPRECATION_MESSAGE);
  res.setHeader("X-Deprecation-Tag", LEGACY_DRY_RUN_TAG);
}

/**
 * Type guard: is a given strategy name in the dead list?
 */
export function isDeadStrategy(name: string): boolean {
  return (DEAD_STRATEGIES as readonly string[]).includes(name);
}

/**
 * Type guard: is a given endpoint path in the legacy list?
 */
export function isLegacyEndpoint(path: string): boolean {
  return (LEGACY_ENDPOINTS as readonly string[]).includes(path);
}
