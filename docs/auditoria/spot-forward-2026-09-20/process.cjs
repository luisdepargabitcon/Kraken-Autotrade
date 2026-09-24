// process.cjs — build forward extraction artifacts from raw dumps (read-only)
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const DEPLOY_MS = Date.parse("2026-09-20T11:12:22Z"); // container CreatedAt (krakenbot-staging-app)
const ALLOWED_PAIRS = new Set(["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"]);

function readCsv(file) {
  const lines = fs.readFileSync(path.join(DIR, "raw", file), "utf8").trim().split("\n");
  const h = lines[0].split(",");
  return lines.slice(1).map(l => {
    const c = l.split(",");
    const o = {};
    h.forEach((k, i) => (o[k] = c[i] === "" ? null : c[i]));
    return o;
  });
}
const num = v => (v === null || v === undefined || v === "") ? null : parseFloat(v);
const csv = (rows, cols) => [cols.join(","), ...rows.map(r => cols.map(c => r[c] ?? "").join(","))].join("\n");

const trades = readCsv("raw_trades.csv");
const fills = readCsv("raw_fills.csv");
const scans = readCsv("raw_scans.csv");
const sups = readCsv("raw_supervisor.csv");

// ── lotId → supervisor entry snapshot (earliest) & exit events ──
const supByLot = new Map();
for (const s of sups) {
  if (!s.lot_id) continue;
  if (!supByLot.has(s.lot_id)) supByLot.set(s.lot_id, []);
  supByLot.get(s.lot_id).push(s);
}
const entrySup = new Map(); // earliest supervisor row per lot
for (const [lot, arr] of supByLot) {
  arr.sort((a, b) => +a.timestamp - +b.timestamp);
  entrySup.set(lot, arr[0]);
}

// BUY fills per lot
const buyFill = new Map();
const sellFill = new Map();
for (const f of fills) {
  if (f.side === "BUY") buyFill.set(f.lot_id, f);
  else if (f.side === "SELL") sellFill.set(f.lot_id, f);
}

// intent signalId → scan row (V4 data)
const scanBySignalId = new Map();
for (const s of scans) if (s.intent_signal_id) scanBySignalId.set(s.intent_signal_id, s);

