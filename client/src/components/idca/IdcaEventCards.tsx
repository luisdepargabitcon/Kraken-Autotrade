/**
 * IdcaEventCards — Sistema visual moderno de eventos IDCA
 * 
 * Doble capa: humana (visible) + técnica (expandible)
 * Colores semánticos, iconos claros, lenguaje natural
 */
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════
// VISUAL CATALOG — cada eventType tiene su identidad visual
// ════════════════════════════════════════════════════════════════════

type EventCategory = "positive" | "negative" | "warning" | "info" | "system";

interface EventVisual {
  icon: string;
  title: string;
  category: EventCategory;
  getHumanSummary: (ev: any, parsed: ParsedPayload) => string;
  getActionText: (ev: any, parsed: ParsedPayload) => string;
}

interface ParsedPayload {
  price?: number;
  quantity?: number;
  capital?: number;
  avgEntry?: number;
  pnlPct?: number;
  pnlUsd?: number;
  basePrice?: number;
  basePriceType?: string;
  basePriceMeta?: {
    selectedMethod?: string;
    selectedReason?: string;
    selectedAnchorPrice?: number;
    selectedAnchorTime?: string;
    drawdownPctFromAnchor?: number;
    outlierRejected?: boolean;
    outlierRejectedValue?: number;
    atrPct?: number;
    candidates?: {
      swingHigh24h?: number;
      p95_24h?: number;
      windowHigh24h?: number;
      p95_7d?: number;
      p95_30d?: number;
    };
    capsApplied?: {
      cappedBy7d?: boolean;
      cappedBy30d?: boolean;
      originalBase?: number;
    };
  };
  entryDipPct?: number;
  marketScore?: number;
  sizeProfile?: string;
  buyCount?: number;
  closeReason?: string;
  tpPct?: number;
  trailingPct?: number;
  blockReasons?: string[];
  parentCycleId?: number;
  dipFromLastBuy?: number;
  [key: string]: any;
}

function parsePayload(ev: any): ParsedPayload {
  const p = ev.payloadJson || {};
  const msg = ev.message || "";
  const result: ParsedPayload = { ...p };

  // Extract from payloadJson
  if (p.price) result.price = parseFloat(String(p.price));
  if (p.quantity) result.quantity = parseFloat(String(p.quantity));
  if (p.capital) result.capital = parseFloat(String(p.capital));
  // Fix: price can be 0 (falsy) — check for object type explicitly
  if (p.basePrice && typeof p.basePrice === 'object' && 'price' in p.basePrice) {
    result.basePrice = parseFloat(String(p.basePrice.price));
    result.basePriceType = p.basePrice.type;
    if (p.basePrice.meta && typeof p.basePrice.meta === 'object') {
      result.basePriceMeta = p.basePrice.meta;
    }
  } else if (typeof p.basePrice === 'number') {
    result.basePrice = p.basePrice;
  }
  if (p.entryDipPct) result.entryDipPct = parseFloat(String(p.entryDipPct));
  if (p.marketScore) result.marketScore = parseFloat(String(p.marketScore));
  if (p.sizeProfile) result.sizeProfile = p.sizeProfile;

  // Parse from message as fallback
  const priceMatch = msg.match(/@ ?([\d,.]+)/);
  if (priceMatch && !result.price) result.price = parseFloat(priceMatch[1]);

  const basePriceMatch = msg.match(/BasePrice=\$?([\d,.]+)\s*\(([^)]+)\)/);
  if (basePriceMatch && !result.basePrice) {
    result.basePrice = parseFloat(basePriceMatch[1]);
    result.basePriceType = basePriceMatch[2];
  }

  const dipMatch = msg.match(/EntryDip=([\d.]+)%/);
  if (dipMatch && !result.entryDipPct) result.entryDipPct = parseFloat(dipMatch[1]);

  const scoreMatch = msg.match(/Score=(\d+)/);
  if (scoreMatch && !result.marketScore) result.marketScore = parseInt(scoreMatch[1]);

  const pnlMatch = msg.match(/PnL[=: ]*([+-]?[\d.]+)%/);
  if (pnlMatch) result.pnlPct = parseFloat(pnlMatch[1]);

  const qtyMatch = msg.match(/(?:baseBuy|qty|Qty)[=: ]*([\d.]+)/i);
  if (qtyMatch && !result.quantity) result.quantity = parseFloat(qtyMatch[1]);

  return result;
}

const fN = (v: number | undefined, d = 2): string =>
  v != null ? v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";

const fUsd = (v: number | undefined): string =>
  v != null ? `$${fN(v)}` : "—";

const BLOCK_REASON_LABELS: Record<string, string> = {
  data_not_ready: "Sistema inicializando datos de mercado",
  no_rebound_confirmed: "Esperando confirmación de rebote",
  insufficient_base_price_data: "Datos de velas insuficientes para calcular referencia",
  insufficient_dip: "Caída insuficiente para entrar",
  market_score_too_low: "Condiciones de mercado desfavorables",
  module_exposure_max_reached: "Exposición máxima del módulo alcanzada",
  asset_exposure_max_reached: "Exposición máxima del activo alcanzada",
  cycle_already_active: "Ya existe un ciclo activo",
  pair_not_allowed: "Par no permitido",
  insufficient_simulation_balance: "Saldo de simulación insuficiente",
  btc_breakdown_blocks_eth: "Caída de BTC bloquea entrada en ETH",
  breakdown_detected: "Ruptura bajista detectada",
  spread_too_high: "Spread demasiado alto",
  sell_pressure_too_high: "Presión de venta elevada",
  combined_exposure_exceeded: "Exposición combinada excedida",
};

