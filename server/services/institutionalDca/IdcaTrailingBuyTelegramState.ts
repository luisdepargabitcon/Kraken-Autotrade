/**
 * IdcaTrailingBuyTelegramState — Máquina de estados para notificaciones Telegram Trailing Buy
 *
 * Previene spam enviando mensajes solo en cambios de estado significativos:
 * - ARMED:     una sola vez al armar. No re-envía tras restart si estado se recupera de DB.
 * - TRACKING:  throttleado (15min o mejora >= 0.20%).
 * - TRIGGERED: una sola vez al ejecutar.
 * - CANCELLED: una sola vez al cancelar (solo si estaba armed/tracking).
 *
 * Anti-spam tras restart:
 * - Al arrancar, se puede reconstruir el estado desde DB vía loadStateFromDb().
 * - Si estado ya era armed/tracking en DB, no se re-notifica ARMED.
 *
 * Cooldown de rearmado:
 * - Tras CANCELLED por price_recovered, no permite nuevo ARMED durante 30 minutos,
 *   salvo nuevo mínimo relevante o cambio de ancla.
 *
 * Histéresis de cancelación:
 * - cancelIncrement() acumula contador; solo cancela realmente al 2do tick consecutivo.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";

export type TrailingBuyTelegramState = {
  state: "idle" | "watching" | "armed" | "tracking" | "triggered" | "cancelled" | "expired";
  lastNotifiedAt: number;
  lastNotifiedBestPrice?: number;
  lastNotifiedState?: string;
  armedAt?: number;
  triggerPrice?: number;
  localLow?: number;
  cancelledAt?: number;
  rearmAllowedAfter?: number;     // timestamp unix ms: no rearmar hasta este momento
  lastWatchingNotifiedAt?: number; // timestamp de última notificación WATCHING
};

// Estado en memoria por par:modo
const trailingBuyTelegramStates = new Map<string, TrailingBuyTelegramState>();

// Contador de ticks consecutivos "precio sobre trigger" para histéresis de cancelación
const cancelTickCounter = new Map<string, number>();

// Constantes (fallback cuando política IdcaTelegramAlertPolicy no está configurada)
const TRACKING_MIN_INTERVAL_MS        = 60 * 60 * 1000; // 60 min (era 15 min — reducir spam)
const TRACKING_MIN_PRICE_IMPROVEMENT  = 0.30;           // 0.30% mejora mínima (era 0.20%)
const REARM_COOLDOWN_AFTER_CANCEL_MS  = 30 * 60 * 1000; // 30 min de cooldown tras CANCELLED
const CANCEL_HISTERESIS_TICKS         = 2;              // ticks consecutivos sobre trigger antes de cancelar
const WATCHING_MIN_INTERVAL_MS        = 120 * 60 * 1000; // 120 min entre notificaciones WATCHING (era 30 min)

function getStateKey(pair: string, mode: string): string {
  return `${mode}:${pair}:trailing_buy`;
}

// ─── Persistencia DB (best-effort, nunca bloquea el flujo principal) ──

async function persistStateToDB(pair: string, mode: string, s: TrailingBuyTelegramState): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO idca_trailing_buy_telegram_state
        (pair, mode, state, last_notified_at, last_notified_best_price, last_notified_state,
         armed_at, trigger_price, local_low, cancelled_at, rearm_allowed_after, updated_at)
      VALUES (
        ${pair}, ${mode}, ${s.state},
        ${s.lastNotifiedAt ?? null},
        ${s.lastNotifiedBestPrice ?? null},
        ${s.lastNotifiedState ?? null},
        ${s.armedAt ?? null},
        ${s.triggerPrice ?? null},
        ${s.localLow ?? null},
        ${s.cancelledAt ?? null},
        ${s.rearmAllowedAfter ?? null},
        NOW()
      )
      ON CONFLICT (pair, mode) DO UPDATE SET
        state                    = EXCLUDED.state,
        last_notified_at         = EXCLUDED.last_notified_at,
        last_notified_best_price = EXCLUDED.last_notified_best_price,
        last_notified_state      = EXCLUDED.last_notified_state,
        armed_at                 = EXCLUDED.armed_at,
        trigger_price            = EXCLUDED.trigger_price,
        local_low                = EXCLUDED.local_low,
        cancelled_at             = EXCLUDED.cancelled_at,
        rearm_allowed_after      = EXCLUDED.rearm_allowed_after,
        updated_at               = NOW()
    `);
  } catch (_e) {
    // best-effort — tabla puede no existir en migrations viejas
  }
}

async function deleteStateFromDB(pair: string, mode: string): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM idca_trailing_buy_telegram_state WHERE pair = ${pair} AND mode = ${mode}
    `);
  } catch (_e) {
    // best-effort
  }
}

/**
 * Cargar estado desde DB al arrancar el scheduler.
 * Llamar una vez por par:modo para no re-enviar ARMED tras restart.
 */
