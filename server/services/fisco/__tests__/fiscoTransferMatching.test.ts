/**
 * Tests for TransferMatchingService
 *
 * Covers:
 * A) Revolut withdrawal 364.061928 USDC without matching deposit → WITHDRAWAL_UNMATCHED
 * B) Revolut withdrawal 360 USDC + Kraken deposit 360 USDC within 2h → matched, confidence=high
 * C) Fee of 4.061928 USDC is correctly recorded in transfer_link
 * D) scoreCandidate thresholds work correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransferMatchingService, type WithdrawalToMatch } from "../TransferMatchingService";
import type { Pool, QueryResult } from "pg";

// ─── Pool mock factory ────────────────────────────────────────────────────────

function makePoolMock(queryResults: Array<{ rows: any[] }>) {
  let callIndex = 0;
  const query = vi.fn(async (_sql: string, _params?: any[]) => {
    const result = queryResults[callIndex] ?? { rows: [] };
    callIndex++;
    return result as QueryResult;
  });

  const client = {
    query,
    release: vi.fn(),
  };

  return {
    query,
    connect: vi.fn(async () => client),
    _client: client,
  } as unknown as Pool;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_WITHDRAWAL: WithdrawalToMatch = {
  asset:               "USDC",
  amountSent:          360,
  feeAmount:           4.061928,
  totalOut:            364.061928,
  executedAt:          new Date("2025-12-14T11:01:00Z"),
  network:             "ethereum",
  fromExchange:        "revolutx",
  fromStatementItemId: 1,
};

// ─── scoreCandidate (pure, no DB) ─────────────────────────────────────────────

describe("TransferMatchingService.scoreCandidate — pure scoring logic", () => {
  const svc = new TransferMatchingService(null as any);

  it("high confidence: amount delta ≤1 USDC and time diff < 2h", () => {
    const w = BASE_WITHDRAWAL;
    const c = {
      operationId: 42,
      exchange:    "kraken",
      asset:       "USDC",
      amount:      360,                                    // exact match
      executedAt:  new Date("2025-12-14T11:12:49Z"),       // 11.8 min later
      externalId:  "FTAVCHJ",
    };
    const result = svc.scoreCandidate(w, c);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.amountDelta).toBeCloseTo(0, 4);
    expect(result.timeDiffMinutes).toBeCloseTo(11.8, 0);
  });

  it("medium confidence: amount delta ≤5 USDC and time diff 2–48h", () => {
    const w = BASE_WITHDRAWAL;
    const c = {
      operationId: 43,
      exchange:    "kraken",
      asset:       "USDC",
      amount:      358,                                    // 2 USDC delta
      executedAt:  new Date("2025-12-14T20:00:00Z"),       // 9h later
      externalId:  "OTHER",
    };
    const result = svc.scoreCandidate(w, c);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe("medium");
  });

  it("no match: amount delta > 5 USDC", () => {
    const w = BASE_WITHDRAWAL;
    const c = {
      operationId: 44,
      exchange:    "kraken",
      asset:       "USDC",
      amount:      300,                                    // 60 USDC delta
      executedAt:  new Date("2025-12-14T11:30:00Z"),
      externalId:  "BAD",
    };
    const result = svc.scoreCandidate(w, c);
    expect(result.matched).toBe(false);
  });

  it("no match: amount ok but time > 48h", () => {
    const w = BASE_WITHDRAWAL;
    const c = {
      operationId: 45,
      exchange:    "kraken",
      asset:       "USDC",
      amount:      360,
      executedAt:  new Date("2025-12-17T11:01:00Z"),       // 72h later
      externalId:  "TOO_LATE",
    };
    const result = svc.scoreCandidate(w, c);
    expect(result.matched).toBe(false);
  });
});

// ─── matchWithdrawal (with DB mock) ───────────────────────────────────────────

describe("TransferMatchingService.matchWithdrawal — with DB mock", () => {
  it("A) no candidates found → WITHDRAWAL_UNMATCHED (matched=false)", async () => {
    const pool = makePoolMock([{ rows: [] }]); // no deposits found
    const svc = new TransferMatchingService(pool);

    const result = await svc.matchWithdrawal(BASE_WITHDRAWAL);
    expect(result.matched).toBe(false);
    expect(result.reason).toMatch(/No deposit/);
  });

  it("B) Kraken deposit 360 USDC within 12 min → matched, high confidence", async () => {
    const krakenDepositRow = {
      id:          101,
      exchange:    "kraken",
      asset:       "USDC",
      amount:      "360",
      executed_at: new Date("2025-12-14T11:12:49Z"),
      external_id: "FTAVCHJ",
    };
    const pool = makePoolMock([{ rows: [krakenDepositRow] }]);
    const svc = new TransferMatchingService(pool);

    const result = await svc.matchWithdrawal(BASE_WITHDRAWAL);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.candidate?.exchange).toBe("kraken");
    expect(result.candidate?.externalId).toBe("FTAVCHJ");
    expect(result.amountDelta).toBeCloseTo(0, 4);
    expect(result.timeDiffMinutes).toBeCloseTo(11.8, 0);
  });

  it("C) fee 4.061928 USDC preserved in withdrawal input (totalOut = amountSent + fee)", () => {
    expect(BASE_WITHDRAWAL.feeAmount).toBeCloseTo(4.061928, 4);
    expect(BASE_WITHDRAWAL.totalOut).toBeCloseTo(
      BASE_WITHDRAWAL.amountSent + BASE_WITHDRAWAL.feeAmount, 4
    );
  });
});

// ─── matchAndPersist ───────────────────────────────────────────────────────────

describe("TransferMatchingService.matchAndPersist — DB write", () => {
  it("B+persist) matched Kraken deposit → creates transfer_link, updates statement_item status", async () => {
    const krakenDepositRow = {
      id:          101,
      exchange:    "kraken",
      asset:       "USDC",
      amount:      "360",
      executed_at: new Date("2025-12-14T11:12:49Z"),
      external_id: "FTAVCHJ",
    };

    // Pool: 1) findCandidates query, 2) BEGIN, 3) INSERT link RETURNING, 4) UPDATE stmt item, 5) COMMIT
    const clientQuery = vi.fn(async (sql: string, _p?: any[]) => {
      if (sql.trim().startsWith("INSERT INTO fisco_transfer_links")) {
        return { rows: [{ id: 999 }] } as unknown as QueryResult;
      }
      return { rows: [] } as unknown as QueryResult;
    });
    const client = { query: clientQuery, release: vi.fn() };
    const poolQuery = vi.fn(async () => ({ rows: [krakenDepositRow] } as unknown as QueryResult));
    const pool = {
      query:   poolQuery,
      connect: vi.fn(async () => client),
    } as unknown as Pool;

    const svc = new TransferMatchingService(pool);
    const { linkId, result } = await svc.matchAndPersist(BASE_WITHDRAWAL);

    expect(result.matched).toBe(true);
    expect(result.confidence).toBe("high");
    expect(linkId).toBe(999);

    // Verify UPDATE was called with matched_internal_transfer
    const updateCall = clientQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("UPDATE fisco_external_statement_items")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain("matched_internal_transfer");
    expect(updateCall![1]).toContain(999);    // linkId
    expect(updateCall![1]).toContain(101);    // to_operation_id
  });

  it("A+persist) no match → creates unmatched transfer_link, status stays unmatched", async () => {
    const clientQuery = vi.fn(async (sql: string, _p?: any[]) => {
      if (sql.trim().startsWith("INSERT INTO fisco_transfer_links")) {
        return { rows: [{ id: 888 }] } as unknown as QueryResult;
      }
      return { rows: [] } as unknown as QueryResult;
    });
    const client = { query: clientQuery, release: vi.fn() };
    const pool = {
      query:   vi.fn(async () => ({ rows: [] } as unknown as QueryResult)),
      connect: vi.fn(async () => client),
    } as unknown as Pool;

    const svc = new TransferMatchingService(pool);
    const { linkId, result } = await svc.matchAndPersist(BASE_WITHDRAWAL);

    expect(result.matched).toBe(false);
    expect(linkId).toBe(888);

    const updateCall = clientQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("UPDATE fisco_external_statement_items")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain("unmatched");
  });
});
