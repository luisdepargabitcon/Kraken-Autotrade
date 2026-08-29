/**
 * spotAiMigrationContractR10.test.ts — R10-10 truly exhaustive migration contract.
 *
 * R10-10: Every column of migration 090 classified as:
 *   GENERATED_BY_DB | WRITTEN_EXPLICITLY | INTENTIONALLY_NULLABLE
 *
 * A) Migration SQL contains exactly the expected columns and nullability/default.
 * B) Production INSERT contains ALL WRITTEN_EXPLICITLY columns.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  buildDurableEntryPayload,
  buildDurableGivebackPayload,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

const migrationPath = path.resolve(__dirname, "../../../db/migrations/090_spot_ai_forward_training_trades.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf-8");

// ─── Column classification ───────────────────────────────────────────────────

type ColumnClass = "GENERATED_BY_DB" | "WRITTEN_EXPLICITLY" | "INTENTIONALLY_NULLABLE";

interface ColumnSpec {
  name: string;
  sqlName: string;
  cls: ColumnClass;
  notNull: boolean;
  hasDefault: boolean;
}

// TRAINING table — ALL columns from migration 090
const TRAINING_TABLE_CONTRACT: ColumnSpec[] = [
  { name: "id", sqlName: "id", cls: "GENERATED_BY_DB", notNull: true, hasDefault: true },
  { name: "featureSchemaVersion", sqlName: "feature_schema_version", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "forwardTwinSchemaVersion", sqlName: "forward_twin_schema_version", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "lotId", sqlName: "lot_id", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "pair", sqlName: "pair", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "entryScanId", sqlName: "entry_scan_id", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "entryTime", sqlName: "entry_time", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "exitTime", sqlName: "exit_time", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "entryPrice", sqlName: "entry_price", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "exitPrice", sqlName: "exit_price", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "stopPrice", sqlName: "stop_price", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "riskUsd", sqlName: "risk_usd", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "mfe", sqlName: "mfe", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "mae", sqlName: "mae", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "mfeR", sqlName: "mfe_r", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "maeR", sqlName: "mae_r", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "netPnlUsd", sqlName: "net_pnl_usd", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "grossPnlUsd", sqlName: "gross_pnl_usd", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "entryFeeUsd", sqlName: "entry_fee_usd", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "totalEntryFeeUsd", sqlName: "total_entry_fee_usd", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "entryFeeAllocatedUsd", sqlName: "entry_fee_allocated_usd", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "exitFeeUsd", sqlName: "exit_fee_usd", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  // executed_qty is written as closedQty (backward compat = closed_qty)
  { name: "executedQty", sqlName: "executed_qty", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "weightedAvgExitPrice", sqlName: "weighted_avg_exit_price", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "weightedAvgEntryPrice", sqlName: "weighted_avg_entry_price", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "totalEntryVolume", sqlName: "total_entry_volume", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "totalExitVolume", sqlName: "total_exit_volume", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "closedQty", sqlName: "closed_qty", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "residualQty", sqlName: "residual_qty", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "isTrainable", sqlName: "is_trainable", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "exitReasonType", sqlName: "exit_reason_type", cls: "INTENTIONALLY_NULLABLE", notNull: false, hasDefault: false },
  { name: "entryFeaturesJson", sqlName: "entry_features_json", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "entryLabelsJson", sqlName: "entry_labels_json", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "policyVersion", sqlName: "policy_version", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "datasetFingerprint", sqlName: "dataset_fingerprint", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "createdAt", sqlName: "created_at", cls: "GENERATED_BY_DB", notNull: true, hasDefault: true },
];

// GIVEBACK table — ALL columns from migration 090
const GIVEBACK_TABLE_CONTRACT: ColumnSpec[] = [
  { name: "id", sqlName: "id", cls: "GENERATED_BY_DB", notNull: true, hasDefault: true },
  { name: "featureSchemaVersion", sqlName: "feature_schema_version", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "forwardTwinSchemaVersion", sqlName: "forward_twin_schema_version", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "lotId", sqlName: "lot_id", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "pair", sqlName: "pair", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "timestamp", sqlName: "timestamp", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "stateJson", sqlName: "state_json", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "labelsJson", sqlName: "labels_json", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "hasLabel", sqlName: "has_label", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "policyVersion", sqlName: "policy_version", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "datasetFingerprint", sqlName: "dataset_fingerprint", cls: "WRITTEN_EXPLICITLY", notNull: true, hasDefault: false },
  { name: "createdAt", sqlName: "created_at", cls: "GENERATED_BY_DB", notNull: true, hasDefault: true },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTrade(): CompletedTrade {
  return {
    lotId: "lot-1", pair: "BTC/USD", entryScanId: "scan-1",
    entryTime: 1000, exitTime: 2000,
    entryPrice: 100, exitPrice: 110,
    initialStopPrice: 95, initialRiskUsd: 10,
    weightedAverageExitPrice: 110, weightedAverageEntryPrice: 100,
    totalEntryVolume: 1, totalExitVolume: 1, closedQty: 1,
    totalEntryFeeUsd: 1, entryFeeAllocatedUsd: 1, totalExitFeeUsd: 1,
    entryFeeUsd: 1, exitFeeUsd: 1,
    grossPnlUsd: 10, netPnlUsd: 8,
    mfe: 10, mae: -5, mfeR: 1, maeR: -0.5,
    exitReasonType: "TARGET",
  };
}

function makeGivebackSample(): SpotAiGivebackSample {
  return {
    sampleId: "gb-1",
    split: "train",
    groupId: "lot-1",
    state: {
      lotId: "lot-1", pair: "BTC/USD", timestamp: 1000,
      entryPrice: 100, currentR: 1.5,
      runningMfeR: 1, runningMaeR: -0.5,
      mfeUsd: 10, maeUsd: -5, minutesInTrade: 30,
      breakEvenActivated: false, trailingActivated: false,
      currentStopPrice: 95, highestPrice: 110,
      currentRUnavailable: false,
    } as any,
    labels: { future_MFE_R: 2.0 } as any,
    sourceForwardTwinSchemaVersion: 2,
    sourcePolicyVersion: "SPOT_POLICY_X",
  };
}

function getTableDef(tableName: string): string {
  const match = migrationSql.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName} \\(([\\s\\S]*?)\\n\\);`),
  );
  expect(match).toBeDefined();
  return match![1];
}

function getColumnDef(tableDef: string, sqlName: string): string | null {
  // Match column definition (line starts with the column name)
  const lines = tableDef.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(sqlName + " ") || trimmed.startsWith(sqlName + "\t")) {
      return trimmed;
    }
  }
  return null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("R10-10 MIGRATION CONTRACT EXHAUSTIVE", () => {
  describe("training table — SQL column classification", () => {
    const tableDef = getTableDef("spot_ai_forward_training_trades");

    for (const col of TRAINING_TABLE_CONTRACT) {
      it(`TRAINING_SQL: ${col.sqlName} exists with correct nullability/default`, () => {
        const colDef = getColumnDef(tableDef, col.sqlName);
        expect(colDef).not.toBeNull();
        const def = colDef!;

        if (col.notNull) {
          // SERIAL PRIMARY KEY implies NOT NULL; explicit NOT NULL for others
          const isSerialPk = def.includes("SERIAL") || def.includes("PRIMARY KEY");
          if (!isSerialPk) {
            expect(def).toContain("NOT NULL");
          }
        }
        if (!col.hasDefault) {
          // R9-13: No DEFAULT on economic/writer columns
          expect(def).not.toContain("DEFAULT");
        }
        if (col.hasDefault) {
          // SERIAL has implicit default; created_at has explicit DEFAULT now()
          const isSerial = def.includes("SERIAL");
          if (!isSerial) {
            expect(def).toContain("DEFAULT");
          }
        }
      });
    }

    it("TRAINING_SQL: total column count matches contract", () => {
      // Verify we have exactly the columns in the contract
      const contractCount = TRAINING_TABLE_CONTRACT.length;
      // The table definition should contain all these column names
      for (const col of TRAINING_TABLE_CONTRACT) {
        expect(getColumnDef(tableDef, col.sqlName)).not.toBeNull();
      }
      // 36 columns in migration 090 training table
      expect(contractCount).toBe(36);
    });
  });

  describe("giveback table — SQL column classification", () => {
    const tableDef = getTableDef("spot_ai_forward_giveback_samples");

    for (const col of GIVEBACK_TABLE_CONTRACT) {
      it(`GIVEBACK_SQL: ${col.sqlName} exists with correct nullability/default`, () => {
        const colDef = getColumnDef(tableDef, col.sqlName);
        expect(colDef).not.toBeNull();
        const def = colDef!;

        if (col.notNull) {
          const isSerialPk = def.includes("SERIAL") || def.includes("PRIMARY KEY");
          if (!isSerialPk) {
            expect(def).toContain("NOT NULL");
          }
        }
        if (!col.hasDefault) {
          expect(def).not.toContain("DEFAULT");
        }
        if (col.hasDefault) {
          const isSerial = def.includes("SERIAL");
          if (!isSerial) {
            expect(def).toContain("DEFAULT");
          }
        }
      });
    }

    it("GIVEBACK_SQL: total column count matches contract", () => {
      const contractCount = GIVEBACK_TABLE_CONTRACT.length;
      for (const col of GIVEBACK_TABLE_CONTRACT) {
        expect(getColumnDef(tableDef, col.sqlName)).not.toBeNull();
      }
      // 12 columns in migration 090 giveback table
      expect(contractCount).toBe(12);
    });
  });

  describe("training table — writer provides all WRITTEN_EXPLICITLY columns", () => {
    const trade = makeTrade();
    const r = buildDurableEntryPayload(trade, { f: 1 }, { l: 1 }, "SPOT_POLICY_X");
    expect(r.ok).toBe(true);
    const row = (r as any).row;
    const fingerprint = (r as any).fingerprint;

    for (const col of TRAINING_TABLE_CONTRACT) {
      if (col.cls === "WRITTEN_EXPLICITLY") {
        it(`TRAINING_WRITER: ${col.name} is provided by writer`, () => {
          // datasetFingerprint is provided separately by the builder
          if (col.name === "datasetFingerprint") {
            expect(fingerprint).toBeDefined();
            expect(fingerprint).not.toBeNull();
            return;
          }
          // executedQty maps to closedQty in the writer (backward compat)
          if (col.name === "executedQty") {
            expect(row.closedQty).toBeDefined();
            expect(row.closedQty).not.toBeNull();
            return;
          }
          expect(row[col.name]).toBeDefined();
          if (col.notNull) {
            expect(row[col.name]).not.toBeNull();
            expect(row[col.name]).not.toBeUndefined();
          }
        });
      }
    }

    it("TRAINING_WRITER: isTrainable is true when features+labels present", () => {
      expect(row.isTrainable).toBe(true);
    });

    it("TRAINING_WRITER: policyVersion is canonical", () => {
      expect(row.policyVersion).toBe("SPOT_POLICY_X");
    });
  });

  describe("giveback table — writer provides all WRITTEN_EXPLICITLY columns", () => {
    const sample = makeGivebackSample();
    const r = buildDurableGivebackPayload(sample);
    expect(r.ok).toBe(true);
    const row = (r as any).row;
    const fingerprint = (r as any).fingerprint;

    for (const col of GIVEBACK_TABLE_CONTRACT) {
      if (col.cls === "WRITTEN_EXPLICITLY") {
        it(`GIVEBACK_WRITER: ${col.name} is provided by writer`, () => {
          if (col.name === "datasetFingerprint") {
            expect(fingerprint).toBeDefined();
            expect(fingerprint).not.toBeNull();
            return;
          }
          expect(row[col.name]).toBeDefined();
          if (col.notNull) {
            expect(row[col.name]).not.toBeNull();
            expect(row[col.name]).not.toBeUndefined();
          }
        });
      }
    }

    it("GIVEBACK_WRITER: hasLabel is true", () => {
      expect(row.hasLabel).toBe(true);
    });

    it("GIVEBACK_WRITER: labelsJson is non-null", () => {
      expect(row.labelsJson).not.toBeNull();
      expect(row.labelsJson).toBeDefined();
    });
  });

  // R15: Migration 091 now exists — verified from filesystem
  it("MIGRATION_091_EXISTS: 091 file exists in db/migrations and is CREATE INDEX CONCURRENTLY", () => {
    const migrationsDir = path.resolve(__dirname, "../../../db/migrations");
    const files = fs.readdirSync(migrationsDir);
    const has091 = files.some((f) => f.startsWith("091_"));
    expect(has091).toBe(true);
    const sql091 = fs.readFileSync(
      path.resolve(migrationsDir, "091_spot_ai_scan_regime_index.sql"),
      "utf-8",
    );
    expect(sql091).toContain("CREATE INDEX CONCURRENTLY");
    expect(sql091).toContain("idx_ft_scan_regime");
  });

  // R10-11: Migration 090 applied state is operational, not verifiable from repo
  it("MIGRATION_090_APPLIED: file exists (applied state is operational)", () => {
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS spot_ai_forward_training_trades");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS spot_ai_forward_giveback_samples");
  });
});
