/**
 * idcaTextUtils — helpers to translate technical IDCA text fields to human-readable Spanish.
 *
 * Backend persists technical codes (e.g. "bullish", "GRID_OBSERVER_BLOCKED") in
 * naturalReason / reason fields. This module sanitises them before display so the
 * UI always shows clear castellano.
 */

const WORD_REPLACEMENTS: [RegExp, string][] = [
  [/\bbullish\b/gi, "alcista"],
  [/\bbearish\b/gi, "bajista"],
  [/\bhigh_volatility\b/gi, "alta volatilidad"],
  [/\btransition\b/gi, "transición"],
  // regime=X patterns (logs, debug strings)
  [/\bregime=bullish\b/gi, "régimen=alcista"],
  [/\bregime=bearish\b/gi, "régimen=bajista"],
  [/\bregime=transition\b/gi, "régimen=transición"],
  [/\bregime=high_volatility\b/gi, "régimen=alta volatilidad"],
  // State codes that sometimes leak into naturalReason
  [/\bOBSERVING_ACTIVE_CYCLE\b/g, "observando ciclo activo"],
  [/\bGRID_PLAN_SIMULATED\b/g, "plan Grid simulado"],
  [/\bGRID_OBSERVER_BLOCKED\b/g, "Grid no activo (observador)"],
  [/\bGRID_BLOCKED_BEAR_TREND\b/g, "Grid bloqueado (tendencia bajista)"],
  [/\bGRID_BLOCKED_DATA_QUALITY\b/g, "Grid bloqueado (datos)"],
  [/\bGRID_BLOCKED_CAPITAL_LIMIT\b/g, "Grid bloqueado (capital)"],
  [/\bGRID_BLOCKED_IMPORTED_CYCLE\b/g, "Grid no aplicado (importado)"],
  [/\bGRID_BLOCKED_MANUAL_CYCLE\b/g, "Grid no aplicado (manual)"],
  [/\bASSISTED_PROPOSAL_READY\b/g, "propuesta asistida lista"],
];

/**
 * Translate technical English terms / state codes inside a naturalReason string.
 * Safe to call with null / undefined — returns empty string.
 */
export function translateHybridText(text: string | null | undefined): string {
  if (!text) return "";
  let out = text;
  for (const [pattern, replacement] of WORD_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
