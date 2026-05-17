/**
 * Tests mínimos para Market Data Health (FASE C)
 * 
 * Casos críticos:
 * 1. 1h age 126min => lagging, no stopped
 * 2. 1h age 400min => stopped
 * 3. source=db_fallback + candles=12 => degraded/minimal/usableForEntry=false
 * 4. source=db_fallback + candles=721 + frescura OK => degraded/full_macro_context/usableForContext=true
 * 5. cleanup se ejecuta sin errores
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  checkMarketDataHealth,
  type DataReadinessState,
  type DataQualityLevel,
} from "../institutionalDca/IdcaMarketDataHealthService";
import { MarketDataService } from "../MarketDataService";

describe("MarketDataHealth FASE C - Casos críticos", () => {
  beforeEach(() => {
    // Limpiar caches entre tests
    MarketDataService.clearAll();
  });

  it("C01: 1h con 126min debe ser lagging (no stopped)", async () => {
    // Simular datos de Kraken con última vela de hace 126 minutos
    // Esto requiere inyectar velas simuladas
    const mockCandles = Array.from({ length: 100 }, (_, i) => ({
      time: Math.floor((Date.now() - (126 + i) * 60 * 1000) / 1000), // 126min + i minutos atrás
      open: 50000,
      high: 51000,
      low: 49000,
      close: 50500,
      volume: 100,
    })).reverse();

    MarketDataService.putCandles("BTC/USD", "1h", mockCandles);

    const health = await checkMarketDataHealth("BTC/USD", "simulation");

    // 126min en 1h debe ser lagging (entre 120 y 180)
    expect(health.dataReadinessState).toBe("lagging");
    expect(health.quality).toBe("good_context"); // 100 velas
    expect(health.usableForEntry).toBe(true); // lagging + fresh enough + good_context
    expect(health.usableForContext).toBe(true);
    expect(health.reason).toContain("ligero retraso");
    expect(health.reason).not.toContain("detenido");
  });

  it("C02: 1h con 400min debe ser stopped", async () => {
    const mockCandles = Array.from({ length: 100 }, (_, i) => ({
      time: Math.floor((Date.now() - (400 + i) * 60 * 1000) / 1000), // 400min + i minutos atrás
      open: 50000,
      high: 51000,
      low: 49000,
      close: 50500,
      volume: 100,
    })).reverse();

    MarketDataService.putCandles("BTC/USD", "1h", mockCandles);

    const health = await checkMarketDataHealth("BTC/USD", "simulation");

    // 400min > 360 (stopped threshold para 1h)
    expect(health.dataReadinessState).toBe("stopped");
    expect(health.usableForEntry).toBe(false);
    // Stopped (> 6h sin datos) bloquea contexto operativo aunque haya velas históricas
    expect(health.usableForContext).toBe(false);
    expect(health.usableForMacro).toBe(false); // 100 velas = good_context, no full_macro (necesita 721+)
    expect(health.blocksNewMain).toBe(true);
    expect(health.reason).toContain("detenido");
  });

  it("C03: db_fallback con 12 velas => degraded/minimal/usableForEntry=false", async () => {
    // Simular fallback a BD con pocas velas
    const mockCandles = Array.from({ length: 12 }, (_, i) => ({
      time: Math.floor((Date.now() - (30 + i) * 60 * 1000) / 1000), // 30min atrás (fresh)
      open: 50000,
      high: 51000,
      low: 49000,
      close: 50500,
      volume: 100,
    })).reverse();

    MarketDataService.putCandles("BTC/USD", "1h", mockCandles);

    const health = await checkMarketDataHealth("BTC/USD", "simulation", {
      isFromDbFallback: true,
    });

    expect(health.dataReadinessState).toBe("degraded");
    expect(health.source).toBe("db_fallback");
    expect(health.quality).toBe("minimal"); // 12 velas (7-23)
    expect(health.usableForEntry).toBe(false); // minimal no es context quality
    expect(health.usableForContext).toBe(true); // minimal sí permite contexto limitado
    expect(health.usableForMacro).toBe(false);
    expect(health.isFallback).toBe(true);
  });

  it("C04: db_fallback con 721 velas frescas => degraded/full_macro_context/usableForContext=true", async () => {
    const mockCandles = Array.from({ length: 721 }, (_, i) => ({
      time: Math.floor((Date.now() - (30 + i) * 60 * 1000) / 1000), // 30min atrás (fresh)
      open: 50000,
      high: 51000,
      low: 49000,
      close: 50500,
      volume: 100,
    })).reverse();

    MarketDataService.putCandles("BTC/USD", "1h", mockCandles);

    const health = await checkMarketDataHealth("BTC/USD", "simulation", {
      isFromDbFallback: true,
    });

    expect(health.dataReadinessState).toBe("degraded");
    expect(health.source).toBe("db_fallback");
    expect(health.quality).toBe("full_macro_context"); // 721+ velas
    expect(health.usableForEntry).toBe(true); // degraded pero fresh + full macro
    expect(health.usableForContext).toBe(true);
    expect(health.usableForMacro).toBe(true);
    expect(health.isFallback).toBe(true);
    expect(health.reason).toContain("cache persistente");
  });

  it("C04b: db_fallback + 721 velas + 400min => usableForEntry=false (obsoleto)", async () => {
    // CASO CRÍTICO: Muchas velas antiguas NO equivalen a datos frescos
    // 721 velas pero última de hace 400min (> 360 stopped threshold para 1h)
    const mockCandles = Array.from({ length: 721 }, (_, i) => ({
      time: Math.floor((Date.now() - (400 + i) * 60 * 1000) / 1000), // 400min + i minutos atrás
      open: 50000,
      high: 51000,
      low: 49000,
      close: 50500,
      volume: 100,
    })).reverse();

    MarketDataService.putCandles("BTC/USD", "1h", mockCandles);

    const health = await checkMarketDataHealth("BTC/USD", "simulation", {
      isFromDbFallback: true,
    });

    // Verificaciones críticas
    expect(health.dataReadinessState).toBe("stopped"); // 400min > 360 threshold
    expect(health.source).toBe("db_fallback");
    expect(health.quality).toBe("full_macro_context"); // 721 velas = buena profundidad
    expect(health.lastCandleAgeMinutes).toBeGreaterThanOrEqual(400);

    // IMPORTANTE: Aunque tenga 721 velas, NO debe permitir entrada porque están obsoletas
    expect(health.usableForEntry).toBe(false); // ← CRÍTICO: freshness gating
    // Cuando está stopped (> 6h sin datos), el contexto técnico está obsoleto
    expect(health.usableForContext).toBe(false); // Stopped bloquea contexto operativo
    expect(health.usableForMacro).toBe(true); // Macro histórico sí disponible por cantidad
    expect(health.isFallback).toBe(true);
    expect(health.blocksNewMain).toBe(true); // Bloquea nuevas entradas

    // El mensaje debe dejar claro que está stopped (el origen fallback está en source)
    expect(health.reason).toContain("detenido");
    expect(health.reason.toLowerCase()).toContain("feed");
    expect(health.reason).toContain("400min");
  });

  it("C05: cleanupOldCandles ejecuta sin errores", async () => {
    // El cleanup debe ejecutarse sin lanzar errores
    const result = await MarketDataService.cleanupOldCandles();
    
    // Resultado es número de velas borradas (>= 0)
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("C06: 0 velas => warmup/none/usableForEntry=false", async () => {
    const health = await checkMarketDataHealth("BTC/USD", "simulation");

    expect(health.dataReadinessState).toBe("warmup");
    expect(health.quality).toBe("none");
    expect(health.candleCount).toBe(0);
    expect(health.usableForEntry).toBe(false);
    expect(health.usableForContext).toBe(false);
    expect(health.usableForMacro).toBe(false);
    expect(health.blocksNewMain).toBe(true);
  });

  it("C07: 5 velas => warmup/insufficient", async () => {
    const mockCandles = Array.from({ length: 5 }, (_, i) => ({
      time: Math.floor((Date.now() - (30 + i) * 60 * 1000) / 1000),
      open: 50000,
      high: 51000,
      low: 49000,
      close: 50500,
      volume: 100,
    })).reverse();

    MarketDataService.putCandles("BTC/USD", "1h", mockCandles);

    const health = await checkMarketDataHealth("BTC/USD", "simulation");

    expect(health.quality).toBe("insufficient"); // 5 < 7
    expect(health.dataReadinessState).toBe("warmup"); // < minimum (7)
    expect(health.usableForEntry).toBe(false);
  });

  it("C08: ready desde Kraken con velas suficientes", async () => {
    const mockCandles = Array.from({ length: 100 }, (_, i) => ({
      time: Math.floor((Date.now() - (30 + i) * 60 * 1000) / 1000), // 30min (dentro de ready 120min)
      open: 50000,
      high: 51000,
      low: 49000,
      close: 50500,
      volume: 100,
    })).reverse();

    MarketDataService.putCandles("BTC/USD", "1h", mockCandles);

    // Sin isFromDbFallback => viene de Kraken/MDS
    const health = await checkMarketDataHealth("BTC/USD", "simulation");

    expect(health.dataReadinessState).toBe("ready");
    expect(health.source).toBe("kraken"); // o "mds_cache"
    expect(health.quality).toBe("good_context");
    expect(health.usableForEntry).toBe(true);
    expect(health.usableForContext).toBe(true);
    expect(health.isFallback).toBe(false);
  });
});

console.log("✅ Tests FASE C listos para ejecutar con: npx vitest run server/services/__tests__/marketDataHealth.test.ts");
