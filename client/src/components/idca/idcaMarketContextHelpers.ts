/**
 * idcaMarketContextHelpers.ts — Helpers puros para Contexto de Mercado IDCA.
 * Sin dependencias de React ni UI — testables directamente con vitest.
 */

export type FreshnessState = "realtime" | "recent" | "stale";
export type ReferencePriceState = "stable" | "recently_changed" | "unknown";
export type VwapZone = "below_lower3" | "below_lower2" | "below_lower1" | "between_bands" | "above_upper1" | "above_upper2";
export type DataQuality = "excellent" | "good" | "poor" | "insufficient";

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

export function buildMarketContextNarrative(data: {
  vwapZone?: VwapZone | string;
  dataQuality: DataQuality;
  drawdownPct?: number;
  anchorPriceUpdatedAt?: string;
  lastUpdated?: string;
}): MarketNarrative {
  const freshness = getFreshnessState(data.lastUpdated);
  const refState = getReferencePriceState(data.anchorPriceUpdatedAt);
  const zone = data.vwapZone;
  const quality = data.dataQuality;
  const drawdown = data.drawdownPct ?? 0;

  if (freshness === "stale") {
    return {
      title: "Datos desactualizados",
      description: "El contexto de mercado no se ha actualizado en los últimos 15 minutos. Los cálculos de entrada pueden estar basados en datos obsoletos. Verificar la conexión del scheduler.",
      icon: "alert",
    };
  }

  if (quality === "poor" || quality === "insufficient") {
    return {
      title: "Datos a revisar",
      description: "El sistema tiene datos de mercado insuficientes para calcular el contexto con precisión. La entrada se evalúa con más margen de seguridad hasta disponer de más velas históricas.",
      icon: "warning",
    };
  }

  if (zone === "below_lower3" || zone === "below_lower2") {
    const refMsg = refState === "recently_changed" ? " La referencia fue revisada recientemente." : "";
    return {
      title: "Contexto favorable",
      description: `El precio se encuentra en zona de valor ${zone === "below_lower3" ? "profundo" : "fuerte"}, por debajo de las bandas VWAP inferiores (drawdown ${drawdown.toFixed(1)}%). Las condiciones son favorables para evaluar entradas.${refMsg}`,
      icon: "ok",
    };
  }

  if (zone === "below_lower1") {
    return {
      title: "Contexto de valor",
      description: `El precio está en zona de valor dentro del rango inferior de bandas VWAP (drawdown ${drawdown.toFixed(1)}%). Contexto positivo para entradas con confirmación de rebote.`,
      icon: "ok",
    };
  }

  if (zone === "above_upper2") {
    return {
      title: "Contexto exigente",
      description: `El precio está muy por encima de las bandas VWAP (drawdown ${drawdown.toFixed(1)}%). El sistema evalúa entradas con máxima prudencia en este nivel de extensión.`,
      icon: "caution",
    };
  }

  if (zone === "above_upper1") {
    return {
      title: "Contexto exigente",
      description: `El precio se encuentra por encima de la banda superior VWAP. Las entradas se evalúan con criterios más estrictos hasta que el precio corrija hacia zona neutra o de valor.`,
      icon: "caution",
    };
  }

  const refMsg = refState === "recently_changed"
    ? " La referencia de entrada fue revisada recientemente."
    : "";
  return {
    title: "Contexto neutro",
    description: `El precio se encuentra entre las bandas VWAP en zona neutra (drawdown ${drawdown.toFixed(1)}%). El sistema evalúa entradas con los criterios estándar configurados.${refMsg}`,
    icon: "warning",
  };
}
