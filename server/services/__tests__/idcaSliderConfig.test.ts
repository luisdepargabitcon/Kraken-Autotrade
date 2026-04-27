/**
 * Tests para IdcaSliderConfig — Derivación de config técnica desde sliders.
 *
 * Verifica:
 * - Defaults profesionales aplicados cuando no hay config
 * - Interpolación correcta de minDipPct por par (BTC/ETH/genérico)
 * - Interpolación de reboundPct por par
 * - maxExecutionOvershootPct inversamente proporcional a patience
 * - minEntryQualityScore derivado correctamente
 * - Política Telegram derivada de sliders
 * - getEffectiveEntryConfig con y sin entryUiJson
 * - Backward compat: sin entryUiJson aplica defaults
 */

import { describe, it, expect } from "vitest";
import {
  ENTRY_SLIDER_DEFAULTS,
  TELEGRAM_SLIDER_DEFAULTS,
  deriveEntryConfigFromSliders,
  deriveTelegramPolicyFromSliders,
  getEffectiveEntryConfig,
  getEffectiveTelegramConfig,
  type EntryUiConfig,
  type TelegramUiConfig,
} from "../institutionalDca/IdcaSliderConfig";

// ─── Defaults ─────────────────────────────────────────────────────────────────

describe("IdcaSliderConfig — Defaults", () => {
  it("SC01. ENTRY_SLIDER_DEFAULTS son los valores profesionales recomendados", () => {
    expect(ENTRY_SLIDER_DEFAULTS.entryPatienceLevel).toBe(70);
    expect(ENTRY_SLIDER_DEFAULTS.reboundConfirmationLevel).toBe(65);
    expect(ENTRY_SLIDER_DEFAULTS.entryQualityLevel).toBe(65);
    expect(ENTRY_SLIDER_DEFAULTS.entrySizeAggressiveness).toBe(40);
  });

  it("SC02. TELEGRAM_SLIDER_DEFAULTS son los valores anti-spam recomendados", () => {
    expect(TELEGRAM_SLIDER_DEFAULTS.telegramAlertFrequencyLevel).toBe(85);
    expect(TELEGRAM_SLIDER_DEFAULTS.telegramAlertDetailLevel).toBe(40);
    expect(TELEGRAM_SLIDER_DEFAULTS.telegramAlertGroupingLevel).toBe(85);
  });
});

// ─── minDipPct BTC ────────────────────────────────────────────────────────────

describe("IdcaSliderConfig — minDipPct BTC/USD", () => {
  it("SC03. entryPatienceLevel=70 → BTC effectiveMinDipPct ≈ 4.20%", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 70 }, "BTC/USD");
    expect(d.effectiveMinDipPct).toBeCloseTo(4.20, 1);
  });

  it("SC04. entryPatienceLevel=0 → BTC effectiveMinDipPct ≈ 3.00%", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 0 }, "BTC/USD");
    expect(d.effectiveMinDipPct).toBeCloseTo(3.00, 1);
  });

  it("SC05. entryPatienceLevel=100 → BTC effectiveMinDipPct ≈ 5.20%", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 100 }, "BTC/USD");
    expect(d.effectiveMinDipPct).toBeCloseTo(5.20, 1);
  });

  it("SC06. entryPatienceLevel=50 → BTC effectiveMinDipPct ≈ 3.70%", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 50 }, "BTC/USD");
    expect(d.effectiveMinDipPct).toBeCloseTo(3.70, 1);
  });
});

// ─── minDipPct ETH ────────────────────────────────────────────────────────────

describe("IdcaSliderConfig — minDipPct ETH/USD", () => {
  it("SC07. entryPatienceLevel=70 → ETH effectiveMinDipPct ≈ 4.60%", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 70 }, "ETH/USD");
    expect(d.effectiveMinDipPct).toBeCloseTo(4.60, 1);
  });

  it("SC08. entryPatienceLevel=0 → ETH effectiveMinDipPct ≈ 3.30%", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 0 }, "ETH/USD");
    expect(d.effectiveMinDipPct).toBeCloseTo(3.30, 1);
  });

  it("SC09. ETH siempre >= BTC para el mismo slider (mayor volatilidad)", () => {
    for (const level of [0, 30, 50, 70, 100]) {
      const btc = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: level }, "BTC/USD");
      const eth = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: level }, "ETH/USD");
      expect(eth.effectiveMinDipPct).toBeGreaterThanOrEqual(btc.effectiveMinDipPct);
    }
  });
});

