import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

async function insertSnapshot(db: PGlite, tsProvider: Date | null, tsIngested: Date) {
  await db.query(
    `INSERT INTO market_metrics_snapshots
      (source, metric, asset, pair, value, ts_provider, ts_ingested, meta)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb
     WHERE NOT EXISTS (
       SELECT 1
       FROM market_metrics_snapshots existing
       WHERE existing.source = $1
         AND existing.metric = $2
         AND existing.asset IS NOT DISTINCT FROM $3
         AND COALESCE(existing.ts_provider, existing.ts_ingested) = COALESCE($6::timestamptz, $7::timestamptz)
       LIMIT 1
     )`,
    ["binance", "open_interest", "BTC", null, 100, tsProvider, tsIngested, "{}"]
  );
}

describe("deduplicación SQL de market_metrics_snapshots", () => {
  it("no duplica misma observación, pero permite observaciones distintas y null tsProvider", async () => {
    const db = new PGlite();
    await db.query(`CREATE TABLE market_metrics_snapshots (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      metric TEXT NOT NULL,
      asset TEXT,
      pair TEXT,
      value NUMERIC NOT NULL,
      ts_provider TIMESTAMPTZ,
      ts_ingested TIMESTAMPTZ NOT NULL,
      meta JSONB NOT NULL DEFAULT '{}'
    )`);
    const providerTs = new Date("2026-01-02T10:00:00Z");
    const ingest1 = new Date("2026-01-02T10:01:00Z");
    const ingest2 = new Date("2026-01-02T10:02:00Z");

    await insertSnapshot(db, providerTs, ingest1);
    await insertSnapshot(db, providerTs, ingest2);
    let count = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM market_metrics_snapshots");
    expect(Number(count.rows[0].count)).toBe(1);

    await insertSnapshot(db, new Date("2026-01-02T10:05:00Z"), ingest2);
    count = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM market_metrics_snapshots");
    expect(Number(count.rows[0].count)).toBe(2);

    await insertSnapshot(db, null, ingest1);
    await insertSnapshot(db, null, ingest2);
    count = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM market_metrics_snapshots");
    expect(Number(count.rows[0].count)).toBe(4);
    await db.close();
  });
});
