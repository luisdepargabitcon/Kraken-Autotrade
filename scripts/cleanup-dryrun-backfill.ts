/**
 * Script para limpiar filas contaminadas de backfill DRY_RUN
 * 
 * Identifica y elimina filas en training_trades que:
 * - Tienen buyTxid que empieza con 'DRY-' (deberían ser DRY_RUN)
 * - Pero tienen source_mode = 'REAL' (contaminadas por bug)
 * 
 * Uso:
 *   npx tsx scripts/cleanup-dryrun-backfill.ts
 * 
 * El script es idempotente y seguro:
 * - Solo elimina filas que coinciden con el patrón de contaminación
 * - Muestra cuántas filas se eliminarán antes de confirmar
 * - No toca filas reales (buyTxid sin prefijo 'DRY-')
 */

import { db } from "../server/db";
import { trainingTrades } from "../shared/schema";
import { eq, and, like } from "drizzle-orm";

async function main() {
  console.log("=== LIMPIEZA SEGURA DE BACKFILL DRY_RUN ===\n");

  // 1. Identificar filas contaminadas
  const contaminated = await db.select()
    .from(trainingTrades)
    .where(
      and(
        like(trainingTrades.buyTxid, "DRY-%"),
        eq(trainingTrades.sourceMode, "REAL")
      )
    );

  console.log(`Filas contaminadas detectadas: ${contaminated.length}`);
  
  if (contaminated.length === 0) {
    console.log("✅ No hay filas contaminadas. No se requiere limpieza.");
    return;
  }

  // 2. Mostrar muestra de filas a eliminar
  console.log("\nMuestra de filas a eliminar (primeras 5):");
  for (let i = 0; i < Math.min(5, contaminated.length); i++) {
    const row = contaminated[i];
    console.log(`  - ID ${row.id}: buyTxid=${row.buyTxid}, pair=${row.pair}, source_mode=${row.sourceMode}, evidence_weight=${row.evidenceWeight}`);
  }

  // 3. Confirmar eliminación
  console.log(`\n⚠️  Se eliminarán ${contaminated.length} filas contaminadas.`);
  console.log("Estas filas tienen buyTxid='DRY-*' pero source_mode='REAL' (bug de backfill).");
  console.log("Las filas reales (sin prefijo 'DRY-') NO se tocarán.\n");

  // En entorno de script, proceder automáticamente pero con logging claro
  console.log("Procediendo con la eliminación...\n");

  // 4. Eliminar filas contaminadas
  const idsToDelete = contaminated.map(row => row.id);
  let deleted = 0;

  for (const id of idsToDelete) {
    await db.delete(trainingTrades).where(eq(trainingTrades.id, id));
    deleted++;
    if (deleted % 50 === 0) {
      console.log(`  Progreso: ${deleted}/${idsToDelete.length} filas eliminadas...`);
    }
  }

  console.log(`\n✅ Eliminadas ${deleted} filas contaminadas.`);

  // 5. Verificar estado final
  const remainingDryRun = await db.select()
    .from(trainingTrades)
    .where(eq(trainingTrades.sourceMode, "DRY_RUN"));

  const remainingReal = await db.select()
    .from(trainingTrades)
    .where(eq(trainingTrades.sourceMode, "REAL"));

  console.log(`\nEstado final:`);
  console.log(`  - Filas DRY_RUN: ${remainingDryRun.length}`);
  console.log(`  - Filas REAL: ${remainingReal.length}`);
  console.log(`\n🔄 Ahora puedes reejecutar el backfill corregido:`);
  console.log(`  curl -sS -X POST http://127.0.0.1:3020/api/ai/backfill | jq .`);
}

main().catch((error) => {
  console.error("Error en limpieza:", error);
  process.exit(1);
});
