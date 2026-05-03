/**
 * idcaMarketContextHelpers.ts — Helpers puros para Contexto de Mercado IDCA.
 * Sin dependencias de React ni UI — testables directamente con vitest.
 */

export type FreshnessState = "realtime" | "recent" | "stale";
export type ReferencePriceState = "stable" | "recently_changed" | "unknown";
export type VwapZone = "below_lower3" | "below_lower2" | "below_lower1" | "between_bands" | "above_upper1" | "above_upper2";
export type DataQuality = "excellent" | "good" | "poor" | "insufficient";

export interface MarketContextQualityDetail {
  status: "ok" | "partial" | "poor";
  reason: "ok" | "warming_up_cache" | "insufficient_candles" | "stale_market_data" | "missing_atrp" | "missing_vwap_zone" | "missing_anchor";
  candleCount: number;
  requiredForOptimal: number;
  hasVwap: boolean;
  hasAtrp: boolean;
}

export interface ZoneVisual {
  label: string;
  labelShort: string;
  color: string;
  badgeClass: string;
  position: number;
  favorable: boolean;
}

export interface MarketNarrative {
  title: string;
  description: string;
  icon: "ok" | "warning" | "caution" | "alert";
  /** Texto corto para modo compacto (≤ 60 chars) */
  shortText: string;
}

export function getFreshnessState(lastUpdated?: string): FreshnessState {
  if (!lastUpdated) return "stale";
  const ageMin = (Date.now() - new Date(lastUpdated).getTime()) / 60_000;
  if (ageMin <= 5) return "realtime";
  if (ageMin <= 15) return "recent";
  return "stale";
}

export function getReferencePriceState(anchorPriceUpdatedAt?: string): ReferencePriceState {
  if (!anchorPriceUpdatedAt) return "unknown";
  const ageH = (Date.now() - new Date(anchorPriceUpdatedAt).getTime()) / 3_600_000;
  return ageH < 24 ? "recently_changed" : "stable";
}