const EVENT_CATALOG: Record<string, EventVisual> = {
  // ── REVISIÓN DE CICLO (azul/info) ──────────────────
  cycle_management: {
    icon: "🔵",
    title: "Ciclo bajo seguimiento",
    category: "info",
    getHumanSummary: (ev, p) => {
      const conclusion = ev.message || p.reason || "";
      if (conclusion && !conclusion.startsWith("Gestión ciclo")) return conclusion;

      const parts: string[] = [];
      parts.push("El bot revisó el ciclo activo.");

      if (p.pnlPct != null) {
        if (p.pnlPct < -10) parts.push(`La posición está en drawdown profundo (${fN(p.pnlPct)}%).`);
        else if (p.pnlPct < -5) parts.push(`La posición está en zona negativa (${fN(p.pnlPct)}%).`);
        else if (p.pnlPct < 0) parts.push(`La posición está ligeramente en negativo (${fN(p.pnlPct)}%).`);
        else if (p.pnlPct < 1) parts.push(`La posición está cerca del break-even (${p.pnlPct >= 0 ? "+" : ""}${fN(p.pnlPct)}%).`);
        else parts.push(`La posición está en positivo (+${fN(p.pnlPct)}%).`);
      }

      // Nearest trigger info
      const nearest = p.nearestTrigger;
      const dist = p.nearestTriggerDist;
      if (nearest && dist != null) {
        if (nearest === "safety_buy") {
          if (dist < 1) parts.push("Muy cerca del próximo safety buy.");
          else if (dist < 3) parts.push(`A ${fN(dist)}% del próximo safety buy.`);
        } else if (nearest === "tp") {
          if (dist < 1) parts.push("Muy cerca de toma de ganancias.");
          else if (dist < 3) parts.push(`A ${fN(dist)}% de la toma de ganancias.`);
        } else if (nearest === "protection_stop") {
          if (dist < 1) parts.push("Muy cerca del stop de protección.");
          else if (dist < 3) parts.push(`A ${fN(dist)}% del stop de protección.`);
        }
      }

      if (p.isProtectionArmed) parts.push("La protección de capital está activa.");

      if (!p.actionTaken) parts.push("Sin acción en este tick.");
      return parts.join(" ");
    },
    getActionText: (_ev, p) => {
      if (p.actionTaken) return "Se ejecutó una acción (compra, venta o cambio de estado).";
      return "Sin acción. El bot sigue vigilando la posición.";
    },
  },

  // ── POSITIVOS (verde) ──────────────────────────────
  cycle_started: {
    icon: "🟢",
    title: "Nuevo ciclo de compra iniciado",
    category: "positive",
    getHumanSummary: (_ev, p) => {
      const parts = [`El bot detectó una oportunidad de compra y abrió una nueva posición.`];
      if (p.basePrice && p.entryDipPct) {
        parts.push(`El precio cayó un ${fN(p.entryDipPct)}% desde el precio de referencia (${fUsd(p.basePrice)}), superando el umbral mínimo configurado.`);
      }
      if (p.marketScore) parts.push(`Las condiciones de mercado obtuvieron un score de ${p.marketScore}/100.`);
      return parts.join(" ");
    },
    getActionText: (_ev, p) =>
      p.quantity && p.price
        ? `Compra ejecutada: ${fN(p.quantity, 6)} unidades a ${fUsd(p.price)}`
        : "Compra inicial ejecutada",
  },

  base_buy_executed: {
    icon: "💰",
    title: "Compra inicial ejecutada",
    category: "positive",
    getHumanSummary: (_ev, p) =>
      `Se ejecutó la primera compra del ciclo.${p.capital ? ` Capital invertido: ${fUsd(p.capital)}.` : ""}`,
    getActionText: (_ev, p) =>
      p.quantity && p.price
        ? `Compra: ${fN(p.quantity, 6)} @ ${fUsd(p.price)}`
        : "Compra ejecutada",
  },

  safety_buy_executed: {
    icon: "📦",
    title: "Compra adicional (Safety Buy)",
    category: "positive",
    getHumanSummary: (_ev, p) => {
      const parts = [`El precio siguió bajando y el bot ejecutó una compra adicional para mejorar el precio medio de entrada.`];
      return parts.join(" ");
    },
    getActionText: (_ev, p) =>
      p.quantity && p.price
        ? `Compra adicional: ${fN(p.quantity, 6)} @ ${fUsd(p.price)}`
        : "Compra adicional ejecutada",
  },

  entry_check_passed: {
    icon: "✅",
    title: "Evaluación de entrada aprobada",
    category: "positive",
    getHumanSummary: (_ev, p) => {
      const parts = [`Todas las condiciones de entrada se cumplen: la caída es suficiente y el mercado es favorable.`];
      if (p.entryDipPct && p.basePrice) {
        parts.push(`Caída detectada: ${fN(p.entryDipPct)}% desde ${fUsd(p.basePrice)} (${p.basePriceType || "hybrid"}).`);
      }
      return parts.join(" ");
    },
    getActionText: () => "El bot procederá a abrir un nuevo ciclo de compra.",
  },

  tp_armed: {
    icon: "🎯",
    title: "Toma de ganancias activada",
    category: "positive",
    getHumanSummary: () =>
      `La posición alcanzó el objetivo de ganancias. Se vendió una parte y el trailing stop está activo para proteger el beneficio restante.`,
    getActionText: (_ev, p) =>
      p.tpPct ? `Objetivo de TP: +${fN(p.tpPct, 1)}% alcanzado` : "Venta parcial ejecutada por TP",
  },

  partial_sell_executed: {
    icon: "📤",
    title: "Venta parcial ejecutada",
    category: "positive",
    getHumanSummary: () =>
      `Se vendió una parte de la posición al alcanzar el objetivo de ganancias. El resto sigue activo con trailing stop.`,
    getActionText: (_ev, p) =>
      p.price ? `Venta parcial a ${fUsd(p.price)}` : "Venta parcial ejecutada",
  },

  trailing_exit: {
    icon: "📈",
    title: "Cierre por trailing stop — Beneficio asegurado",
    category: "positive",
    getHumanSummary: (_ev, p) =>
      `El trailing stop se activó y el ciclo se cerró con beneficio.${p.pnlPct ? ` Resultado: ${p.pnlPct >= 0 ? "+" : ""}${fN(p.pnlPct)}%` : ""}`,
    getActionText: () => "Posición cerrada completamente. Capital liberado.",
  },

  trailing_activated: {
    icon: "🎯",
    title: "Trailing stop activado",
    category: "positive",
    getHumanSummary: () =>
      `El precio superó el umbral de activación del trailing. El sistema ahora protege el beneficio con un stop dinámico que sigue al precio.`,
    getActionText: () => "El trailing stop está activo y protegiendo ganancias.",
  },

  plus_cycle_activated: {
    icon: "⚡",
    title: "Ciclo Plus activado",
    category: "positive",
    getHumanSummary: (_ev, p) =>
      `El ciclo principal agotó sus compras y el precio siguió bajando. El bot abrió un ciclo táctico adicional para aprovechar la caída extra.${p.dipFromLastBuy ? ` Caída adicional: ${fN(p.dipFromLastBuy, 1)}%.` : ""}`,
    getActionText: () => "Nuevo ciclo Plus abierto como posición táctica complementaria.",
  },

  // ── NEGATIVOS (rojo) ──────────────────────────────
  breakeven_exit: {
    icon: "🛡️",
    title: "Cierre por protección de capital",
    category: "negative",
    getHumanSummary: () =>
      `La protección de capital se activó: el precio retrocedió hasta el punto de break-even y el bot cerró la posición para evitar pérdidas.`,
    getActionText: () => "Posición cerrada en break-even. Capital protegido.",
  },

  emergency_close_all: {
    icon: "🚨",
    title: "Cierre de emergencia total",
    category: "negative",
    getHumanSummary: () =>
      `Se ejecutó un cierre de emergencia de todos los ciclos activos. Esto puede deberse a una acción manual o a un evento excepcional del mercado.`,
    getActionText: () => "Todos los ciclos fueron cerrados inmediatamente.",
  },

  module_max_drawdown_reached: {
    icon: "⛔",
    title: "Drawdown máximo alcanzado — Módulo pausado",
    category: "negative",
    getHumanSummary: () =>
      `Las pérdidas acumuladas del módulo alcanzaron el límite máximo configurado. El módulo se ha pausado automáticamente para proteger el capital. No se abrirán nuevos ciclos hasta que la situación mejore.`,
    getActionText: () => "Módulo pausado. Nuevas compras bloqueadas.",
  },

  plus_cycle_closed: {
    icon: "⚡",
    title: "Ciclo Plus cerrado",
    category: "info",
    getHumanSummary: (_ev, p) =>
      `El ciclo Plus complementario se ha cerrado.${p.pnlPct ? ` Resultado: ${p.pnlPct >= 0 ? "+" : ""}${fN(p.pnlPct)}%` : ""}`,
    getActionText: () => "Ciclo Plus finalizado.",
  },

  // ── RECOVERY CYCLES ────────────────────────────────
  recovery_cycle_eligible: {
    icon: "🟡",
    title: "Ciclo de recuperación habilitado",
    category: "warning",
    getHumanSummary: (_ev, p) => {
      const parts = ["El ciclo principal alcanzó un drawdown profundo."];
      if (p.drawdownPct != null) parts.push(`Drawdown actual: -${fN(p.drawdownPct)}%.`);
      if (p.activationDrawdownPct != null) parts.push(`Umbral de activación: -${fN(p.activationDrawdownPct)}%.`);
      parts.push("El bot queda habilitado para abrir un ciclo de recuperación cuando se confirme un rebote.");
      return parts.join(" ");
    },
    getActionText: (_ev, p) =>
      p.recoveryCapital
        ? `Vigilando rebote. Capital asignado: ${fUsd(p.recoveryCapital)}.`
        : "Vigilando rebote para abrir ciclo recovery.",
  },

  recovery_cycle_started: {
    icon: "🔄",
    title: "Ciclo de recuperación abierto",
    category: "positive",
    getHumanSummary: (_ev, p) => {
      const parts = ["Se abrió un ciclo de recuperación."];
      if (p.mainDrawdown != null || p.drawdownPct != null) {
        const dd = p.mainDrawdown ?? p.drawdownPct;
        parts.push(`El ciclo principal tiene un drawdown de -${fN(dd)}%.`);
      }
      parts.push("Se invirtió capital reducido con un TP conservador para capturar una recuperación parcial.");
      return parts.join(" ");
    },
    getActionText: (_ev, p) => {
      const parts: string[] = [];
      if (p.quantity && p.price) parts.push(`Compra: ${fN(p.quantity, 6)} @ ${fUsd(p.price)}`);
      if (p.tpPct) parts.push(`TP objetivo: +${fN(p.tpPct)}%`);
      return parts.length > 0 ? parts.join(". ") + "." : "Recovery cycle abierto.";
    },
  },

  recovery_cycle_blocked: {
    icon: "🛡️",
    title: "Ciclo de recuperación bloqueado",
    category: "warning",
    getHumanSummary: (ev, p) => {
      const msg = ev.message || "";
      const parts = ["El ciclo principal cumple las condiciones de drawdown, pero el recovery fue bloqueado."];
      if (p.blockReasons && Array.isArray(p.blockReasons)) {
        parts.push(`Motivos: ${p.blockReasons.join("; ")}.`);
      } else if (msg.includes("blocked:")) {
        parts.push(msg.replace("Recovery blocked: ", "Motivos: ") + ".");
      }
      parts.push("El bot seguirá vigilando para futuros intentos.");
      return parts.join(" ");
    },
    getActionText: () => "Sin acción. Esperando que se resuelvan las restricciones.",
  },

  recovery_cycle_closed: {
    icon: "📊",
    title: "Ciclo de recuperación cerrado",
    category: "info",
    getHumanSummary: (_ev, p) => {
      const parts = ["El ciclo de recuperación se cerró."];
      if (p.pnlPct != null) parts.push(`Resultado: ${p.pnlPct >= 0 ? "+" : ""}${fN(p.pnlPct)}%.`);
      if (p.pnlUsd != null) parts.push(`(${p.pnlUsd >= 0 ? "+" : ""}${fUsd(Math.abs(p.pnlUsd))})`);
      if (p.closeReason) {
        const reasons: Record<string, string> = {
          tp_reached: "TP alcanzado",
          trailing_exit: "Salida por trailing",
          main_cycle_closed: "Ciclo principal cerrado",
          main_recovered: "Ciclo principal se recuperó",
          max_duration_exceeded: "Duración máxima superada",
        };
        parts.push(`Motivo: ${reasons[p.closeReason] || p.closeReason}.`);
      }
      if (p.durationStr) parts.push(`Duración: ${p.durationStr}.`);
      return parts.join(" ");
    },
    getActionText: (_ev, p) =>
      p.netValue ? `Capital liberado: ${fUsd(p.netValue)}.` : "Capital liberado.",
  },

  recovery_cycle_risk_warning: {
    icon: "⚠️",
    title: "Alerta de riesgo: exposición elevada",
    category: "warning",
    getHumanSummary: (_ev, p) => {
      const parts = ["Con el ciclo de recuperación activo, la exposición total se acerca al límite."];
      if (p.pairExposure != null && p.pairExposurePct != null) {
        parts.push(`Exposición del par: ${fUsd(p.pairExposure)} (${fN(p.pairExposurePct)}%).`);
      }
      if (p.maxPairExposurePct != null) parts.push(`Límite: ${fN(p.maxPairExposurePct)}%.`);
      parts.push("No se abrirán más ciclos hasta reducir la exposición.");
      return parts.join(" ");
    },
    getActionText: () => "Sin acción. Monitoreo activo de exposición.",
  },

  // ── WARNING (amarillo) ──────────────────────────────
  entry_check_blocked: {
    icon: "⛔",
    title: "Entrada bloqueada",
    category: "warning",
    getHumanSummary: (ev, p) => {
      const blockReasons: any[] = ev.payloadJson?.blockReasons || [];
      const codes = blockReasons.map((r: any) => r?.code || r).filter(Boolean);
      const isDataIssue = codes.some((c: string) => c === "data_not_ready" || c === "insufficient_base_price_data");
      const meta = ev.payloadJson?.basePrice?.meta;

      // Caso 1: problema de datos — diferenciar de condiciones de mercado
      if (isDataIssue) {
        if (meta?.candleCount != null) {
          return `No se compró porque el sistema aún no dispone de suficientes velas (${meta.candleCount}/7) para calcular una referencia de precio fiable. El sistema seguirá reintentando automáticamente.`;
        }
        return "No se compró porque el sistema aún no dispone de suficientes datos de mercado para calcular una referencia fiable. El sistema seguirá reintentando automáticamente.";
      }

      // Caso 2: condiciones de mercado
      const marketCodes = codes.filter((c: string) => c !== "data_not_ready" && c !== "insufficient_base_price_data");
      if (marketCodes.length > 0) {
        const labels = marketCodes.map((c: string) => BLOCK_REASON_LABELS[c] || c);
        if (p.entryDipPct != null && p.basePrice != null && p.basePrice > 0) {
          return `No se compró: ${labels.join("; ")}. Caída actual: ${fN(p.entryDipPct)}% desde ${fUsd(p.basePrice)}.`;
        }
        return `No se compró: ${labels.join("; ")}.`;
      }

      // Fallback
      return "El bot evaluó la entrada pero no se cumplen todas las condiciones necesarias para comprar.";
    },
    getActionText: () => "Sin acción. El bot seguirá vigilando.",
  },

  entry_evaluated: {
    icon: "📊",
    title: "Evaluación de entrada",
    category: "info",
    getHumanSummary: (ev, p) => {
      if (p.action === "allowed") {
        return `Entrada PERMITIDA para ${ev.pair || "?"}: caída ${fN(p.dip)}% ≥ mínimo ${fN(p.minDip)}%. Base: ${fUsd(p.basePrice)}.`;
      }
      return `Entrada bloqueada para ${ev.pair || "?"}: caída ${fN(p.dip)}% vs mínimo ${fN(p.minDip)}%. Motivo: ${p.reason || "condiciones insuficientes"}.`;
    },
    getActionText: (_ev, p) =>
      p.action === "allowed" ? "Entrada autorizada — siguiente paso: ejecución de compra." : "Sin acción. El bot sigue vigilando.",
  },

  buy_blocked: {
    icon: "🟠",
    title: "Compra bloqueada",
    category: "warning",
    getHumanSummary: (ev, _p) => {
      const msg = ev.message || "";
      for (const [code, label] of Object.entries(BLOCK_REASON_LABELS)) {
        if (msg.includes(code)) return `Compra bloqueada: ${label}.`;
      }
      return "La compra fue bloqueada por no cumplir los requisitos de seguridad.";
    },
    getActionText: () => "Sin acción. Esperando mejores condiciones.",
  },

  protection_armed: {
    icon: "🛡️",
    title: "Protección de capital armada",
    category: "warning",
    getHumanSummary: () =>
      `La posición entró en zona positiva y la protección de break-even se ha armado. Si el precio retrocede hasta el punto de entrada, el bot cerrará automáticamente para proteger el capital.`,
    getActionText: () => "Protección activa. El capital está protegido si hay retroceso.",
  },

  smart_adjustment_applied: {
    icon: "🧠",
    title: "Ajuste inteligente del bot",
    category: "warning",
    getHumanSummary: (ev) => {
      const msg = ev.message || "";
      return `El bot ajustó automáticamente un parámetro basándose en las condiciones actuales del mercado. ${msg}`;
    },
    getActionText: () => "Parámetros optimizados automáticamente.",
  },

  // ── INFO (azul) ──────────────────────────────
  mode_transition: {
    icon: "🔄",
    title: "Cambio de modo del módulo",
    category: "info",
    getHumanSummary: (ev) => {
      const msg = ev.message || "";
      if (msg.includes("simulation") && msg.includes("live")) {
        return "El módulo cambió de modo simulación a modo real. Las operaciones ahora se ejecutan con fondos reales.";
      }
      if (msg.includes("live") && msg.includes("simulation")) {
        return "El módulo volvió a modo simulación. Las operaciones no afectan fondos reales.";
      }
      return "El módulo cambió de modo de operación.";
    },
    getActionText: () => "Nuevo modo de operación activo.",
  },

  config_changed: {
    icon: "⚙️",
    title: "Configuración modificada",
    category: "system",
    getHumanSummary: () =>
      "Se modificó la configuración del módulo IDCA. Los nuevos parámetros se aplicarán en el próximo tick.",
    getActionText: () => "Configuración actualizada.",
  },

  imported_position_created: {
    icon: "📥",
    title: "Posición importada al IDCA",
    category: "info",
    getHumanSummary: (_ev, p) =>
      `Se importó una posición existente para que el IDCA la gestione.${p.price ? ` Precio medio: ${fUsd(p.price)}.` : ""}`,
    getActionText: () => "El IDCA gestionará esta posición desde ahora.",
  },

  imported_position_closed: {
    icon: "📤",
    title: "Posición importada cerrada",
    category: "info",
    getHumanSummary: (_ev, p) =>
      `La posición importada fue cerrada.${p.pnlPct ? ` Resultado: ${p.pnlPct >= 0 ? "+" : ""}${fN(p.pnlPct)}%.` : ""}`,
    getActionText: () => "Posición importada finalizada.",
  },
};