// ── closed trades enrichment ──
const rows = trades.map(t => {
  const lot = t.lot_id;
  const sup = entrySup.get(lot);
  const bf = buyFill.get(lot);
  const sf = sellFill.get(lot);
  const closedAtMs = t.executed_at ? Date.parse(t.executed_at.replace(" ", "T") + "Z") : null;
  const openedAtMs = sup ? +sup.opened_at_ms
    : bf ? +bf.executed_at_ms
    : closedAtMs !== null ? closedAtMs - (+t.hold_time_minutes || 0) * 60000 : null;
  const scan = t.signal_id ? scanBySignalId.get(t.signal_id) : null;
  const net = num(t.net_pnl_usd);
  const risk = num(sup?.risk_usd);
  const entryPrice = num(sup?.entry_price) ?? num(t.entry_price);
  const exitPrice = num(t.price);
  const stopDistUsd = num(sup?.initial_stop_distance_usd);
  const stopDistPct = entryPrice && stopDistUsd ? stopDistUsd / entryPrice * 100 : null;
  return {
    lotId: lot, pair: t.pair, signalId: t.signal_id,
    policyVersion: t.policy_version, entryStrategyId: "SPOT_CANONICAL_V4", setupTag: t.setup_tag ?? sup?.setup_tag,
    openedAt: openedAtMs ? new Date(openedAtMs).toISOString() : "",
    openedAtMs,
    closedAt: closedAtMs !== null ? new Date(closedAtMs).toISOString() : "",
    closedAtMs,
    holdTimeMinutes: t.hold_time_minutes,
    entryPrice, exitPrice,
    amount: num(t.amount), notionalUsd: bf ? num(bf.notional_usd) : (num(t.amount) && entryPrice ? num(t.amount) * entryPrice : null),
    entryFee: num(t.entry_fee_usd), exitFee: num(t.exit_fee_usd),
    totalFees: (num(t.entry_fee_usd) ?? 0) + (num(t.exit_fee_usd) ?? 0),
    riskUsd: risk,
    initialStopPrice: num(sup?.initial_stop_price),
    initialStopDistanceUsd: stopDistUsd,
    initialStopDistancePct: stopDistPct,
    exitReason: t.exit_reason_type,
    grossPnlUsd: num(t.gross_pnl_usd), netPnlUsd: net,
    rMultiple: risk && net !== null ? net / risk : null,
    mfeUsd: num(t.mfe), maeUsd: num(t.mae), mfeR: num(t.mfe_r), maeR: num(t.mae_r),
    highestPrice: num(sup?.highest_price),
    breakEvenActivated: sup?.be_activated, trailingActivated: sup?.trailing_activated,
    regimeAtEntry: scan?.regime ?? null, directionAtEntry: scan?.direction ?? null,
    macroAtEntry: scan?.macro_bias ?? null,
    signalConfidence: num(t.signal_confidence ?? scan?.signal_confidence),
    marketContextId: t.market_context_id,
    executionMode: t.execution_mode,
    v4QualityScore: num(scan?.v4_quality_score),
    v4Threshold: num(scan?.v4_threshold),
    v4Accepted: scan?.v4_accepted,
    impulseScore: null, retracementScore: null, structureScore: null, reclaimScore: null, resumptionScore: null,
    v4RejectReason: scan?.v4_reject_reason,
    adx: num(scan?.adx), atrPct: num(scan?.atr_pct),
    spreadPct: num(scan?.spread_pct), volumeRatio: num(scan?.volume_ratio),
    volatility: scan?.volatility, dataHealth: scan?.data_health,
  };
});

const cohort = rows.filter(r => r.openedAtMs && r.openedAtMs >= DEPLOY_MS);
const carryover = rows.filter(r => r.openedAtMs && r.openedAtMs < DEPLOY_MS && r.closedAtMs && r.closedAtMs >= DEPLOY_MS);

const tradeCols = ["lotId","pair","signalId","policyVersion","entryStrategyId","setupTag","openedAt","closedAt","holdTimeMinutes","entryPrice","exitPrice","amount","notionalUsd","entryFee","exitFee","totalFees","riskUsd","initialStopPrice","initialStopDistanceUsd","initialStopDistancePct","exitReason","grossPnlUsd","netPnlUsd","rMultiple","mfeUsd","maeUsd","mfeR","maeR","highestPrice","breakEvenActivated","trailingActivated","regimeAtEntry","directionAtEntry","macroAtEntry","signalConfidence","marketContextId","executionMode","v4QualityScore","v4Threshold","v4Accepted","impulseScore","retracementScore","structureScore","reclaimScore","resumptionScore","v4RejectReason","adx","atrPct","spreadPct","volumeRatio","volatility","dataHealth"];

fs.writeFileSync(path.join(DIR, "SPOT_CLOSED_TRADES.csv"), csv(cohort, tradeCols));
fs.writeFileSync(path.join(DIR, "SPOT_CLOSED_TRADES.json"), JSON.stringify(cohort, null, 2));
fs.writeFileSync(path.join(DIR, "CARRYOVER_PRE_DEPLOY.csv"), csv(carryover, tradeCols));

// ── open positions now ── (open_positions table was empty → header-only)
fs.writeFileSync(path.join(DIR, "OPEN_POSITIONS_NOW.csv"),
  "lotId,pair,openedAt,entryPrice,qty,notional,riskUsd,initialStop,currentStop,highestPrice,mfe,mae,unrealizedPnl,qualityScore,regimeAtEntry,setupTag\n");

