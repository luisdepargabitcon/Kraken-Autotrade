/**
 * RegimeManager — Stateful regime detection, confirmation, caching, and alerting.
 * Extracted from TradingEngine for modularity.
 */

import { createHash } from "crypto";
import { log } from "../utils/logger";
import { botLogger } from "./botLogger";
import { environment } from "./environment";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { regimeState, type RegimeState } from "@shared/schema";
import {
  detectMarketRegime,
  REGIME_PRESETS,
  REGIME_CONFIG,
  type MarketRegime,
  type RegimeAnalysis,
} from "./regimeDetection";
import type { OHLCCandle } from "./indicators";
import type { TradingConfig } from "@shared/config-schema";

// === Host interface ===

export interface IRegimeManagerHost {
  getOHLC(pair: string, intervalMinutes: number): Promise<OHLCCandle[]>;
  sendAlertWithSubtype(message: string, alertType: any, subtype: any): Promise<void>;
}

// === RegimeManager ===

export class RegimeManager {
  private host: IRegimeManagerHost;
  private regimeCache: Map<string, { regime: RegimeAnalysis; timestamp: number }> = new Map();
  private readonly REGIME_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private lastRegime: Map<string, MarketRegime> = new Map();
  private dynamicConfig: TradingConfig | null = null;

  constructor(host: IRegimeManagerHost) {
    this.host = host;
  }

  /** Called by TradingEngine when dynamicConfig updates */
  setDynamicConfig(config: TradingConfig | null): void {
    this.dynamicConfig = config;
  }

  // === Hash helpers ===

  private computeHash(input: string): string {
    return createHash("sha256").update(input).digest("hex").substring(0, REGIME_CONFIG.HASH_LENGTH);
  }

  private computeParamsHash(regime: MarketRegime): string {
    const preset = REGIME_PRESETS[regime];
    const payload = `${preset.sgBeAtPct}|${preset.sgTrailDistancePct}|${preset.sgTpFixedPct}|${preset.minSignals}`;
    return this.computeHash(payload);
  }

  private computeReasonHash(regime: MarketRegime, reason: string): string {
    return this.computeHash(`${regime}|${reason}`);
  }

  // === DB access ===

  private async getRegimeState(pair: string): Promise<RegimeState | null> {
    try {
      const [state] = await db.select().from(regimeState).where(eq(regimeState.pair, pair)).limit(1);
      return state || null;
    } catch (error) {
      log(`[REGIME] Error loading state for ${pair}: ${error}`, "trading");
      return null;
    }
  }

