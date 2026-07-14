/**
 * gridRetentionPolicy.ts — Pure helpers for retention policy dry-run preview.
 * NO deletes, NO DB writes, NO destructive operations.
 * Only computes which records WOULD be archived/hidden in future phases.
 */

export const RETENTION_DEFAULTS: {
  levelsMaxHistorical: number;
  cyclesMaxClosed: number;
  cyclesMaxCancelled: number;
  keepFilledCycles: boolean;
  keepActiveLevels: boolean;
  keepActiveRangeLevels: boolean;
} = {
  levelsMaxHistorical: 100,
  cyclesMaxClosed: 20,
  cyclesMaxCancelled: 10,
  keepFilledCycles: true,
  keepActiveLevels: true,
  keepActiveRangeLevels: true,
};

export interface RetentionLevelCandidate {
  id: string;
  status: string;
  rangeVersionId: string;
  isActiveRange: boolean;
  action: "keep_active" | "keep_recent" | "archive_candidate";
  reason: string;
}

export interface RetentionCycleCandidate {
  id: string;
  status: string;
  rangeVersionId: string;
  isActiveRange: boolean;
  action: "keep_active" | "keep_completed" | "keep_recent" | "archive_candidate";
  reason: string;
}

export interface RetentionPreviewResult {
  levelsTotal: number;
  levelsActiveRange: number;
  levelsKept: number;
  levelsArchiveCandidates: number;
  cyclesTotal: number;
  cyclesActive: number;
  cyclesKept: number;
  cyclesArchiveCandidates: number;
  levelCandidates: RetentionLevelCandidate[];
  cycleCandidates: RetentionCycleCandidate[];
  isDryRun: true;
  summary: string;
}

export function previewLevelRetention(
  levels: any[],
  activeRangeId: string | null,
  opts: Partial<typeof RETENTION_DEFAULTS> = {}
): RetentionLevelCandidate[] {
  const { levelsMaxHistorical, keepActiveLevels, keepActiveRangeLevels } = {
    ...RETENTION_DEFAULTS,
    ...opts,
  };

  if (!Array.isArray(levels)) return [];

  const activeRangeLevels = levels.filter(l => l?.rangeVersionId === activeRangeId);
  const historicalLevels = levels.filter(l => l?.rangeVersionId !== activeRangeId);

  const candidates: RetentionLevelCandidate[] = [];

  for (const level of activeRangeLevels) {
    candidates.push({
      id: level.id,
      status: level.status,
      rangeVersionId: level.rangeVersionId,
      isActiveRange: true,
      action: keepActiveRangeLevels ? "keep_active" : "keep_recent",
      reason: "Pertenece al rango activo",
    });
  }

  const sortedHistorical = [...historicalLevels].sort((a, b) => {
    const aDate = new Date(a?.createdAt ?? 0).getTime();
    const bDate = new Date(b?.createdAt ?? 0).getTime();
    return bDate - aDate;
  });

  for (let i = 0; i < sortedHistorical.length; i++) {
    const level = sortedHistorical[i];
    const isRecent = i < levelsMaxHistorical;
    candidates.push({
      id: level.id,
      status: level.status,
      rangeVersionId: level.rangeVersionId,
      isActiveRange: false,
      action: isRecent ? "keep_recent" : "archive_candidate",
      reason: isRecent
        ? `Dentro de los últimos ${levelsMaxHistorical} históricos`
        : `Más antiguo que el límite de ${levelsMaxHistorical} niveles históricos`,
    });
  }

  return candidates;
}

