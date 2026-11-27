import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzleAuthV2Store } from "../authV2DrizzleStore";
import { authV2StoreContractTests } from "./authV2Service.test";

async function makePgStore(): Promise<DrizzleAuthV2Store> {
  const pg = new PGlite();
  const migration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/095_nexa_auth_v2.sql"), "utf8");
  await pg.exec(migration);
  return new DrizzleAuthV2Store(drizzle(pg));
}

authV2StoreContractTests(makePgStore, "drizzle/pglite");
