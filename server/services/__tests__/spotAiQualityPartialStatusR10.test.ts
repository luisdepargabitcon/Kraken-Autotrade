/**
 * spotAiQualityPartialStatusR10.test.ts — R10-09 quality partial status.
 *
 * R10-09: Partial coverage must NOT report OK.
 * - coverage < 100 + 0 issues => PARTIAL
 * - coverage < 100 + issues => WARNINGS_PARTIAL
 * - coverage = 100 + 0 issues => OK
 * - coverage = 100 + issues => WARNINGS
 *
 * Tests the status logic directly (unit test) AND through the endpoint
 * (integration test with mock req/res).
 */

import { describe, it, expect, vi } from "vitest";

// ─── Unit test: status logic ─────────────────────────────────────────────────

/**
 * R10-09: The status computation logic extracted from the route.
 * This mirrors the exact logic in spotAi.routes.ts.
 */
function computeStatus(qualityCoveragePct: number, totalIssues: number): string {
  const isPartial = qualityCoveragePct < 100;
  return isPartial
    ? (totalIssues > 0 ? "WARNINGS_PARTIAL" : "PARTIAL")
    : (totalIssues > 0 ? "WARNINGS" : "OK");
}

describe("R10-09 QUALITY PARTIAL STATUS — unit test", () => {
  it("QUALITY_R10_STATUS_01: coverage < 100 + 0 issues => PARTIAL", () => {
    expect(computeStatus(90, 0)).toBe("PARTIAL");
  });

  it("QUALITY_R10_STATUS_02: coverage 100 + 0 issues => OK", () => {
    expect(computeStatus(100, 0)).toBe("OK");
  });

  it("QUALITY_R10_STATUS_03: coverage < 100 + issues => WARNINGS_PARTIAL", () => {
    expect(computeStatus(90, 5)).toBe("WARNINGS_PARTIAL");
  });

  it("QUALITY_R10_STATUS_04: coverage 100 + issues => WARNINGS", () => {
    expect(computeStatus(100, 5)).toBe("WARNINGS");
  });

  it("QUALITY_R10_STATUS_05: coverage 0 + 0 issues => PARTIAL", () => {
    expect(computeStatus(0, 0)).toBe("PARTIAL");
  });
});

// ─── Integration test: endpoint returns non-OK when coverage < 100 ───────────

// Mock db
const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: { execute: mockExecute },
}));

vi.mock("../spotAiForwardTwin/spotAiDurableTrainingStore", () => ({
  isDurableStorageAvailable: vi.fn().mockResolvedValue(true),
  getDurableStoredTradeCount: vi.fn().mockResolvedValue(0),
  getDurableTrainableTradeCount: vi.fn().mockResolvedValue(0),
  getDurableCompletedTradeCount: vi.fn().mockResolvedValue(0),
  getUnsyncedCompletedTradeCount: vi.fn().mockResolvedValue(0),
  getUnsyncedGivebackSampleCount: vi.fn().mockResolvedValue(0),
  getReconciliationMetrics: vi.fn().mockReturnValue({
    lastAttemptAt: 1000, lastCompletedAt: 2000, status: "SUCCESS",
    errors: 0, fingerprintConflicts: 0, skippedNotTrainable: 0,
    skippedUnlabeledGiveback: 0, syncedTrades: 0, syncedGivebackSamples: 0,
    idempotentTrades: 0, idempotentGivebackSamples: 0,
    invalidProvenance: 0, insertErrors: 0, errorCodes: [],
  }),
  getLastReconciliationAt: vi.fn().mockReturnValue(1000),
  getLastReconciliationErrors: vi.fn().mockReturnValue(0),
  getLastFingerprintConflicts: vi.fn().mockReturnValue(0),
  getLastSkippedNotTrainable: vi.fn().mockReturnValue(0),
  getLastSyncedTrades: vi.fn().mockReturnValue(0),
  getLastSyncedGivebackSamples: vi.fn().mockReturnValue(0),
  getLastSkippedUnlabeledGiveback: vi.fn().mockReturnValue(0),
  getLastIdempotentTrades: vi.fn().mockReturnValue(0),
  getLastIdempotentGivebackSamples: vi.fn().mockReturnValue(0),
  getLastInvalidProvenance: vi.fn().mockReturnValue(0),
  getLastInsertErrors: vi.fn().mockReturnValue(0),
  getReconciliationStatus: vi.fn().mockReturnValue("SUCCESS"),
  getReconciliationErrorCodes: vi.fn().mockReturnValue([]),
  loadDuplicateFillQuality: vi.fn(),
  DURABLE_RETENTION_POLICY: "NO_AUTO_DELETE_UNTIL_VALIDATED",
}));

import type { Express } from "express";

function createMockApp(): any {
  const handlers: Record<string, Function> = {};
  const app: any = {
    get: (path: string, handler: Function) => { handlers["GET " + path] = handler; },
    post: (path: string, handler: Function) => { handlers["POST " + path] = handler; },
    _handlers: handlers,
  };
  return app;
}

async function callRoute(app: any, method: string, path: string): Promise<{ status: number; body: any }> {
  const key = `${method} ${path}`;
  const handler = app._handlers[key];
  if (!handler) throw new Error(`No route for ${key}`);
  const req: any = {};
  const res: any = {
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._body = body; },
    _status: 200,
    _body: null,
  };
  await handler(req, res);
  return { status: res._status, body: res._body };
}

describe("R10-09 QUALITY PARTIAL STATUS — endpoint integration", () => {
  // Duplicate check null => status != OK, scoreIsPartial=true
  it("QUALITY_R10_ENDPOINT_01: duplicate check null => status != OK, scoreIsPartial=true", async () => {
    const { loadDuplicateFillQuality } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");

    (loadDuplicateFillQuality as any).mockReturnValue({
      available: false,
      duplicateEntryFills: null,
      duplicateExitFills: null,
      error: "DB error",
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    mockExecute.mockResolvedValue({ rows: [] });

    const response = await callRoute(app, "GET", "/api/spot/ai/dataset/quality");

    expect(response.status).toBe(200);
    expect(response.body.status).not.toBe("OK");
    expect(response.body.scoreIsPartial).toBe(true);
  });

  // All available checks + 0 issues => status != OK (because some checks are structurally false)
  it("QUALITY_R10_ENDPOINT_02: all available + 0 issues => PARTIAL (not OK)", async () => {
    const { loadDuplicateFillQuality } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");

    (loadDuplicateFillQuality as any).mockReturnValue({
      available: true,
      duplicateEntryFills: 0,
      duplicateExitFills: 0,
      error: null,
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    mockExecute.mockResolvedValue({ rows: [] });

    const response = await callRoute(app, "GET", "/api/spot/ai/dataset/quality");

    expect(response.status).toBe(200);
    // Coverage < 100 because some checks are structurally false (lookaheadViolations, etc.)
    // So status should be PARTIAL, not OK
    expect(response.body.status).toBe("PARTIAL");
    expect(response.body.scoreIsPartial).toBe(true);
  });
});
