/**
 * SpotHistoryService — Enhanced history queries for SPOT canonical engine.
 *
 * Provides:
 *   - getClosedTradesList: enriched list with openedAt (from bot_events), notional,
 *     returnPct, and derived R-multiple.
 *   - getTradeDetail: full detail with timeline built from bot_events.
 *   - deriveRMultiple: canonical R derivation (never fabricates 0 for unknown).
 *
 * Invariants:
 *   - Only returns trades with policy_version = SPOT_POLICY_VERSION.
 *   - lotId must start with 'spot-' for detail endpoint.
 *   - rMultiple is null (never 0) when derivation is not possible.
 *   - openedAt is from bot_events SPOT_ENTRY; null if no event found.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { SPOT_POLICY_VERSION } from "./spotTypes";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface SpotTradeListRow {
  tradeId: string;
  lotId: string;
  pair: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  notionalUsd: number;
  grossPnl: number;
  netPnl: number;
  returnPct: number | null;
  entryFee: number;
  exitFee: number;
  executionCost: number;
  feeQuality: string | null;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  rMultiple: number | null;
  profitCapturePct: number | null;
  exitReason: string | null;
  holdTimeMinutes: number;
  executionMode: string;
  policyVersion: string;
  setupTag: string | null;
  signalId: string | null;
  marketContextId: string | null;
  openedAt: number | null;
  closedAt: number | null;
}

export interface SpotTimelineEvent {
  timestamp: number;
  type: "ENTRY" | "BREAK_EVEN" | "TRAILING" | "TRAILING_UPDATE" | "EXIT" | "OTHER";
  titleEs: string;
  descriptionEs: string;
  price?: number;
  pnlUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface SpotTradeDetailContext {
  setupTag: string | null;
  regime: string | null;
  direction: string | null;
  macroBias: string | null;
  signalId: string | null;
  marketContextId: string | null;
}

export interface SpotTradeDetailProtections {
  breakEvenActivated: boolean;
  breakEvenActivatedAt: number | null;
  trailingActivated: boolean;
  trailingActivatedAt: number | null;
}

export interface SpotTradeDetail {
  trade: SpotTradeListRow;
  context: SpotTradeDetailContext;
  protections: SpotTradeDetailProtections;
  timeline: SpotTimelineEvent[];
  availability: "FULL_DETAIL" | "PARTIAL_DETAIL" | "BASIC_DETAIL";
}

// ─── R-multiple derivation ───────────────────────────────────────────────────

/**
 * Derive trade R-multiple when risk_usd is not persisted in trades table.
 *
 * Formula: risk_usd = mfe_usd / mfe_r  (when both > 0)
 *          r_trade  = net_pnl_usd / risk_usd
 *
 * Fallback: uses MAE when MFE is zero.
 * Returns null when derivation is not possible — NEVER returns 0 as proxy.
 */
export function deriveRMultiple(
  netPnlUsd: number,
  mfe: number,
  mfeR: number,
  mae: number,
  maeR: number,
): number | null {
  if (mfe > 0 && mfeR > 0) {
    const riskUsd = mfe / mfeR;
    if (riskUsd > 0) return Math.round((netPnlUsd / riskUsd) * 100) / 100;
  }
  if (mae > 0 && maeR > 0) {
    const riskUsd = mae / maeR;
    if (riskUsd > 0) return Math.round((netPnlUsd / riskUsd) * 100) / 100;
  }
  return null;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function enrichRow(r: Record<string, unknown>, openedAtMs: number | null): SpotTradeListRow {
  const entryPrice = safeNum(r.entry_price);
  const amount = safeNum(r.amount);
  const notionalUsd = entryPrice > 0 && amount > 0 ? entryPrice * amount : 0;
  const netPnl = safeNum(r.net_pnl_usd);
  const returnPct = notionalUsd > 0 ? (netPnl / notionalUsd) * 100 : null;
  const mfe = safeNum(r.mfe);
  const mfeR = safeNum(r.mfe_r);
  const mae = safeNum(r.mae);
  const maeR = safeNum(r.mae_r);

  return {
    tradeId: String(r.trade_id ?? ""),
    lotId: String(r.lot_id ?? ""),
    pair: String(r.pair ?? ""),
    side: String(r.type ?? "sell"),
    entryPrice,
    exitPrice: safeNum(r.price),
    amount,
    notionalUsd,
    grossPnl: safeNum(r.gross_pnl_usd),
    netPnl,
    returnPct: returnPct !== null ? Math.round(returnPct * 100) / 100 : null,
    entryFee: safeNum(r.entry_fee_usd),
    exitFee: safeNum(r.exit_fee_usd),
    executionCost: safeNum(r.execution_cost_usd),
    feeQuality: r.fee_quality ? String(r.fee_quality) : null,
    mfe,
    mae,
    mfeR,
    maeR,
    rMultiple: deriveRMultiple(netPnl, mfe, mfeR, mae, maeR),
    profitCapturePct: r.profit_capture_pct !== null && r.profit_capture_pct !== undefined
      ? safeNum(r.profit_capture_pct)
      : null,
    exitReason: r.exit_reason_type ? String(r.exit_reason_type) : null,
    holdTimeMinutes: safeNum(r.hold_time_minutes),
    executionMode: String(r.execution_mode ?? "SHADOW"),
    policyVersion: String(r.policy_version ?? SPOT_POLICY_VERSION),
    setupTag: r.setup_tag ? String(r.setup_tag) : null,
    signalId: r.signal_id ? String(r.signal_id) : null,
    marketContextId: r.market_context_id ? String(r.market_context_id) : null,
    openedAt: openedAtMs,
    closedAt: r.executed_at ? new Date(String(r.executed_at)).getTime() : null,
  };
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(String(raw)) as Record<string, unknown>; } catch { return {}; }
}

