/**
 * IdcaMessageFormatter — Formatter centralizado que genera mensajes humanos
 * para eventos, Telegram, monitor y logs del módulo Institutional DCA.
 *
 * Recibe event_type, reason_code, payload y contexto, y devuelve:
 *   - humanTitle: título corto en castellano
 *   - humanMessage: explicación clara en 1-2 frases
 *   - technicalSummary: línea compacta con métricas clave
 */

import { getCatalogEntry, getBlockReasonSummary, type HumanMessage } from "./IdcaReasonCatalog";

// ─── Types ──────────────────────────────────────────────────────────

export interface FormatContext {
  eventType: string;
  reasonCode?: string;
  pair?: string;
  mode?: string;
  payload?: Record<string, any>;
  cycleId?: number;
  // Optional enrichment
  price?: number;
  quantity?: number;
  avgEntry?: number;
  entryDipPct?: number;
  entryBasePrice?: number;
  entryBasePriceType?: string;
  marketScore?: number;
  pnlPct?: number;
  pnlUsd?: number;
  tpPct?: number;
  trailingPct?: number;
  capitalUsed?: number;
  buyCount?: number;
  closedCount?: number;
  sizeProfile?: string;
  atrPct?: number;
  highestPrice?: number;
  partialPct?: number;
  oldMode?: string;
  newMode?: string;
  blockReasons?: Array<{ code: string; message: string }>;
  triggerSource?: string;
  durationStr?: string;
  field?: string;
  oldVal?: number;
  newVal?: number;
  reason?: string;
  drawdownPct?: number;
  maxDrawdownPct?: number;
  parentCycleId?: number | null;
  realizedPnl?: number;
  closeReason?: string;
  soloSalida?: boolean;
  sourceType?: string;
  isManualCycle?: boolean;
  exchangeSource?: string;
  estimatedFeePct?: number;
  estimatedFeeUsd?: number;
  // Rich context for Telegram
  maxBuyCount?: number;
  nextBuyPrice?: number;
  nextBuyLevelPct?: number;
  protectionActivationPct?: number;
  trailingActivationPct?: number;
  trailingMarginPct?: number;
  totalCapitalReserved?: number;
  totalFeesUsd?: number;
  protectionArmed?: boolean;
  trailingActive?: boolean;
  stopPrice?: number;
  prevAvgEntry?: number;
}

// ─── Multi-block composition (entry_check_blocked) ──────────────────

const BLOCK_PRIORITY: Record<string, number> = {
  insufficient_dip: 1,
  market_score_too_low: 2,
  no_rebound_confirmed: 3,
  btc_breakdown_blocks_eth: 4,
  module_exposure_max_reached: 5,
  insufficient_simulation_balance: 6,
  insufficient_base_price_data: 7,
  data_not_ready: 8,
  cycle_already_active: 9,
  pair_not_allowed: 10,
};

const BLOCK_SHORT_NAMES: Record<string, string> = {
  insufficient_dip: "caída insuficiente",
  market_score_too_low: "score bajo",
  no_rebound_confirmed: "falta rebote confirmado",
  btc_breakdown_blocks_eth: "caída de BTC",
  module_exposure_max_reached: "exposición máxima del módulo",
  insufficient_simulation_balance: "saldo de simulación insuficiente",
  insufficient_base_price_data: "datos de precio insuficientes",
  data_not_ready: "datos no disponibles",
  cycle_already_active: "ciclo ya activo",
  pair_not_allowed: "par no permitido",
};

function extractDipInfo(msg: string): { dip?: string; min?: string } {
  const dip = msg.match(/EntryDip\s*([\d.-]+)%/)?.[1];
  const min = msg.match(/min\s*([\d.-]+)%/)?.[1];
  return { dip, min };
}

function extractScoreInfo(msg: string): { score?: string; minScore?: string } {
  const score = msg.match(/Score\s*(\d+)/)?.[1];
  const minScore = msg.match(/<\s*(\d+)/)?.[1];
  return { score, minScore };
}

function composeBlockedEntryHuman(
  reasons: Array<{ code: string; message: string }>,
  pair: string
): { humanTitle: string; humanMessage: string } {
  // Sort by priority (lower number = more important)
  const sorted = [...reasons].sort(
    (a, b) => (BLOCK_PRIORITY[a.code] ?? 99) - (BLOCK_PRIORITY[b.code] ?? 99)
  );

  const n = sorted.length;
  const primary = sorted[0];
  const secondary = sorted[1];

  // ── CASO 1: un único bloqueo ─────────────────────────────────────
  if (n === 1) {
    const entry = getCatalogEntry(primary.code);
    return {
      humanTitle: entry.humanTitle,
      humanMessage: entry.humanTemplate.replace(/\{pair\}/g, pair),
    };
  }

  // ── CASO 2: dos bloqueos — mensaje compuesto con datos extraídos ─
  if (n === 2) {
    const name1 = BLOCK_SHORT_NAMES[primary.code] ?? primary.code.replace(/_/g, " ");
    const name2 = BLOCK_SHORT_NAMES[secondary.code] ?? secondary.code.replace(/_/g, " ");
    const humanTitle = `Entrada bloqueada por ${name1} y ${name2}`;

    // Build enriched message fragment for each block
    const parts: string[] = [];

    for (const r of [primary, secondary]) {
      if (r.code === "insufficient_dip") {
        const { dip, min } = extractDipInfo(r.message);
        if (dip != null && min != null) {
          const dipNum = parseFloat(dip);
          if (dipNum < 0) {
            parts.push(`el precio está un ${Math.abs(dipNum).toFixed(2)}% por encima del ancla (mínimo caída ${min}%)`);
          } else {
            parts.push(`la caída fue del ${dip}% (mínimo ${min}%)`);
          }
        } else {
          parts.push("la caída desde el precio base fue insuficiente");
        }
      } else if (r.code === "market_score_too_low") {
        const { score, minScore } = extractScoreInfo(r.message);
        if (score != null && minScore != null) {
          parts.push(`el market score fue ${score} (mínimo ${minScore})`);
        } else {
          parts.push("el score de mercado fue demasiado bajo");
        }
      } else if (r.code === "no_rebound_confirmed") {
        parts.push("no se confirmó rebote técnico");
      } else if (r.code === "btc_breakdown_blocks_eth") {
        parts.push("BTC está en caída fuerte");
      } else {
        parts.push(BLOCK_SHORT_NAMES[r.code] ?? r.code.replace(/_/g, " "));
      }
    }

    const humanMessage = `No se compró ${pair} porque ${parts.join(" y además ")}.`;
    return { humanTitle, humanMessage };
  }

  // ── CASO 3+: tres o más bloqueos — resumen compacto ─────────────
  const name1 = BLOCK_SHORT_NAMES[primary.code] ?? primary.code.replace(/_/g, " ");
  const name2 = secondary ? (BLOCK_SHORT_NAMES[secondary.code] ?? secondary.code.replace(/_/g, " ")) : undefined;

  const humanTitle = "Entrada bloqueada por varios filtros";
  const humanMessage = name2
    ? `No se compró ${pair} por ${name1}, ${name2} y otros filtros adicionales.`
    : `No se compró ${pair} por ${name1} y otros filtros adicionales.`;

  return { humanTitle, humanMessage };
}