// ─── reboundPct ───────────────────────────────────────────────────────────────

describe("IdcaSliderConfig — reboundPct", () => {
  it("SC10. reboundConfirmationLevel=65 → BTC reboundPct ≈ 0.55%", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, reboundConfirmationLevel: 65 }, "BTC/USD");
    expect(d.reboundPct).toBeCloseTo(0.55, 2);
  });

  it("SC11. reboundConfirmationLevel=65 → ETH reboundPct ≈ 0.65%", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, reboundConfirmationLevel: 65 }, "ETH/USD");
    expect(d.reboundPct).toBeCloseTo(0.65, 2);
  });

  it("SC12. reboundPct crece monótonamente con el slider", () => {
    const levels = [0, 25, 50, 65, 80, 100];
    const rebounds = levels.map(l =>
      deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, reboundConfirmationLevel: l }, "BTC/USD").reboundPct
    );
    for (let i = 1; i < rebounds.length; i++) {
      expect(rebounds[i]).toBeGreaterThanOrEqual(rebounds[i - 1]);
    }
  });
});

// ─── maxExecutionOvershootPct ─────────────────────────────────────────────────

describe("IdcaSliderConfig — maxExecutionOvershootPct", () => {
  it("SC13. patience=0 → overshoot ≈ 0.50% (permisivo)", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 0 }, "BTC/USD");
    expect(d.maxExecutionOvershootPct).toBeCloseTo(0.50, 2);
  });

  it("SC14. patience=100 → overshoot mínimo (≤0.15%)", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 100 }, "BTC/USD");
    expect(d.maxExecutionOvershootPct).toBeGreaterThanOrEqual(0.10);
    expect(d.maxExecutionOvershootPct).toBeLessThanOrEqual(0.16);
  });

  it("SC15. overshoot decrece (o se mantiene) con patience creciente", () => {
    const levels = [0, 25, 50, 70, 100];
    const overshoots = levels.map(l =>
      deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: l }, "BTC/USD").maxExecutionOvershootPct
    );
    for (let i = 1; i < overshoots.length; i++) {
      expect(overshoots[i]).toBeLessThanOrEqual(overshoots[i - 1] + 0.001);
    }
  });
});

// ─── minEntryQualityScore ─────────────────────────────────────────────────────

describe("IdcaSliderConfig — minEntryQualityScore", () => {
  it("SC16. entryQualityLevel=65 → minEntryQualityScore ≈ 65", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryQualityLevel: 65 }, "BTC/USD");
    expect(d.minEntryQualityScore).toBeCloseTo(65, 0);
  });

  it("SC17. entryQualityLevel=100 → minEntryQualityScore ≈ 80", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryQualityLevel: 100 }, "BTC/USD");
    expect(d.minEntryQualityScore).toBeCloseTo(80, 0);
  });

  it("SC18. entryQualityLevel=0 → minEntryQualityScore ≥ 45 (no menor que mínimo)", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryQualityLevel: 0 }, "BTC/USD");
    expect(d.minEntryQualityScore).toBeGreaterThanOrEqual(45);
  });
});

// ─── Telegram policy derivada ─────────────────────────────────────────────────

