/**
 * alertBuilder.ts — Time-Stop alert building and dispatch.
 * Extracted from tradingEngine.ts to reduce monolith size.
 *
 * Uses a host interface to access engine state without tight coupling.
 */

import { log } from "../utils/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AlertOpenPosition {
  lotId: string;
  pair: string;
  amount: number;
  entryPrice: number;
  openedAt: number;
  timeStopExpiredAt?: number;
  timeStopDisabled?: boolean;
}

export interface AlertExitConfig {
  takerFeePct: number;
  profitBufferPct: number;
  timeStopHours: number;
  timeStopMode: "soft" | "hard";
}

/** Host interface — TradingEngine implements this to feed data to AlertBuilder */
export interface IAlertBuilderHost {
  isTelegramInitialized(): boolean;
  sendTelegramAlert(message: string, category: string, subtype: string): Promise<void>;
  getCurrentPrice(pair: string): Promise<number | null>;
  calculateMinCloseNetPct(entryFeePct: number, exitFeePct: number, profitBufferPct: number): number;
  getAdaptiveExitConfig(): Promise<AlertExitConfig>;
  getOpenPositions(): Map<string, AlertOpenPosition>;
  setPosition(lotId: string, position: AlertOpenPosition): void;
  savePositionToDB(pair: string, position: AlertOpenPosition): Promise<void>;
}

// ─── Pure message builder ────────────────────────────────────────────────────

export function buildTimeStopAlertMessage(
  pair: string,
  ageHours: number,
  timeStopHours: number,
  timeStopMode: "soft" | "hard",
  priceChange: number,
  minCloseNetPct: number
): string {
  if (timeStopMode === "hard") {
    return `🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⏰ <b>Time-Stop HARD - Cierre Inmediato</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   • Límite configurado: <code>${timeStopHours} horas</code>

📊 <b>Estado:</b>
   • Ganancia actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>

⚡ <b>ACCIÓN:</b> La posición se cerrará INMEDIATAMENTE [modo HARD]
━━━━━━━━━━━━━━━━━━━`;
  } else {
    return `🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⏰ <b>Time-Stop Alcanzado</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   • Límite configurado: <code>${timeStopHours} horas</code>

📊 <b>Estado:</b>
   • Ganancia actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>
   • Mínimo para cierre auto: <code>+${minCloseNetPct.toFixed(2)}%</code>

💡 Se cerrará automáticamente cuando supere +${minCloseNetPct.toFixed(2)}%
⚠️ <b>Puedes cerrarla manualmente si lo prefieres</b>
━━━━━━━━━━━━━━━━━━━`;
  }
}

// ─── Alert dispatcher ────────────────────────────────────────────────────────

export async function sendTimeStopAlert(
  host: IAlertBuilderHost,
  position: AlertOpenPosition,
  exitConfig: AlertExitConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!host.isTelegramInitialized()) {
      return { success: false, error: "Telegram not initialized" };
    }

    const now = Date.now();
    const ageMs = now - position.openedAt;
    const ageHours = ageMs / (1000 * 60 * 60);

    // Get current price with error handling
    let currentPrice: number | null;
    try {
      currentPrice = await host.getCurrentPrice(position.pair);
    } catch (tickerError: any) {
      log(`[TIME_STOP_ALERT] ${position.pair}: Error getting ticker - ${tickerError.message}`, "trading");
      return { success: false, error: `Ticker error: ${tickerError.message}` };
    }

    if (currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) {
      return { success: false, error: `Invalid price: ${currentPrice}` };
    }

    const priceChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const minCloseNetPct = host.calculateMinCloseNetPct(exitConfig.takerFeePct, exitConfig.takerFeePct, exitConfig.profitBufferPct);

    const message = buildTimeStopAlertMessage(
      position.pair,
      ageHours,
      exitConfig.timeStopHours,
      exitConfig.timeStopMode,
      priceChange,
      minCloseNetPct
    );

    try {
      await host.sendTelegramAlert(message, "trades", "trade_timestop");
      return { success: true };
    } catch (telegramError: any) {
      log(`[TIME_STOP_ALERT] ${position.pair}: Error sending Telegram - ${telegramError.message}`, "trading");
      return { success: false, error: `Telegram error: ${telegramError.message}` };
    }
  } catch (error: any) {
    log(`[TIME_STOP_ALERT] ${position.pair}: Unexpected error - ${error.message}`, "trading");
    return { success: false, error: error.message };
  }
}