// ── entry decisions ──
const dec = scans.map(s => {
  const executed = s.intent_state === "EXECUTED";
  const allowed = !executed && s.should_execute === "true";
  const decision = executed ? "BUY_EXECUTED" : allowed ? "BUY_ALLOWED" : "BUY_BLOCKED";
  const reason = s.sizing_block_code || s.v4_reject_reason || s.intent_block_reason || s.signal_block_reason || "";
  return {
    timestamp: new Date(+s.timestamp).toISOString(), pair: s.pair,
    canonicalSignal: s.signal, b0Intent: s.intent_state ?? "",
    v4QualityScore: s.v4_quality_score, v4Threshold: s.v4_threshold, v4Accepted: s.v4_accepted,
    v4RejectReason: s.v4_reject_reason,
    sizingApproved: s.sizing_approved, sizingBlockCode: s.sizing_block_code,
    intentState: s.intent_state,
    decision, blockReason: reason,
    setupTag: s.intent_setup_tag ?? s.signal_setup_tag,
    regime: s.regime, direction: s.direction, macroBias: s.macro_bias,
    adx: s.adx, atrPct: s.atr_pct, spreadPct: s.spread_pct,
    volumeRatio: s.volume_ratio, volatility: s.volatility, dataHealth: s.data_health,
    riskUsd: s.risk_usd, notionalUsd: s.notional_usd, stopPrice: s.stop_price, stopDistanceUsd: s.stop_distance_usd,
    intentSignalId: s.intent_signal_id,
  };
});
const decCols = Object.keys(dec[0] ?? { timestamp: 1 });
fs.writeFileSync(path.join(DIR, "SPOT_ENTRY_DECISIONS.csv"), csv(dec, decCols));

// ── exit events: supervisor rows with exit decision for cohort lots ──
const cohortLots = new Set(cohort.map(r => r.lotId));
const exitRows = [];
for (const s of sups) {
  if (!s.lot_id || !cohortLots.has(s.lot_id)) continue;
  if (s.exit_should !== "true") continue;
  exitRows.push({
    timestamp: new Date(+s.timestamp).toISOString(), lotId: s.lot_id, pair: s.pair,
    price: s.exit_price ?? s.current_price, exitReasonType: s.exit_reason_type, exitReason: s.exit_reason,
    currentR: s.current_r, mfeR: s.mfe_r, maeR: s.mae_r,
    beActivated: s.be_activated, trailingActivated: s.trailing_activated,
    stopPrice: s.current_stop_price, regime: s.regime, direction: s.direction, adx: s.adx, atrPct: s.atr_pct,
  });
}
const exCols = ["timestamp","lotId","pair","price","exitReasonType","exitReason","currentR","mfeR","maeR","beActivated","trailingActivated","stopPrice","regime","direction","adx","atrPct"];
fs.writeFileSync(path.join(DIR, "SPOT_EXIT_EVENTS.csv"), csv(exitRows, exCols));

// ── summary metrics ──
function stats(rs) {
  const n = rs.length;
  const net = rs.reduce((s, r) => s + (r.netPnlUsd ?? 0), 0);
  const w = rs.filter(r => (r.netPnlUsd ?? 0) > 0);
  const l = rs.filter(r => (r.netPnlUsd ?? 0) <= 0);
  const gw = w.reduce((s, r) => s + r.netPnlUsd, 0);
  const gl = Math.abs(l.reduce((s, r) => s + r.netPnlUsd, 0));
  let eq = 10000, peak = 10000, dd = 0;
  for (const r of [...rs].sort((a, b) => a.closedAtMs - b.closedAtMs)) {
    eq += r.netPnlUsd ?? 0; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
  }
  return { n, net, winners: w.length, losers: l.length, pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0, exp: n ? net / n : 0, dd, fees: rs.reduce((s, r) => s + (r.totalFees ?? 0), 0) };
}
const sAll = stats(cohort);
const byPair = p => cohort.filter(r => r.pair === p).length;
const dupLots = cohort.length - new Set(cohort.map(r => r.lotId)).size;
const badTimes = cohort.filter(r => !(r.openedAtMs < r.closedAtMs)).length;
const nonShadow = cohort.filter(r => r.executionMode !== "SHADOW").length;
const tonRows = cohort.filter(r => !ALLOWED_PAIRS.has(r.pair));