export function previewCycleRetention(
  cycles: any[],
  activeRangeId: string | null,
  opts: Partial<typeof RETENTION_DEFAULTS> = {}
): RetentionCycleCandidate[] {
  const { cyclesMaxClosed, cyclesMaxCancelled, keepFilledCycles } = {
    ...RETENTION_DEFAULTS,
    ...opts,
  };

  if (!Array.isArray(cycles)) return [];

  const candidates: RetentionCycleCandidate[] = [];

  const activeCycles = cycles.filter(c =>
    ["open", "active", "buy_filled"].includes(c?.status ?? "")
  );
  const completedCycles = cycles.filter(c => c?.status === "completed");
  const cancelledCycles = cycles.filter(c =>
    ["cancelled", "error", "stop_loss_hit", "trailing_closed"].includes(c?.status ?? "")
  );

  for (const c of activeCycles) {
    candidates.push({
      id: c.id,
      status: c.status,
      rangeVersionId: c.rangeVersionId,
      isActiveRange: c.rangeVersionId === activeRangeId,
      action: "keep_active",
      reason: "Ciclo activo: siempre se conserva",
    });
  }

  const sortedCompleted = [...completedCycles].sort((a, b) =>
    new Date(b?.closedAt ?? b?.completedAt ?? 0).getTime() -
    new Date(a?.closedAt ?? a?.completedAt ?? 0).getTime()
  );

  for (let i = 0; i < sortedCompleted.length; i++) {
    const c = sortedCompleted[i];
    const keep = keepFilledCycles || i < cyclesMaxClosed;
    candidates.push({
      id: c.id,
      status: c.status,
      rangeVersionId: c.rangeVersionId,
      isActiveRange: c.rangeVersionId === activeRangeId,
      action: keep ? "keep_completed" : "archive_candidate",
      reason: keep
        ? `Ciclo completado conservado (${i + 1}/${cyclesMaxClosed})`
        : `Más antiguo que el límite de ${cyclesMaxClosed} ciclos cerrados`,
    });
  }

  const sortedCancelled = [...cancelledCycles].sort((a, b) =>
    new Date(b?.updatedAt ?? 0).getTime() - new Date(a?.updatedAt ?? 0).getTime()
  );

  for (let i = 0; i < sortedCancelled.length; i++) {
    const c = sortedCancelled[i];
    const keep = i < cyclesMaxCancelled;
    candidates.push({
      id: c.id,
      status: c.status,
      rangeVersionId: c.rangeVersionId,
      isActiveRange: c.rangeVersionId === activeRangeId,
      action: keep ? "keep_recent" : "archive_candidate",
      reason: keep
        ? `Cancelado reciente conservado (${i + 1}/${cyclesMaxCancelled})`
        : `Más antiguo que el límite de ${cyclesMaxCancelled} ciclos cancelados`,
    });
  }

  return candidates;
}

export function buildRetentionPreview(
  levels: any[],
  cycles: any[],
  activeRangeId: string | null,
  opts: Partial<typeof RETENTION_DEFAULTS> = {}
): RetentionPreviewResult {
  const levelCandidates = previewLevelRetention(levels, activeRangeId, opts);
  const cycleCandidates = previewCycleRetention(cycles, activeRangeId, opts);

  const levelsKept = levelCandidates.filter(c => c.action !== "archive_candidate").length;
  const levelsArchiveCandidates = levelCandidates.filter(c => c.action === "archive_candidate").length;

  const cyclesActive = cycleCandidates.filter(c => c.action === "keep_active").length;
  const cyclesKept = cycleCandidates.filter(c => c.action !== "archive_candidate").length;
  const cyclesArchiveCandidates = cycleCandidates.filter(c => c.action === "archive_candidate").length;

  return {
    levelsTotal: levels.length,
    levelsActiveRange: levelCandidates.filter(c => c.isActiveRange).length,
    levelsKept,
    levelsArchiveCandidates,
    cyclesTotal: cycles.length,
    cyclesActive,
    cyclesKept,
    cyclesArchiveCandidates,
    levelCandidates,
    cycleCandidates,
    isDryRun: true,
    summary: `DRY-RUN: Se conservarían ${levelsKept} niveles y ${cyclesKept} ciclos. Candidatos a archivo: ${levelsArchiveCandidates} niveles, ${cyclesArchiveCandidates} ciclos. NO se borra nada.`,
  };
}