// ─── Core Formatter ─────────────────────────────────────────────────

export function formatIdcaMessage(ctx: FormatContext): HumanMessage {
  const entry = getCatalogEntry(ctx.reasonCode || ctx.eventType);
  const pair = ctx.pair || "—";
  const mode = ctx.mode?.toUpperCase() || "—";

  // Build humanTitle / humanMessage
  let humanTitle = entry.humanTitle;
  let humanMessage = entry.humanTemplate.replace(/\{pair\}/g, pair);

  // entry_check_blocked: compose multi-block human text
  if (ctx.eventType === "entry_check_blocked" && ctx.blockReasons && ctx.blockReasons.length > 0) {
    const composed = composeBlockedEntryHuman(ctx.blockReasons, pair);
    humanTitle = composed.humanTitle;
    humanMessage = composed.humanMessage;
  }

  // Handle block details placeholder (buy_blocked and other events that use {blockDetail})
  if (humanMessage.includes("{blockDetail}")) {
    if (ctx.blockReasons && ctx.blockReasons.length > 0) {
      const blockSummaries = ctx.blockReasons.map(r => getBlockReasonSummary(r.code, ctx.pair));
      humanMessage = humanMessage.replace(/\{blockDetail\}/g, blockSummaries.join(", "));
    } else if (ctx.reasonCode) {
      humanMessage = humanMessage.replace(/\{blockDetail\}/g, getBlockReasonSummary(ctx.reasonCode, ctx.pair));
    } else {
      humanMessage = humanMessage.replace(/\{blockDetail\}/g, "no se cumplieron las condiciones necesarias");
    }
  }

  // Handle close detail
  if (ctx.eventType === "cycle_closed" || ctx.eventType === "trailing_exit" || ctx.eventType === "breakeven_exit") {
    const closeReason = ctx.reasonCode || ctx.eventType;
    const closeEntry = getCatalogEntry(closeReason);
    humanMessage = humanMessage.replace(/\{closeDetail\}/g, closeEntry.humanTemplate.replace(/\{pair\}/g, pair));
  } else {
    humanMessage = humanMessage.replace(/\{closeDetail\}/g, "");
  }

  // Build technicalSummary
  const techParts: string[] = [];
  if (ctx.pair) techParts.push(`Par=${ctx.pair}`);
  if (ctx.mode) techParts.push(`Modo=${mode}`);

  // Event-specific tech details
  switch (ctx.eventType) {
    case "entry_check_passed":
    case "entry_check_blocked":
      if (ctx.entryBasePrice != null) techParts.push(`BasePrice=${fmtNum(ctx.entryBasePrice)}`);
      if (ctx.entryBasePriceType) techParts.push(`BaseType=${ctx.entryBasePriceType}`);
      if (ctx.entryDipPct != null) techParts.push(`EntryDip=${ctx.entryDipPct.toFixed(2)}%`);
      if (ctx.marketScore != null) techParts.push(`Score=${ctx.marketScore}`);
      if (ctx.sizeProfile) techParts.push(`Perfil=${ctx.sizeProfile}`);
      if (ctx.blockReasons) {
        techParts.push(`Bloqueos=${ctx.blockReasons.map(r => r.code).join(",")}`);
      }
      break;

    case "cycle_started":
    case "base_buy_executed":
      if (ctx.price != null) techParts.push(`Precio=${fmtNum(ctx.price)}`);
      if (ctx.quantity != null) techParts.push(`Qty=${ctx.quantity.toFixed(6)}`);
      if (ctx.capitalUsed != null) techParts.push(`Capital=$${ctx.capitalUsed.toFixed(2)}`);
      if (ctx.entryBasePrice != null) techParts.push(`BasePrice=${fmtNum(ctx.entryBasePrice)}`);
      if (ctx.entryBasePriceType) techParts.push(`BaseType=${ctx.entryBasePriceType}`);
      if (ctx.entryDipPct != null) techParts.push(`EntryDip=${ctx.entryDipPct.toFixed(2)}%`);
      if (ctx.marketScore != null) techParts.push(`Score=${ctx.marketScore}`);
      if (ctx.buyCount != null) techParts.push(`Compra=#${ctx.buyCount}`);
      if (ctx.sizeProfile) techParts.push(`Perfil=${ctx.sizeProfile}`);
      break;

    case "safety_buy_executed":
      if (ctx.price != null) techParts.push(`Precio=${fmtNum(ctx.price)}`);
      if (ctx.quantity != null) techParts.push(`Qty=${ctx.quantity.toFixed(6)}`);
      if (ctx.avgEntry != null) techParts.push(`AvgNuevo=${fmtNum(ctx.avgEntry)}`);
      if (ctx.capitalUsed != null) techParts.push(`Capital=$${ctx.capitalUsed.toFixed(2)}`);
      if (ctx.buyCount != null) techParts.push(`Compra=#${ctx.buyCount}`);
      break;

    case "tp_armed":
    case "partial_sell_executed":
      if (ctx.pnlPct != null) techParts.push(`PnL=${ctx.pnlPct >= 0 ? "+" : ""}${ctx.pnlPct.toFixed(2)}%`);
      if (ctx.tpPct != null) techParts.push(`TP=${ctx.tpPct.toFixed(1)}%`);
      if (ctx.trailingPct != null) techParts.push(`Trailing=${ctx.trailingPct.toFixed(2)}%`);
      if (ctx.partialPct != null) techParts.push(`VentaParcial=${ctx.partialPct.toFixed(0)}%`);
      if (ctx.avgEntry != null) techParts.push(`Avg=${fmtNum(ctx.avgEntry)}`);
      if (ctx.price != null) techParts.push(`Precio=${fmtNum(ctx.price)}`);
      break;

    case "trailing_exit":
      if (ctx.price != null) techParts.push(`Close=${fmtNum(ctx.price)}`);
      if (ctx.pnlPct != null) techParts.push(`PnL=${ctx.pnlPct >= 0 ? "+" : ""}${ctx.pnlPct.toFixed(2)}%`);
      if (ctx.pnlUsd != null) techParts.push(`Resultado=$${ctx.pnlUsd.toFixed(2)}`);
      if (ctx.buyCount != null) techParts.push(`Compras=${ctx.buyCount}`);
      if (ctx.durationStr) techParts.push(`Duración=${ctx.durationStr}`);
      break;

    case "breakeven_exit":
      if (ctx.price != null) techParts.push(`Close=${fmtNum(ctx.price)}`);
      if (ctx.quantity != null) techParts.push(`Qty=${ctx.quantity.toFixed(6)}`);
      if (ctx.buyCount != null) techParts.push(`Compras=${ctx.buyCount}`);
      break;

    case "emergency_close_all":
      if (ctx.closedCount != null) techParts.push(`CiclosCerrados=${ctx.closedCount}`);
      if (ctx.triggerSource) techParts.push(`Trigger=${ctx.triggerSource}`);
      break;

    case "mode_transition":
      if (ctx.oldMode) techParts.push(`Anterior=${ctx.oldMode}`);
      if (ctx.newMode) techParts.push(`Nuevo=${ctx.newMode}`);
      break;

    case "buy_blocked":
      if (ctx.reasonCode) techParts.push(`Motivo=${ctx.reasonCode}`);
      if (ctx.pnlPct != null) techParts.push(`PnL=${ctx.pnlPct.toFixed(2)}%`);
      if (ctx.buyCount != null) techParts.push(`Compras=${ctx.buyCount}`);
      break;

    case "smart_adjustment_applied":
      if (ctx.field) techParts.push(`Campo=${ctx.field}`);
      if (ctx.oldVal != null) techParts.push(`Antes=${ctx.oldVal}`);
      if (ctx.newVal != null) techParts.push(`Después=${ctx.newVal}`);
      if (ctx.reason) techParts.push(`Razón=${ctx.reason}`);
      break;

    case "cycle_management":
      if (ctx.price != null) techParts.push(`Precio=${fmtNum(ctx.price)}`);
      if (ctx.avgEntry != null) techParts.push(`AvgEntry=${fmtNum(ctx.avgEntry)}`);
      if (ctx.pnlPct != null) techParts.push(`PnL=${ctx.pnlPct >= 0 ? "+" : ""}${ctx.pnlPct.toFixed(2)}%`);
      if (ctx.pnlUsd != null) techParts.push(`PnL$=${ctx.pnlUsd >= 0 ? "+" : ""}${ctx.pnlUsd.toFixed(2)}`);
      if (ctx.drawdownPct != null) techParts.push(`MaxDD=${ctx.drawdownPct.toFixed(2)}%`);
      if (ctx.quantity != null) techParts.push(`Qty=${ctx.quantity.toFixed(6)}`);
      if (ctx.capitalUsed != null) techParts.push(`Capital=$${ctx.capitalUsed.toFixed(2)}`);
      if (ctx.buyCount != null) techParts.push(`Compras=${ctx.buyCount}`);
      if (ctx.reason) techParts.push(`Estado=${ctx.reason}`);
      break;

    case "module_max_drawdown_reached":
      if (ctx.drawdownPct != null) techParts.push(`DD=${ctx.drawdownPct.toFixed(2)}%`);
      if (ctx.maxDrawdownPct != null) techParts.push(`Límite=${ctx.maxDrawdownPct.toFixed(2)}%`);
      break;

    case "plus_cycle_activated":
      if (ctx.price != null) techParts.push(`Precio=${fmtNum(ctx.price)}`);
      if (ctx.quantity != null) techParts.push(`Qty=${ctx.quantity.toFixed(6)}`);
      if (ctx.entryDipPct != null) techParts.push(`DipDesdeMain=${ctx.entryDipPct.toFixed(2)}%`);
      if (ctx.parentCycleId != null) techParts.push(`Parent=#${ctx.parentCycleId}`);
      if (ctx.tpPct != null) techParts.push(`TP=${ctx.tpPct.toFixed(1)}%`);
      break;

    case "plus_safety_buy_executed":
      if (ctx.price != null) techParts.push(`Precio=${fmtNum(ctx.price)}`);
      if (ctx.quantity != null) techParts.push(`Qty=${ctx.quantity.toFixed(6)}`);
      if (ctx.avgEntry != null) techParts.push(`AvgNuevo=${fmtNum(ctx.avgEntry)}`);
      if (ctx.capitalUsed != null) techParts.push(`Capital=$${ctx.capitalUsed.toFixed(2)}`);
      if (ctx.buyCount != null) techParts.push(`Compra=#${ctx.buyCount}`);
      break;

    case "plus_cycle_closed":
      if (ctx.price != null) techParts.push(`Close=${fmtNum(ctx.price)}`);
      if (ctx.realizedPnl != null) techParts.push(`PnL=$${ctx.realizedPnl.toFixed(2)}`);
      if (ctx.closeReason) techParts.push(`Motivo=${ctx.closeReason}`);
      if (ctx.parentCycleId != null) techParts.push(`Parent=#${ctx.parentCycleId}`);
      break;

    case "imported_position_created":
      if (ctx.price != null) techParts.push(`AvgEntry=${fmtNum(ctx.price)}`);
      if (ctx.quantity != null) techParts.push(`Qty=${ctx.quantity.toFixed(6)}`);
      if (ctx.capitalUsed != null) techParts.push(`Capital=$${ctx.capitalUsed.toFixed(2)}`);
      if (ctx.soloSalida != null) techParts.push(`SoloSalida=${ctx.soloSalida}`);
      if (ctx.sourceType) techParts.push(`Origen=${ctx.sourceType}`);
      if (ctx.isManualCycle) techParts.push(`Manual=sí`);
      if (ctx.exchangeSource) techParts.push(`Exchange=${ctx.exchangeSource}`);
      if (ctx.estimatedFeePct != null) techParts.push(`Fee=${ctx.estimatedFeePct}%`);
      if (ctx.estimatedFeeUsd != null) techParts.push(`FeeUSD=$${ctx.estimatedFeeUsd.toFixed(2)}`);
      break;

    case "imported_position_closed":
      if (ctx.price != null) techParts.push(`Close=${fmtNum(ctx.price)}`);
      if (ctx.realizedPnl != null) techParts.push(`PnL=$${ctx.realizedPnl.toFixed(2)}`);
      if (ctx.pnlPct != null) techParts.push(`PnL%=${ctx.pnlPct >= 0 ? "+" : ""}${ctx.pnlPct.toFixed(2)}%`);
      if (ctx.closeReason) techParts.push(`Motivo=${ctx.closeReason}`);
      if (ctx.durationStr) techParts.push(`Duración=${ctx.durationStr}`);
      break;

    case "recovery_cycle_eligible":
      if (ctx.drawdownPct != null) techParts.push(`DD=${ctx.drawdownPct.toFixed(1)}%`);
      if (ctx.capitalUsed != null) techParts.push(`RecoveryCapital=$${ctx.capitalUsed.toFixed(0)}`);
      if (ctx.pnlPct != null) techParts.push(`MainPnL=${ctx.pnlPct.toFixed(2)}%`);
      if (ctx.parentCycleId != null) techParts.push(`Main=#${ctx.parentCycleId}`);
      break;

    case "recovery_cycle_started":
      if (ctx.price != null) techParts.push(`Precio=${fmtNum(ctx.price)}`);
      if (ctx.quantity != null) techParts.push(`Qty=${ctx.quantity.toFixed(6)}`);
      if (ctx.tpPct != null) techParts.push(`TP=${ctx.tpPct.toFixed(1)}%`);
      if (ctx.drawdownPct != null) techParts.push(`MainDD=${ctx.drawdownPct.toFixed(1)}%`);
      if (ctx.capitalUsed != null) techParts.push(`Capital=$${ctx.capitalUsed.toFixed(2)}`);
      if (ctx.parentCycleId != null) techParts.push(`Main=#${ctx.parentCycleId}`);
      break;

    case "recovery_cycle_blocked":
      if (ctx.drawdownPct != null) techParts.push(`DD=${ctx.drawdownPct.toFixed(1)}%`);
      if (ctx.parentCycleId != null) techParts.push(`Main=#${ctx.parentCycleId}`);
      if (ctx.reason) techParts.push(`Motivo=${ctx.reason}`);
      break;

    case "recovery_cycle_closed":
      if (ctx.pnlPct != null) techParts.push(`PnL=${ctx.pnlPct >= 0 ? "+" : ""}${ctx.pnlPct.toFixed(2)}%`);
      if (ctx.pnlUsd != null) techParts.push(`PnL$=${ctx.pnlUsd >= 0 ? "+" : ""}${ctx.pnlUsd.toFixed(2)}`);
      if (ctx.closeReason) techParts.push(`Motivo=${ctx.closeReason}`);
      if (ctx.durationStr) techParts.push(`Duración=${ctx.durationStr}`);
      if (ctx.buyCount != null) techParts.push(`Compras=${ctx.buyCount}`);
      if (ctx.parentCycleId != null) techParts.push(`Main=#${ctx.parentCycleId}`);
      break;

    case "recovery_cycle_risk_warning":
      if (ctx.capitalUsed != null) techParts.push(`Exposición=$${ctx.capitalUsed.toFixed(0)}`);
      if (ctx.parentCycleId != null) techParts.push(`Main=#${ctx.parentCycleId}`);
      if (ctx.reason) techParts.push(`${ctx.reason}`);
      break;

    default:
      // Include any payload keys as tech details
      if (ctx.payload) {
        for (const [k, v] of Object.entries(ctx.payload)) {
          if (typeof v === "number") {
            techParts.push(`${k}=${v}`);
          } else if (typeof v === "string" && v.length < 50) {
            techParts.push(`${k}=${v}`);
          }
        }
      }
      break;
  }

  const technicalSummary = techParts.join(" | ");

  return { humanTitle, humanMessage, technicalSummary };
}

