/**
 * gridActionNotices.ts — Pure helpers for actionable Grid notices.
 * No DOM, no React, no side-effects. Safe for unit tests.
 */

export type NoticeSeverity = "info" | "warning" | "error" | "success" | "shadow";

export interface GridActionNotice {
  id: string;
  severity: NoticeSeverity;
  title: string;
  shortText: string;
  explanation: string;
  technicalReason: string;
  impact: string;
  recommendedAction: string;
  targetTab?: string;
  targetSubTab?: string;
  targetField?: string;
  ctaLabel?: string;
  secondaryCtaLabel?: string;
}

export function buildGridActionNotices(
  status: any,
  auditData: any,
  levels: any[],
  cycles: any[]
): GridActionNotice[] {
  const notices: GridActionNotice[] = [];
  const mode: string = status?.mode ?? auditData?.mode ?? "OFF";
  const activeRangeId: string | null = status?.activeRangeVersionId ?? null;
  const realOpenOrders: number = status?.realOpenOrdersCount ?? 0;
  const pumpState: string = status?.pumpDumpState ?? "normal";
  const circuitBreaker: boolean = status?.circuitBreakerOpen ?? false;
  const lastReconciliationOk: boolean | null = status?.lastReconciliationOk ?? null;

  const totalLevels: number = levels?.length ?? 0;
  const historicalLevels = levels?.filter(l => l?.rangeVersionId !== activeRangeId) ?? [];

  if (mode === "SHADOW") {
    notices.push({
      id: "shadow_mode",
      severity: "shadow",
      title: "Niveles en SHADOW",
      shortText: "Simulación activa, sin órdenes reales.",
      explanation:
        "El Grid está evaluando el mercado y calculando niveles como si operara de verdad, pero no envía órdenes reales ni usa capital. Es una simulación segura para validar la estrategia.",
      technicalReason: `mode = ${mode}, realOpenOrdersCount = ${realOpenOrders}`,
      impact: "Sin impacto en capital. Sin órdenes reales.",
      recommendedAction: "Observa el comportamiento y cuando estés satisfecho, activa REAL_LIMITED.",
      targetTab: "resumen",
      ctaLabel: "Ver cómo funciona SHADOW",
      secondaryCtaLabel: "Ver configuración REAL",
    });
  }

  if (historicalLevels.length > 0) {
    notices.push({
      id: "historical_levels",
      severity: "info",
      title: "Hay niveles históricos",
      shortText: `${historicalLevels.length} niveles de rangos anteriores archivados.`,
      explanation:
        "Estos niveles pertenecen a rangos de precio anteriores. No son ejecutables por el motor y no afectan al PnL actual. Se conservan solo para auditoría histórica.",
      technicalReason: `${historicalLevels.length} niveles con rangeVersionId !== activeRangeVersionId`,
      impact: "Sin impacto operativo. Solo visibles en la vista histórica.",
      recommendedAction: "Usa el filtro Históricos en la pestaña Niveles para verlos. No es necesaria ninguna acción.",
      targetTab: "niveles",
      ctaLabel: "Ver históricos",
    });
  }

  if (pumpState !== "normal") {
    notices.push({
      id: "pump_dump_guard",
      severity: "warning",
      title: pumpState === "pump_detected" ? "Pump detectado" : pumpState === "dump_detected" ? "Dump detectado" : "Mercado volátil",
      shortText: "Compras nuevas pausadas por protección.",
      explanation:
        "El motor ha detectado un movimiento brusco del precio. Las nuevas compras están pausadas temporalmente hasta que el mercado se estabilice. Las órdenes existentes no se cancelen.",
      technicalReason: `pumpDumpState = ${pumpState}`,
      impact: "Nuevas órdenes BUY bloqueadas hasta que expire el cooldown.",
      recommendedAction: "Espera a que el mercado se estabilice. El sistema reanudará automáticamente.",
      targetTab: "resumen",
      ctaLabel: "Ver estado del motor",
    });
  }

  if (circuitBreaker) {
    notices.push({
      id: "circuit_breaker",
      severity: "error",
      title: "Circuit Breaker activo",
      shortText: "Todas las órdenes bloqueadas temporalmente.",
      explanation:
        "El circuit breaker se activa cuando se detectan condiciones de mercado extremas o errores críticos. Bloquea todas las operaciones para proteger el capital.",
      technicalReason: "circuitBreakerOpen = true",
      impact: "Sin nuevas órdenes. Ciclos existentes no se cierran automáticamente.",
      recommendedAction: "Revisa los logs de actividad para entender el motivo. Espera a que se desactive automáticamente o revisa configuración.",
      targetTab: "actividad",
      ctaLabel: "Ver actividad",
    });
  }

  if (lastReconciliationOk === false) {
    notices.push({
      id: "reconciliation_pending",
      severity: "warning",
      title: "Reconciliación pendiente",
      shortText: "El estado local y el exchange no coinciden del todo.",
      explanation:
        "La reconciliación verifica que el estado local (niveles, ciclos) coincide con el estado real del exchange. Mientras no pase, el desbloqueo a REAL queda bloqueado.",
      technicalReason: "lastReconciliationOk = false o null",
      impact: "No puedes activar REAL hasta resolver la reconciliación.",
      recommendedAction: "Ejecuta una reconciliación manual desde la pestaña Resumen o espera al siguiente ciclo automático.",
      targetTab: "resumen",
      ctaLabel: "Ver desbloqueo REAL",
    });
  }

  const proximityWarning = auditData?.levelsSummary?.proximityWarning;
  if (proximityWarning) {
    notices.push({
      id: "proximity_warning",
      severity: "info",
      title: "Separación condicionada por beneficio",
      shortText: "Los niveles están muy juntos dado el objetivo neto mínimo.",
      explanation:
        "El objetivo de beneficio neto mínimo limita cuántos niveles se pueden generar sin solaparse. Esto puede reducir el número de niveles activos.",
      technicalReason: "avgGapPct < 1.0 entre niveles",
      impact: "Menos operaciones simultáneas. El Grid es más selectivo.",
      recommendedAction: "Reduce el objetivo neto mínimo, ajusta el número de niveles o amplía la banda.",
      targetTab: "ajustes",
      targetField: "netProfitTargetPct",
      ctaLabel: "Ir al objetivo neto",
    });
  }

  if (activeRangeId && auditData?.range?.rangeLifecycleStatus === "reusable") {
    notices.push({
      id: "range_reused",
      severity: "info",
      title: "Rango reutilizado",
      shortText: "El motor mantiene la banda porque sigue siendo válida.",
      explanation:
        "El rango activo no se regenera en cada tick. Se reutiliza mientras el precio siga dentro de la banda y el régimen de mercado siga siendo compatible.",
      technicalReason: "rangeLifecycleStatus = reusable",
      impact: "Sin acción necesaria. El Grid opera con el rango actual.",
      recommendedAction: "Si quieres forzar un análisis nuevo, usa el botón Analizar ahora.",
      targetTab: "bandas",
      ctaLabel: "Ver banda",
      secondaryCtaLabel: "Analizar ahora",
    });
  }

  return notices;
}

export function noticeIsBlocking(notice: GridActionNotice): boolean {
  return notice.severity === "error";
}

export function noticesByTab(
  notices: GridActionNotice[],
  tab: string
): GridActionNotice[] {
  return notices.filter(n => n.targetTab === tab);
}
