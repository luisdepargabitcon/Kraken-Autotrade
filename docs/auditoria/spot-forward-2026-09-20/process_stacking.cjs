// process_stacking.cjs — same-pair stacking forensic (audit only, no changes)
const fs = require("fs");
const path = require("path");
const DIR = __dirname;
const CERT = new Set(["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"]);

const tr = JSON.parse(fs.readFileSync(path.join(DIR, "SPOT_CLOSED_TRADES.json"), "utf8"));
const csv = (rows, cols) => [cols.join(","), ...rows.map(r => cols.map(c => {
  const v = r[c] === null || r[c] === undefined ? "" : String(r[c]);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}).join(","))].join("\n");
const num = v => v === null || v === undefined ? null : +v;
const stats = rs => {
  const n = rs.length, net = rs.reduce((s, r) => s + (r.netPnlUsd ?? 0), 0);
  const w = rs.filter(r => (r.netPnlUsd ?? 0) > 0).reduce((s, r) => s + r.netPnlUsd, 0);
  const l = Math.abs(rs.filter(r => (r.netPnlUsd ?? 0) <= 0).reduce((s, r) => s + r.netPnlUsd, 0));
  let eq = 10000, peak = 10000, dd = 0;
  for (const r of [...rs].sort((a, b) => a.closedAtMs - b.closedAtMs)) { eq += r.netPnlUsd ?? 0; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return { n, net, pf: l > 0 ? w / l : w > 0 ? Infinity : 0, exp: n ? net / n : 0, dd };
};

// ── A) real temporal overlaps (same pair) ──
const overlaps = [];
for (let i = 0; i < tr.length; i++) for (let j = i + 1; j < tr.length; j++) {
  const a = tr[i], b = tr[j];
  if (a.pair !== b.pair) continue;
  const ov = Math.min(a.closedAtMs, b.closedAtMs) - Math.max(a.openedAtMs, b.openedAtMs);
  if (ov <= 0) continue;
  const [f, s] = a.openedAtMs <= b.openedAtMs ? [a, b] : [b, a];
  const cls = (f.setupTag === s.setupTag && f.regimeAtEntry === s.regimeAtEntry && f.directionAtEntry === s.directionAtEntry &&
    Math.abs((f.adx ?? 0) - (s.adx ?? 0)) < 10 && Math.abs((f.atrPct ?? 0) - (s.atrPct ?? 0)) < 0.5)
    ? "SAME_SETUP_DUPLICATE"
    : f.setupTag === s.setupTag ? "RELATED_SETUP" : "INDEPENDENT_SETUP";
  overlaps.push({
    pair: f.pair, certifiedScope: CERT.has(f.pair), lot1: f.lotId, lot2: s.lotId,
    openedAt1: f.openedAt, openedAt2: s.openedAt, closedAt1: f.closedAt, closedAt2: s.closedAt,
    overlapMinutes: +(ov / 60000).toFixed(1), risk1: f.riskUsd, risk2: s.riskUsd,
    combinedRisk: (f.riskUsd ?? 0) + (s.riskUsd ?? 0),
    net1: +f.netPnlUsd?.toFixed(2), net2: +s.netPnlUsd?.toFixed(2),
    combinedNet: +((f.netPnlUsd ?? 0) + (s.netPnlUsd ?? 0)).toFixed(2),
    sameSetupTag: f.setupTag === s.setupTag, sameRegime: f.regimeAtEntry === s.regimeAtEntry,
    sameDirection: f.directionAtEntry === s.directionAtEntry,
    sameMarketContext: f.marketContextId === s.marketContextId,
    classification: cls,
    entryPrice1: f.entryPrice, entryPrice2: s.entryPrice,
    stop1: f.initialStopPrice, stop2: s.initialStopPrice,
    mfeR1: f.mfeR, maeR1: f.maeR, mfeR2: s.mfeR, maeR2: s.maeR,
    exitReason1: f.exitReason, exitReason2: s.exitReason,
    signalId1: f.signalId, signalId2: s.signalId,
    marketContextId1: f.marketContextId, marketContextId2: s.marketContextId,
  });
}
fs.writeFileSync(path.join(DIR, "SAME_PAIR_OVERLAP.csv"), csv(overlaps, Object.keys(overlaps[0])));

// ── B) MAX1 counterfactual (real overlap rule, per pair, chronological) ──
const kept = [], blocked = [];
for (const pair of new Set(tr.map(t => t.pair))) {
  const open = tr.filter(t => t.pair === pair).sort((a, b) => a.openedAtMs - b.openedAtMs);
  const active = [];
  for (const t of open) {
    const stillOpen = active.filter(x => x.closedAtMs > t.openedAtMs);
    if (stillOpen.length === 0) { active.push(t); kept.push(t); }
    else blocked.push({ ...t, blockedBy: stillOpen.map(x => x.lotId).join("|") });
  }
}
const cfRows = tr.map(t => ({
  lotId: t.lotId, pair: t.pair, certifiedScope: CERT.has(t.pair), openedAt: t.openedAt, closedAt: t.closedAt,
  currentPolicy: "KEPT", max1Policy: blocked.some(b => b.lotId === t.lotId) ? "BLOCKED" : "KEPT",
  blockedBy: blocked.find(b => b.lotId === t.lotId)?.blockedBy ?? "",
  setupTag: t.setupTag, riskUsd: t.riskUsd, netPnlUsd: t.netPnlUsd, rMultiple: t.rMultiple,
  mfeR: t.mfeR, maeR: t.maeR, exitReason: t.exitReason,
}));
cfRows.forEach(r => { if (r.max1Policy === "BLOCKED") r.currentPolicy = "KEPT(max2)"; });
fs.writeFileSync(path.join(DIR, "STACKING_COUNTERFACTUAL.csv"), csv(cfRows, Object.keys(cfRows[0])));

const certTr = tr.filter(t => CERT.has(t.pair));
const certBlocked = new Set(blocked.filter(b => CERT.has(b.pair)).map(b => b.lotId));
const max1Trades = certTr.filter(t => !certBlocked.has(t.lotId));
const sCur = stats(certTr), sMax1 = stats(max1Trades), sAll = stats(tr);
const max1All = tr.filter(t => !new Set(blocked.map(b => b.lotId)).has(t.lotId));
const sMax1All = stats(max1All);

// ── C) single vs multi cluster (heuristic clusters from CSV) ──
const cl = fs.readFileSync(path.join(DIR, "SPOT_ENTRY_CLUSTERS.csv"), "utf8").trim().split("\n").slice(1);
const lotClusterN = new Map();
for (const c of cl) { const f = c.split(","); for (const l of f[6].split("|")) lotClusterN.set(l, +f[5]); }
const singleT = certTr.filter(t => (lotClusterN.get(t.lotId) ?? 1) === 1);
const multiT = certTr.filter(t => (lotClusterN.get(t.lotId) ?? 1) > 1);
const sS = stats(singleT), sM = stats(multiT);

// ── D) per pair current vs max1 ──
const perPair = {};
for (const p of CERT) {
  const cur = certTr.filter(t => t.pair === p);
  const m1 = cur.filter(t => !certBlocked.has(t.lotId));
  perPair[p] = { cur: stats(cur), m1: stats(m1), blocked: cur.length - m1.length };
}

const lines = [];
lines.push(`# STACKING_FORENSIC — same-pair stacking audit (forward, audit only)`);
lines.push(``);
lines.push(`BASE_AUDIT_SHA=8618c44 · deployed code verified: 3ae18319 DEFAULT_SPOT_RISK_CONFIG.maxLotsPerPair=2 (git show)`);
lines.push(``);
lines.push(`## Overlaps reales (mismo pair, second.openedAt < first.closedAt)`);
lines.push(`certified: ${overlaps.filter(o => o.certifiedScope).length} pares solapados | all-scope: ${overlaps.length}`);
lines.push(`clasificación: ${overlaps.map(o => o.classification).reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {}) && Object.entries(overlaps.reduce((m, o) => (m[o.classification] = (m[o.classification] || 0) + 1, m), {})).map(([k, v]) => `${k}=${v}`).join(" ")}`);
lines.push(`sameMarketContextId en overlaps: ${overlaps.filter(o => o.sameMarketContext).length}/${overlaps.length} (cada entrada evaluada en scan distinto — no son el mismo contextId)`);
lines.push(``);
lines.push(`## MAX1 counterfactual (certified scope)`);
lines.push(`CURRENT_TRADES=${sCur.n} NET=${sCur.net.toFixed(2)} PF=${sCur.pf.toFixed(3)} DD=${sCur.dd.toFixed(2)}`);
lines.push(`MAX1_TRADES=${sMax1.n} NET=${sMax1.net.toFixed(2)} PF=${sMax1.pf.toFixed(3)} DD=${sMax1.dd.toFixed(2)}`);
lines.push(`SECOND_LOTS_BLOCKED=${certBlocked.size} DELTA_NET=${(sMax1.net - sCur.net).toFixed(2)} DELTA_DD=${(sMax1.dd - sCur.dd).toFixed(2)}`);
lines.push(`blocked net sum=${blocked.filter(b => CERT.has(b.pair)).reduce((s, b) => s + b.netPnlUsd, 0).toFixed(2)}`);
lines.push(``);
lines.push(`## Single vs multi cluster (certified)`);
lines.push(`SINGLE_ENTRY_CLUSTERS: n=${sS.n} net=${sS.net.toFixed(2)} pf=${sS.pf.toFixed(3)} exp=${sS.exp.toFixed(2)}`);
lines.push(`MULTI_ENTRY_CLUSTERS: n=${sM.n} net=${sM.net.toFixed(2)} pf=${sM.pf.toFixed(3)} exp=${sM.exp.toFixed(2)}`);
lines.push(``);
lines.push(`## Per pair (certified)`);
for (const [p, m] of Object.entries(perPair))
  lines.push(`${p}: current=${m.cur.net.toFixed(2)} max1=${m.m1.net.toFixed(2)} blocked=${m.blocked} delta=${(m.m1.net - m.cur.net).toFixed(2)}`);
lines.push(``);
lines.push(`## All-scope (incl TON)`);
lines.push(`CURRENT: n=${sAll.n} net=${sAll.net.toFixed(2)} | MAX1: n=${sMax1All.n} net=${sMax1All.net.toFixed(2)} blocked=${blocked.length}`);

fs.writeFileSync(path.join(DIR, "STACKING_FORENSIC.md"), lines.join("\n"));
console.log(lines.join("\n"));
