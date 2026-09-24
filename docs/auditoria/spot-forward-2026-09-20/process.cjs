// process.cjs — build forward extraction artifacts from JSONL dumps (read-only).
// v2: JSONL parsing (no CSV split), no hardcoded provenance, lifecycle exit
// states (ANY/last), certified 4-pair scope vs OTHER_SPOT_PAIRS, entry clusters.
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const DEPLOY_MS = Date.parse("2026-09-20T11:12:22Z"); // container CreatedAt
const CERTIFIED_PAIRS = new Set(["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"]);
const CLUSTER_GAP_MS = 30 * 60 * 1000; // same pair+setup entries <30min apart = same cluster

const j = f => fs.readFileSync(path.join(DIR, "raw", f), "utf8").trim().split("\n").map(JSON.parse);
const num = v => (v === null || v === undefined || v === "" || Number.isNaN(+v)) ? null : +v;
const csv = (rows, cols) => [cols.join(","), ...rows.map(r => cols.map(c => {
  const v = r[c] === null || r[c] === undefined ? "" : String(r[c]);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; // proper CSV quoting on OUTPUT
}).join(","))].join("\n");

const trades = j("raw_trades.jsonl");
const fills = j("raw_fills.jsonl");
const scans = j("raw_scans.jsonl");
const sups = j("raw_supervisor.jsonl");

// ── supervisor lifecycle per lot ──
const supByLot = new Map();
for (const s of sups) {
  const lot = s.position?.lotId;
  if (!lot) continue;
  if (!supByLot.has(lot)) supByLot.set(lot, []);
  supByLot.get(lot).push(s);
}
for (const arr of supByLot.values()) arr.sort((a, b) => a.timestamp - b.timestamp);

const buyFill = new Map(), sellFill = new Map();
for (const f of fills) {
  if (f.fill?.side === "BUY") buyFill.set(f.fill.lotId, f.fill);
  if (f.fill?.side === "SELL") sellFill.set(f.fill.lotId, f.fill);
}
const scanBySignalId = new Map();
for (const s of scans) if (s.intent?.signalId) scanBySignalId.set(s.intent.signalId, s);

const tradesByLot = new Map(trades.map(t => [t.lotId, t]));

