/**
 * Tests para IdcaTelegramAlertPolicy — Política centralizada anti-spam Telegram IDCA.
 *
 * Cubre:
 * - Defaults cuando no hay config
 * - Overrides por perfil (balanced, verbose, silent, actions_only)
 * - shouldSendTrackingTelegram con distintos intervalos y mejoras
 * - shouldSendDigest
 * - Mensajes sin carácter \uFFFD (corrupción UTF-8)
 * - Clamp de valores mínimos
 */

import { describe, it, expect } from "vitest";
import {
  TB_ALERT_DEFAULTS,
  getTrailingBuyTelegramConfig,
  resolveTrailingBuyPolicy,
  shouldSendTrackingTelegram,
  shouldSendDigest,
  buildDigestMessage,
  type TrailingBuyDigestEntry,
} from "../institutionalDca/IdcaTelegramAlertPolicy";

// ─── H11: Defaults cuando togglesJson está vacío ─────────────────────────────

describe("IdcaTelegramAlertPolicy — Defaults", () => {
  it("H11. Sin config → devuelve defaults seguros", () => {
    const cfg = getTrailingBuyTelegramConfig({});
    expect(cfg.profile).toBe("balanced");
    expect(cfg.trackingEnabled).toBe(false);       // CRÍTICO: false por defecto
    expect(cfg.armedEnabled).toBe(true);
    expect(cfg.watchingEnabled).toBe(true);
    expect(cfg.cancelledEnabled).toBe(true);
    expect(cfg.reboundDetectedEnabled).toBe(true);
    expect(cfg.executedEnabled).toBe(true);
    expect(cfg.blockedExecutionEnabled).toBe(true);
    expect(cfg.digestEnabled).toBe(true);
    expect(cfg.digestIntervalMinutes).toBe(240);
    expect(cfg.trackingMinMinutes).toBe(60);
    expect(cfg.trackingMinPriceImprovementPct).toBe(0.30);
  });

  it("H12. togglesJson null/undefined → defaults", () => {
    expect(getTrailingBuyTelegramConfig(null).trackingEnabled).toBe(false);
    expect(getTrailingBuyTelegramConfig(undefined).trackingEnabled).toBe(false);
  });

  it("H13. Partial config → mezcla con defaults", () => {
    const cfg = getTrailingBuyTelegramConfig({ trailingBuy: { trackingEnabled: true, digestIntervalMinutes: 60 } });
    expect(cfg.trackingEnabled).toBe(true);         // override
    expect(cfg.digestIntervalMinutes).toBe(60);      // override
    expect(cfg.armedEnabled).toBe(true);             // default conservado
    expect(cfg.profile).toBe("balanced");            // default conservado
  });
});

// ─── H14-H17: Perfiles ───────────────────────────────────────────────────────

describe("IdcaTelegramAlertPolicy — Perfiles", () => {
  it("H14. Perfil balanced → trackingEnabled=false aunque usuario lo ponga true", () => {
    const policy = resolveTrailingBuyPolicy({ trailingBuy: { profile: "balanced", trackingEnabled: true } });
    expect(policy.trackingEnabled).toBe(false);     // balance siempre fuerza tracking=false
  });

  it("H15. Perfil verbose → respeta trackingEnabled=true del usuario", () => {
    const policy = resolveTrailingBuyPolicy({ trailingBuy: { profile: "verbose", trackingEnabled: true } });
    expect(policy.trackingEnabled).toBe(true);
  });

  it("H16. Perfil silent → todo desactivado salvo executedEnabled", () => {
    const policy = resolveTrailingBuyPolicy({ trailingBuy: { profile: "silent" } });
    expect(policy.armedEnabled).toBe(false);
    expect(policy.watchingEnabled).toBe(false);
    expect(policy.trackingEnabled).toBe(false);
    expect(policy.cancelledEnabled).toBe(false);
    expect(policy.digestEnabled).toBe(false);
    expect(policy.executedEnabled).toBe(true);      // ejecutado siempre visible
  });

  it("H17. Perfil actions_only → watching y tracking desactivados, reboundDetected activo", () => {
    const policy = resolveTrailingBuyPolicy({ trailingBuy: { profile: "actions_only" } });
    expect(policy.watchingEnabled).toBe(false);
    expect(policy.trackingEnabled).toBe(false);
    expect(policy.reboundDetectedEnabled).toBe(true);
    expect(policy.executedEnabled).toBe(true);
  });
});

// ─── H18-H21: shouldSendTrackingTelegram ─────────────────────────────────────