  private async upsertRegimeState(pair: string, updates: Partial<RegimeState>): Promise<void> {
    try {
      const existing = await this.getRegimeState(pair);
      if (existing) {
        await db.update(regimeState)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(regimeState.pair, pair));
      } else {
        await db.insert(regimeState).values({
          pair,
          currentRegime: updates.currentRegime || "TRANSITION",
          candidateCount: updates.candidateCount || 0,
          ...updates,
          updatedAt: new Date(),
        });
      }
    } catch (error) {
      log(`[REGIME] Error saving state for ${pair}: ${error}`, "trading");
    }
  }

  // === Public API ===

  async getMarketRegimeWithCache(pair: string): Promise<RegimeAnalysis> {
    const cached = this.regimeCache.get(pair);
    if (cached && Date.now() - cached.timestamp < this.REGIME_CACHE_TTL_MS) {
      return cached.regime;
    }

    const defaultResult: RegimeAnalysis = {
      regime: "TRANSITION",
      adx: 25,
      emaAlignment: 0,
      bollingerWidth: 2,
      confidence: 0.3,
      reason: "Datos insuficientes",
    };

    try {
      const candles = await this.host.getOHLC(pair, 60); // 1h candles
      if (!candles || candles.length < 50) {
        return defaultResult;
      }

      // Raw detection (without persistence logic)
      const rawAnalysis = detectMarketRegime(candles);

      // Phase 2.2: Confirmation + Phase 2.3: MinHold + Hysteresis
      const confirmedAnalysis = await this.applyRegimeConfirmation(pair, rawAnalysis);

      // Cache confirmed result
      this.regimeCache.set(pair, { regime: confirmedAnalysis, timestamp: Date.now() });

      return confirmedAnalysis;
    } catch (error: any) {
      log(`Error obteniendo régimen para ${pair}: ${error.message}`, "trading");
      return { ...defaultResult, reason: "Error en detección" };
    }
  }

  private async applyRegimeConfirmation(pair: string, rawAnalysis: RegimeAnalysis): Promise<RegimeAnalysis> {
    const now = new Date();
    const state = await this.getRegimeState(pair);
    const currentConfirmed = (state?.currentRegime as MarketRegime) || "TRANSITION";

    // Keep lastRegime map in sync with persistent state
    this.lastRegime.set(pair, currentConfirmed);

    // Phase 2.3: Check MinHold - prevent flip unless hard exit
    if (state?.holdUntil && now < state.holdUntil) {
      const isHardExit = rawAnalysis.adx < REGIME_CONFIG.ADX_HARD_EXIT;
      const remainingMs = state.holdUntil.getTime() - now.getTime();
      const remainingMin = Math.ceil(remainingMs / 60000);

      if (!isHardExit) {
        log(`[REGIME_HOLD] pair=${pair} skipChange=true remainingMin=${remainingMin} candidate=${rawAnalysis.regime} adx=${rawAnalysis.adx.toFixed(1)}`, "trading");
        log(`[REGIME_NOTIFY] sent=false skipReason=hysteresis_hold pair=${pair}`, "trading");
        const syncedReason = `Manteniendo ${currentConfirmed} (minHold ${remainingMin}min restantes)`;
        return { ...rawAnalysis, regime: currentConfirmed, reason: syncedReason };
      }
      log(`[REGIME_HARD_EXIT] pair=${pair} adx=${rawAnalysis.adx.toFixed(1)} changeImmediate=true bypassHold=true`, "trading");
    }

    // Phase 2.2: Confirmation via consecutive scans (fallback mode)
    if (rawAnalysis.regime !== currentConfirmed) {
      const candidateRegime = state?.candidateRegime;
      const candidateCount = state?.candidateCount || 0;

      if (rawAnalysis.regime === candidateRegime) {
        // Same candidate: increment count
        const newCount = candidateCount + 1;
        const confirmed = newCount >= REGIME_CONFIG.CONFIRM_SCANS_REQUIRED;

        log(`[REGIME_CANDIDATE] pair=${pair} candidate=${rawAnalysis.regime} count=${newCount}/${REGIME_CONFIG.CONFIRM_SCANS_REQUIRED} adx=${rawAnalysis.adx.toFixed(1)}`, "trading");

        if (confirmed) {
          // Confirmed! Update state and send alert
          const holdUntil = new Date(now.getTime() + REGIME_CONFIG.MIN_HOLD_MINUTES * 60 * 1000);
          const transitionSince = rawAnalysis.regime === "TRANSITION" ? now : null;

          await this.upsertRegimeState(pair, {
            currentRegime: rawAnalysis.regime,
            confirmedAt: now,
            holdUntil,
            transitionSince,
            candidateRegime: null,
            candidateCount: 0,
            lastAdx: rawAnalysis.adx.toString(),
          });

          log(`[REGIME_CONFIRM] pair=${pair} from=${currentConfirmed} to=${rawAnalysis.regime} adx=${rawAnalysis.adx.toFixed(1)} holdUntil=${holdUntil.toISOString()}`, "trading");

          // Update lastRegime map with new confirmed regime
          this.lastRegime.set(pair, rawAnalysis.regime);

          // Send alert (with cooldown/dedup)
          await this.sendRegimeChangeAlert(pair, currentConfirmed, rawAnalysis);

          return rawAnalysis;
        } else {
          // Not yet confirmed, keep accumulating
          await this.upsertRegimeState(pair, {
            candidateRegime: rawAnalysis.regime,
            candidateCount: newCount,
            lastAdx: rawAnalysis.adx.toString(),
          });
          log(`[REGIME_NOTIFY] sent=false skipReason=no_confirmed pair=${pair}`, "trading");
          const syncedReason = `Manteniendo ${currentConfirmed} (confirmación ${newCount}/${REGIME_CONFIG.CONFIRM_SCANS_REQUIRED})`;
          return { ...rawAnalysis, regime: currentConfirmed, reason: syncedReason };
        }
      } else {
        // Different candidate: reset counter
        log(`[REGIME_CANDIDATE] pair=${pair} candidate=${rawAnalysis.regime} count=1/${REGIME_CONFIG.CONFIRM_SCANS_REQUIRED} reset=true prevCandidate=${candidateRegime || "none"} adx=${rawAnalysis.adx.toFixed(1)}`, "trading");
        await this.upsertRegimeState(pair, {
          candidateRegime: rawAnalysis.regime,
          candidateCount: 1,
          lastAdx: rawAnalysis.adx.toString(),
        });
        log(`[REGIME_NOTIFY] sent=false skipReason=no_confirmed pair=${pair}`, "trading");
        const syncedReason = `Manteniendo ${currentConfirmed} (confirmación 1/${REGIME_CONFIG.CONFIRM_SCANS_REQUIRED})`;
        return { ...rawAnalysis, regime: currentConfirmed, reason: syncedReason };
      }
    }

    // No change in regime
    await this.upsertRegimeState(pair, { lastAdx: rawAnalysis.adx.toString() });
    return rawAnalysis;
  }

  private async sendRegimeChangeAlert(pair: string, fromRegime: MarketRegime, analysis: RegimeAnalysis) {
    const now = Date.now();
    const state = await this.getRegimeState(pair);

    // Phase 2.1: Cooldown check (60 min per pair)
    if (state?.lastNotifiedAt) {
      const msSinceNotified = now - state.lastNotifiedAt.getTime();
      if (msSinceNotified < REGIME_CONFIG.NOTIFY_COOLDOWN_MS) {
        log(`[REGIME_NOTIFY] sent=false skipReason=cooldown pair=${pair} msSince=${msSinceNotified}`, "trading");
        return;
      }
    }

    // Phase 2.1: Hash dedup (same params + reason = no notify)
    const paramsHash = this.computeParamsHash(analysis.regime);
    const reasonHash = this.computeReasonHash(analysis.regime, analysis.reason);

    if (state?.lastParamsHash === paramsHash && state?.lastReasonHash === reasonHash) {
      log(`[REGIME_NOTIFY] sent=false skipReason=same_hash pair=${pair} paramsHash=${paramsHash} reasonHash=${reasonHash}`, "trading");
      return;
    }

    // Phase 2.4: TRANSITION silence (only first entry or material change)
    if (analysis.regime === "TRANSITION" && fromRegime === "TRANSITION") {
      log(`[REGIME_NOTIFY] sent=false skipReason=transition_no_change pair=${pair}`, "trading");
      return;
    }

    // Update state with notification info
    await this.upsertRegimeState(pair, {
      lastNotifiedAt: new Date(),
      lastParamsHash: paramsHash,
      lastReasonHash: reasonHash,
    });

    const regimeEmoji: Record<MarketRegime, string> = {
      TREND: "\u{1F4C8}",
      RANGE: "\u2194\uFE0F",
      TRANSITION: "\u23F3",
    };

    const preset = REGIME_PRESETS[analysis.regime];
    const presetInfo = analysis.regime === "TRANSITION"
      ? "Entradas pausadas hasta confirmación"
      : `BE: ${preset.sgBeAtPct}%, Trail: ${preset.sgTrailDistancePct}%, TP: ${preset.sgTpFixedPct}%, MinSig: ${preset.minSignals}`;

    const message = `
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${regimeEmoji[analysis.regime]} <b>Cambio de R\u00e9gimen</b>

\u{1F4E6} <b>Detalles:</b>
   \u2022 Par: <code>${pair}</code>
   \u2022 Antes: <code>${fromRegime}</code> \u2192 Ahora: <code>${analysis.regime}</code>
   \u2022 ADX: <code>${analysis.adx.toFixed(0)}</code>
   \u2022 Raz\u00f3n: <code>${analysis.reason}</code>

\u2699\uFE0F <b>Par\u00e1metros ajustados:</b>
   ${presetInfo}

\u{1F517} <a href="${environment.panelUrl}">Ver Panel</a>
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`;

    await this.host.sendAlertWithSubtype(message, "strategy", "strategy_regime_change");

    log(`[TELEGRAM] RegimeChanged pair=${pair} from=${fromRegime} to=${analysis.regime}`, "trading");
    log(`[REGIME_NOTIFY] sent=true pair=${pair} paramsHash=${paramsHash} reasonHash=${reasonHash}`, "trading");

    await botLogger.info("SYSTEM_ALERT", `Régimen cambiado en ${pair}: ${fromRegime} → ${analysis.regime}`, {
      pair,
      fromRegime,
      toRegime: analysis.regime,
      adx: analysis.adx,
      confidence: analysis.confidence,
      reason: analysis.reason,
    });
  }

  getRegimeMinSignals(regime: MarketRegime, baseMinSignals: number): number {
    // Check if we have dynamic configuration from ConfigService
    if (this.dynamicConfig?.signals?.[regime]) {
      const signalConfig = this.dynamicConfig.signals[regime];
      const currentSignals = signalConfig.currentSignals;
      // Use dynamic value if it's within reasonable bounds
      if (currentSignals >= 1 && currentSignals <= 10) {
        log(`[CONFIG] Using dynamic minSignals=${currentSignals} for regime=${regime}`, "trading");
        return currentSignals;
      }
    }

    // Fallback to preset values
    const preset = REGIME_PRESETS[regime];
    // Never go below the stricter of base config or regime preset
    return Math.max(baseMinSignals, preset.minSignals);
  }
}