const DEFAULT_VISUAL: EventVisual = {
  icon: "📋",
  title: "Evento del sistema",
  category: "system",
  getHumanSummary: (ev) => ev.humanMessage || ev.message || "Evento registrado.",
  getActionText: () => "—",
};

// ════════════════════════════════════════════════════════════════════
// COLOR SYSTEM
// ════════════════════════════════════════════════════════════════════

const CATEGORY_STYLES: Record<EventCategory, {
  border: string; bg: string; badge: string; badgeText: string; text: string; accent: string;
}> = {
  positive: {
    border: "border-l-emerald-500",
    bg: "bg-emerald-500/5 hover:bg-emerald-500/10",
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    badgeText: "Acción positiva",
    text: "text-emerald-400",
    accent: "border-emerald-500/30",
  },
  negative: {
    border: "border-l-red-500",
    bg: "bg-red-500/5 hover:bg-red-500/10",
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    badgeText: "Alerta",
    text: "text-red-400",
    accent: "border-red-500/30",
  },
  warning: {
    border: "border-l-amber-500",
    bg: "bg-amber-500/5 hover:bg-amber-500/10",
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    badgeText: "Precaución",
    text: "text-amber-400",
    accent: "border-amber-500/30",
  },
  info: {
    border: "border-l-blue-500",
    bg: "bg-blue-500/5 hover:bg-blue-500/10",
    badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    badgeText: "Información",
    text: "text-blue-400",
    accent: "border-blue-500/30",
  },
  system: {
    border: "border-l-slate-500",
    bg: "bg-slate-500/5 hover:bg-slate-500/10",
    badge: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    badgeText: "Sistema",
    text: "text-slate-400",
    accent: "border-slate-500/30",
  },
};