// ─── Telegram Formatter ─────────────────────────────────────────────

export function formatTelegramMessage(ctx: FormatContext): string {
  const sim = ctx.mode === "simulation";
  const modeTag = sim ? "🧪 SIM" : "🟢 LIVE";
  const pair = ctx.pair || "—";

  switch (ctx.eventType) {

    // ═══ CYCLE STARTED / BASE BUY ═══
    case "cycle_started":
    case "base_buy_executed": {
      const lines = [
        `🚀 <b>IDCA — Nuevo ciclo iniciado</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
        `💵 Precio: <b>$${fmtNum(ctx.price || 0)}</b>`,
      ];
      if (ctx.quantity) lines.push(`📊 Cantidad: <code>${ctx.quantity.toFixed(6)}</code> (~$${fmtNum((ctx.quantity || 0) * (ctx.price || 0))})`);
      if (ctx.entryDipPct != null && ctx.entryBasePrice != null) {
        lines.push(`📉 Dip detectado: <code>-${ctx.entryDipPct.toFixed(2)}%</code> desde base <code>$${fmtNum(ctx.entryBasePrice)}</code> (${ctx.entryBasePriceType || "hybrid"})`);
      } else if (ctx.entryDipPct != null) {
        lines.push(`📉 Dip detectado: <code>-${ctx.entryDipPct.toFixed(2)}%</code>`);
      }
      if (ctx.marketScore != null) lines.push(`🧠 Score mercado: <code>${ctx.marketScore}</code>`);
      if (ctx.capitalUsed != null && ctx.totalCapitalReserved) {
        lines.push(`💰 Capital: <code>$${fmtNum(ctx.capitalUsed)}</code> de <code>$${fmtNum(ctx.totalCapitalReserved)}</code>`);
      } else if (ctx.capitalUsed != null) {
        lines.push(`💰 Capital usado: <code>$${fmtNum(ctx.capitalUsed)}</code>`);
      }
      if (ctx.sizeProfile) lines.push(`📐 Perfil: <code>${ctx.sizeProfile}</code>`);

      // Cycle roadmap
      lines.push(``, `📍 <b>Hoja de ruta:</b>`);
      if (ctx.maxBuyCount != null) lines.push(`• Compras disponibles: ${ctx.maxBuyCount}`);
      if (ctx.nextBuyPrice) lines.push(`• Próxima compra: <code>$${fmtNum(ctx.nextBuyPrice)}</code>${ctx.nextBuyLevelPct ? ` (-${ctx.nextBuyLevelPct.toFixed(1)}%)` : ""}`);
      if (ctx.protectionActivationPct != null) lines.push(`• 🛡 Protección arma a: <code>+${ctx.protectionActivationPct.toFixed(1)}%</code>`);
      if (ctx.trailingActivationPct != null) lines.push(`• 🎯 Trailing activa a: <code>+${ctx.trailingActivationPct.toFixed(1)}%</code>`);

      lines.push(``, `💡 El sistema detectó una caída válida y abrió posición.`);
      return lines.join("\n");
    }

    // ═══ SAFETY BUY ═══
    case "safety_buy_executed": {
      const remaining = (ctx.maxBuyCount != null && ctx.buyCount != null) ? ctx.maxBuyCount - ctx.buyCount : null;
      const avgImproved = (ctx.prevAvgEntry && ctx.avgEntry && ctx.prevAvgEntry > ctx.avgEntry);
      const improvePct = avgImproved ? ((ctx.prevAvgEntry! - ctx.avgEntry!) / ctx.prevAvgEntry! * 100) : 0;

      const lines = [
        `📦 <b>IDCA — Compra adicional #${ctx.buyCount || "?"}</b>${ctx.maxBuyCount ? ` de ${ctx.maxBuyCount}` : ""}`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
        `💵 Precio: <b>$${fmtNum(ctx.price || 0)}</b>`,
      ];
      if (ctx.quantity) lines.push(`📊 Cantidad: <code>${ctx.quantity.toFixed(6)}</code> (~$${fmtNum((ctx.quantity || 0) * (ctx.price || 0))})`);
      if (ctx.avgEntry != null) lines.push(`💰 Precio medio: <b>$${fmtNum(ctx.avgEntry)}</b>${avgImproved ? ` (mejoró -${improvePct.toFixed(1)}%)` : ""}`);
      if (ctx.capitalUsed != null && ctx.totalCapitalReserved) {
        lines.push(`💰 Capital: <code>$${fmtNum(ctx.capitalUsed)}</code> de <code>$${fmtNum(ctx.totalCapitalReserved)}</code>`);
      } else if (ctx.capitalUsed != null) {
        lines.push(`💰 Capital acumulado: <code>$${fmtNum(ctx.capitalUsed)}</code>`);
      }

      // Cycle status
      lines.push(``, `📍 <b>Estado del ciclo:</b>`);
      if (remaining != null) {
        lines.push(`• Compras: ${ctx.buyCount} de ${ctx.maxBuyCount}${remaining === 0 ? " ⚠️ <b>última compra</b>" : ` (quedan ${remaining})`}`);
      }
      if (ctx.nextBuyPrice && remaining && remaining > 0) {
        lines.push(`• Próxima compra: <code>$${fmtNum(ctx.nextBuyPrice)}</code>${ctx.nextBuyLevelPct ? ` (-${ctx.nextBuyLevelPct.toFixed(1)}%)` : ""}`);
      }
      if (ctx.protectionArmed) {
        lines.push(`• 🛡 Protección: <b>ARMADA</b>`);
      } else if (ctx.protectionActivationPct != null && ctx.avgEntry) {
        const protPrice = ctx.avgEntry * (1 + ctx.protectionActivationPct / 100);
        lines.push(`• 🛡 Protección arma a: <code>$${fmtNum(protPrice)}</code> (+${ctx.protectionActivationPct.toFixed(1)}%)`);
      }
      if (ctx.trailingActivationPct != null && ctx.avgEntry) {
        const trailPrice = ctx.avgEntry * (1 + ctx.trailingActivationPct / 100);
        lines.push(`• 🎯 Trailing activa a: <code>$${fmtNum(trailPrice)}</code> (+${ctx.trailingActivationPct.toFixed(1)}%)`);
      }

      // Smart comment
      const comments: string[] = [];
      if (avgImproved && improvePct > 1) comments.push(`Esta compra bajó el promedio un ${improvePct.toFixed(1)}%, mejorando la posición.`);
      if (remaining === 0) comments.push(`Ya no quedan compras disponibles. El ciclo espera recuperación.`);
      if (remaining != null && remaining === 1) comments.push(`Queda una sola compra más disponible.`);
      if (comments.length > 0) lines.push(``, `💡 ${comments.join(" ")}`);

      return lines.join("\n");
    }

    // ═══ PROTECTION ARMED ═══
    case "protection_armed": {
      const lines = [
        `🛡️ <b>IDCA — Protección armada</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
        `📈 PnL actual: <code>+${(ctx.pnlPct || 0).toFixed(2)}%</code>`,
        `💰 Precio medio: <code>$${fmtNum(ctx.avgEntry || 0)}</code>`,
        `📍 Precio actual: <code>$${fmtNum(ctx.price || 0)}</code>`,
        `🔒 Stop protección: <code>$${fmtNum(ctx.stopPrice || ctx.avgEntry || 0)}</code>`,
      ];
      if (ctx.trailingActivationPct != null && ctx.avgEntry) {
        const trailPrice = ctx.avgEntry * (1 + ctx.trailingActivationPct / 100);
        lines.push(``, `📍 <b>Siguiente paso:</b>`);
        lines.push(`• 🎯 Trailing activa a: <code>$${fmtNum(trailPrice)}</code> (+${ctx.trailingActivationPct.toFixed(1)}%)`);
      }
      lines.push(``, `💡 El ciclo está protegido. Si el precio cae al stop, se cierra en break-even. Si sigue subiendo, se activará el trailing.`);
      return lines.join("\n");
    }

    // ═══ TRAILING ACTIVATED ═══
    case "trailing_activated": {
      const lines = [
        `🎯 <b>IDCA — Trailing activado</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
        `📈 PnL actual: <code>+${(ctx.pnlPct || 0).toFixed(2)}%</code>`,
        `💰 Precio medio: <code>$${fmtNum(ctx.avgEntry || 0)}</code>`,
        `📍 Precio actual: <code>$${fmtNum(ctx.price || 0)}</code>`,
        `📐 Margen trailing: <code>${(ctx.trailingPct || ctx.trailingMarginPct || 0).toFixed(2)}%</code>`,
      ];
      lines.push(``, `💡 Dejando correr beneficios. El sistema seguirá el precio y cerrará cuando retroceda el margen configurado.`);
      return lines.join("\n");
    }

    // ═══ TP ARMED (legacy partial sell) ═══
    case "tp_armed": {
      const lines = [
        `🎯 <b>IDCA — Take Profit alcanzado</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
      ];
      if (ctx.avgEntry != null) lines.push(`💰 Precio medio: <code>$${fmtNum(ctx.avgEntry)}</code>`);
      if (ctx.price != null) lines.push(`📍 Precio actual: <code>$${fmtNum(ctx.price)}</code>`);
      if (ctx.pnlPct != null) lines.push(`📈 PnL: <code>${ctx.pnlPct >= 0 ? "+" : ""}${ctx.pnlPct.toFixed(2)}%</code>`);
      if (ctx.partialPct != null) lines.push(`📤 Venta parcial: <code>${ctx.partialPct.toFixed(0)}%</code>`);
      if (ctx.trailingPct != null) lines.push(`📐 Trailing: <code>${ctx.trailingPct.toFixed(2)}%</code>`);
      lines.push(``, `💡 Se vendió una parte y el sistema vigila el resto con trailing stop.`);
      return lines.join("\n");
    }

    // ═══ TRAILING EXIT ═══
    case "trailing_exit": {
      const pnlUsd = ctx.pnlUsd || 0;
      const pnlPct = ctx.pnlPct || 0;
      const isProfit = pnlUsd > 1;
      const isLoss = pnlUsd < -1;
      const icon = isProfit ? "✅" : isLoss ? "🔴" : "⚖️";
      const resultLabel = isProfit ? "con beneficio" : isLoss ? "con pérdida" : "en break-even";

      const lines = [
        `${icon} <b>IDCA — Ciclo cerrado ${resultLabel}</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
      ];
      if (ctx.price != null) lines.push(`📍 Precio cierre: <code>$${fmtNum(ctx.price)}</code>`);
      if (ctx.avgEntry != null) lines.push(`💰 Precio medio: <code>$${fmtNum(ctx.avgEntry)}</code>`);
      if (ctx.capitalUsed != null) lines.push(`💰 Capital invertido: <code>$${fmtNum(ctx.capitalUsed)}</code>`);

      lines.push(``, `📈 <b>Resultado:</b>`);
      if (ctx.totalFeesUsd != null && ctx.totalFeesUsd > 0) {
        const gross = pnlUsd + ctx.totalFeesUsd;
        lines.push(`• Bruto: <code>${gross >= 0 ? "+" : ""}$${fmtNum(gross)}</code>`);
        lines.push(`• Fees: <code>-$${fmtNum(ctx.totalFeesUsd)}</code>`);
      }
      lines.push(`• Neto: <b>${pnlUsd >= 0 ? "+" : ""}$${fmtNum(pnlUsd)}</b> (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)`);

      lines.push(``, `📋 <b>Resumen:</b>`);
      if (ctx.buyCount != null) lines.push(`• Compras: ${ctx.buyCount}`);
      if (ctx.durationStr) lines.push(`• Duración: ${ctx.durationStr}`);
      lines.push(`• Motivo: trailing stop activado`);

      // Smart comment
      if (isProfit && pnlPct > 3) {
        lines.push(``, `💡 Excelente captura de beneficio. El trailing protegió la ganancia correctamente.`);
      } else if (isProfit) {
        lines.push(``, `💡 Beneficio asegurado. El trailing cerró al detectar retroceso.`);
      } else if (isLoss) {
        lines.push(``, `💡 El trailing cerró con pérdida. La protección no alcanzó a cubrir la caída.`);
      } else {
        lines.push(``, `💡 Cierre neutro. El capital se recuperó pero sin beneficio significativo.`);
      }
      return lines.join("\n");
    }

    // ═══ BREAKEVEN EXIT ═══
    case "breakeven_exit": {
      const lines = [
        `🛡️ <b>IDCA — Ciclo cerrado en break-even</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
      ];
      if (ctx.price != null) lines.push(`📍 Precio cierre: <code>$${fmtNum(ctx.price)}</code>`);
      if (ctx.avgEntry != null) lines.push(`💰 Precio medio: <code>$${fmtNum(ctx.avgEntry)}</code>`);
      if (ctx.capitalUsed != null) lines.push(`💰 Capital invertido: <code>$${fmtNum(ctx.capitalUsed)}</code>`);

      if (ctx.pnlUsd != null || ctx.totalFeesUsd != null) {
        lines.push(``, `📈 <b>Resultado:</b>`);
        if (ctx.pnlUsd != null) lines.push(`• PnL neto: <code>~$${fmtNum(ctx.pnlUsd || 0)}</code> (break-even)`);
        if (ctx.totalFeesUsd != null && ctx.totalFeesUsd > 0) lines.push(`• Fees: <code>-$${fmtNum(ctx.totalFeesUsd)}</code>`);
      }

      lines.push(``, `📋 <b>Resumen:</b>`);
      if (ctx.buyCount != null) lines.push(`• Compras: ${ctx.buyCount}`);
      if (ctx.durationStr) lines.push(`• Duración: ${ctx.durationStr}`);
      lines.push(`• Motivo: protección activada (stop en break-even)`);
      lines.push(``, `💡 El capital fue protegido. El precio cayó al stop de break-even tras armar la protección.`);
      return lines.join("\n");
    }

    // ═══ EMERGENCY CLOSE ═══
    case "emergency_close_all": {
      const lines = [
        `🚨 <b>IDCA — Cierre de emergencia</b>`,
        ``,
        `[${modeTag}]`,
      ];
      if (ctx.closedCount != null) lines.push(`⚠️ Ciclos cerrados: <b>${ctx.closedCount}</b>`);
      lines.push(`🔒 Trigger: ${ctx.triggerSource || "manual"}`);
      lines.push(`⏱ ${new Date().toISOString()}`);
      lines.push(``, `💡 Se ordenó cierre inmediato de todos los ciclos activos.`);
      return lines.join("\n");
    }

    // ═══ BUY BLOCKED ═══
    case "entry_check_blocked":
    case "buy_blocked": {
      const entry = getCatalogEntry(ctx.reasonCode || ctx.eventType);
      const lines = [
        `⛔ <b>IDCA — Compra bloqueada</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
      ];
      if (ctx.blockReasons && ctx.blockReasons.length > 0) {
        lines.push(``, `🚫 <b>Motivos:</b>`);
        for (const r of ctx.blockReasons) {
          const be = getCatalogEntry(r.code);
          lines.push(`• ${be.emoji} ${be.humanTitle}`);
        }
      } else if (ctx.reasonCode) {
        lines.push(`🚫 Motivo: ${entry.humanTitle}`);
      }
      if (ctx.entryDipPct != null && ctx.entryBasePrice != null) {
        lines.push(`📉 Dip: <code>${ctx.entryDipPct.toFixed(2)}%</code> desde base <code>$${fmtNum(ctx.entryBasePrice)}</code>`);
      } else if (ctx.entryDipPct != null) {
        lines.push(`📉 Dip: <code>${ctx.entryDipPct.toFixed(2)}%</code>`);
      }
      if (ctx.pnlPct != null) lines.push(`📊 PnL: <code>${ctx.pnlPct.toFixed(2)}%</code>`);
      if (ctx.buyCount != null) lines.push(`📦 Compras actuales: ${ctx.buyCount}`);
      return lines.join("\n");
    }

    // ═══ SMART ADJUSTMENT ═══
    case "smart_adjustment_applied": {
      const lines = [
        `🧠 <b>IDCA — Ajuste inteligente</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
      ];
      if (ctx.field) lines.push(`🔧 Cambio: <code>${ctx.field}</code> ${ctx.oldVal} → <b>${ctx.newVal}</b>`);
      if (ctx.reason) lines.push(`📝 Motivo: ${escapeHtml(ctx.reason)}`);
      lines.push(``, `💡 El sistema ajustó un parámetro basándose en las condiciones actuales.`);
      return lines.join("\n");
    }

    // ═══ MODULE DRAWDOWN ═══
    case "module_max_drawdown_reached": {
      const lines = [
        `🔴 <b>IDCA — Drawdown máximo alcanzado</b>`,
        ``,
        `[${modeTag}]`,
      ];
      if (ctx.drawdownPct != null) lines.push(`📉 Drawdown actual: <code>-${ctx.drawdownPct.toFixed(2)}%</code>`);
      if (ctx.maxDrawdownPct != null) lines.push(`⛔ Límite: <code>-${ctx.maxDrawdownPct.toFixed(2)}%</code>`);
      lines.push(``, `⚠️ <b>Módulo pausado.</b> Nuevas compras bloqueadas hasta que el drawdown se reduzca.`);
      return lines.join("\n");
    }

    // ═══ IMPORTED POSITION ═══
    case "imported_position_created": {
      const lines = [
        `📥 <b>IDCA — Posición importada</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
      ];
      if (ctx.isManualCycle) lines.push(`🏷 Tipo: <b>CICLO MANUAL</b>`);
      if (ctx.exchangeSource) lines.push(`🏦 Exchange: <code>${escapeHtml(ctx.exchangeSource)}</code>`);
      if (ctx.price != null) lines.push(`💰 Precio medio: <code>$${fmtNum(ctx.price)}</code>`);
      if (ctx.quantity != null) lines.push(`📊 Cantidad: <code>${ctx.quantity.toFixed(6)}</code>`);
      if (ctx.capitalUsed != null) lines.push(`💵 Capital base: <code>$${fmtNum(ctx.capitalUsed)}</code>`);
      if (ctx.estimatedFeePct != null) lines.push(`💸 Fee estimada: <code>${ctx.estimatedFeePct}%</code>`);
      if (ctx.soloSalida != null) lines.push(`🔒 Solo salida: <b>${ctx.soloSalida ? "Sí" : "No"}</b>`);
      lines.push(``, `💡 El IDCA gestionará esta posición desde ahora.`);
      return lines.join("\n");
    }

    // ═══ IMPORTED CLOSED ═══
    case "imported_position_closed": {
      const pnl = ctx.realizedPnl || 0;
      const pnlPctVal = ctx.pnlPct || 0;
      const icon = pnl > 1 ? "✅" : pnl < -1 ? "🔴" : "⚖️";
      const label = pnl > 1 ? "con beneficio" : pnl < -1 ? "con pérdida" : "en break-even";

      const lines = [
        `${icon} <b>IDCA — Posición importada cerrada ${label}</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
      ];
      if (ctx.price != null) lines.push(`📍 Precio cierre: <code>$${fmtNum(ctx.price)}</code>`);
      lines.push(``, `📈 <b>Resultado:</b>`);
      lines.push(`• PnL: <b>${pnl >= 0 ? "+" : ""}$${fmtNum(pnl)}</b> (${pnlPctVal >= 0 ? "+" : ""}${pnlPctVal.toFixed(2)}%)`);
      if (ctx.durationStr) lines.push(`• Duración: ${ctx.durationStr}`);
      if (ctx.closeReason) lines.push(`• Motivo: ${escapeHtml(ctx.closeReason)}`);
      return lines.join("\n");
    }

    // ═══ PLUS CYCLE ═══
    case "plus_cycle_activated": {
      const lines = [
        `⚡ <b>IDCA — Ciclo Plus activado</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
      ];
      if (ctx.price != null) lines.push(`💵 Precio: <code>$${fmtNum(ctx.price)}</code>`);
      if (ctx.quantity != null) lines.push(`📊 Cantidad: <code>${ctx.quantity.toFixed(6)}</code>`);
      if (ctx.entryDipPct != null) lines.push(`📉 Dip desde main: <code>-${ctx.entryDipPct.toFixed(2)}%</code>`);
      if (ctx.parentCycleId != null) lines.push(`🔗 Ciclo padre: <code>#${ctx.parentCycleId}</code>`);
      if (ctx.tpPct != null) lines.push(`🎯 TP: <code>${ctx.tpPct.toFixed(1)}%</code>`);
      lines.push(``, `💡 Ciclo táctico Plus iniciado: el principal agotó entradas y el precio siguió bajando.`);
      return lines.join("\n");
    }

    case "plus_cycle_closed": {
      const pnl = ctx.realizedPnl || 0;
      const icon = pnl > 0 ? "✅" : pnl < -1 ? "🔴" : "⚖️";
      const lines = [
        `${icon} <b>IDCA — Ciclo Plus cerrado</b>`,
        ``,
        `📦 <code>${pair}</code>  [${modeTag}]`,
      ];
      if (ctx.price != null) lines.push(`📍 Precio cierre: <code>$${fmtNum(ctx.price)}</code>`);
      if (ctx.realizedPnl != null) lines.push(`📈 PnL: <b>${pnl >= 0 ? "+" : ""}$${fmtNum(pnl)}</b>`);
      if (ctx.closeReason) lines.push(`📝 Motivo: ${escapeHtml(ctx.closeReason)}`);
      if (ctx.parentCycleId != null) lines.push(`🔗 Parent: <code>#${ctx.parentCycleId}</code>`);
      return lines.join("\n");
    }

    // ═══ FALLBACK ═══
    default: {
      const { humanTitle, humanMessage, technicalSummary } = formatIdcaMessage(ctx);
      const entry = getCatalogEntry(ctx.reasonCode || ctx.eventType);
      let msg = `${entry.emoji} <b>${escapeHtml(humanTitle)} — IDCA</b>\n\n`;
      if (ctx.pair) msg += `📦 <code>${pair}</code>  [${modeTag}]\n`;
      msg += `\n${escapeHtml(humanMessage)}`;
      if (technicalSummary) msg += `\n\n<code>${escapeHtml(technicalSummary)}</code>`;
      return msg;
    }
  }
}