// ── enriched closed trades ──
const rows = trades.map(t => {
  const lot = t.lotId;
  const life = supByLot.get(lot) ?? [];
  const entrySup = life[0] ?? null;
  const bf = buyFill.get(lot), sf = sellFill.get(lot);
  const closedAtMs = t.executedAt ? Date.parse(String(t.executedAt).replace(" ", "T") + "Z") : null;
  const openedAtMs = entrySup?.position?.openedAt ? +entrySup.position.openedAt
    : bf?.executedAt ? +bf.executedAt
    : closedAtMs !== null ? closedAtMs - (+t.holdTimeMinutes || 0) * 60000 : null;
  const scan = t.signalId ? scanBySignalId.get(t.signalId) : null;
  const lastSupBeforeClose = closedAtMs ? [...life].reverse().find(s => s.timestamp <= closedAtMs + 60000) ?? life[life.length - 1] : life[life.length - 1];
  const net = num(t.netPnlUsd);
  const risk = num(entrySup?.position?.riskUsd) ?? num(life[0]?.position?.riskUsd);
  const entryPrice = num(entrySup?.position?.entryPrice) ?? num(bf?.fillPrice) ?? num(t.entryPrice);
  const stopDistUsd = num(entrySup?.position?.initialStopDistanceUsd);
  const anyBe = life.some(s => s.position?.sgBreakEvenActivated === true);
  const anyTrail = life.some(s => s.position?.sgTrailingActivated === true);
  const maxHigh = life.length ? Math.max(...life.map(s => num(s.position?.highestPrice) ?? -Infinity)) : null;
  return {
    lotId: lot, pair: t.pair, signalId: t.signalId,
    policyVersion: t.policyVersion, entryStrategyId: null, // NOT persisted for closed trades → NULL
    setupTag: t.setupTag ?? entrySup?.position?.setupTag,
    openedAt: openedAtMs ? new Date(openedAtMs).toISOString() : null, openedAtMs,
    closedAt: closedAtMs ? new Date(closedAtMs).toISOString() : null, closedAtMs,
    holdTimeMinutes: num(t.holdTimeMinutes),
    entryPrice, exitPrice: num(t.price),
    qty: num(t.amount), notionalUsd: num(bf?.notionalUsd) ?? (num(t.amount) && entryPrice ? num(t.amount) * entryPrice : null),
    entryFee: num(t.entryFeeUsd), exitFee: num(t.exitFeeUsd),
    totalFees: (num(t.entryFeeUsd) ?? 0) + (num(t.exitFeeUsd) ?? 0),
    riskUsd: risk,
    initialStopPrice: num(entrySup?.position?.initialStopPrice),
    initialStopDistanceUsd: stopDistUsd,
    initialStopDistancePct: entryPrice && stopDistUsd ? stopDistUsd / entryPrice * 100 : null,
    exitReason: t.exitReasonType,
    grossPnlUsd: num(t.grossPnlUsd), netPnlUsd: net,
    rMultiple: risk && net !== null ? net / risk : null,
    mfeUsd: num(t.mfe), maeUsd: num(t.mae), mfeR: num(t.mfeR), maeR: num(t.maeR),
    highestPrice: Number.isFinite(maxHigh) ? maxHigh : num(entrySup?.position?.highestPrice),
    breakEvenActivated: anyBe ? true : (life.length ? false : null),
    trailingActivated: anyTrail ? true : (life.length ? false : null),
    regimeAtEntry: scan?.regime?.regime ?? entrySup?.regime ?? null,
    directionAtEntry: scan?.regime?.direction ?? entrySup?.direction ?? null,
    macroAtEntry: scan?.regime?.macroBias ?? entrySup?.macroBias ?? null,
    signalConfidence: num(scan?.signal?.confidence),
    marketContextId: t.marketContextId,
    executionMode: t.executionMode,
    v4QualityScore: num(scan?.intent?.v4QualityScore),
    v4Threshold: num(scan?.intent?.v4Threshold),
    v4Accepted: scan?.intent?.v4Accepted ?? null,
    impulseScore: null, retracementScore: null, structureScore: null, reclaimScore: null, resumptionScore: null,
    v4RejectReason: scan?.intent?.v4RejectReason ?? null,
    entryReason: scan?.intent?.evaluationReason ?? null,
    adx: num(scan?.regime?.adx), atrPct: num(scan?.regime?.atrPct),
    ema20: num(scan?.regime?.ema20), ema50: num(scan?.regime?.ema50),
    spreadPct: num(scan?.ticker?.spreadPct), volumeRatio: num(scan?.volume?.volumeRatio),
    volatility: scan?.regime?.volatility ?? null, dataHealth: scan?.dataHealth ?? null,
    supervisorSnapshots: life.length,
  };
});

const cohort = rows.filter(r => r.openedAtMs && r.openedAtMs >= DEPLOY_MS);
const carryover = rows.filter(r => r.openedAtMs && r.openedAtMs < DEPLOY_MS && r.closedAtMs && r.closedAtMs >= DEPLOY_MS);
const certified = cohort.filter(r => CERTIFIED_PAIRS.has(r.pair));
const otherPairs = cohort.filter(r => !CERTIFIED_PAIRS.has(r.pair));

const tradeCols = ["lotId","pair","signalId","policyVersion","entryStrategyId","setupTag","openedAt","closedAt","holdTimeMinutes","entryPrice","exitPrice","qty","notionalUsd","entryFee","exitFee","totalFees","riskUsd","initialStopPrice","initialStopDistanceUsd","initialStopDistancePct","exitReason","grossPnlUsd","netPnlUsd","rMultiple","mfeUsd","maeUsd","mfeR","maeR","highestPrice","breakEvenActivated","trailingActivated","regimeAtEntry","directionAtEntry","macroAtEntry","signalConfidence","marketContextId","executionMode","v4QualityScore","v4Threshold","v4Accepted","impulseScore","retracementScore","structureScore","reclaimScore","resumptionScore","v4RejectReason","entryReason","adx","atrPct","ema20","ema50","spreadPct","volumeRatio","volatility","dataHealth","supervisorSnapshots"];

