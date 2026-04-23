import { storage } from "../server/storage";

(async () => {
  try {
    const result = await storage.runSchemaMigration();
    console.log("Migration success:", result.success);
    console.log("Columns added:", result.columnsAdded.length);
    if (result.error) console.error("Error:", result.error);
    process.exit(0);
  } catch (e: any) {
    console.error("FATAL:", e?.message || e);
    process.exit(1);
  }
})();