export async function loadStateFromDb(pair: string, mode: string): Promise<void> {
  try {
    const rows = await db.execute(sql`
      SELECT state, last_notified_at, last_notified_best_price, last_notified_state,
             armed_at, trigger_price, local_low, cancelled_at, rearm_allowed_after
      FROM idca_trailing_buy_telegram_state
      WHERE pair = ${pair} AND mode = ${mode}
      LIMIT 1
    `);
    const row = (rows as any).rows?.[0] ?? (rows as any)[0];
    if (!row) return;
    const key = getStateKey(pair, mode);
    trailingBuyTelegramStates.set(key, {
      state:                 row.state ?? "idle",
      lastNotifiedAt:        Number(row.last_notified_at ?? 0),
      lastNotifiedBestPrice: row.last_notified_best_price != null ? parseFloat(row.last_notified_best_price) : undefined,
      lastNotifiedState:     row.last_notified_state ?? undefined,
      armedAt:               row.armed_at != null ? Number(row.armed_at) : undefined,
      triggerPrice:          row.trigger_price != null ? parseFloat(row.trigger_price) : undefined,
      localLow:              row.local_low != null ? parseFloat(row.local_low) : undefined,
      cancelledAt:           row.cancelled_at != null ? Number(row.cancelled_at) : undefined,
      rearmAllowedAfter:     row.rearm_allowed_after != null ? Number(row.rearm_allowed_after) : undefined,
    });
    console.log(`[TrailingBuyTelegramState] Loaded DB state ${pair}/${mode}: state=${row.state}`);
  } catch (_e) {
    // tabla no existe aún — silencioso
  }
}

// ─── API pública ───────────────────────────────────────────────────

export function getTrailingBuyTelegramState(pair: string, mode: string): TrailingBuyTelegramState | undefined {
  return trailingBuyTelegramStates.get(getStateKey(pair, mode));
}

// ─── WATCHING (pre-arm) ────────────────────────────────────────────

/**
 * Indica si se debe notificar el estado WATCHING (precio cerca de zona, no armado aún).
 * Throttle: máximo 1 vez cada watchingMinIntervalMs por par:modo.
 * Si watchingMinIntervalMs no se pasa, usa el fallback WATCHING_MIN_INTERVAL_MS (120 min).
 */
export function shouldNotifyWatching(pair: string, mode: string, watchingMinIntervalMs?: number): boolean {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);
  // No notificar watching si ya estamos armed/tracking/triggered
  if (current && (current.state === "armed" || current.state === "tracking" || current.state === "triggered")) {
    return false;
  }
  const lastAt = current?.lastWatchingNotifiedAt ?? 0;
  const intervalMs = watchingMinIntervalMs ?? WATCHING_MIN_INTERVAL_MS;
  return (Date.now() - lastAt) >= intervalMs;
}

export function markNotifiedWatching(pair: string, mode: string): void {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);
  const next: TrailingBuyTelegramState = {
    ...(current ?? { lastNotifiedAt: 0 }),
    state: "watching",
    lastWatchingNotifiedAt: Date.now(),
    lastNotifiedState: "watching",
  };
  trailingBuyTelegramStates.set(key, next);
}

// ─── ARMED ─────────────────────────────────────────────────────────

export function shouldNotifyArmed(pair: string, mode: string): boolean {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);

  // No re-notificar si ya estamos en armed o tracking (incluye estado cargado de DB tras restart)
  if (current && (current.state === "armed" || current.state === "tracking")) {
    return false;
  }

  // Cooldown: si fue cancelado recientemente, no rearmar todavía
  if (current?.rearmAllowedAfter && Date.now() < current.rearmAllowedAfter) {
    return false;
  }

  return true;
}

export function markNotifiedArmed(pair: string, mode: string, triggerPrice: number, localLow: number): void {
  const key = getStateKey(pair, mode);
  const now = Date.now();
  const next: TrailingBuyTelegramState = {
    state: "armed",
    lastNotifiedAt: now,
    lastNotifiedState: "armed",
    armedAt: now,
    triggerPrice,
    localLow,
  };
  trailingBuyTelegramStates.set(key, next);
  cancelTickCounter.delete(key);
  void persistStateToDB(pair, mode, next);
}

