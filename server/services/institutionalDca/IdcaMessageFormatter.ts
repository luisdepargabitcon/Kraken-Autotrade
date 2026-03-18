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
  dipPct?: number;
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
}

// ─── Core Formatter ─────────────────────────────────────────────────

export function formatIdcaMessage(ctx: FormatContext): HumanMessage {
  const entry = getCatalogEntry(ctx.reasonCode || ctx.eventType);
  const pair = ctx.pair || "—";
  const mode = ctx.mode?.toUpperCase() || "—";

  // Build humanTitle
  let humanTitle = entry.humanTitle;

  // Build humanMessage from template
  let humanMessage = entry.humanTemplate
    .replace(/\{pair\}/g, pair);

  // Handle block details
  if (ctx.blockReasons && ctx.blockReasons.length > 0) {
    const blockSummaries = ctx.blockReasons.map(r => getBlockReasonSummary(r.code, ctx.pair));
    const blockDetail = blockSummaries.join(", ");
    humanMessage = humanMessage.replace(/\{blockDetail\}/g, blockDetail);
  } else if (ctx.reasonCode && ctx.eventType === "entry_check_blocked") {
    const blockDetail = getBlockReasonSummary(ctx.reasonCode, ctx.pair);
    humanMessage = humanMessage.replace(/\{blockDetail\}/g, blockDetail);
  } else {
    humanMessage = humanMessage.replace(/\{blockDetail\}/g, "no se cumplieron las condiciones necesarias");
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
      if (ctx.dipPct != null) techParts.push(`Dip=${ctx.dipPct.toFixed(2)}%`);
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
      if (ctx.dipPct != null) techParts.push(`Dip=${ctx.dipPct.toFixed(2)}%`);
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

    case "module_max_drawdown_reached":
      if (ctx.drawdownPct != null) techParts.push(`DD=${ctx.drawdownPct.toFixed(2)}%`);
      if (ctx.maxDrawdownPct != null) techParts.push(`Límite=${ctx.maxDrawdownPct.toFixed(2)}%`);
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
  const { humanTitle, humanMessage, technicalSummary } = formatIdcaMessage(ctx);
  const entry = getCatalogEntry(ctx.reasonCode || ctx.eventType);
  const simPrefix = ctx.mode === "simulation" ? "[SIMULACIÓN] " : "";

  let msg = `${simPrefix}${entry.emoji} <b>${escapeHtml(humanTitle)} — IDCA</b>\n\n`;
  msg += `${escapeHtml(humanMessage)}\n\n`;

  // Structured data block
  const lines: string[] = [];
  if (ctx.pair) lines.push(`<b>Par:</b> ${escapeHtml(ctx.pair)}`);
  if (ctx.mode) lines.push(`<b>Modo:</b> ${ctx.mode.toUpperCase()}`);

  switch (ctx.eventType) {
    case "cycle_started":
    case "base_buy_executed":
      if (ctx.price != null) lines.push(`<b>Precio:</b> ${fmtNum(ctx.price)}`);
      if (ctx.quantity != null) lines.push(`<b>Cantidad:</b> ${ctx.quantity.toFixed(6)}`);
      if (ctx.buyCount != null) lines.push(`<b>Compra:</b> #${ctx.buyCount}`);
      if (ctx.dipPct != null) lines.push(`<b>Dip detectado:</b> ${ctx.dipPct.toFixed(2)}%`);
      if (ctx.marketScore != null) lines.push(`<b>Score:</b> ${ctx.marketScore}`);
      if (ctx.capitalUsed != null) lines.push(`<b>Capital usado:</b> $${ctx.capitalUsed.toFixed(2)}`);
      if (ctx.sizeProfile) lines.push(`<b>Perfil tamaño:</b> ${ctx.sizeProfile}`);
      break;

    case "safety_buy_executed":
      if (ctx.price != null) lines.push(`<b>Precio:</b> ${fmtNum(ctx.price)}`);
      if (ctx.quantity != null) lines.push(`<b>Cantidad:</b> ${ctx.quantity.toFixed(6)}`);
      if (ctx.buyCount != null) lines.push(`<b>Compra:</b> #${ctx.buyCount}`);
      if (ctx.avgEntry != null) lines.push(`<b>Precio medio nuevo:</b> ${fmtNum(ctx.avgEntry)}`);
      if (ctx.capitalUsed != null) lines.push(`<b>Capital usado:</b> $${ctx.capitalUsed.toFixed(2)}`);
      break;

    case "tp_armed":
      if (ctx.avgEntry != null) lines.push(`<b>Precio medio:</b> ${fmtNum(ctx.avgEntry)}`);
      if (ctx.price != null) lines.push(`<b>Precio actual:</b> ${fmtNum(ctx.price)}`);
      if (ctx.pnlPct != null) lines.push(`<b>PnL:</b> ${ctx.pnlPct >= 0 ? "+" : ""}${ctx.pnlPct.toFixed(2)}%`);
      if (ctx.partialPct != null) lines.push(`<b>Venta parcial:</b> ${ctx.partialPct.toFixed(0)}%`);
      if (ctx.trailingPct != null) lines.push(`<b>Trailing:</b> ${ctx.trailingPct.toFixed(2)}%`);
      break;

    case "trailing_exit":
      if (ctx.price != null) lines.push(`<b>Precio cierre:</b> ${fmtNum(ctx.price)}`);
      if (ctx.pnlPct != null) lines.push(`<b>PnL final:</b> ${ctx.pnlPct >= 0 ? "+" : ""}${ctx.pnlPct.toFixed(2)}%`);
      if (ctx.pnlUsd != null) lines.push(`<b>Resultado:</b> $${ctx.pnlUsd.toFixed(2)}`);
      if (ctx.buyCount != null) lines.push(`<b>Compras del ciclo:</b> ${ctx.buyCount}`);
      if (ctx.durationStr) lines.push(`<b>Duración:</b> ${ctx.durationStr}`);
      lines.push(`<b>Motivo:</b> trailing_exit`);
      break;

    case "breakeven_exit":
      if (ctx.price != null) lines.push(`<b>Precio cierre:</b> ${fmtNum(ctx.price)}`);
      if (ctx.buyCount != null) lines.push(`<b>Compras:</b> ${ctx.buyCount}`);
      lines.push(`<b>Motivo:</b> breakeven_exit`);
      break;

    case "emergency_close_all":
      if (ctx.closedCount != null) lines.push(`<b>Ciclos cerrados:</b> ${ctx.closedCount}`);
      lines.push(`<b>Trigger:</b> ${ctx.triggerSource || "manual"}`);
      lines.push(`<b>Timestamp:</b> ${new Date().toISOString()}`);
      break;

    case "entry_check_blocked":
    case "buy_blocked":
      if (ctx.dipPct != null) lines.push(`<b>Dip:</b> ${ctx.dipPct.toFixed(2)}%`);
      if (ctx.marketScore != null) lines.push(`<b>Score:</b> ${ctx.marketScore}`);
      if (ctx.reasonCode) lines.push(`<b>Motivo técnico:</b> ${ctx.reasonCode}`);
      if (ctx.blockReasons) {
        lines.push(`<b>Bloqueos:</b> ${ctx.blockReasons.map(r => r.code).join(", ")}`);
      }
      break;

    case "smart_adjustment_applied":
      if (ctx.field) lines.push(`<b>Cambio:</b> ${ctx.field} ${ctx.oldVal} → ${ctx.newVal}`);
      if (ctx.reason) lines.push(`<b>Motivo:</b> ${escapeHtml(ctx.reason)}`);
      break;

    case "module_max_drawdown_reached":
      if (ctx.drawdownPct != null) lines.push(`<b>Drawdown actual:</b> -${ctx.drawdownPct.toFixed(2)}%`);
      if (ctx.maxDrawdownPct != null) lines.push(`<b>Límite configurado:</b> -${ctx.maxDrawdownPct.toFixed(2)}%`);
      lines.push(`<b>Acción:</b> Módulo pausado, nuevas compras bloqueadas`);
      break;

    default:
      // Fallback: show tech summary as detail
      if (technicalSummary) lines.push(`<b>Detalle:</b> ${escapeHtml(technicalSummary)}`);
      break;
  }

  if (lines.length > 0) {
    msg += lines.join("\n");
  }

  return msg;
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