// ─── Monitor Line Formatter ─────────────────────────────────────────

/**
 * Generates a single human-readable line for the live monitor console.
 * Format: PAR | Título humano | Resumen técnico corto
 */
export function formatMonitorLine(ctx: FormatContext): string {
  const { humanTitle, technicalSummary } = formatIdcaMessage(ctx);
  const pair = (ctx.pair || "SYS").padEnd(8);
  return `${pair}| ${humanTitle} | ${technicalSummary}`;
}

// ─── Order Human Reason ─────────────────────────────────────────────

/**
 * Generates a human-readable reason for an order (for history tab).
 */
export function formatOrderReason(orderType: string, triggerReason?: string, pair?: string): string {
  switch (orderType) {
    case "base_buy":
      return "Se abrió compra inicial tras detectar una caída válida con condiciones de mercado favorables.";
    case "safety_buy":
      return "Se añadió compra adicional para mejorar el precio medio del ciclo ante caída continuada.";
    case "partial_sell":
      return "Se vendió una parte de la posición al alcanzar el objetivo de beneficio, protegiendo ganancia parcial.";
    case "final_sell":
      return "Se cerró el ciclo vendiendo la posición restante por activación del trailing stop.";
    case "breakeven_sell":
      return "Se cerró la posición en punto de equilibrio para proteger el capital y evitar pérdidas.";
    case "emergency_sell":
      return "Se ejecutó venta de emergencia por cierre forzado de todos los ciclos del módulo.";
    case "manual_sell":
      return "El usuario cerró manualmente la posición desde el panel de control.";
    default:
      return triggerReason || orderType.replace(/_/g, " ");
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtNum(val: number): string {
  return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
