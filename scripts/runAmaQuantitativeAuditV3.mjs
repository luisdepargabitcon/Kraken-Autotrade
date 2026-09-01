#!/usr/bin/env node
/**
 * Final AMA quantitative audit runner (V3).
 *
 * It derives the executable V3 harness from V2 with four explicit, reviewable corrections:
 * 1) report-template literal escaping;
 * 2) float-safe canonical staircase assertion;
 * 3) rebuild the canonical seed plan on every confirmed close until the FIRST fill;
 *    after the first fill, replan exclusively through ExecutedTrancheEvidence;
 * 4) rename output/version markers to V3 so artifacts cannot be confused with superseded runs.
 *
 * This file exists because the research branch intentionally preserves the superseded V1/V2
 * harnesses as an audit trail instead of silently rewriting history.
 */
import { readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";

const sourcePath = "scripts/amaQuantitativeAuditV2.ts";
const generatedPath = "scripts/.amaQuantitativeAuditV3.generated.ts";
let s = readFileSync(sourcePath, "utf8");

function replaceExact(oldText, newText, label) {
  if (!s.includes(oldText)) {
    throw new Error(`V3_PATCH_NOT_FOUND:${label}`);
  }
  s = s.replace(oldText, newText);
}

replaceExact("`amaReplayService.ts`", "amaReplayService.ts", "report-literal-replay");
replaceExact("`replanTranches`", "replanTranches", "report-literal-replan");
replaceExact(
  "if(JSON.stringify(got)!==JSON.stringify(expected)||deployed!==7500)throw new Error(`staircase mismatch got=${got} deployed=${deployed}`);",
  "if(got.some((v,i)=>Math.abs(v-expected[i])>1e-6)||Math.abs(deployed-7500)>1e-6)throw new Error(`staircase mismatch got=${got} deployed=${deployed}`);",
  "float-safe-staircase",
);
replaceExact(
  "if(!basePlan){baseSeed={hwmPrice:hwm.price,hwmTimestamp:hwm.timestamp,budgetUsd:CAPITAL,deployedUsd:0,reservedUsd:0,parameters:P,cycleId,asset:\"BTC\",riskOverlayMultiplier:1,previousTranchePrice:null,atr};basePlan=buildCanonicalSeedPlan(baseSeed,dc(c))}",
  "if(evidence.length===0){baseSeed={hwmPrice:hwm.price,hwmTimestamp:hwm.timestamp,budgetUsd:CAPITAL,deployedUsd:0,reservedUsd:0,parameters:P,cycleId,asset:\"BTC\",riskOverlayMultiplier:1,previousTranchePrice:null,atr};basePlan=buildCanonicalSeedPlan(baseSeed,dc(c))}",
  "rebuild-plan-until-first-fill",
);

s = s.replaceAll("artifacts/ama-quant-audit-v2", "artifacts/ama-quant-audit-v3");
s = s.replaceAll("AUDITORIA_CUANTITATIVA_AMA_BTC_V2.md", "AUDITORIA_CUANTITATIVA_AMA_BTC_V3.md");
s = s.replaceAll("AMA_QUANT_AUDIT_V2", "AMA_QUANT_AUDIT_V3");
s = s.replaceAll("V2 corregida", "V3 final");
s = s.replace('auditVersion:"V2"', 'auditVersion:"V3"');
s = s.replace(
  "4. Esta V2 corrige el doble conteo detectado en el primer harness mediante replanTranches + evidencia ejecutada.",
  "4. V3 corrige además la reevaluación pre-fill: el plan canónico se reconstruye cada cierre hasta la primera ejecución; después se usa replanTranches + evidencia ejecutada.",
);

writeFileSync(generatedPath, s);
const result = spawnSync("npx", ["tsx", generatedPath], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