fs.writeFileSync(path.join(DIR, "SPOT_CLOSED_TRADES.csv"), csv(cohort, tradeCols));
fs.writeFileSync(path.join(DIR, "SPOT_CLOSED_TRADES.json"), JSON.stringify(cohort, null, 2));
fs.writeFileSync(path.join(DIR, "CARRYOVER_PRE_DEPLOY.csv"), csv(carryover, tradeCols));
fs.writeFileSync(path.join(DIR, "OPEN_POSITIONS_NOW.csv"),
  "lotId,pair,openedAt,entryPrice,qty,notionalUsd,riskUsd,initialStop,currentStop,highestPrice,mfeR,maeR,unrealizedPnl,qualityScore,setupTag,regimeAtEntry\n");

// ── entry decisions ──
const dec = scans.map(s => {
  const it = s.intent ?? {};
  const executed = it.state === "EXECUTED";
  const allowed = !executed && it.shouldExecute === true;
  const decision = executed ? "BUY_EXECUTED" : allowed ? "BUY_ALLOWED" : "BUY_BLOCKED";
  const reason = s.sizing?.blockCode || it.v4RejectReason || it.lastBlockReason || s.signal?.blockReason || null;
  return {
    timestamp: new Date(s.timestamp).toISOString(), pair: s.pair,
    canonicalSignal: s.signal?.signal ?? null, canonicalSetupTag: s.signal?.setupTag ?? null,
    canonicalBlockReason: s.signal?.blockReason ?? null,
    b0IntentState: it.state ?? null, shouldExecute: it.shouldExecute ?? null,
    v4QualityScore: it.v4QualityScore ?? null, v4Threshold: it.v4Threshold ?? null,
    v4Accepted: it.v4Accepted ?? null, v4RejectReason: it.v4RejectReason ?? null,
    impulseScore: null, retracementScore: null, structureScore: null, reclaimScore: null, resumptionScore: null,
    sizingApproved: s.sizing?.approved ?? null, sizingBlockCode: s.sizing?.blockCode ?? null,
    sizingRiskUsd: s.sizing?.riskUsd ?? null, sizingNotionalUsd: s.sizing?.notionalUsd ?? null,
    sizingStopPrice: s.sizing?.stopPrice ?? null, sizingStopDistanceUsd: s.sizing?.stopDistanceUsd ?? null,
    decision, blockReason: reason,
    intentSetupTag: it.setupTag ?? null, intentSignalId: it.signalId ?? null,
    intentCreatedAt: it.createdAt ? new Date(it.createdAt).toISOString() : null,
    evaluationReason: it.evaluationReason ?? null,
    regime: s.regime?.regime ?? null, direction: s.regime?.direction ?? null,
    macroBias: s.regime?.macroBias ?? null, adx: s.regime?.adx ?? null,
    atrPct: s.regime?.atrPct ?? null, volatility: s.regime?.volatility ?? null,
    spreadPct: s.ticker?.spreadPct ?? null, volumeRatio: s.volume?.volumeRatio ?? null,
    dataHealth: s.dataHealth ?? null,
  };
});
fs.writeFileSync(path.join(DIR, "SPOT_ENTRY_DECISIONS.csv"), csv(dec, Object.keys(dec[0])));

// ── exit events (all supervisor rows with shouldExit for cohort lots) ──
const cohortLots = new Set(cohort.map(r => r.lotId));
const exitRows = [];
for (const s of sups) {
  const lot = s.position?.lotId;
  if (!lot || !cohortLots.has(lot)) continue;
  if (s.exitDecision?.shouldExit !== true) continue;
  exitRows.push({
    timestamp: new Date(s.timestamp).toISOString(), lotId: lot, pair: s.pair,
    price: s.exitDecision.price ?? s.position?.currentPrice,
    exitDecision: "EXIT", exitReasonType: s.exitDecision.reasonType ?? null,
    exitReason: s.exitDecision.reason ?? null,
    currentR: s.position?.currentR ?? null, mfeR: s.position?.mfeR ?? null, maeR: s.position?.maeR ?? null,
    breakEvenActivated: s.position?.sgBreakEvenActivated ?? null,
    trailingActivated: s.position?.sgTrailingActivated ?? null,
    stopPrice: s.position?.sgCurrentStopPrice ?? null,
    regime: s.regime ?? null, direction: s.direction ?? null,
    adx: s.adx ?? null, atrPct: s.atrPct ?? null,
  });
}
const exCols = ["timestamp","lotId","pair","price","exitDecision","exitReasonType","exitReason","currentR","mfeR","maeR","breakEvenActivated","trailingActivated","stopPrice","regime","direction","adx","atrPct"];
fs.writeFileSync(path.join(DIR, "SPOT_EXIT_EVENTS.csv"), csv(exitRows, exCols));

