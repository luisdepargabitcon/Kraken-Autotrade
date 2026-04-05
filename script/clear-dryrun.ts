/**
 * Script de limpieza DRY_RUN
 * Borra TODOS los registros de dry_run_trades (posiciones + historial)
 * 
 * Uso: npx tsx script/clear-dryrun.ts
 */
import { db } from "../server/db";
import { dryRunTrades } from "../shared/schema";

async function clearDryRun() {
  console.log("[DRY_RUN CLEAR] Borrando todos los registros de dry_run_trades...");
  
  // Count before
  const before = await db.select().from(dryRunTrades);
  console.log(`[DRY_RUN CLEAR] Registros a borrar: ${before.length}`);
  
  if (before.length === 0) {
    console.log("[DRY_RUN CLEAR] ✅ Tabla ya está vacía, nada que borrar.");
    process.exit(0);
  }
  
  const openCount = before.filter(r => r.type === "buy" && r.status === "open").length;
  const histCount = before.filter(r => r.type === "sell").length;
  console.log(`[DRY_RUN CLEAR] → Posiciones abiertas: ${openCount}`);
  console.log(`[DRY_RUN CLEAR] → Historial (sells): ${histCount}`);
  
  await db.delete(dryRunTrades);
  
  console.log("[DRY_RUN CLEAR] ✅ COMPLETADO — dry_run_trades vaciada.");
  console.log("[DRY_RUN CLEAR] 💡 Reinicia el bot para que el mapa en memoria quede limpio también.");
  
  process.exit(0);
}

clearDryRun().catch(err => {
  console.error("[DRY_RUN CLEAR] ❌ ERROR:", err);
  process.exit(1);
});