// ─── Startup check for expired time-stop positions ──────────────────────────

export async function checkExpiredTimeStopPositions(
  host: IAlertBuilderHost
): Promise<{ checked: number; alerted: number; errors: number }> {
  const result = { checked: 0, alerted: 0, errors: 0 };

  if (!host.isTelegramInitialized()) {
    log("[TIME_STOP_CHECK] Telegram not initialized, skipping alerts", "trading");
    return result;
  }

  // Use dynamic config from DB instead of hardcoded values
  const exitConfig = await host.getAdaptiveExitConfig();
  const now = Date.now();

  for (const [lotId, position] of host.getOpenPositions()) {
    result.checked++;

    // Skip if already notified
    if (position.timeStopExpiredAt) continue;

    // Skip if Time-Stop is manually disabled
    if (position.timeStopDisabled) continue;

    const ageMs = now - position.openedAt;
    const ageHours = ageMs / (1000 * 60 * 60);

    // Check if Time-Stop is expired
    if (ageHours >= exitConfig.timeStopHours) {
      const alertResult = await sendTimeStopAlert(host, position, exitConfig);

      if (alertResult.success) {
        result.alerted++;

        // Mark as notified
        position.timeStopExpiredAt = now;
        host.setPosition(lotId, position);

        try {
          await host.savePositionToDB(position.pair, position);
        } catch (saveError: any) {
          log(`[TIME_STOP_CHECK] ${position.pair}: Error saving position - ${saveError.message}`, "trading");
        }

        log(`[TIME_STOP_EXPIRED_STARTUP] ${position.pair} (${lotId}): age=${ageHours.toFixed(1)}h mode=${exitConfig.timeStopMode} - Alert sent`, "trading");
      } else {
        result.errors++;
        log(`[TIME_STOP_CHECK] ${position.pair}: Alert failed - ${alertResult.error}`, "trading");
      }
    }
  }

  log(`[TIME_STOP_CHECK] Completed: checked=${result.checked} alerted=${result.alerted} errors=${result.errors}`, "trading");
  return result;
}

// ─── Force alerts (ignoring previous notifications) ─────────────────────────

export async function forceTimeStopAlerts(
  host: IAlertBuilderHost
): Promise<{ checked: number; alerted: number; errors: number; skipped: number }> {
  const result = { checked: 0, alerted: 0, errors: 0, skipped: 0 };

  if (!host.isTelegramInitialized()) {
    log("[TIME_STOP_FORCE] Telegram not initialized, skipping alerts", "trading");
    return result;
  }

  // Use dynamic config from DB instead of hardcoded values
  const exitConfig = await host.getAdaptiveExitConfig();
  const now = Date.now();

  log(`[TIME_STOP_FORCE] Starting force alerts check with config: timeStopHours=${exitConfig.timeStopHours} mode=${exitConfig.timeStopMode}`, "trading");

  for (const [lotId, position] of host.getOpenPositions()) {
    result.checked++;

    // Skip if Time-Stop is manually disabled
    if (position.timeStopDisabled) {
      result.skipped++;
      log(`[TIME_STOP_FORCE] ${position.pair}: Skipped (timeStopDisabled=true)`, "trading");
      continue;
    }

    const ageMs = now - position.openedAt;
    const ageHours = ageMs / (1000 * 60 * 60);

    // Check if Time-Stop is expired
    if (ageHours >= exitConfig.timeStopHours) {
      const alertResult = await sendTimeStopAlert(host, position, exitConfig);

      if (alertResult.success) {
        result.alerted++;
        log(`[TIME_STOP_EXPIRED_FORCED] ${position.pair} (${lotId}): age=${ageHours.toFixed(1)}h mode=${exitConfig.timeStopMode} - Alert sent (forced)`, "trading");
      } else {
        result.errors++;
        log(`[TIME_STOP_FORCE] ${position.pair}: Alert failed - ${alertResult.error}`, "trading");
      }
    } else {
      result.skipped++;
      log(`[TIME_STOP_FORCE] ${position.pair}: Skipped (age=${ageHours.toFixed(1)}h < ${exitConfig.timeStopHours}h)`, "trading");
    }
  }

  log(`[TIME_STOP_FORCE] Completed: checked=${result.checked} alerted=${result.alerted} errors=${result.errors} skipped=${result.skipped}`, "trading");
  return result;
}
