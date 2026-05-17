/**
 * MarketCandleRepository
 * 
 * Repositorio de velas OHLCV persistentes para todo el sistema.
 * 
 * FASE B: Base común de velas para IDCA, modo normal y futuros módulos.
 * 
 * Responsabilidades:
 * - Persistir velas cerradas desde Kraken/MDS
 * - Servir como seed inicial y fallback temporal
 * - No acoplarse a ningún módulo específico
 * - Ser consumido por MarketDataService, no directamente por módulos de trading
 * 
 * Reglas:
 * - Kraken/MDS sigue siendo la fuente primaria
 * - Esta BD es cache persistente / fallback / seed
 * - No decide operaciones de trading
 * - No finge frescura si los datos están obsoletos
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface OHLCV {
  time: number;      // Timestamp en ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed?: boolean; // Opcional: indica si la vela está cerrada
}

export interface CandleRecord extends OHLCV {
  id: number;
  pair: string;
  timeframe: string;
  source: string;
  openTime: Date;
  closeTime: Date | null;
  isClosed: boolean;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RetentionPolicy {
  timeframe: string;
  days: number;
}

// ─── Configuración ────────────────────────────────────────────────────────────

/** Políticas de retención por defecto */
export const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  { timeframe: "1m", days: 7 },      // 1 minuto: 7 días (si se usa)
  { timeframe: "5m", days: 30 },     // 5 minutos: 30 días
  { timeframe: "15m", days: 90 },     // 15 minutos: 90 días
  { timeframe: "30m", days: 90 },     // 30 minutos: 90 días
  { timeframe: "1h", days: 180 },    // 1 hora: 180 días (~6 meses)
  { timeframe: "4h", days: 365 },     // 4 horas: 1 año
  { timeframe: "1d", days: 1825 },   // 1 día: 5 años
  { timeframe: "1w", days: 1095 },   // 1 semana: 3 años
  { timeframe: "15d", days: 1095 },   // 15 días: 3 años
];

/** Timestamp de última limpieza (en memoria) */
let lastCleanupTime = 0;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 horas

// ─── Funciones principales ─────────────────────────────────────────────────────

/**
 * Guarda o actualiza velas en la BD (upsert).
 * 
 * @param pair - Par de trading (ej: "BTC/USD")
 * @param timeframe - Timeframe (ej: "1h")
 * @param source - Fuente de datos (ej: "kraken", "mds_cache")
 * @param candles - Array de velas OHLCV
 * @returns Número de velas insertadas/actualizadas
 */
export async function upsertCandles(
  pair: string,
  timeframe: string,
  source: string,
  candles: OHLCV[],
): Promise<number> {
  if (!candles.length) return 0;

  try {
    let inserted = 0;
    
    for (const candle of candles) {
      const openTime = new Date(candle.time);
      const closeTime = candle.isClosed 
        ? new Date(candle.time + getTimeframeMs(timeframe) - 1)
        : null;
      
      // Upsert usando INSERT ... ON CONFLICT
      await db.execute(sql`
        INSERT INTO market_candles (
          pair, timeframe, source, open_time, close_time,
          open, high, low, close, volume, is_closed, fetched_at
        ) VALUES (
          ${pair}, ${timeframe}, ${source}, ${openTime}, ${closeTime},
          ${candle.open}, ${candle.high}, ${candle.low}, ${candle.close}, 
          ${candle.volume ?? null}, ${candle.isClosed ?? true}, ${new Date()}
        )
        ON CONFLICT (pair, timeframe, source, open_time) DO UPDATE SET
          close_time = EXCLUDED.close_time,
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          is_closed = EXCLUDED.is_closed,
          fetched_at = EXCLUDED.fetched_at,
          updated_at = NOW()
      `);
      
      inserted++;
    }
    
    return inserted;
  } catch (error) {
    console.error(`[MarketCandleRepository] Error upserting candles for ${pair}/${timeframe}:`, error);
    return 0;
  }
}

/**
 * Obtiene velas recientes de la BD.
 * 
 * @param pair - Par de trading
 * @param timeframe - Timeframe
 * @param limit - Número máximo de velas a retornar
 * @returns Array de velas OHLCV
 */
export async function getRecentCandles(
  pair: string,
  timeframe: string,
  limit: number = 100,
): Promise<OHLCV[]> {
  try {
    const result = await db.execute(sql`
      SELECT 
        EXTRACT(EPOCH FROM open_time) * 1000 as time,
        open, high, low, close, volume,
        is_closed
      FROM market_candles
      WHERE pair = ${pair} 
        AND timeframe = ${timeframe}
        AND is_closed = TRUE
      ORDER BY open_time DESC
      LIMIT ${limit}
    `);
    
    return result.rows.map(row => ({
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: row.volume ? Number(row.volume) : 0,
      isClosed: Boolean(row.is_closed),
    })).reverse(); // Orden cronológico ascendente
    
  } catch (error) {
    console.error(`[MarketCandleRepository] Error getting recent candles for ${pair}/${timeframe}:`, error);
    return [];
  }
}

/**
 * Obtiene velas desde un timestamp específico.
 * 
 * @param pair - Par de trading
 * @param timeframe - Timeframe
 * @param since - Timestamp en ms desde el cual obtener velas
 * @returns Array de velas OHLCV
 */
export async function getCandlesSince(
  pair: string,
  timeframe: string,
  since: number,
): Promise<OHLCV[]> {
  try {
    const sinceDate = new Date(since);
    
    const result = await db.execute(sql`
      SELECT 
        EXTRACT(EPOCH FROM open_time) * 1000 as time,
        open, high, low, close, volume,
        is_closed
      FROM market_candles
      WHERE pair = ${pair} 
        AND timeframe = ${timeframe}
        AND open_time >= ${sinceDate}
        AND is_closed = TRUE
      ORDER BY open_time ASC
    `);
    
    return result.rows.map(row => ({
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: row.volume ? Number(row.volume) : 0,
      isClosed: Boolean(row.is_closed),
    }));
    
  } catch (error) {
    console.error(`[MarketCandleRepository] Error getting candles since for ${pair}/${timeframe}:`, error);
    return [];
  }
}

