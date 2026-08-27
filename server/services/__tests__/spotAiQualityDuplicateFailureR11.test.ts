/**
 * spotAiQualityDuplicateFailureR11.test.ts — R11-08 mock correct module.
 *
 * R11-08: spotAi.routes.ts imports loadDuplicateFillQuality from
 * spotAiDuplicateIdentity (NOT durableTrainingStore). The integration
 * test must mock the correct module.
 */

import { describe, it, expect, vi } from "vitest";

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: { execute: mockExecute },
}));

// R11-08: Mock the CORRECT module — spotAiDuplicateIdentity
vi.mock("../spotAiForwardTwin/spotAiDuplicateIdentity", () => ({
  loadDuplicateFillQuality: vi.fn(),
  countDuplicateFills: vi.fn().mockResolvedValue({ duplicateEntryFills: 0, duplicateExitFills: 0 }),
}));

// Mock completedTrades since the route calls queryCompletedTrades
vi.mock("../spotAiForwardTwin/spotAiCompletedTrades", () => ({
  queryCompletedTrades: vi.fn().mockResolvedValue({
    completedTrades: [],
    partialExitTrades: 0,
    legacyMissingLotIdBuyFills: 0,
    correlationIncompleteTrades: 0,
    economicInvalidTrades: 0,
    exitVolumeOverflowTrades: 0,
  }),
}));

// Also mock durableTrainingStore for other imports the route uses
vi.mock("../spotAiForwardTwin/spotAiDurableTrainingStore", () => ({
  isDurableStorageAvailable: vi.fn().mockResolvedValue(true),
  getDurableStoredTradeCount: vi.fn().mockResolvedValue(0),
  getDurableTrainableTradeCount: vi.fn().mockResolvedValue(0),
  getDurableCompletedTradeCount: vi.fn().mockResolvedValue(0),
  getUnsyncedCompletedTradeCount: vi.fn().mockResolvedValue(0),
  getUnsyncedGivebackSampleCount: vi.fn().mockResolvedValue(0),
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
}));

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

describe("R11-08 QUALITY DUPLICATE FAILURE — correct module mock", () => {
  it("QUALITY_R11_DUP_01: duplicate check null => checks null, available false, status != OK", async () => {
    // Import from the CORRECT mocked module
    const { loadDuplicateFillQuality } = await import("../spotAiForwardTwin/spotAiDuplicateIdentity");

    // Configure: duplicate check returns null (unavailable)
    (loadDuplicateFillQuality as any).mockReturnValue({
      available: false,
      duplicateEntryFills: null,
      duplicateExitFills: null,
      error: "DB failure",
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    mockExecute.mockResolvedValue({ rows: [] });

    const response = await callRoute(app, "GET", "/api/spot/ai/dataset/quality");

    expect(response.status).toBe(200);
    // checks.duplicateEntryFills === null
    expect(response.body.checks.duplicateEntryFills).toBeNull();
    // checks.duplicateExitFills === null
    expect(response.body.checks.duplicateExitFills).toBeNull();
    // checksAvailable.duplicateEntryFills === false
    expect(response.body.checksAvailable.duplicateEntryFills).toBe(false);
    // checksAvailable.duplicateExitFills === false
    expect(response.body.checksAvailable.duplicateExitFills).toBe(false);
    // scoreIsPartial === true
    expect(response.body.scoreIsPartial).toBe(true);
    // status !== "OK"
    expect(response.body.status).not.toBe("OK");
  });
});