export function shouldNotifyTracking(pair: string, mode: string, currentBestPrice: number): { should: boolean; reason?: string } {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);

  if (!current || (current.state !== "armed" && current.state !== "tracking")) {
    return { should: false };
  }

  const now = Date.now();
  const timeSinceLastNotify = now - current.lastNotifiedAt;

  if (timeSinceLastNotify >= TRACKING_MIN_INTERVAL_MS) {
    return { should: true, reason: "interval" };
  }

  if (current.lastNotifiedBestPrice != null) {
    const improvementPct = ((current.lastNotifiedBestPrice - currentBestPrice) / current.lastNotifiedBestPrice) * 100;
    if (improvementPct >= TRACKING_MIN_PRICE_IMPROVEMENT) {
      return { should: true, reason: "improvement" };
    }
  }

  return { should: false };
}

export function markNotifiedTracking(pair: string, mode: string, bestPrice: number): void {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);
  const now = Date.now();
  const next: TrailingBuyTelegramState = {
    state: "tracking",
    lastNotifiedAt: now,
    lastNotifiedBestPrice: bestPrice,
    lastNotifiedState: "tracking",
    armedAt: current?.armedAt,
    triggerPrice: current?.triggerPrice,
    localLow: current?.localLow,
  };
  trailingBuyTelegramStates.set(key, next);
  void persistStateToDB(pair, mode, next);
}

export function shouldNotifyTriggered(pair: string, mode: string): boolean {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);
  return current?.state !== "triggered";
}

export function markNotifiedTriggered(pair: string, mode: string): void {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);
  const next: TrailingBuyTelegramState = {
    state: "triggered",
    lastNotifiedAt: Date.now(),
    lastNotifiedState: "triggered",
    armedAt: current?.armedAt,
    triggerPrice: current?.triggerPrice,
    localLow: current?.localLow,
  };
  trailingBuyTelegramStates.set(key, next);
  cancelTickCounter.delete(key);
  void persistStateToDB(pair, mode, next);
}

export function shouldNotifyCancelled(pair: string, mode: string): boolean {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);
  // Solo notificar si estábamos en armed/tracking y no habíamos notificado cancelled ya
  if (!current || current.state === "cancelled" || current.state === "triggered" || current.state === "idle") {
    return false;
  }
  return true;
}

/**
 * Incrementa el contador de histéresis para cancelación.
 * Solo cancela realmente cuando se llama CANCEL_HISTERESIS_TICKS veces consecutivas.
 * Retorna true si se debe proceder con la cancelación real.
 */
export function cancelIncrement(pair: string, mode: string): boolean {
  const key = getStateKey(pair, mode);
  const prev = cancelTickCounter.get(key) ?? 0;
  const next = prev + 1;
  cancelTickCounter.set(key, next);
  return next >= CANCEL_HISTERESIS_TICKS;
}

/** Reinicia el contador de histéresis (llamar cuando el precio vuelve a zona válida) */
export function cancelReset(pair: string, mode: string): void {
  cancelTickCounter.delete(getStateKey(pair, mode));
}

export function markNotifiedCancelled(pair: string, mode: string): void {
  const key = getStateKey(pair, mode);
  const now = Date.now();
  const next: TrailingBuyTelegramState = {
    state: "cancelled",
    lastNotifiedAt: now,
    lastNotifiedState: "cancelled",
    cancelledAt: now,
    rearmAllowedAfter: now + REARM_COOLDOWN_AFTER_CANCEL_MS,
  };
  trailingBuyTelegramStates.set(key, next);
  cancelTickCounter.delete(key);
  void persistStateToDB(pair, mode, next);
}

export function resetTrailingBuyTelegramState(pair: string, mode: string, reason?: string): void {
  const key = getStateKey(pair, mode);
  if (reason) {
    console.log(`[TrailingBuyTelegramState] Reset ${pair} (${mode}) reason: ${reason}`);
  }
  trailingBuyTelegramStates.delete(key);
  cancelTickCounter.delete(key);
  void deleteStateFromDB(pair, mode);
}

export function getAllTrailingBuyTelegramStates(): Array<{ pair: string; mode: string; state: TrailingBuyTelegramState }> {
  return Array.from(trailingBuyTelegramStates.entries()).map(([key, state]) => {
    const [mode, pair] = key.split(":");
    return { pair, mode, state };
  });
}

// Exposed for testing only
export function resetAllStates(): void {
  trailingBuyTelegramStates.clear();
  cancelTickCounter.clear();
}