function buildTimeline(events: Record<string, unknown>[]): SpotTimelineEvent[] {
  const result: SpotTimelineEvent[] = [];

  for (const ev of events) {
    const meta = parseMeta(ev.meta);
    const timestamp = new Date(String(ev.timestamp)).getTime();
    const decision = String(meta.decision ?? "");
    const reasonCode = String(meta.reasonCode ?? "");
    const price = meta.price ? safeNum(meta.price) : undefined;
    const explanation = String(meta.explanation ?? "");

    switch (ev.type) {
      case "SPOT_ENTRY": {
        result.push({
          timestamp,
          type: "ENTRY",
          titleEs: "Entrada ejecutada",
          descriptionEs: explanation || (price !== undefined ? `Posición abierta a $${price.toFixed(4)}` : "Entrada ejecutada"),
          price,
          metadata: {
            regime: meta.regime,
            direction: meta.direction,
            setupTag: meta.setupTag,
          },
        });
        break;
      }
      case "SPOT_POSITION":
        break;
      case "SPOT_PROTECTION": {
        if (decision === "BE_ACTIVATED" || reasonCode === "PROTECTION_BE_ACTIVATED") {
          result.push({
            timestamp,
            type: "BREAK_EVEN",
            titleEs: "Break-even activado",
            descriptionEs: explanation || "Stop movido a precio de entrada (break-even).",
            price,
          });
        } else if (decision === "TRAILING_ACTIVATED" || reasonCode === "PROTECTION_TRAILING_ACTIVATED") {
          result.push({
            timestamp,
            type: "TRAILING",
            titleEs: "Trailing stop armado",
            descriptionEs: explanation || "Trailing stop activado.",
            price,
          });
        } else if (decision === "TRAILING_UPDATED" || reasonCode === "PROTECTION_TRAILING_UPDATED") {
          result.push({
            timestamp,
            type: "TRAILING_UPDATE",
            titleEs: "Trailing stop actualizado",
            descriptionEs: explanation || "Stop de trailing actualizado.",
            price,
          });
        }
        break;
      }
      case "SPOT_EXIT": {
        const pnlMatch = explanation.match(/PnL=\$([+-]?\d+\.?\d*)/);
        const pnlUsd = pnlMatch ? safeNum(pnlMatch[1]) : undefined;
        result.push({
          timestamp,
          type: "EXIT",
          titleEs: "Posición cerrada",
          descriptionEs: explanation || (price !== undefined ? `Salida a $${price.toFixed(4)}` : "Posición cerrada"),
          price,
          pnlUsd,
          metadata: { reasonCode },
        });
        break;
      }
    }
  }

  return result.sort((a, b) => a.timestamp - b.timestamp);
}

function determineAvailability(
  hasTimeline: boolean,
  hasContext: boolean,
): "FULL_DETAIL" | "PARTIAL_DETAIL" | "BASIC_DETAIL" {
  if (hasTimeline && hasContext) return "FULL_DETAIL";
  if (hasTimeline || hasContext) return "PARTIAL_DETAIL";
  return "BASIC_DETAIL";
}

// ─── getClosedTradesList ─────────────────────────────────────────────────────

/**
 * Returns enriched list of closed SPOT trades.
 * Enriches each trade with:
 *   - openedAt: from bot_events SPOT_ENTRY (one batch query for all)
 *   - notionalUsd: entryPrice * amount
 *   - returnPct: netPnl / notionalUsd * 100
 *   - rMultiple: derived from mfe/mfeR (null if not possible)
 */
