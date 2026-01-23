/**
 * Telegram Message Templates - CHESTER BOT
 * Branding unificado + Exchange explícito + Anti-placeholders
 */
import {
  BOT_CANONICAL_NAME,
  DailyReportContext,
  TradeBuyContext,
  TradeSellContext,
  BotStartedContext,
  HeartbeatContext,
  PositionsUpdateContext,
  EntryIntentContext,
  ExchangeName,
} from "./types";
import { environment } from "../environment";

// ============================================================
// HTML ESCAPE HELPER
// ============================================================
export function escapeHtml(s: unknown): string {
  const str = String(s ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// SPANISH DATE FORMATTER
// ============================================================
export function formatSpanishDate(dateInput?: string | Date | number): string {
  try {
    if (!dateInput) dateInput = new Date();
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return "N/D (fecha inválida)";
    
    return new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return "N/D (error formato)";
  }
}

// ============================================================
// DURATION FORMATTER
// ============================================================
export function formatDuration(openedAt: string | Date | null | undefined): string {
  if (!openedAt) return "N/D";
  try {
    const opened = new Date(openedAt);
    const now = new Date();
    const diffMs = now.getTime() - opened.getTime();
    if (diffMs < 0) return "0m";

    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  } catch {
    return "N/D";
  }
}

// ============================================================
// AGE FORMATTER (for sync status)
// ============================================================
export function formatAge(seconds: number | null): string {
  if (seconds === null) return "N/D";
  if (seconds < 60) return `hace ${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `hace ${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `hace ${hours}h ${mins}m`;
}

// ============================================================
// BRANDING HEADER - Unified for all messages
// ============================================================
export function buildHeader(): string {
  return `[${environment.envTag}] 🤖 ${BOT_CANONICAL_NAME} 🇪🇸`;
}

// ============================================================
// PANEL URL FOOTER
// ============================================================
export function buildPanelFooter(): string {
  const url = environment.panelUrl;
  if (!url) return "\n📋 Panel no configurado";
  
  const safeUrl = url.startsWith("http") ? url : `https://${url}`;
  return `\nPanel: ${safeUrl}`;
}

// ============================================================
// DAILY REPORT TEMPLATE (MEJORADO)
// ============================================================
export function buildDailyReportHTML(ctx: DailyReportContext): string {
  const lines: string[] = [
    buildHeader(),
    `━━━━━━━━━━━━━━━━━━━`,
    `📋 <b>REPORTE DIARIO (14:00)</b>`,
    `🕒 ${formatSpanishDate(ctx.timestamp)} (Europe/Madrid)`,
    ``,
  ];

  // Connections section
  const connIcon = (ok: boolean) => ok ? "✅" : "❌";
  lines.push(
    `🔌 <b>Conexiones:</b>`,
    `  ${connIcon(ctx.connections.kraken)} Kraken | ${connIcon(ctx.connections.db)} DB | ${connIcon(ctx.connections.telegram)} Telegram | ${connIcon(ctx.connections.revolutx)} RevolutX`,
    ``
  );

  // System section
  const memWarning = ctx.system.memWarning ? " ⚠️" : "";
  lines.push(
    `🧠 <b>Sistema:</b>`,
    `  CPU: ${escapeHtml(ctx.system.cpu)}`,
    `  Memoria: ${escapeHtml(ctx.system.mem)}${memWarning}`,
    `  Disco: ${escapeHtml(ctx.system.disk)}`,
    `  Uptime: ${escapeHtml(ctx.system.uptime)}`,
    ``
  );

  // Bot config section
  lines.push(
    `🤖 <b>Bot:</b>`,
    `  Entorno: <code>${escapeHtml(ctx.env)}</code> | DRY_RUN: <code>${ctx.bot.dryRun ? "SÍ" : "NO"}</code>`,
    `  Modo: <code>${escapeHtml(ctx.bot.mode)}</code> | Estrategia: <code>${escapeHtml(ctx.bot.strategy)}</code>`,
    `  Pares: <code>${ctx.bot.pairs.join(", ")}</code>`,
    ``
  );

  // Portfolio section - Confirmed positions
  lines.push(`💰 <b>Portfolio (confirmado):</b>`);
  if (ctx.portfolio.positionCount === 0) {
    lines.push(`  Posiciones: 0 | Exposición: $0.00`);
  } else {
    lines.push(`  Posiciones: ${ctx.portfolio.positionCount} | Exposición: $${ctx.portfolio.exposureUsd.toFixed(2)}`);
    for (const pos of ctx.portfolio.positions.slice(0, 5)) {
      lines.push(`  • ${escapeHtml(pos.pair)} (${pos.exchange}): $${pos.exposureUsd.toFixed(2)} @ $${pos.entryPrice.toFixed(4)}`);
    }
    if (ctx.portfolio.positions.length > 5) {
      lines.push(`  <i>... y ${ctx.portfolio.positions.length - 5} más</i>`);
    }
  }
  lines.push(``);

  // Pending orders section
  lines.push(`🧾 <b>Órdenes pendientes:</b>`);
  if (ctx.pendingOrders.count === 0) {
    lines.push(`  Sin órdenes pendientes`);
  } else {
    const byExchange = new Map<ExchangeName, typeof ctx.pendingOrders.orders>();
    for (const order of ctx.pendingOrders.orders) {
      const list = byExchange.get(order.exchange) || [];
      list.push(order);
      byExchange.set(order.exchange, list);
    }
    
    for (const [exchange, orders] of byExchange) {
      const lastOrder = orders[orders.length - 1];
      lines.push(`  ${orders.length} pendientes (${exchange}) | Última: ${lastOrder.side} ${escapeHtml(lastOrder.pair)} | ID: <code>${lastOrder.orderId.slice(0, 8)}...</code>`);
    }
  }
  lines.push(``);

  // Sync status section
  lines.push(`🔄 <b>Sincronización:</b>`);
  for (const sync of ctx.syncStatus) {
    const timeStr = sync.lastSyncAt 
      ? `${formatSpanishDate(sync.lastSyncAt).split(" ")[1]} (${formatAge(sync.ageSeconds)})`
      : "N/D (sin sincronizar)";
    lines.push(`  ${sync.exchange} lastSync: ${timeStr}`);
  }

  lines.push(
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelFooter()
  );

  return lines.join("\n");
}

// ============================================================
// BOT STARTED TEMPLATE
// ============================================================
export function buildBotStartedHTML(ctx: BotStartedContext): string {
  const routerStatus = ctx.routerEnabled ? "ACTIVO" : "INACTIVO";
  const exchangeList = ctx.exchanges.join(", ");
  
  return [
    buildHeader(),
    `━━━━━━━━━━━━━━━━━━━`,
    `✅ <b>Bot Iniciado</b>`,
    ``,
    `🤖 <b>Configuración:</b>`,
    `   • Entorno: <code>${escapeHtml(ctx.env)}</code>`,
    `   • Exchanges: <code>${exchangeList}</code>`,
    `   • Estrategia: <code>${escapeHtml(ctx.strategy)}</code>`,
    `   • Riesgo: <code>${escapeHtml(ctx.risk)}</code>`,
    `   • Modo: <code>${escapeHtml(ctx.mode)}</code>`,
    `   • Router: <code>${routerStatus}</code>`,
    ``,
    `💰 <b>Balance inicial:</b> <code>$${escapeHtml(ctx.balanceUsd)}</code>`,
    `📊 <b>Pares activos:</b> <code>${ctx.pairs.join(", ")}</code>`,
    `📈 <b>Posiciones:</b> <code>${ctx.positionCount}</code>`,
    ``,
    `📅 ${formatSpanishDate(ctx.timestamp)}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelFooter(),
  ].join("\n");
}

// ============================================================
// HEARTBEAT TEMPLATE
// ============================================================
export function buildHeartbeatHTML(ctx: HeartbeatContext): string {
  const connIcon = (ok: boolean) => ok ? "✅" : "❌";
  
  return [
    buildHeader(),
    `━━━━━━━━━━━━━━━━━━━`,
    `✅ <b>Sistema operativo 24x7</b>`,
    `Verificación automática de funcionamiento`,
    ``,
    `📊 <b>Recursos del sistema:</b>`,
    `   • CPU: <code>${escapeHtml(ctx.cpu)}</code>`,
    `   • Memoria: <code>${escapeHtml(ctx.mem)}</code>`,
    `   • Disco: <code>${escapeHtml(ctx.disk)}</code>`,
    `   • Uptime: <code>${escapeHtml(ctx.uptime)}</code>`,
    ``,
    `🔌 <b>Conexiones:</b>`,
    `   ${connIcon(ctx.connections.kraken)} Kraken`,
    `   ${connIcon(ctx.connections.revolutx)} RevolutX`,
    `   ${connIcon(ctx.connections.telegram)} Telegram`,
    `   ${connIcon(ctx.connections.db)} Base de datos`,
    ``,
    `📅 ${formatSpanishDate(ctx.timestamp)}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelFooter(),
  ].join("\n");
}

// ============================================================
// TRADE BUY TEMPLATE
// ============================================================
export function buildTradeBuyHTML(ctx: TradeBuyContext): string {
  const lines: string[] = [
    buildHeader(),
    `━━━━━━━━━━━━━━━━━━━`,
    `🟢 <b>COMPRA ${escapeHtml(ctx.pair)}</b> 🟢`,
    ``,
    `🏦 <b>Exchange:</b> <code>${ctx.exchange}</code>`,
    `💵 <b>Precio:</b> <code>$${escapeHtml(ctx.price)}</code>`,
    `📦 <b>Cantidad:</b> <code>${escapeHtml(ctx.amount)}</code>`,
    `💰 <b>Total:</b> <code>$${escapeHtml(ctx.total)}</code>`,
    ``,
  ];

  if (ctx.signalsSummary) {
    lines.push(
      `📊 <b>Indicadores:</b>`,
      `${escapeHtml(ctx.signalsSummary)}`,
      ``
    );
  }

  if (ctx.regime) {
    lines.push(`🧭 <b>Régimen:</b> <code>${escapeHtml(ctx.regime)}</code>`);
  }
  if (ctx.regimeReason) {
    lines.push(`   ↳ ${escapeHtml(ctx.regimeReason)}`);
  }
  if (ctx.routerStrategy) {
    lines.push(`🔀 <b>Estrategia Router:</b> <code>${escapeHtml(ctx.routerStrategy)}</code>`);
  }

  lines.push(
    ``,
    `⚙️ <b>Modo:</b> <code>${escapeHtml(ctx.mode)}</code>`,
    `🔗 <b>OrderID:</b> <code>${escapeHtml(ctx.orderId)}</code>`,
  );

  if (ctx.lotId) {
    lines.push(`🎫 <b>LotID:</b> <code>${escapeHtml(ctx.lotId)}</code>`);
  }

  lines.push(
    ``,
    `📅 ${formatSpanishDate(ctx.timestamp)}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelFooter()
  );

  return lines.join("\n");
}

// ============================================================
// TRADE SELL TEMPLATE
// ============================================================
export function buildTradeSellHTML(ctx: TradeSellContext): string {
  const pnlSign = ctx.pnlUsd !== null && ctx.pnlUsd >= 0 ? "+" : "";
  const pnlEmoji = ctx.pnlUsd !== null && ctx.pnlUsd >= 0 ? "📈" : "📉";
  const pnlUsdTxt = ctx.pnlUsd === null ? "N/D" : `${pnlSign}$${ctx.pnlUsd.toFixed(2)}`;
  const pnlPctTxt = ctx.pnlPct !== null ? `${pnlSign}${ctx.pnlPct.toFixed(2)}%` : "";
  const feeTxt = ctx.feeUsd === null || ctx.feeUsd === undefined ? "N/D" : `$${ctx.feeUsd.toFixed(2)}`;
  const durationTxt = ctx.holdDuration || formatDuration(ctx.openedAt);

  const lines: string[] = [
    buildHeader(),
    `━━━━━━━━━━━━━━━━━━━`,
    `🔴 <b>VENTA ${escapeHtml(ctx.pair)}</b> 🔴`,
    ``,
    `🏦 <b>Exchange:</b> <code>${ctx.exchange}</code>`,
    `💵 <b>Precio:</b> <code>$${escapeHtml(ctx.price)}</code>`,
    `📦 <b>Cantidad:</b> <code>${escapeHtml(ctx.amount)}</code>`,
    `💰 <b>Total:</b> <code>$${escapeHtml(ctx.total)}</code>`,
    `⏱️ <b>Duración:</b> <code>${escapeHtml(durationTxt)}</code>`,
    ``,
    `${pnlEmoji} <b>Resultado:</b>`,
    `   • PnL: <code>${escapeHtml(pnlUsdTxt)}</code>${pnlPctTxt ? ` (<code>${escapeHtml(pnlPctTxt)}</code>)` : ""}`,
    `   • Fee: <code>${escapeHtml(feeTxt)}</code>`,
    ``,
    `🛡️ <b>Tipo de salida:</b> <code>${escapeHtml(ctx.exitType)}</code>`,
  ];

  if (ctx.trigger) {
    lines.push(`⚡ <b>Trigger:</b> <code>${escapeHtml(ctx.trigger)}</code>`);
  }

  lines.push(
    ``,
    `⚙️ <b>Modo:</b> <code>${escapeHtml(ctx.mode)}</code>`,
    `🔗 <b>OrderID:</b> <code>${escapeHtml(ctx.orderId)}</code>`,
  );

  if (ctx.lotId) {
    lines.push(`🎫 <b>LotID:</b> <code>${escapeHtml(ctx.lotId)}</code>`);
  }

  lines.push(
    ``,
    `📅 ${formatSpanishDate(ctx.timestamp)}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelFooter()
  );

  return lines.join("\n");
}

// ============================================================
// POSITIONS UPDATE TEMPLATE
// ============================================================
export function buildPositionsUpdateHTML(ctx: PositionsUpdateContext): string {
  if (ctx.positions.length === 0) {
    return [
      buildHeader(),
      `━━━━━━━━━━━━━━━━━━━`,
      `📊 <b>POSICIONES ABIERTAS</b>`,
      ``,
      `Sin posiciones abiertas actualmente`,
      ``,
      `📅 ${formatSpanishDate(ctx.timestamp)}`,
      `━━━━━━━━━━━━━━━━━━━`,
    ].join("\n");
  }

  const lines: string[] = [
    buildHeader(),
    `━━━━━━━━━━━━━━━━━━━`,
    `📊 <b>POSICIONES ABIERTAS (${ctx.positions.length})</b>`,
    ``,
  ];

  for (const pos of ctx.positions) {
    const pnlStr = pos.pnlUsd !== undefined 
      ? ` | PnL: ${pos.pnlUsd >= 0 ? "+" : ""}$${pos.pnlUsd.toFixed(2)}`
      : "";
    const statusStr = pos.beActivated ? " 🔒 B.E." : pos.trailingActivated ? " 📉 Trail" : "";
    
    lines.push(
      `<b>${escapeHtml(pos.pair)}</b> (${pos.exchange})${statusStr}`,
      `   Entrada: $${pos.entryPrice.toFixed(4)} | Qty: ${pos.amount.toFixed(6)}${pnlStr}`,
      `   ID: <code>${pos.lotId.slice(0, 12)}...</code>`,
      ``
    );
  }

  lines.push(
    `━━━━━━━━━━━━━━━━━━━`,
    `<b>Total Exposición:</b> $${ctx.totalExposureUsd.toFixed(2)}`,
    `📅 ${formatSpanishDate(ctx.timestamp)}`,
  );

  return lines.join("\n");
}

// ============================================================
// ENTRY INTENT TEMPLATE
// ============================================================
export function buildEntryIntentHTML(ctx: EntryIntentContext): string {
  const lines: string[] = [
    buildHeader(),
    `━━━━━━━━━━━━━━━━━━━`,
    `💡 <b>INTENCIÓN DE ENTRADA</b> 💡`,
    ``,
    `🏦 <b>Exchange:</b> <code>${ctx.exchange}</code>`,
    `📊 <b>Par:</b> <code>${escapeHtml(ctx.pair)}</code>`,
    `💵 <b>Entraría con:</b> <code>$${escapeHtml(ctx.amountUsd)}</code>`,
    `📈 <b>Precio:</b> <code>$${escapeHtml(ctx.price)}</code>`,
    ``,
    `🧠 <b>Estrategia:</b> <code>${escapeHtml(ctx.strategyLabel)}</code>`,
    `📈 <b>Confianza:</b> <code>${ctx.confidence.toFixed(0)}%</code>`,
  ];

  if (ctx.currentSignals !== undefined && ctx.requiredSignals !== undefined) {
    lines.push(`📊 <b>Señales:</b> <code>${ctx.currentSignals}/${ctx.requiredSignals}</code>`);
  }

  if (ctx.regime) {
    lines.push(`🧭 <b>Régimen:</b> <code>${escapeHtml(ctx.regime)}</code>`);
    if (ctx.regimeReason) {
      lines.push(`   ↳ ${escapeHtml(ctx.regimeReason)}`);
    }
  }

  lines.push(
    ``,
    `💬 <b>Motivo:</b>`,
    `<i>${escapeHtml(ctx.signalReason.substring(0, 300))}</i>`,
    ``,
    `📅 ${formatSpanishDate(ctx.timestamp)}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelFooter()
  );

  return lines.join("\n");
}

// ============================================================
// ERROR ALERT TEMPLATE
// ============================================================
export function buildErrorAlertHTML(title: string, description: string, meta?: Record<string, unknown>): string {
  const lines: string[] = [
    buildHeader(),
    `━━━━━━━━━━━━━━━━━━━`,
    `⚠️ <b>${escapeHtml(title)}</b>`,
    ``,
    `${escapeHtml(description)}`,
  ];

  if (meta && Object.keys(meta).length > 0) {
    lines.push(``, `<b>Detalles:</b>`);
    for (const [key, value] of Object.entries(meta).slice(0, 5)) {
      lines.push(`   • ${escapeHtml(key)}: <code>${escapeHtml(String(value))}</code>`);
    }
  }

  lines.push(
    ``,
    `📅 ${formatSpanishDate()}`,
    `━━━━━━━━━━━━━━━━━━━`,
  );

  return lines.join("\n");
}

// ============================================================
// EXPORT ALL TEMPLATES
// ============================================================
export const telegramTemplates = {
  escapeHtml,
  formatSpanishDate,
  formatDuration,
  formatAge,
  buildHeader,
  buildPanelFooter,
  buildDailyReportHTML,
  buildBotStartedHTML,
  buildHeartbeatHTML,
  buildTradeBuyHTML,
  buildTradeSellHTML,
  buildPositionsUpdateHTML,
  buildEntryIntentHTML,
  buildErrorAlertHTML,
};