export function getZoneVisual(zone?: VwapZone | string): ZoneVisual {
  switch (zone) {
    case "below_lower3":
      return { label: "Valor profundo", labelShort: "Profundo", color: "text-emerald-400", badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", position: 5, favorable: true };
    case "below_lower2":
      return { label: "Valor fuerte", labelShort: "Valor+", color: "text-green-400", badgeClass: "bg-green-500/15 text-green-400 border-green-500/30", position: 18, favorable: true };
    case "below_lower1":
      return { label: "Zona de valor", labelShort: "Valor", color: "text-cyan-400", badgeClass: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30", position: 33, favorable: true };
    case "between_bands":
      return { label: "Zona neutra", labelShort: "Neutro", color: "text-yellow-400", badgeClass: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", position: 50, favorable: false };
    case "above_upper1":
      return { label: "Sobreextendido", labelShort: "Sobre+", color: "text-orange-400", badgeClass: "bg-orange-500/15 text-orange-400 border-orange-500/30", position: 68, favorable: false };
    case "above_upper2":
      return { label: "Muy sobreextendido", labelShort: "Sobre++", color: "text-red-400", badgeClass: "bg-red-500/15 text-red-400 border-red-500/30", position: 85, favorable: false };
    default:
      return { label: "Desconocido", labelShort: "N/A", color: "text-muted-foreground", badgeClass: "bg-muted/30 text-muted-foreground border-border/30", position: 50, favorable: false };
  }
}

export function getAtrpLabel(atrPct?: number): { label: string; color: string } {
  if (atrPct === undefined) return { label: "N/A", color: "text-muted-foreground" };
  if (atrPct < 1.5) return { label: "Bajo", color: "text-green-400" };
  if (atrPct < 3.5) return { label: "Medio", color: "text-yellow-400" };
  return { label: "Alto", color: "text-orange-400" };
}

export function formatAgeLabel(iso?: string): string {
  if (!iso) return "";
  const ageMs = Date.now() - new Date(iso).getTime();
  const ageMin = Math.floor(ageMs / 60_000);
  if (ageMin < 1) return "hace unos segundos";
  if (ageMin < 60) return `hace ${ageMin}m`;
  const ageH = Math.floor(ageMin / 60);
  if (ageH < 24) return `hace ${ageH}h`;
  const ageD = Math.floor(ageH / 24);
  return `hace ${ageD}d`;
}

export function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Texto corto para el badge de calidad en modo compacto.
 * Ej: "Parcial: calentando", "Parcial: 34/100 velas", "Parcial: falta VWAP"
 */
export function getQualityBadgeText(qualityDetail?: MarketContextQualityDetail): string {
  if (!qualityDetail) return "Parcial";
  if (qualityDetail.status === "ok") return "Óptima";
  if (qualityDetail.status === "poor") return "Insuficiente";
  // partial
  switch (qualityDetail.reason) {
    case "warming_up_cache":
      return "Parcial: calentando";
    case "insufficient_candles":
      return `Parcial: ${qualityDetail.candleCount}/${qualityDetail.requiredForOptimal} velas`;
    case "missing_vwap_zone":
      return "Parcial: falta VWAP";
    case "missing_atrp":
      return "Parcial: falta ATRP";
    default:
      return "Parcial";
  }
}

/**
 * Construye la narrativa interpretativa del contexto de mercado.
 *
 * Prioridad:
 * 1. freshness stale → "Datos desactualizados" (siempre, crítico)
 * 2. qualityDetail.status === "poor" (< 20 velas) → "Datos a revisar"
 * 3. qualityDetail.reason === "warming_up_cache" → "Histórico calentando"
 * 4. qualityDetail.reason === "insufficient_candles" (parcial, ≥ 20 velas) → "Histórico parcial"
 * 5. qualityDetail.status === "ok" → zona-based narrative
 * 6. qualityDetail.reason === "missing_vwap_zone" / "missing_atrp" → zona + nota parcial
 */
export function buildMarketContextNarrative(data: {
  vwapZone?: VwapZone | string;
  dataQuality?: DataQuality;
  qualityDetail?: MarketContextQualityDetail;
  drawdownPct?: number;
  anchorPriceUpdatedAt?: string;
  lastUpdated?: string;
}): MarketNarrative {
  const freshness = getFreshnessState(data.lastUpdated);
  const refState = getReferencePriceState(data.anchorPriceUpdatedAt);
  const zone = data.vwapZone;
  const drawdown = data.drawdownPct ?? 0;
  const qd = data.qualityDetail;

  // 1. Datos desactualizados — señal crítica independiente de calidad
  if (freshness === "stale") {
    return {
      title: "Datos desactualizados",
      description: "El último contexto de mercado no es reciente. Revisar conexión/caché antes de confiar en esta lectura.",
      shortText: "Último contexto no reciente",
      icon: "alert",
    };
  }

  // 2. Poor quality → verdaderamente faltan datos críticos (< 20 velas)
  if (qd?.status === "poor" || (!qd && (data.dataQuality === "insufficient"))) {
    return {
      title: "Datos a revisar",
      description: "Faltan datos clave para calcular el contexto con precisión. La entrada se evalúa de forma conservadora hasta recuperar datos suficientes.",
      shortText: "Faltan datos críticos",
      icon: "alert",
    };
  }

  // 3. Caché calentando — tiene datos en tiempo real pero histórico incompleto
  if (qd?.reason === "warming_up_cache") {
    const refMsg = refState === "recently_changed" ? " Referencia revisada recientemente." : "";
    return {
      title: "Histórico calentando",
      description: `El sistema ya tiene datos en tiempo real, pero todavía está completando el histórico necesario para afinar bandas, ATRP y referencia (${qd.candleCount}/${qd.requiredForOptimal} velas). La evaluación sigue activa con margen de seguridad.${refMsg}`,
      shortText: `Calentando: ${qd.candleCount}/${qd.requiredForOptimal} velas`,
      icon: "warning",
    };
  }

  // 4. Histórico parcial (tiene datos pero no los 100 óptimos)
  if (qd?.status === "partial" && qd.reason === "insufficient_candles") {
    return {
      title: "Histórico parcial",
      description: `Hay datos suficientes para seguimiento básico, pero faltan velas históricas para máxima precisión. Velas disponibles: ${qd.candleCount}/${qd.requiredForOptimal}.`,
      shortText: `Parcial: ${qd.candleCount}/${qd.requiredForOptimal} velas`,
      icon: "warning",
    };
  }

  // A partir de aquí tenemos datos suficientes para narrativa de zona
  const refMsg = refState === "recently_changed" ? " Referencia de entrada revisada recientemente." : "";

  // 5. Zona favorable
  if (zone === "below_lower3" || zone === "below_lower2") {
    return {
      title: "Contexto favorable",
      description: `El precio se encuentra en zona de valor ${zone === "below_lower3" ? "profundo" : "fuerte"}, por debajo de las bandas VWAP inferiores (drawdown ${drawdown.toFixed(1)}%). Las condiciones son favorables para evaluar entradas.${refMsg}`,
      shortText: `Zona de valor — DD ${drawdown.toFixed(1)}%`,
      icon: "ok",
    };
  }

  if (zone === "below_lower1") {
    return {
      title: "Contexto de valor",
      description: `El precio está en zona de valor dentro del rango inferior de bandas VWAP (drawdown ${drawdown.toFixed(1)}%). Contexto positivo para entradas con confirmación de rebote.${refMsg}`,
      shortText: `Zona valor — DD ${drawdown.toFixed(1)}%`,
      icon: "ok",
    };
  }

  // 6. Zona sobreextendida
  if (zone === "above_upper2") {
    return {
      title: "Contexto exigente",
      description: `El precio está muy por encima de las bandas VWAP (drawdown ${drawdown.toFixed(1)}%). El sistema evalúa entradas con máxima prudencia en este nivel de extensión.`,
      shortText: `Sobreextendido — DD ${drawdown.toFixed(1)}%`,
      icon: "caution",
    };
  }

  if (zone === "above_upper1") {
    return {
      title: "Contexto exigente",
      description: `El precio se encuentra por encima de la banda superior VWAP. Las entradas se evalúan con criterios más estrictos hasta que el precio corrija hacia zona neutra o de valor.`,
      shortText: `Sobreextendido leve`,
      icon: "caution",
    };
  }

  // 7. Estado ok con datos completos — "Contexto actualizado"
  if (qd?.status === "ok") {
    return {
      title: "Contexto actualizado",
      description: `El sistema dispone de datos suficientes para evaluar entradas con el contexto actual (${qd.candleCount}/${qd.requiredForOptimal} velas, VWAP y ATRP activos).${refMsg}`,
      shortText: "Datos completos",
      icon: "ok",
    };
  }

  // 8. Zona neutra con calidad parcial (missing_vwap o missing_atrp pero funcional)
  const partialNote = qd?.reason === "missing_vwap_zone"
    ? " VWAP no disponible, usando referencia alternativa."
    : qd?.reason === "missing_atrp"
    ? " ATRP no calculado, usando configuración fija."
    : "";
  return {
    title: "Contexto neutro",
    description: `El precio se encuentra en zona neutra (drawdown ${drawdown.toFixed(1)}%). El sistema evalúa entradas con los criterios estándar configurados.${partialNote}${refMsg}`,
    shortText: `Zona neutra — DD ${drawdown.toFixed(1)}%`,
    icon: "warning",
  };
}
