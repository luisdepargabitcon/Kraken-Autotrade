/**
 * IdcaTrailingBuyTelegramState — Máquina de estados para notificaciones Telegram Trailing Buy
 * 
 * Previene spam enviando mensajes solo en cambios de estado significativos:
 * - ARMED: una sola vez al armar
 * - TRACKING: throttleado (15min o mejora >= 0.20%)
 * - TRIGGERED: una sola vez al ejecutar
 * - CANCELLED: una sola vez al cancelar
 */

export type TrailingBuyTelegramState = {
  state: "idle" | "armed" | "tracking" | "triggered" | "cancelled" | "expired";
  lastNotifiedAt: number;
  lastNotifiedBestPrice?: number;
  lastNotifiedState?: string;
  armedAt?: number;
  triggerPrice?: number;
  localLow?: number;
};

// Estado en memoria por par:modo
const trailingBuyTelegramStates = new Map<string, TrailingBuyTelegramState>();

// Constantes de throttle
const TRACKING_MIN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutos
const TRACKING_MIN_PRICE_IMPROVEMENT_PCT = 0.20; // 0.20% mejora mínima

function getStateKey(pair: string, mode: string): string {
  return `${mode}:${pair}:trailing_buy`;
}

export function getTrailingBuyTelegramState(pair: string, mode: string): TrailingBuyTelegramState | undefined {
  return trailingBuyTelegramStates.get(getStateKey(pair, mode));
}

export function shouldNotifyArmed(pair: string, mode: string): boolean {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);
  
  // Solo notificar si no estábamos en armed/tracking ya
  if (current && (current.state === "armed" || current.state === "tracking")) {
    return false; // Ya estaba armado, no spammear
  }
  
  return true;
}

export function markNotifiedArmed(pair: string, mode: string, triggerPrice: number, localLow: number): void {
  const key = getStateKey(pair, mode);
  const now = Date.now();
  
  trailingBuyTelegramStates.set(key, {
    state: "armed",
    lastNotifiedAt: now,
    lastNotifiedState: "armed",
    armedAt: now,
    triggerPrice,
    localLow,
  });
}

export function shouldNotifyTracking(pair: string, mode: string, currentBestPrice: number): { should: boolean; reason?: string } {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);
  
  if (!current || (current.state !== "armed" && current.state !== "tracking")) {
    return { should: false }; // No está armado, no hay qué trackear
  }
  
  const now = Date.now();
  const timeSinceLastNotify = now - current.lastNotifiedAt;
  
  // Si pasaron 15 minutos, permitir notificación
  if (timeSinceLastNotify >= TRACKING_MIN_INTERVAL_MS) {
    return { should: true, reason: "interval" };
  }
  
  // Si el precio mejoró >= 0.20% desde el último aviso
  if (current.lastNotifiedBestPrice != null) {
    const improvementPct = ((currentBestPrice - current.lastNotifiedBestPrice) / current.lastNotifiedBestPrice) * 100;
    if (improvementPct >= TRACKING_MIN_PRICE_IMPROVEMENT_PCT) {
      return { should: true, reason: "improvement" };
    }
  }
  
  return { should: false };
}

export function markNotifiedTracking(pair: string, mode: string, bestPrice: number): void {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);
  const now = Date.now();
  
  trailingBuyTelegramStates.set(key, {
    state: "tracking",
    lastNotifiedAt: now,
    lastNotifiedBestPrice: bestPrice,
    lastNotifiedState: "tracking",
    armedAt: current?.armedAt,
    triggerPrice: current?.triggerPrice,
    localLow: current?.localLow,
  });
}

export function shouldNotifyTriggered(pair: string, mode: string): boolean {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);
  
  // Solo notificar si no habíamos notificado triggered ya
  if (current?.state === "triggered") {
    return false;
  }
  
  return true;
}

export function markNotifiedTriggered(pair: string, mode: string): void {
  const key = getStateKey(pair, mode);
  const current = trailingBuyTelegramStates.get(key);
  
  trailingBuyTelegramStates.set(key, {
    state: "triggered",
    lastNotifiedAt: Date.now(),
    lastNotifiedState: "triggered",
    armedAt: current?.armedAt,
    triggerPrice: current?.triggerPrice,
    localLow: current?.localLow,
  });
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

export function markNotifiedCancelled(pair: string, mode: string): void {
  const key = getStateKey(pair, mode);
  
  trailingBuyTelegramStates.set(key, {
    state: "cancelled",
    lastNotifiedAt: Date.now(),
    lastNotifiedState: "cancelled",
  });
}

export function resetTrailingBuyTelegramState(pair: string, mode: string, reason?: string): void {
  const key = getStateKey(pair, mode);
  
  if (reason) {
    console.log(`[TrailingBuyTelegramState] Reset ${pair} (${mode}) reason: ${reason}`);
  }
  
  trailingBuyTelegramStates.delete(key);
}

export function getAllTrailingBuyTelegramStates(): Array<{ pair: string; mode: string; state: TrailingBuyTelegramState }> {
  return Array.from(trailingBuyTelegramStates.entries()).map(([key, state]) => {
    const [mode, pair] = key.split(":");
    return { pair, mode, state };
  });
}