export async function getClosedTradesList(limit = 100): Promise<SpotTradeListRow[]> {
  try {
    const tradesResult = await db.execute(sql`
      SELECT
        trade_id, pair, type, price, amount, entry_price,
        gross_pnl_usd, entry_fee_usd, exit_fee_usd, execution_cost_usd,
        net_pnl_usd, fee_quality, mfe, mae, mfe_r, mae_r,
        profit_capture_pct, exit_reason_type, lot_id, hold_time_minutes,
        execution_mode, policy_version, setup_tag, signal_id, market_context_id,
        executed_at
      FROM trades
      WHERE policy_version = ${SPOT_POLICY_VERSION}
      ORDER BY executed_at DESC NULLS LAST
      LIMIT ${limit}
    `);

    const rows = tradesResult.rows as Record<string, unknown>[];
    if (rows.length === 0) return [];

    const lotIds = rows.map((r) => String(r.lot_id ?? "")).filter(Boolean);

    const eventsResult = await db.execute(sql`
      SELECT meta, timestamp
      FROM bot_events
      WHERE type = 'SPOT_ENTRY'
        AND meta::text LIKE '%"lotId":"spot-%'
      ORDER BY timestamp ASC
    `);

    const openedAtMap: Record<string, number> = {};
    for (const ev of eventsResult.rows as Record<string, unknown>[]) {
      const meta = parseMeta(ev.meta);
      const lotId = String(meta.lotId ?? "");
      if (lotId && !openedAtMap[lotId]) {
        openedAtMap[lotId] = new Date(String(ev.timestamp)).getTime();
      }
    }

    return rows.map((r) => {
      const lotId = String(r.lot_id ?? "");
      return enrichRow(r, openedAtMap[lotId] ?? null);
    });
  } catch (error) {
    console.error("[SpotHistoryService] getClosedTradesList failed:", error);
    return [];
  }
}

// ─── getTradeDetail ──────────────────────────────────────────────────────────

/**
 * Returns full detail for a single SPOT trade by lotId.
 * Builds timeline from bot_events.
 * Returns null if trade not found or lotId invalid.
 */
export async function getTradeDetail(lotId: string): Promise<SpotTradeDetail | null> {
  if (!lotId.startsWith("spot-")) return null;

  try {
    const tradeResult = await db.execute(sql`
      SELECT
        trade_id, pair, type, price, amount, entry_price,
        gross_pnl_usd, entry_fee_usd, exit_fee_usd, execution_cost_usd,
        net_pnl_usd, fee_quality, mfe, mae, mfe_r, mae_r,
        profit_capture_pct, exit_reason_type, lot_id, hold_time_minutes,
        execution_mode, policy_version, setup_tag, signal_id, market_context_id,
        executed_at
      FROM trades
      WHERE lot_id = ${lotId}
        AND policy_version = ${SPOT_POLICY_VERSION}
      LIMIT 1
    `);

    if (tradeResult.rows.length === 0) return null;
    const rawTrade = tradeResult.rows[0] as Record<string, unknown>;

    const eventsResult = await db.execute(sql`
      SELECT type, timestamp, meta
      FROM bot_events
      WHERE meta::text LIKE ${"%" + lotId + "%"}
      ORDER BY timestamp ASC
      LIMIT 50
    `);

    const events = eventsResult.rows as Record<string, unknown>[];
    const entryEvent = events.find((e) => e.type === "SPOT_ENTRY");
    const openedAtMs = entryEvent
      ? new Date(String(entryEvent.timestamp)).getTime()
      : null;

    const entryMeta = parseMeta(entryEvent?.meta);

    const protectionEvents = events.filter((e) => e.type === "SPOT_PROTECTION");
    let beEvent: Record<string, unknown> | null = null;
    let trailingEvent: Record<string, unknown> | null = null;
    for (const pe of protectionEvents) {
      const pm = parseMeta(pe.meta);
      if (pm.decision === "BE_ACTIVATED" || pm.reasonCode === "PROTECTION_BE_ACTIVATED") {
        beEvent = pe;
      }
      if (pm.decision === "TRAILING_ACTIVATED" || pm.reasonCode === "PROTECTION_TRAILING_ACTIVATED") {
        trailingEvent = pe;
      }
    }

    const trade = enrichRow(rawTrade, openedAtMs);
    const timeline = buildTimeline(events);
    const hasTimeline = timeline.length > 0;
    const hasContext = !!(entryMeta.regime || entryMeta.direction);

    return {
      trade,
      context: {
        setupTag: (entryMeta.setupTag ?? rawTrade.setup_tag) ? String(entryMeta.setupTag ?? rawTrade.setup_tag) : null,
        regime: entryMeta.regime ? String(entryMeta.regime) : null,
        direction: entryMeta.direction ? String(entryMeta.direction) : null,
        macroBias: entryMeta.macroBias ? String(entryMeta.macroBias) : null,
        signalId: (entryMeta.signalId ?? rawTrade.signal_id) ? String(entryMeta.signalId ?? rawTrade.signal_id) : null,
        marketContextId: (entryMeta.marketContextId ?? rawTrade.market_context_id) ? String(entryMeta.marketContextId ?? rawTrade.market_context_id) : null,
      },
      protections: {
        breakEvenActivated: !!beEvent,
        breakEvenActivatedAt: beEvent ? new Date(String(beEvent.timestamp)).getTime() : null,
        trailingActivated: !!trailingEvent,
        trailingActivatedAt: trailingEvent ? new Date(String(trailingEvent.timestamp)).getTime() : null,
      },
      timeline,
      availability: determineAvailability(hasTimeline, hasContext),
    };
  } catch (error) {
    console.error(`[SpotHistoryService] getTradeDetail(${lotId}) failed:`, error);
    return null;
  }
}
