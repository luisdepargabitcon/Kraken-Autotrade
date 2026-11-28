// Harness causal de replay de CICLOS IDCA (no solo señales).
//
// A diferencia de idca_signal_replay.ts (que mide forward returns de señales),
// este harness simula la máquina de estados completa del ciclo DCA: entrada,
// compras de seguridad escalonadas, take-profit con trailing y cierre, todo de
// forma CAUSAL — en cada vela cerrada solo se usa información del pasado.
//
// LÍMITES DECLARADOS (no es el motor productivo):
//  - no reproduce hybrid/confluencia/BE adaptativo/ATRP dinámico del motor;
//  - la referencia de entrada es el máximo rodante de N velas (proxy del anchor);
//  - fees fijos paramétricos; sin slippage; una posición por par;
//  - datos públicos Bitstamp 1h como proxy de mercado (no el venue real).
// Por tanto sus números NO son evidencia de rentabilidad del bot: son un
// instrumento de comparación CAUSAL entre variantes de parámetros, y siguen
// sin activar ninguna variante.
import fs from "fs";
import path from "path";
import crypto from "crypto";

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

export interface CycleReplayConfig {
  entryDipPct: number;          // dip desde máximo rodante para entrar
  referenceWindowCandles: number;
  safetyDipStepsPct: number[];  // dips adicionales desde entrada para cada safety
  sizeWeightsPct: number[];     // peso de capital por nivel (base + safeties)
  capitalPerCycleUsd: number;
  takeProfitPct: number;        // sobre precio medio
  trailingPct: number;          // trailing desde el pico tras armar TP
  feePct: number;
  maxLevels: number;
}

export interface CycleResult {
  entryTime: number;
  exitTime: number | null;
  levelsUsed: number;
  investedUsd: number;
  exitValueUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  holdingHours: number | null;
  exitReason: string | null;
  maxDrawdownPct: number;
}

export interface ReplaySummary {
  config: CycleReplayConfig;
  cycles: number;
  closedCycles: number;
  winRate: number | null;
  totalPnlUsd: number;
  avgPnlPct: number | null;
  maxDrawdownPct: number;
  exposurePct: number;
  openCyclesAtEnd: number;
}

export function replayCycles(candles: Candle[], cfg: CycleReplayConfig): { summary: ReplaySummary; cycles: CycleResult[] } {
  const cycles: CycleResult[] = [];
  let pos: {
    entryTime: number; qty: number; invested: number; avgPrice: number; baseEntryPrice: number;
    levelsUsed: number; peakPrice: number; tpArmed: boolean; maxDdPct: number;
  } | null = null;
  let timeInMarket = 0;

  for (let i = cfg.referenceWindowCandles; i < candles.length; i++) {
    const c = candles[i];
    // CAUSAL: la referencia usa solo velas [i-N, i-1], nunca la actual ni futuras.
    const window = candles.slice(i - cfg.referenceWindowCandles, i);
    const reference = Math.max(...window.map(w => w.high));

    if (!pos) {
      const dipPct = ((reference - c.close) / reference) * 100;
      if (dipPct >= cfg.entryDipPct) {
        const usd = cfg.capitalPerCycleUsd * (cfg.sizeWeightsPct[0] / 100);
        const qty = (usd * (1 - cfg.feePct / 100)) / c.close;
        pos = { entryTime: c.time, qty, invested: usd, avgPrice: c.close, baseEntryPrice: c.close, levelsUsed: 1, peakPrice: c.close, tpArmed: false, maxDdPct: 0 };
      }
      continue;
    }

    timeInMarket++;
    // Safety buys: escalón causal sobre el precio de entrada BASE (dip
    // acumulado de los escalones), nunca sobre información futura.
    if (pos.levelsUsed < cfg.maxLevels) {
      const stepIdx = pos.levelsUsed - 1;
      const stepDip = cfg.safetyDipStepsPct[stepIdx];
      if (stepDip != null) {
        const cumulativeDip = cfg.safetyDipStepsPct.slice(0, stepIdx + 1).reduce((a, b) => a + b, 0);
        const trigger = pos.baseEntryPrice * (1 - cumulativeDip / 100);
        if (c.low <= trigger) {
          const levelIdx = Math.min(pos.levelsUsed, cfg.sizeWeightsPct.length - 1);
          const usd = cfg.capitalPerCycleUsd * (cfg.sizeWeightsPct[levelIdx] / 100);
          const fillPrice = Math.min(c.close, trigger);
          const qty = (usd * (1 - cfg.feePct / 100)) / fillPrice;
          pos.qty += qty;
          pos.invested += usd;
          // Precio medio correcto: coste total / cantidad total.
          pos.avgPrice = pos.invested / pos.qty * (1 - cfg.feePct / 100);
          pos.levelsUsed++;
        }
      }
    }

    // Drawdown causal del ciclo abierto.
    const markValue = pos.qty * c.close;
    const dd = ((pos.invested - markValue) / pos.invested) * 100;
    pos.maxDdPct = Math.max(pos.maxDdPct, Number.isFinite(dd) ? dd : 0);

    // TP + trailing causal.
    const tpPrice = pos.avgPrice * (1 + cfg.takeProfitPct / 100);
    if (c.high >= tpPrice) pos.tpArmed = true;
    pos.peakPrice = Math.max(pos.peakPrice, c.high);
    let exitReason: string | null = null;
    let exitPrice: number | null = null;
    if (pos.tpArmed) {
      const trailStop = pos.peakPrice * (1 - cfg.trailingPct / 100);
      if (c.low <= trailStop) { exitReason = "trailing_tp"; exitPrice = Math.max(c.close, trailStop); }
      else if (c.close >= tpPrice && !pos.tpArmed) { exitReason = "take_profit"; exitPrice = c.close; }
    }
    if (exitReason && exitPrice != null) {
      const exitValue = pos.qty * exitPrice * (1 - cfg.feePct / 100);
      cycles.push({
        entryTime: pos.entryTime, exitTime: c.time, levelsUsed: pos.levelsUsed,
        investedUsd: pos.invested, exitValueUsd: exitValue,
        pnlUsd: exitValue - pos.invested, pnlPct: ((exitValue - pos.invested) / pos.invested) * 100,
        holdingHours: (c.time - pos.entryTime) / 3_600_000, exitReason, maxDrawdownPct: pos.maxDdPct,
      });
      pos = null;
    }
  }

  const totalHours = candles.length - cfg.referenceWindowCandles;
  const closed = cycles.filter(cy => cy.pnlPct != null);
  const openAtEnd = pos ? 1 : 0;
  const summary: ReplaySummary = {
    config: cfg,
    cycles: cycles.length + openAtEnd,
    closedCycles: closed.length,
    winRate: closed.length > 0 ? closed.filter(cy => (cy.pnlUsd ?? 0) > 0).length / closed.length : null,
    totalPnlUsd: closed.reduce((a, cy) => a + (cy.pnlUsd ?? 0), 0),
    avgPnlPct: closed.length > 0 ? closed.reduce((a, cy) => a + (cy.pnlPct ?? 0), 0) / closed.length : null,
    maxDrawdownPct: closed.length > 0 ? Math.max(...closed.map(cy => cy.maxDrawdownPct)) : 0,
    exposurePct: totalHours > 0 ? (timeInMarket / totalHours) * 100 : 0,
    openCyclesAtEnd: openAtEnd,
  };
  return { summary, cycles };
}