/**
 * Obtiene la última vela disponible.
 * 
 * @param pair - Par de trading
 * @param timeframe - Timeframe
 * @returns La última vela o null si no hay datos
 */
export async function getLatestCandle(
  pair: string,
  timeframe: string,
): Promise<OHLCV | null> {
  try {
    const result = await db.execute(sql`
      SELECT 
        EXTRACT(EPOCH FROM open_time) * 1000 as time,
        open, high, low, close, volume,
        is_closed
      FROM market_candles
      WHERE pair = ${pair} 
        AND timeframe = ${timeframe}
      ORDER BY open_time DESC
      LIMIT 1
    `);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: row.volume ? Number(row.volume) : 0,
      isClosed: Boolean(row.is_closed),
    };
    
  } catch (error) {
    console.error(`[MarketCandleRepository] Error getting latest candle for ${pair}/${timeframe}:`, error);
    return null;
  }
}

/**
 * Verifica la cobertura de datos (rango temporal disponible).
 * 
 * @param pair - Par de trading
 * @param timeframe - Timeframe
 * @returns Objeto con firstTime, lastTime y count, o null si no hay datos
 */
export async function getCoverage(
  pair: string,
  timeframe: string,
): Promise<{ firstTime: number; lastTime: number; count: number } | null> {
  try {
    const result = await db.execute(sql`
      SELECT 
        MIN(EXTRACT(EPOCH FROM open_time) * 1000) as first_time,
        MAX(EXTRACT(EPOCH FROM open_time) * 1000) as last_time,
        COUNT(*) as count
      FROM market_candles
      WHERE pair = ${pair} 
        AND timeframe = ${timeframe}
        AND is_closed = TRUE
    `);
    
    if (result.rows.length === 0 || result.rows[0].count === 0) return null;
    
    const row = result.rows[0];
    return {
      firstTime: Number(row.first_time),
      lastTime: Number(row.last_time),
      count: Number(row.count),
    };
    
  } catch (error) {
    console.error(`[MarketCandleRepository] Error getting coverage for ${pair}/${timeframe}:`, error);
    return null;
  }
}

/**
 * Elimina velas antiguas según la política de retención.
 * 
 * @param policies - Array de políticas de retención (por defecto usa DEFAULT_RETENTION_POLICIES)
 * @returns Número total de velas eliminadas
 */
export async function deleteOldCandles(
  policies: RetentionPolicy[] = DEFAULT_RETENTION_POLICIES,
): Promise<number> {
  // Throttle: máximo una vez cada 24 horas
  const now = Date.now();
  if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) {
    return 0;
  }
  
  lastCleanupTime = now;
  
  let totalDeleted = 0;
  
  try {
    for (const policy of policies) {
      const cutoffDate = new Date(now - policy.days * 24 * 60 * 60 * 1000);
      
      const result = await db.execute(sql`
        DELETE FROM market_candles
        WHERE timeframe = ${policy.timeframe}
          AND open_time < ${cutoffDate}
      `);
      
      const deleted = Number(result.rowCount || 0);
      totalDeleted += deleted;
      
      if (deleted > 0) {
        console.log(`[MarketCandleRepository][RETENTION] Deleted ${deleted} candles for timeframe ${policy.timeframe} older than ${policy.days}d`);
      }
    }
    
    if (totalDeleted > 0) {
      console.log(`[MarketCandleRepository][RETENTION] Total deleted: ${totalDeleted} candles`);
    }
    
    return totalDeleted;
    
  } catch (error) {
    console.error(`[MarketCandleRepository] Error deleting old candles:`, error);
    return 0;
  }
}

/**
 * Obtiene estadísticas de la tabla de velas.
 * 
 * @returns Estadísticas por timeframe
 */
export async function getStats(): Promise<Array<{
  timeframe: string;
  pairs: number;
  totalCandles: number;
  oldestCandle: Date | null;
  newestCandle: Date | null;
}>> {
  try {
    const result = await db.execute(sql`
      SELECT 
        timeframe,
        COUNT(DISTINCT pair) as pairs,
        COUNT(*) as total_candles,
        MIN(open_time) as oldest_candle,
        MAX(open_time) as newest_candle
      FROM market_candles
      GROUP BY timeframe
      ORDER BY timeframe
    `);
    
    return result.rows.map(row => ({
      timeframe: row.timeframe as string,
      pairs: Number(row.pairs),
      totalCandles: Number(row.total_candles),
      oldestCandle: row.oldest_candle ? new Date(row.oldest_candle as Date) : null,
      newestCandle: row.newest_candle ? new Date(row.newest_candle as Date) : null,
    }));
    
  } catch (error) {
    console.error(`[MarketCandleRepository] Error getting stats:`, error);
    return [];
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Convierte timeframe a milisegundos */
function getTimeframeMs(timeframe: string): number {
  const minutes: Record<string, number> = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
    "1w": 10080,
    "15d": 21600,
  };
  
  return (minutes[timeframe] || 60) * 60 * 1000;
}

// ─── Exportación del repositorio ───────────────────────────────────────────────

export const MarketCandleRepository = {
  upsertCandles,
  getRecentCandles,
  getCandlesSince,
  getLatestCandle,
  getCoverage,
  deleteOldCandles,
  getStats,
  DEFAULT_RETENTION_POLICIES,
};

export default MarketCandleRepository;