const summary = [
  `DEPLOY_CODE_SHA=3ae18319b8c0b68c9374241db65f8ef9bdd39a57`,
  `DEPLOY_TIMESTAMP_UTC=2026-09-20 11:12:22 UTC (docker CreatedAt krakenbot-staging-app; VPS git HEAD=3ae18319 committed 11:11:29 UTC)`,
  `DEPLOY_TIMESTAMP_MADRID=2026-09-20 13:12:22 Europe/Madrid (CEST, UTC+2)`,
  ``,
  `EXTRACTION_END_UTC=${new Date().toISOString()}`,
  `EXTRACTION_END_MADRID=${new Date(Date.now() + 2 * 3600000).toISOString().replace("Z", " (approx CEST)")}`,
  ``,
  `SPOT_MODE=SHADOW`,
  ``,
  `TOTAL_CLOSED=${sAll.n}`,
  `TOTAL_OPEN=0 (open_positions table empty)`,
  `TOTAL_CARRYOVER=${carryover.length}`,
  ``,
  `BTC_CLOSED=${byPair("BTC/USD")}`,
  `ETH_CLOSED=${byPair("ETH/USD")}`,
  `SOL_CLOSED=${byPair("SOL/USD")}`,
  `XRP_CLOSED=${byPair("XRP/USD")}`,
  `OTHER_PAIRS_CLOSED=${tonRows.length} (${[...new Set(tonRows.map(r => r.pair))].join(",") || "none"} — SPOT engine also trades TON; kept in extraction, flagged by pair validation)`,
  ``,
  `TOTAL_ENTRY_EXECUTED=${dec.filter(d => d.decision === "BUY_EXECUTED").length}`,
  `TOTAL_ENTRY_ALLOWED=${dec.filter(d => d.decision === "BUY_ALLOWED").length}`,
  `TOTAL_ENTRY_BLOCKED=${dec.filter(d => d.decision === "BUY_BLOCKED").length}`,
  `TOTAL_EXIT_EVENTS=${exitRows.length}`,
  ``,
  `EARLIEST_ENTRY=${cohort.length ? new Date(Math.min(...cohort.map(r => r.openedAtMs))).toISOString() : ""}`,
  `LATEST_ENTRY=${cohort.length ? new Date(Math.max(...cohort.map(r => r.openedAtMs))).toISOString() : ""}`,
  ``,
  `NET_PNL_CLOSED=${sAll.net.toFixed(2)}`,
  `TOTAL_FEES=${sAll.fees.toFixed(2)}`,
  `WINNERS=${sAll.winners}`,
  `LOSERS=${sAll.losers}`,
  `PF=${sAll.pf === Infinity ? "inf" : sAll.pf.toFixed(3)}`,
  `EXPECTANCY=${sAll.exp.toFixed(3)}`,
  `MAX_DD=${sAll.dd.toFixed(2)}`,
  ``,
  `VALIDATION: dupLotId=${dupLots} badOpenCloseTimes=${badTimes} nonShadow=${nonShadow}`,
  ``,
  `DATA_SOURCE=MIXED (trades=DB canonical; openedAt/riskUsd/stop=DB supervisor snapshots; v4/context=DB scan snapshots; fills=DB fill snapshots)`,
  `MISSING_FIELDS=impulse/retracement/structure/reclaim/resumption scores NOT persisted per trade (v4 component breakdown not stored in scan intent row — only v4QualityScore/v4Threshold/v4Accepted/v4RejectReason); signalConfidence not persisted on trade rows`,
].join("\n");
fs.writeFileSync(path.join(DIR, "SUMMARY.md"), summary);
console.log(summary);