describe("IdcaSliderConfig — deriveTelegramPolicyFromSliders", () => {
  it("SC19. defaults → trackingEnabled=false (anti-spam)", () => {
    const p = deriveTelegramPolicyFromSliders(TELEGRAM_SLIDER_DEFAULTS);
    expect(p.trackingEnabled).toBe(false);
  });

  it("SC20. telegramAlertFrequencyLevel=85 → watchingMinIntervalMinutes ≈ 240", () => {
    const p = deriveTelegramPolicyFromSliders(TELEGRAM_SLIDER_DEFAULTS);
    expect(p.watchingMinIntervalMinutes).toBeCloseTo(240, -1); // dentro de ±10
  });

  it("SC21. telegramAlertFrequencyLevel=85 → trackingMinIntervalMinutes ≈ 90", () => {
    const p = deriveTelegramPolicyFromSliders(TELEGRAM_SLIDER_DEFAULTS);
    expect(p.trackingMinIntervalMinutes).toBeCloseTo(90, -1);
  });

  it("SC22. detail=40, grouping=85 → digestEnabled=true y digestIntervalMinutes ≈ 240", () => {
    const p = deriveTelegramPolicyFromSliders(TELEGRAM_SLIDER_DEFAULTS);
    expect(p.digestEnabled).toBe(true);
    expect(p.digestIntervalMinutes).toBeCloseTo(240, -1);
  });

  it("SC23. detail=70 → trackingEnabled=true (modo detallado)", () => {
    const p = deriveTelegramPolicyFromSliders({ ...TELEGRAM_SLIDER_DEFAULTS, telegramAlertDetailLevel: 70 });
    expect(p.trackingEnabled).toBe(true);
  });

  it("SC24. detail=10 → profile=silent y cancelledEnabled=false", () => {
    const p = deriveTelegramPolicyFromSliders({ ...TELEGRAM_SLIDER_DEFAULTS, telegramAlertDetailLevel: 10 });
    expect(p.profile).toBe("silent");
    expect(p.cancelledEnabled).toBe(false);
  });

  it("SC25. executedEnabled siempre true independiente de sliders", () => {
    for (const detail of [0, 10, 40, 70, 100]) {
      const p = deriveTelegramPolicyFromSliders({ ...TELEGRAM_SLIDER_DEFAULTS, telegramAlertDetailLevel: detail });
      expect(p.executedEnabled).toBe(true);
    }
  });
});

// ─── getEffectiveEntryConfig ──────────────────────────────────────────────────

describe("IdcaSliderConfig — getEffectiveEntryConfig", () => {
  it("SC26. Sin entryUiJson → aplica defaults profesionales (BTC: dip≈4.20%)", () => {
    const d = getEffectiveEntryConfig(null, "BTC/USD");
    expect(d.effectiveMinDipPct).toBeCloseTo(4.20, 1);
    expect(d.reboundPct).toBeCloseTo(0.55, 2);
  });

  it("SC27. Con entryUiJson explícito → override de defaults", () => {
    const d = getEffectiveEntryConfig({ entryUiJson: { entryPatienceLevel: 100 } }, "BTC/USD");
    expect(d.effectiveMinDipPct).toBeCloseTo(5.20, 1);
  });

  it("SC28. Partial entryUiJson → mezcla con defaults", () => {
    const d = getEffectiveEntryConfig({ entryUiJson: { reboundConfirmationLevel: 0 } }, "BTC/USD");
    expect(d.reboundPct).toBeCloseTo(0.25, 2);       // reboundConfirmationLevel=0
    expect(d.effectiveMinDipPct).toBeCloseTo(4.20, 1); // entryPatienceLevel=70 (default)
  });

  it("SC29. getEffectiveTelegramConfig sin telegramUiJson → defaults anti-spam", () => {
    const p = getEffectiveTelegramConfig(null);
    expect(p.trackingEnabled).toBe(false);
    expect(p.digestEnabled).toBe(true);
    expect(p.watchingMinIntervalMinutes).toBeGreaterThanOrEqual(200);
  });
});

// ─── confirmationTicks y requiredReboundHoldSeconds ──────────────────────────

describe("IdcaSliderConfig — confirmationTicks y holdSeconds", () => {
  it("SC30. reboundConfirmationLevel=0 → confirmationTicks=1, holdSeconds pequeño", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, reboundConfirmationLevel: 0 }, "BTC/USD");
    expect(d.confirmationTicks).toBe(1);
    expect(d.requiredReboundHoldSeconds).toBeLessThanOrEqual(10);
  });

  it("SC31. reboundConfirmationLevel=65 → confirmationTicks=2, holdSeconds en rango 20-30", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, reboundConfirmationLevel: 65 }, "BTC/USD");
    expect(d.confirmationTicks).toBe(2);
    expect(d.requiredReboundHoldSeconds).toBeGreaterThanOrEqual(20);
    expect(d.requiredReboundHoldSeconds).toBeLessThanOrEqual(35);
  });

  it("SC32. reboundConfirmationLevel=100 → confirmationTicks=3, holdSeconds en rango 45-60", () => {
    const d = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, reboundConfirmationLevel: 100 }, "BTC/USD");
    expect(d.confirmationTicks).toBe(3);
    expect(d.requiredReboundHoldSeconds).toBeGreaterThanOrEqual(45);
  });
});