const SEVERITY_OVERRIDE: Record<string, EventCategory> = {
  critical: "negative",
  error: "negative",
};

// ════════════════════════════════════════════════════════════════════
// TIME FORMATTING
// ════════════════════════════════════════════════════════════════════

function fmtTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleString("es-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtTimeShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60000) return "hace unos segundos";
  if (ms < 3600000) return `hace ${Math.floor(ms / 60000)} min`;
  if (ms < 86400000) return `hace ${Math.floor(ms / 3600000)}h`;
  return `hace ${Math.floor(ms / 86400000)}d`;
}

// ════════════════════════════════════════════════════════════════════
// KEY-VALUE DISPLAY
// ════════════════════════════════════════════════════════════════════

function DataPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-start gap-0.5 min-w-[80px]">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-medium">{label}</span>
      <span className={cn("text-xs font-mono font-semibold", color || "text-foreground")}>{value}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SINGLE EVENT CARD — doble capa
// ════════════════════════════════════════════════════════════════════

interface IdcaEventCardProps {
  event: any;
  isExpanded: boolean;
  onToggle: () => void;
}

export function IdcaEventCard({ event, isExpanded, onToggle }: IdcaEventCardProps) {
  const [techOpen, setTechOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const visual = EVENT_CATALOG[event.eventType] || DEFAULT_VISUAL;
  const parsed = parsePayload(event);

  // Severity can override category
  const category = SEVERITY_OVERRIDE[event.severity] || visual.category;
  const style = CATEGORY_STYLES[category];

  const humanSummary = visual.getHumanSummary(event, parsed);
  const actionText = visual.getActionText(event, parsed);

  const handleCopyTech = () => {
    const text = JSON.stringify({ id: event.id, ...event, payloadJson: parsed }, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={cn(
      "border-l-[3px] rounded-lg transition-all duration-200",
      style.border,
      isExpanded ? "ring-1 ring-white/5" : "",
    )}>
      {/* ── CAPA HUMANA (siempre visible) ───────────────── */}
      <div
        className={cn(
          "flex items-start gap-3 px-4 py-3 cursor-pointer rounded-r-lg transition-colors",
          style.bg,
        )}
        onClick={onToggle}
      >
        {/* Icon */}
        <span className="text-xl mt-0.5 shrink-0 select-none">{visual.icon}</span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Row 1: Title + Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground leading-tight">
              {visual.title}
            </span>
            {event.pair && (
              <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 h-[18px]">
                {event.pair}
              </Badge>
            )}
            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-[16px] border", style.badge)}>
              {style.badgeText}
            </Badge>
            {event.mode && (
              <Badge variant="outline" className={cn(
                "text-[9px] font-mono px-1.5 py-0 h-[16px]",
                event.mode === "simulation" ? "text-cyan-400 border-cyan-400/30" : "text-green-400 border-green-400/30",
              )}>
                {event.mode === "simulation" ? "SIM" : "LIVE"}
              </Badge>
            )}
          </div>

          {/* Row 2: Human summary */}
          <p className="text-[12px] text-muted-foreground leading-relaxed mt-1.5 max-w-[700px]">
            {humanSummary}
          </p>

          {/* Row 3: Key data pills (inline, compact) */}
          {!isExpanded && (
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {parsed.price != null && <DataPill label="Precio" value={fUsd(parsed.price)} />}
              {parsed.entryDipPct != null && <DataPill label="Caída" value={`-${fN(parsed.entryDipPct)}%`} color="text-amber-400" />}
              {parsed.marketScore != null && <DataPill label="Score" value={`${parsed.marketScore}/100`} />}
              {parsed.pnlPct != null && (
                <DataPill label="Resultado" value={`${parsed.pnlPct >= 0 ? "+" : ""}${fN(parsed.pnlPct)}%`}
                  color={parsed.pnlPct >= 0 ? "text-emerald-400" : "text-red-400"} />
              )}
            </div>
          )}
        </div>

        {/* Right side: time + expand */}
        <div className="flex flex-col items-end gap-1 shrink-0 min-w-[80px]">
          <span className="text-[10px] text-muted-foreground font-mono">{fmtTimeShort(event.createdAt)}</span>
          <span className="text-[9px] text-muted-foreground/60">{timeAgo(event.createdAt)}</span>
          {isExpanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground mt-1" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground mt-1" />
          }
        </div>
      </div>

      {/* ── CAPA EXPANDIDA ───────────────── */}
      {isExpanded && (
        <div className="px-5 pb-4 pt-1 space-y-4 border-t border-white/5">

          {/* A. Acción tomada */}
          <div className="flex items-start gap-2.5 mt-2">
            <div className={cn("w-1 h-full min-h-[24px] rounded-full shrink-0", style.border.replace("border-l-", "bg-"))} />
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Acción del bot</span>
              <p className="text-[12px] text-foreground font-medium mt-0.5">{actionText}</p>
            </div>
          </div>

          {/* B. Datos clave — grid */}
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Datos clave</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-2.5 mt-2 p-3 rounded-md bg-white/[0.02] border border-white/5">
              {event.pair && <DataPill label="Par" value={event.pair} />}
              {event.mode && <DataPill label="Modo" value={event.mode === "simulation" ? "Simulación" : "Real"} />}
              {parsed.price != null && <DataPill label="Precio" value={fUsd(parsed.price)} />}
              {parsed.avgEntry != null && <DataPill label="Precio medio" value={fUsd(parsed.avgEntry)} />}
              {parsed.basePrice != null && parsed.basePrice > 0 && <DataPill label="Precio base" value={fUsd(parsed.basePrice)} />}
              {(parsed.basePrice == null || parsed.basePrice === 0) && event.payloadJson?.basePrice?.meta?.candleCount != null && (
                <DataPill label="Velas OHLCV" value={`${event.payloadJson.basePrice.meta.candleCount}/7`}
                  color={event.payloadJson.basePrice.meta.candleCount < 7 ? "text-amber-400" : "text-emerald-400"} />
              )}
              {parsed.basePriceType && <DataPill label="Tipo base" value={parsed.basePriceType} />}
              {parsed.entryDipPct != null && <DataPill label="Caída entrada" value={`-${fN(parsed.entryDipPct)}%`} color="text-amber-400" />}
              {parsed.quantity != null && <DataPill label="Cantidad" value={fN(parsed.quantity, 6)} />}
              {parsed.capital != null && <DataPill label="Capital" value={fUsd(parsed.capital)} />}
              {parsed.marketScore != null && <DataPill label="Score" value={`${parsed.marketScore}`} />}
              {parsed.sizeProfile && <DataPill label="Perfil" value={parsed.sizeProfile} />}
              {parsed.pnlPct != null && (
                <DataPill label="PnL %" value={`${parsed.pnlPct >= 0 ? "+" : ""}${fN(parsed.pnlPct)}%`}
                  color={parsed.pnlPct >= 0 ? "text-emerald-400" : "text-red-400"} />
              )}
              {parsed.pnlUsd != null && (
                <DataPill label="PnL USD" value={`${parsed.pnlUsd >= 0 ? "+" : ""}${fUsd(Math.abs(parsed.pnlUsd))}`}
                  color={parsed.pnlUsd >= 0 ? "text-emerald-400" : "text-red-400"} />
              )}
              {parsed.buyCount != null && <DataPill label="Compras" value={`${parsed.buyCount}`} />}
              {parsed.maxDD != null && parsed.maxDD > 0 && (
                <DataPill label="Max Drawdown" value={`-${fN(parsed.maxDD)}%`} color="text-red-400" />
              )}
              {parsed.distToNextSafety != null && (
                <DataPill label="Dist. Safety Buy" value={`${fN(parsed.distToNextSafety)}%`}
                  color={parsed.distToNextSafety < 1 ? "text-amber-400" : "text-muted-foreground"} />
              )}
              {parsed.distToTp != null && (
                <DataPill label="Dist. TP" value={`${fN(parsed.distToTp)}%`}
                  color={parsed.distToTp < 1 ? "text-emerald-400" : "text-muted-foreground"} />
              )}
              {parsed.distToProtectionStop != null && (
                <DataPill label="Dist. Protección" value={`${fN(parsed.distToProtectionStop)}%`}
                  color={parsed.distToProtectionStop < 1 ? "text-amber-400" : "text-muted-foreground"} />
              )}
              {parsed.distToTrailingActivation != null && (
                <DataPill label="Dist. Trailing" value={`${fN(parsed.distToTrailingActivation)}%`}
                  color={parsed.distToTrailingActivation < 1.5 ? "text-emerald-400" : "text-muted-foreground"} />
              )}
              {parsed.tpPct != null && <DataPill label="TP" value={`+${fN(parsed.tpPct, 1)}%`} color="text-emerald-400" />}
              {parsed.parentCycleId != null && <DataPill label="Ciclo padre" value={`#${parsed.parentCycleId}`} />}
            </div>
          </div>

          {/* B2. Cálculo de base — solo si hay meta híbrido */}
          {parsed.basePriceMeta && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Cálculo de base (Hybrid V2.1)</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mt-2 p-3 rounded-md bg-white/[0.02] border border-white/5">
                {parsed.basePriceMeta.selectedAnchorPrice != null && (
                  <DataPill label="Ancla" value={fUsd(parsed.basePriceMeta.selectedAnchorPrice)} color="text-sky-400" />
                )}
                {parsed.basePriceMeta.drawdownPctFromAnchor != null && (
                  <DataPill label="Caída desde ancla" value={`-${fN(parsed.basePriceMeta.drawdownPctFromAnchor)}%`}
                    color={parsed.basePriceMeta.drawdownPctFromAnchor > 0 ? "text-amber-400" : "text-muted-foreground"} />
                )}
                {parsed.basePriceMeta.selectedMethod && (
                  <DataPill label="Método" value={parsed.basePriceMeta.selectedMethod} />
                )}
                {parsed.basePriceMeta.atrPct != null && (
                  <DataPill label="ATR%" value={`${fN(parsed.basePriceMeta.atrPct)}%`} />
                )}
                {parsed.basePriceMeta.candidates?.p95_24h != null && (
                  <DataPill label="P95 24h" value={fUsd(parsed.basePriceMeta.candidates.p95_24h)} color="text-violet-400" />
                )}
                {parsed.basePriceMeta.candidates?.p95_7d != null && (
                  <DataPill label="P95 7d" value={fUsd(parsed.basePriceMeta.candidates.p95_7d)} color="text-violet-300" />
                )}
                {parsed.basePriceMeta.candidates?.p95_30d != null && (
                  <DataPill label="P95 30d" value={fUsd(parsed.basePriceMeta.candidates.p95_30d)} color="text-violet-200" />
                )}
                {parsed.basePriceMeta.candidates?.swingHigh24h != null && (
                  <DataPill label="Swing 24h" value={fUsd(parsed.basePriceMeta.candidates.swingHigh24h)} />
                )}
                {parsed.basePriceMeta.outlierRejected && (
                  <DataPill label="Outlier rechazado" value={fUsd(parsed.basePriceMeta.outlierRejectedValue)} color="text-orange-400" />
                )}
                {parsed.basePriceMeta.capsApplied?.cappedBy7d && (
                  <DataPill label="Cap aplicado" value="7d" color="text-amber-300" />
                )}
                {parsed.basePriceMeta.capsApplied?.cappedBy30d && (
                  <DataPill label="Cap aplicado" value="30d" color="text-amber-300" />
                )}
              </div>
              {parsed.basePriceMeta.selectedReason && (
                <p className="mt-1.5 text-[10px] text-muted-foreground/60 italic px-1">{parsed.basePriceMeta.selectedReason}</p>
              )}
            </div>
          )}

          {/* C. Detalle técnico (colapsable) */}
          <div>
            <button
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors font-medium"
              onClick={(e) => { e.stopPropagation(); setTechOpen(!techOpen); }}
            >
              {techOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Detalle técnico
            </button>
            {techOpen && (
              <div className="mt-2 p-3 rounded-md bg-black/40 border border-white/5 font-mono text-[10px] text-muted-foreground/80 space-y-1.5 relative">
                <button
                  className="absolute top-2 right-2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                  onClick={(e) => { e.stopPropagation(); handleCopyTech(); }}
                  title="Copiar JSON"
                >
                  {copied ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <div><span className="text-muted-foreground/50">ID:</span> {event.id}</div>
                <div><span className="text-muted-foreground/50">Tipo:</span> {event.eventType}</div>
                <div><span className="text-muted-foreground/50">Severidad:</span> {event.severity}</div>
                <div><span className="text-muted-foreground/50">Timestamp:</span> {event.createdAt}</div>
                {event.cycleId && <div><span className="text-muted-foreground/50">Ciclo ID:</span> {event.cycleId}</div>}
                <div><span className="text-muted-foreground/50">Mensaje raw:</span> {event.message}</div>
                {event.humanTitle && <div><span className="text-muted-foreground/50">humanTitle:</span> {event.humanTitle}</div>}
                {event.humanMessage && <div><span className="text-muted-foreground/50">humanMessage:</span> {event.humanMessage}</div>}
                {event.technicalSummary && <div><span className="text-muted-foreground/50">technicalSummary:</span> {event.technicalSummary}</div>}
                {event.payloadJson && Object.keys(event.payloadJson).length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-white/5">
                    <span className="text-muted-foreground/50">Payload:</span>
                    <pre className="mt-1 text-[9px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(event.payloadJson, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// EVENTS LIST — lista completa con filtros
// ════════════════════════════════════════════════════════════════════

interface IdcaEventsListProps {
  events: any[];
  maxHeight?: string;
}

export function IdcaEventsList({ events, maxHeight = "700px" }: IdcaEventsListProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (events.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-8 text-center text-muted-foreground">
          <p className="text-sm">No hay eventos que mostrar</p>
          <p className="text-xs mt-1 text-muted-foreground/60">Los eventos aparecerán aquí cuando el módulo IDCA esté activo.</p>
        </CardContent>
      </Card>
    );
  }

  const style = maxHeight === "none"
    ? { overflow: 'visible' as const }
    : { maxHeight, overflowY: 'auto' as const };

  return (
    <div className="space-y-2" style={style}>
      {events.map((ev) => (
        <IdcaEventCard
          key={ev.id}
          event={ev}
          isExpanded={expandedId === ev.id}
          onToggle={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
        />
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// LIVE MONITOR — versión enriquecida del terminal
// ════════════════════════════════════════════════════════════════════

export function IdcaLiveEventsFeed({ events }: { events: any[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-6 w-6 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Sin actividad reciente</p>
        <p className="text-xs mt-1 text-muted-foreground/60">Los eventos aparecerán aquí en tiempo real.</p>
      </div>
    );
  }

  // Show last 50 as compact cards
  return (
    <div className="space-y-1.5 max-h-[75vh] overflow-auto">
      {events.slice(0, 50).map((ev) => (
        <IdcaEventCard
          key={ev.id}
          event={ev}
          isExpanded={expandedId === ev.id}
          onToggle={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
        />
      ))}
    </div>
  );
}

// Re-export catalog for use in filters
export const EVENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(EVENT_CATALOG).map(([k, v]) => [k, v.title])
);

export const EVENT_CATEGORIES = CATEGORY_STYLES;
