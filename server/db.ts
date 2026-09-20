import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

// Pool is created lazily — it does NOT connect until a query is executed.
// This allows research/offline modules to import storage.ts without DATABASE_URL.
// If DATABASE_URL is unset, the Pool will throw on first actual query (connect),
// not at module load time.
export const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {}
);

export const db = drizzle(pool, { schema });