describe("IdcaTelegramAlertPolicy — shouldSendTrackingTelegram", () => {
  const basePolicy = { ...TB_ALERT_DEFAULTS, trackingEnabled: true, trackingMinMinutes: 60, trackingMinPriceImprovementPct: 0.30 };

  it("H18. trackingEnabled=false → no enviar, razón=tracking_disabled_by_policy", () => {
    const result = shouldSendTrackingTelegram({ ...basePolicy, trackingEnabled: false }, 999_999, 99);
    expect(result.should).toBe(false);
    expect(result.reason).toBe("tracking_disabled_by_policy");
  });

  it("H19. trackingEnabled=true, intervalo insuficiente, mejora pequeña → throttle", () => {
    const result = shouldSendTrackingTelegram(basePolicy, 10 * 60 * 1000, 0.10); // 10min, 0.10%
    expect(result.should).toBe(false);
    expect(result.reason).toBe("throttle");
  });

  it("H20. trackingEnabled=true, intervalo >= 60min → enviar por interval", () => {
    const result = shouldSendTrackingTelegram(basePolicy, 61 * 60 * 1000, 0);
    expect(result.should).toBe(true);
    expect(result.reason).toBe("interval");
  });

  it("H21. trackingEnabled=true, mejora >= 0.30% antes del intervalo → enviar por improvement", () => {
    const result = shouldSendTrackingTelegram(basePolicy, 5 * 60 * 1000, 0.35); // 5min, 0.35%
    expect(result.should).toBe(true);
    expect(result.reason).toBe("improvement");
  });

  it("H22. SIM/LIVE: trackingEnabled=false por defecto con perfil balanced", () => {
    const policy = resolveTrailingBuyPolicy({});  // sin config = balanced = trackingEnabled=false
    const result = shouldSendTrackingTelegram(policy, 999_999, 99);
    expect(result.should).toBe(false);
  });
});

// ─── H23-H24: shouldSendDigest ────────────────────────────────────────────────

describe("IdcaTelegramAlertPolicy — shouldSendDigest", () => {
  const policy = { ...TB_ALERT_DEFAULTS, digestEnabled: true, digestIntervalMinutes: 240 };

  it("H23. digestEnabled=false → no enviar", () => {
    expect(shouldSendDigest(0, { ...policy, digestEnabled: false })).toBe(false);
  });

  it("H24. digestEnabled=true, tiempo insuficiente → no enviar", () => {
    const lastSent = Date.now() - 60 * 60 * 1000; // hace 1h (< 4h)
    expect(shouldSendDigest(lastSent, policy)).toBe(false);
  });

  it("H25. digestEnabled=true, lastSent=0 → enviar (nunca enviado)", () => {
    expect(shouldSendDigest(0, policy)).toBe(true);
  });

  it("H26. digestEnabled=true, hace >4h → enviar", () => {
    const lastSent = Date.now() - 5 * 60 * 60 * 1000; // hace 5h
    expect(shouldSendDigest(lastSent, policy)).toBe(true);
  });
});

// ─── H27: Clamp de valores mínimos ───────────────────────────────────────────

describe("IdcaTelegramAlertPolicy — Clamp mínimos", () => {
  it("H27. trackingMinMinutes < 15 → clampado a 15", () => {
    const cfg = getTrailingBuyTelegramConfig({ trailingBuy: { trackingMinMinutes: 1 } });
    expect(cfg.trackingMinMinutes).toBe(15);
  });

  it("H28. digestIntervalMinutes < 30 → clampado a 30", () => {
    const cfg = getTrailingBuyTelegramConfig({ trailingBuy: { digestIntervalMinutes: 5 } });
    expect(cfg.digestIntervalMinutes).toBe(30);
  });

  it("H29. trackingMinPriceImprovementPct < 0.10 → clampado a 0.10", () => {
    const cfg = getTrailingBuyTelegramConfig({ trailingBuy: { trackingMinPriceImprovementPct: 0.01 } });
    expect(cfg.trackingMinPriceImprovementPct).toBe(0.10);
  });
});

// ─── H30: buildDigestMessage sin caracteres corruptos ─────────────────────────

describe("IdcaTelegramAlertPolicy — buildDigestMessage sin corrupción UTF-8", () => {
  const entries: TrailingBuyDigestEntry[] = [
    {
      pair: "BTC/USD",
      stateLabel: "Trailing Buy armado",
      referencePrice: 77924.38,
      localLow: 77591.70,
      reboundTriggerPrice: 78057.25,
      maxExecutionPrice: 78391.92,
    },
    {
      pair: "ETH/USD",
      stateLabel: "Siguiendo el mínimo",
      referencePrice: 2335.87,
      localLow: 2319.46,
      reboundTriggerPrice: 2331.06,
      maxExecutionPrice: 2347.55,
    },
  ];

  it("H30. Mensaje digest no contiene \\uFFFD (carácter corrupto)", () => {
    const msg = buildDigestMessage(entries, "simulation");
    expect(msg).not.toContain("\uFFFD");
  });

  it("H31. Mensaje digest contiene datos de ambos pares", () => {
    const msg = buildDigestMessage(entries, "simulation");
    expect(msg).toContain("BTC/USD");
    expect(msg).toContain("ETH/USD");
    expect(msg).toContain("$77924.38");
    expect(msg).toContain("$2335.87");
  });

  it("H32. Mensaje digest en castellano — sin textos técnicos en inglés", () => {
    const msg = buildDigestMessage(entries, "simulation");
    expect(msg).not.toContain("ARMED");
    expect(msg).not.toContain("TRACKING");
    expect(msg).not.toContain("WATCHING");
    expect(msg).not.toContain("Trailing Buy tracking");
    expect(msg).toContain("simulación");
  });

  it("H33. Mensaje digest de 0 entradas → buildDigestMessage devuelve string con header", () => {
    const msg = buildDigestMessage([], "live");
    expect(msg).toContain("real");           // modo "real" en castellano
    expect(msg).toContain("Sin compras ejecutadas");
  });
});
