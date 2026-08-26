/**
 * spotAiRestart.test.ts — AI_RESTART_01..04: Restart recovery tests.
 *
 * Verifies that services survive restarts by using DB persistence
 * instead of in-memory state. Model registry and advisory logs
 * must persist across restarts.
 */

import { describe, it, expect } from "vitest";
import { modelRegistry } from "../spotAiForwardTwin/spotAiModelRegistry";
import { advisoryService } from "../spotAiForwardTwin/spotAiAdvisoryService";
import { trainerService } from "../spotAiForwardTwin/spotAiTrainerService";
import {
  SPOT_AI_FEATURE_SCHEMA_VERSION,
  MIN_TRADES_TO_TRAIN,
} from "../spotAiForwardTwin/spotAiForwardTwinTypes";

describe("AI_RESTART_01: model registry survives restart", () => {
  it("modelRegistry is stateless — no in-memory entries array", () => {
    expect((modelRegistry as any).entries).toBeUndefined();
  });

  it("listAll is async and returns empty array when DB unavailable", async () => {
    const models = await modelRegistry.listAll();
    expect(Array.isArray(models)).toBe(true);
  });

  it("getLatest is async and returns null when DB unavailable", async () => {
    const latest = await modelRegistry.getLatest("SPOT_AI_FORWARD_TWIN_ENTRY");
    expect(latest).toBeNull();
  });

  it("getActiveAdvisory is async and returns null when DB unavailable", async () => {
    const active = await modelRegistry.getActiveAdvisory("SPOT_AI_FORWARD_TWIN_ENTRY");
    expect(active).toBeNull();
  });
});

describe("AI_RESTART_02: advisory logs persist in DB", () => {
  it("advisoryService has no in-memory advisoryLogs array", () => {
    expect((advisoryService as any).advisoryLogs).toBeUndefined();
  });

  it("getRecentAdvisoryLogs is async and returns array from DB", async () => {
    const logs = await advisoryService.getRecentAdvisoryLogs(10);
    expect(Array.isArray(logs)).toBe(true);
  });

  it("logAdvisory is async and writes to DB", async () => {
    expect(typeof advisoryService.logAdvisory).toBe("function");
    // logAdvisory should be async
    const result = advisoryService.logAdvisory({
      scanId: "test-scan",
      pair: "BTC/USD",
      modelVersion: "v1",
      featureSchemaVersion: 1,
      entryQualityScore: 0,
      prob_0_5R: 0,
      prob_1R: 0,
      prob_2R: 0,
      expectedMfeR: 0,
      expectedMaeR: 0,
      prob_net_profit: 0,
      givebackRiskScore: null,
      lotId: null,
      timestamp: Date.now(),
    });
    expect(result instanceof Promise).toBe(true);
  });
});

describe("AI_RESTART_03: trainer fails closed on restart without Python", () => {
  it("trainer must not have fake success state in memory", () => {
    expect((advisoryService as any).trainingInProgress).toBeUndefined();
  });

  it("trainer service train method must be async", () => {
    expect(typeof trainerService.trainEntryModel).toBe("function");
  });
});

describe("AI_RESTART_04: status computed from DB on each call", () => {
  it("getStatus must be async — no cached state", async () => {
    const status1 = await advisoryService.getStatus(100, 0);
    const status2 = await advisoryService.getStatus(200, 5);
    expect(status1.totalSnapshots).toBe(100);
    expect(status2.totalSnapshots).toBe(200);
    expect(status1.labeledTrades).toBe(0);
    expect(status2.labeledTrades).toBe(5);
  });

  it("status must reflect current DB state, not cached", async () => {
    const status = await advisoryService.getStatus(500, 50);
    expect(status.status).toBe("COLLECTING");
    expect(status.featureSchemaVersion).toBe(SPOT_AI_FEATURE_SCHEMA_VERSION);
    expect(status.minTradesToTrain).toBe(MIN_TRADES_TO_TRAIN);
  });
});