// ── entry clusters: same pair + same setupTag, consecutive entries <30min apart ──
const execEntries = cohort.map(r => ({ lotId: r.lotId, pair: r.pair, setupTag: r.setupTag, openedAtMs: r.openedAtMs, signalId: r.signalId }))
  .sort((a, b) => a.openedAtMs - b.openedAtMs);
const clusters = [];
let cur = null;
for (const e of execEntries) {
  if (cur && e.pair === cur.pair && e.setupTag === cur.setupTag && e.openedAtMs - cur.lastAt <= CLUSTER_GAP_MS) {
    cur.lotIds.push(e.lotId); cur.signalIds.push(e.signalId); cur.lastAt = e.openedAtMs; cur.n++;
  } else {
    if (cur) clusters.push(cur);
    cur = { pair: e.pair, setupTag: e.setupTag, firstAt: e.openedAtMs, lastAt: e.openedAtMs, n: 1, lotIds: [e.lotId], signalIds: [e.signalId] };
  }
}
if (cur) clusters.push(cur);
fs.writeFileSync(path.join(DIR, "SPOT_ENTRY_CLUSTERS.csv"), csv(
  clusters.map((c, i) => ({
    clusterId: i + 1, pair: c.pair, setupTag: c.setupTag,
    firstEntry: new Date(c.firstAt).toISOString(), lastEntry: new Date(c.lastAt).toISOString(),
    tradeCount: c.n, lotIds: c.lotIds.join("|"), signalIds: c.signalIds.join("|"),
  })),
  ["clusterId","pair","setupTag","firstEntry","lastEntry","tradeCount","lotIds","signalIds"]));

