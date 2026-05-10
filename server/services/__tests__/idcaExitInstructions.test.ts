/**
 * Tests for IDCA Exit Instructions (Lote 4)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import * as repo from "../institutionalDca/IdcaExitInstructionRepository";
import { idcaExitInstructions } from "../../../shared/schema";

describe("IdcaExitInstructionRepository", () => {
  const testCycleId = 999999;
  const testPair = "BTC/USD";
  const testMode = "simulation";

  beforeAll(async () => {
    // Clean up any existing test instructions
    await db.delete(idcaExitInstructions).where(eq(idcaExitInstructions.cycleId, testCycleId));
  });

  afterAll(async () => {
    // Clean up test instructions
    await db.delete(idcaExitInstructions).where(eq(idcaExitInstructions.cycleId, testCycleId));
  });

  describe("createExitInstruction", () => {
    it("should create a pending immediate instruction", async () => {
      const instr = await repo.createExitInstruction({
        cycleId: testCycleId,
        pair: testPair,
        mode: testMode,
        type: "immediate",
        closePct: "50.00",
        requestedQuantity: "0.5",
      });

      expect(instr).toBeDefined();
      expect(instr.id).toBeGreaterThan(0);
      expect(instr.status).toBe("pending");
      expect(instr.type).toBe("immediate");
      expect(parseFloat(instr.closePct)).toBe(50);
    });

    it("should create a price_target instruction with trigger price", async () => {
      const instr = await repo.createExitInstruction({
        cycleId: testCycleId,
        pair: testPair,
        mode: testMode,
        type: "price_target",
        closePct: "25.00",
        triggerPrice: "95000.00",
        triggerDirection: "below",
        requestedQuantity: "0.25",
      });

      expect(instr.status).toBe("pending");
      expect(instr.type).toBe("price_target");
      expect(parseFloat(instr.triggerPrice || "0")).toBe(95000);
      expect(instr.triggerDirection).toBe("below");
    });

    it("should create a scheduled_time instruction", async () => {
      const futureTime = new Date(Date.now() + 3600000); // 1 hour from now
      const instr = await repo.createExitInstruction({
        cycleId: testCycleId,
        pair: testPair,
        mode: testMode,
        type: "scheduled_time",
        closePct: "100.00",
        triggerTime: futureTime,
        timezone: "Europe/Madrid",
        requestedQuantity: "1.0",
      });

      expect(instr.status).toBe("pending");
      expect(instr.type).toBe("scheduled_time");
      expect(instr.triggerTime).toBeDefined();
      expect(instr.timezone).toBe("Europe/Madrid");
    });
  });

  describe("getInstructionsByCycle", () => {
    it("should return all instructions for a cycle", async () => {
      // Create multiple instructions
      await repo.createExitInstruction({
        cycleId: testCycleId,
        pair: testPair,
        mode: testMode,
        type: "immediate",
        closePct: "25.00",
        requestedQuantity: "0.25",
      });
      await repo.createExitInstruction({
        cycleId: testCycleId,
        pair: testPair,
        mode: testMode,
        type: "price_target",
        closePct: "75.00",
        triggerPrice: "100000.00",
        triggerDirection: "above",
        requestedQuantity: "0.75",
      });

      const instructions = await repo.getInstructionsByCycle(testCycleId);
      expect(instructions.length).toBeGreaterThanOrEqual(2);
      expect(instructions.every(i => i.cycleId === testCycleId)).toBe(true);
    });
  });

  describe("getActiveExitInstruction", () => {
    it("should return the pending instruction", async () => {
      // Create a pending instruction
      const instr = await repo.createExitInstruction({
        cycleId: testCycleId,
        pair: testPair,
        mode: testMode,
        type: "immediate",
        closePct: "50.00",
        requestedQuantity: "0.5",
      });

      const active = await repo.getActiveExitInstruction(testCycleId);
      expect(active).toBeDefined();
      expect(active?.id).toBe(instr.id);
      expect(active?.status).toBe("pending");
    });

    it("should return null if no pending instruction", async () => {
      // Cancel all pending instructions
      await repo.cancelActiveExitInstructionForCycle(testCycleId, "test");
      const active = await repo.getActiveExitInstruction(testCycleId);
      expect(active).toBeNull();
    });
  });

  describe("cancelExitInstruction", () => {
    it("should cancel a pending instruction", async () => {
      const instr = await repo.createExitInstruction({
        cycleId: testCycleId,
        pair: testPair,
        mode: testMode,
        type: "immediate",
        closePct: "50.00",
        requestedQuantity: "0.5",
      });

      const cancelled = await repo.cancelExitInstruction(instr.id, "test_cancel");
      expect(cancelled).toBeDefined();
      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.cancelReason).toBe("test_cancel");
    });

    it("should return null for non-cancellable instruction", async () => {
      // Create and immediately mark as executed
      const instr = await repo.createExitInstruction({
        cycleId: testCycleId,
        pair: testPair,
        mode: testMode,
        type: "immediate",
        closePct: "50.00",
        requestedQuantity: "0.5",
      });
      await db.update(idcaExitInstructions)
        .set({ status: "executed", executedAt: new Date() })
        .where(eq(idcaExitInstructions.id, instr.id));

      const cancelled = await repo.cancelExitInstruction(instr.id, "test_cancel");
      expect(cancelled).toBeNull();
    });
  });

  describe("hasPendingExitInstruction", () => {
    it("should return true when pending instruction exists", async () => {
      await repo.createExitInstruction({
        cycleId: testCycleId,
        pair: testPair,
        mode: testMode,
        type: "immediate",
        closePct: "50.00",
        requestedQuantity: "0.5",
      });

      const hasPending = await repo.hasPendingExitInstruction(testCycleId);
      expect(hasPending).toBe(true);
    });

    it("should return false when no pending instruction", async () => {
      await repo.cancelActiveExitInstructionForCycle(testCycleId, "test");
      const hasPending = await repo.hasPendingExitInstruction(testCycleId);
      expect(hasPending).toBe(false);
    });
  });

  describe("cancelActiveExitInstructionForCycle", () => {
    it("should cancel the active instruction for a cycle", async () => {
      await repo.createExitInstruction({
        cycleId: testCycleId,
        pair: testPair,
        mode: testMode,
        type: "immediate",
        closePct: "50.00",
        requestedQuantity: "0.5",
      });

      await repo.cancelActiveExitInstructionForCycle(testCycleId, "test_bulk_cancel");
      const active = await repo.getActiveExitInstruction(testCycleId);
      expect(active).toBeNull();
    });
  });
});
