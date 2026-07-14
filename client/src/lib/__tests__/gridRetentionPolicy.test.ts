import { describe, it, expect } from "vitest";
import {
  buildRetentionPreview,
  previewLevelRetention,
  previewCycleRetention,
  RETENTION_DEFAULTS,
} from "../gridRetentionPolicy";

const ACTIVE_ID = "range-active";

function makeLevel(id: string, status: string, rangeId: string, daysAgo = 1): any {
  return {
    id,
    status,
    rangeVersionId: rangeId,
    createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  };
}

function makeCycle(id: string, status: string, rangeId: string, daysAgo = 1): any {
  const closedAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  return {
    id,
    status,
    rangeVersionId: rangeId,
    closedAt: ["completed", "cancelled"].includes(status) ? closedAt : null,
    updatedAt: closedAt,
    completedAt: status === "completed" ? closedAt : null,
  };
}

describe("previewLevelRetention", () => {
  it("keeps active range levels always", () => {
    const levels = [
      makeLevel("l1", "planned", ACTIVE_ID),
      makeLevel("l2", "filled", ACTIVE_ID),
    ];
    const candidates = previewLevelRetention(levels, ACTIVE_ID);
    expect(candidates.every(c => c.action !== "archive_candidate")).toBe(true);
  });

  it("marks old historical levels as archive candidates", () => {
    const levels = Array.from({ length: 150 }, (_, i) =>
      makeLevel(`h${i}`, "replaced", "old-range", i + 1)
    );
    const candidates = previewLevelRetention(levels, ACTIVE_ID);
    const archiveCandidates = candidates.filter(c => c.action === "archive_candidate");
    expect(archiveCandidates.length).toBe(50);
  });

  it("keeps up to levelsMaxHistorical recent historical levels", () => {
    const levels = Array.from({ length: 80 }, (_, i) =>
      makeLevel(`h${i}`, "replaced", "old-range", i + 1)
    );
    const candidates = previewLevelRetention(levels, ACTIVE_ID);
    expect(candidates.filter(c => c.action !== "archive_candidate")).toHaveLength(80);
  });

  it("does NOT delete anything (no destructive candidates in active range)", () => {
    const levels = [
      makeLevel("l1", "planned", ACTIVE_ID),
      makeLevel("l2", "filled", ACTIVE_ID),
    ];
    const candidates = previewLevelRetention(levels, ACTIVE_ID);
    expect(candidates.some(c => c.action === "archive_candidate")).toBe(false);
  });

  it("marks planned historical levels as archive candidates when over limit", () => {
    const levels = Array.from({ length: 120 }, (_, i) =>
      makeLevel(`old${i}`, "planned", "old-range", i + 1)
    );
    const candidates = previewLevelRetention(levels, ACTIVE_ID);
    const archiveCandidates = candidates.filter(c => c.action === "archive_candidate");
    expect(archiveCandidates.length).toBe(20);
  });
});

describe("previewCycleRetention", () => {
  it("keeps active cycles always", () => {
    const cycles = [
      makeCycle("c1", "buy_filled", ACTIVE_ID),
      makeCycle("c2", "open", ACTIVE_ID),
    ];
    const candidates = previewCycleRetention(cycles, ACTIVE_ID);
    expect(candidates.every(c => c.action === "keep_active")).toBe(true);
  });

  it("marks excess completed cycles as archive candidates", () => {
    const cycles = Array.from({ length: 30 }, (_, i) =>
      makeCycle(`comp${i}`, "completed", ACTIVE_ID, i + 1)
    );
    const candidates = previewCycleRetention(cycles, ACTIVE_ID, { keepFilledCycles: false, cyclesMaxClosed: 20 });
    const archiveCandidates = candidates.filter(c => c.action === "archive_candidate");
    expect(archiveCandidates.length).toBe(10);
  });

  it("keeps relevant cycles (completed) by default", () => {
    const cycles = [
      makeCycle("c1", "completed", ACTIVE_ID),
    ];
    const candidates = previewCycleRetention(cycles, ACTIVE_ID);
    expect(candidates.find(c => c.id === "c1")?.action).toBe("keep_completed");
  });

  it("marks old cancelled cycles as archive candidates", () => {
    const cycles = Array.from({ length: 15 }, (_, i) =>
      makeCycle(`can${i}`, "cancelled", "old-range", i + 1)
    );
    const candidates = previewCycleRetention(cycles, ACTIVE_ID, { cyclesMaxCancelled: 10 });
    const archiveCandidates = candidates.filter(c => c.action === "archive_candidate");
    expect(archiveCandidates.length).toBe(5);
  });
});

describe("buildRetentionPreview", () => {
  it("isDryRun is always true", () => {
    const result = buildRetentionPreview([], [], ACTIVE_ID);
    expect(result.isDryRun).toBe(true);
  });

  it("preview does not delete anything (summary says NO borrado)", () => {
    const levels = [makeLevel("l1", "planned", ACTIVE_ID)];
    const cycles = [makeCycle("c1", "buy_filled", ACTIVE_ID)];
    const result = buildRetentionPreview(levels, cycles, ACTIVE_ID);
    expect(result.summary).toContain("NO se borra");
  });

  it("conserves active range levels", () => {
    const levels = [
      makeLevel("l1", "planned", ACTIVE_ID),
      makeLevel("l2", "filled", ACTIVE_ID),
    ];
    const result = buildRetentionPreview(levels, [], ACTIVE_ID);
    expect(result.levelsActiveRange).toBe(2);
    expect(result.levelsArchiveCandidates).toBe(0);
  });

  it("marks archive candidates correctly", () => {
    const levels = Array.from({ length: 110 }, (_, i) =>
      makeLevel(`h${i}`, "replaced", "old-range", i + 1)
    );
    const result = buildRetentionPreview(levels, [], ACTIVE_ID);
    expect(result.levelsArchiveCandidates).toBe(10);
    expect(result.levelsKept).toBe(100);
  });
});