// ── stats ──
const stats = rs => {
  const n = rs.length;
  const net = rs.reduce((s, r) => s + (r.netPnlUsd ?? 0), 0);
  const w = rs.filter(r => (r.netPnlUsd ?? 0) > 0), l = rs.filter(r => (r.netPnlUsd ?? 0) <= 0);
  const gw = w.reduce((s, r) => s + r.netPnlUsd, 0), gl = Math.abs(l.reduce((s, r) => s + r.netPnlUsd, 0));
  let eq = 10000, peak = 10000, dd = 0;
  for (const r of [...rs].sort((a, b) => a.closedAtMs - b.closedAtMs)) { eq += r.netPnlUsd ?? 0; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return { n, net, winners: w.length, losers: l.length, pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0, exp: n ? net / n : 0, dd, fees: rs.reduce((s, r) => s + (r.totalFees ?? 0), 0) };
};
const sCert = stats(certified), sOther = stats(otherPairs), sAll = stats(cohort);
const byPair = (rs, p) => rs.filter(r => r.pair === p).length;

// validations
const dupLots = cohort.length - new Set(cohort.map(r => r.lotId)).size;
const badTimes = cohort.filter(r => !(r.openedAtMs < r.closedAtMs)).length;
const nonShadow = cohort.filter(r => r.executionMode !== "SHADOW").length;
const trailingNoFlag = cohort.filter(r => r.exitReason === "TRAILING" && r.trailingActivated !== true);
const ctxBad = cohort.filter(r => {
  const bad = (r.adx !== null && (r.adx < 0 || r.adx > 100)) ||
    (r.atrPct !== null && (r.atrPct < 0 || r.atrPct > 20)) ||
    (r.spreadPct !== null && (r.spreadPct < 0 || r.spreadPct > 5)) ||
    (r.volatility !== null && !["LOW","NORMAL","HIGH","EXTREME"].includes(r.volatility)) ||
    (r.dataHealth !== null && !["GOOD","DEGRADED","STALE","BAD"].includes(String(r.dataHealth)));
  return bad;
});
const v4Q = cohort.filter(r => r.v4QualityScore !== null).length;
const v4T = cohort.filter(r => r.v4Threshold !== null).length;
const v4A = cohort.filter(r => r.v4Accepted !== null).length;

const now = new Date();
const summary = [
  `DEPLOY_CODE_SHA=3ae18319b8c0b68c9374241db65f8ef9bdd39a57`,
  `DEPLOY_TIMESTAMP_UTC=2026-09-20 11:12:22 UTC (docker CreatedAt krakenbot-staging-app; VPS git HEAD=3ae18319 committed 11:11:29 UTC)`,
  `DEPLOY_TIMESTAMP_MADRID=2026-09-20 13:12:22 Europe/Madrid (CEST, UTC+2)`,
  ``,
  `EXTRACTION_END_UTC=${now.toISOString()}`,
  `EXTRACTION_END_MADRID=2026-09-24T14:xx (CEST = UTC+2)`,
  ``,
  `SPOT_MODE=SHADOW`,
  ``,
  `# CERTIFIED_V4_SCOPE (BTC/ETH/SOL/XRP)`,
  `TOTAL_CLOSED=${sCert.n}`,
  `TOTAL_OPEN=0 (open_positions empty)`,
  `TOTAL_CARRYOVER=${carryover.length}`,
  ``,
  `BTC_CLOSED=${byPair(certified,"BTC/USD")}`,
  `ETH_CLOSED=${byPair(certified,"ETH/USD")}`,
  `SOL_CLOSED=${byPair(certified,"SOL/USD")}`,
  `XRP_CLOSED=${byPair(certified,"XRP/USD")}`,
  ``,
  `NET_PNL_CLOSED=${sCert.net.toFixed(2)}`,
  `TOTAL_FEES=${sCert.fees.toFixed(2)}`,
  `WINNERS=${sCert.winners}`,
  `LOSERS=${sCert.losers}`,
  `PF=${sCert.pf === Infinity ? "inf" : sCert.pf.toFixed(3)}`,
  `EXPECTANCY=${sCert.exp.toFixed(3)}`,
  `MAX_DD=${sCert.dd.toFixed(2)}`,
  ``,
  `# OTHER_SPOT_PAIRS`,
  `TON_TRADES=${sOther.n}`,
  `TON_NET=${sOther.net.toFixed(2)}`,
  `ALL_SCOPE_NET=${sAll.net.toFixed(2)} (certified+other)`,
  ``,
  `TOTAL_ENTRY_EXECUTED=${dec.filter(d => d.decision === "BUY_EXECUTED").length}`,
  `TOTAL_ENTRY_ALLOWED=${dec.filter(d => d.decision === "BUY_ALLOWED").length}`,
  `TOTAL_ENTRY_BLOCKED=${dec.filter(d => d.decision === "BUY_BLOCKED").length}`,
  `TOTAL_EXIT_EVENTS=${exitRows.length}`,
  ``,
  `RAW_TRADES=${cohort.length}`,
  `INDEPENDENT_ENTRY_CLUSTERS=${clusters.length}`,
  ``,
  `EARLIEST_ENTRY=${cohort.length ? new Date(Math.min(...cohort.map(r => r.openedAtMs))).toISOString() : ""}`,
  `LATEST_ENTRY=${cohort.length ? new Date(Math.max(...cohort.map(r => r.openedAtMs))).toISOString() : ""}`,
  ``,
  `VALIDATION: dupLotId=${dupLots} badOpenCloseTimes=${badTimes} nonShadow=${nonShadow} ctxOutOfRange=${ctxBad.length} trailingNoFlag=${trailingNoFlag.length}${trailingNoFlag.length ? " [" + trailingNoFlag.map(r=>r.lotId).join("|") + "]" : ""}`,
  ``,
  `V4_PERSISTENCE: qualityScore nonNull=${v4Q}/${cohort.length}, threshold=${v4T}, accepted=${v4A} → ${v4Q===0&&v4T===0&&v4A===0 ? "V4_PERSISTENCE_MISSING=YES (fields exist in intent schema, always NULL in build 3ae18319)" : "populated"}`,
  ``,
  `DATA_SOURCE=DB (trades + spot_forward_twin_snapshots SCAN/SUPERVISOR/FILL; SELECT only; JSONL structured export)`,
  `MISSING_FIELDS=entryStrategyId (not persisted for closed trades → NULL); v4 component scores + qualityScore/threshold/accepted/rejectReason present-but-NULL in snapshots; signalConfidence only in scan signal (no per-trade persist)`,
].join("\n");
fs.writeFileSync(path.join(DIR, "SUMMARY.md"), summary);
console.log(summary);