export const VARIANTS: Record<string, CycleReplayConfig> = {
  // A0: parámetros estilo legacy (dip 3%, ladder 3 niveles, TP 2%, trailing 1%)
  A0_legacy: {
    entryDipPct: 3, referenceWindowCandles: 72, safetyDipStepsPct: [3, 3],
    sizeWeightsPct: [50, 30, 20], capitalPerCycleUsd: 100, takeProfitPct: 2,
    trailingPct: 1, feePct: 0.09, maxLevels: 3,
  },
  // A2: dip más profundo y TP más amplio (estilo candidato conservador)
  A2_candidate_deep: {
    entryDipPct: 4, referenceWindowCandles: 72, safetyDipStepsPct: [4, 4],
    sizeWeightsPct: [40, 30, 30], capitalPerCycleUsd: 100, takeProfitPct: 2.5,
    trailingPct: 1.2, feePct: 0.09, maxLevels: 3,
  },
  // A3: sin safeties (control de ablación)
  A3_no_safety: {
    entryDipPct: 3, referenceWindowCandles: 72, safetyDipStepsPct: [],
    sizeWeightsPct: [100], capitalPerCycleUsd: 100, takeProfitPct: 2,
    trailingPct: 1, feePct: 0.09, maxLevels: 1,
  },
};

function loadCandles(file: string): Candle[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return raw.candles as Candle[];
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function main() {
  const dir = path.resolve(process.cwd(), "AUDITORIAS/NEXA_INTEGRAL_2026-11-27/data_public/replay");
  const outDir = path.resolve(process.cwd(), "AUDITORIAS/NEXA_INTEGRAL_2026-11-27");
  const results: any = {};
  for (const [asset, file] of [["BTC", "BTC_bitstamp_1h.json"], ["ETH", "ETH_bitstamp_1h.json"]] as const) {
    const candles = loadCandles(path.join(dir, file));
    results[asset] = {};
    for (const [name, cfg] of Object.entries(VARIANTS)) {
      const { summary, cycles } = replayCycles(candles, cfg);
      results[asset][name] = {
        summary: { ...summary, config: undefined },
        firstCycles: cycles.slice(0, 3),
        closedCount: cycles.length,
      };
    }
  }
  results.meta = {
    generatedAt: new Date().toISOString(),
    note: "Harness causal de ciclos. NO es el motor productivo; comparación causal de variantes con datos públicos. No evidencia rentabilidad. Ninguna variante activada.",
    dataSha256: {
      BTC: sha256(fs.readFileSync(path.join(dir, "BTC_bitstamp_1h.json"), "utf8")),
      ETH: sha256(fs.readFileSync(path.join(dir, "ETH_bitstamp_1h.json"), "utf8")),
    },
  };
  const outFile = path.join(outDir, "REPLAY_CICLOS_RESULTADOS.json");
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2).slice(0, 3000));
  console.log(`\nEscrito: ${outFile} sha256=${sha256(JSON.stringify(results, null, 2))}`);
}

if (process.argv[1] && process.argv[1].includes("idca_cycle_replay")) main();
