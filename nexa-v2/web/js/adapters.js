// NEXA V2 — adaptadores de rutas REALES del bot → contrato canónico.
// Cada entrada documenta la ruta existente en el repositorio (server/routes/*)
// y cómo se normaliza. Los campos ausentes quedan null (nunca se inventan).
import { freshness } from './util.js';

// ---------- Mapa de rutas reales (inventario F1) ----------
export const ROUTES = {
  idca: {
    controls:   'GET /institutional-dca/controls',
    config:     'GET /institutional-dca/config',
    effective:  'GET /institutional-dca/config/effective',
    pairs:      'GET /institutional-dca/asset-configs',
    summary:    'GET /institutional-dca/summary',
    cycles:     'GET /institutional-dca/cycles/active',
    cycleDetail:'GET /institutional-dca/cycles/:id',
    orders:     'GET /institutional-dca/orders',
    history:    'GET /institutional-dca/cycles?status=closed',
    events:     'GET /institutional-dca/events',
    wallet:     'GET /institutional-dca/simulation/wallet',
    feePresets: 'GET /institutional-dca/exchange-fee-presets',
    hybrid:     'GET /institutional-dca/hybrid/status',
    actions: {
      pauseGlobal:   'POST /institutional-dca/controls {globalTradingPause}',
      emergencyClose:'POST /institutional-dca/emergency/close-all',
      pauseCycle:    'POST /institutional-dca/cycles/:id/close-manual',
      manualBuy:     'POST /institutional-dca/cycles/:id/manual-buy',
      togglePair:    'POST /institutional-dca/asset-configs/:pair {enabled}',
      resetSim:      'POST /institutional-dca/simulation/reset',
    },
  },
  grid: {
    config:    'GET /grid-isolated/config',
    status:    'GET /grid-isolated/status',
    levels:    'GET /grid-isolated/levels',
    cycles:    'GET /grid-isolated/cycles',
    events:    'GET /grid-isolated/events',
    pumpDump:  'GET /grid-isolated/pump-dump-state',
    unlock:    'GET /grid-isolated/unlock-status',
    audit:     'GET /grid-isolated/monitor/audit',
    actions: {
      setMode:       'POST /grid-isolated/mode {mode}',
      acknowledge:   'POST /grid-isolated/mode/acknowledge',
      saveConfig:    'POST /grid-isolated/config',
      shadowCleanup: 'POST /grid-isolated/shadow-cleanup/apply',
      reconcile:     'POST /grid-isolated/reconcile',
    },
  },
  ama: {
    status:    'GET /ama/status',
    marketView:'GET /ama/market-view',
    mandate:   'GET /ama/mandate',
    policy:    'GET /ama/policy/active',
    tranches:  'GET /ama/tranche-plan/current',
    cycles:    'GET /ama/cycles',
    portfolio: 'GET /ama/portfolio',
    readiness: 'GET /ama/readiness',
    actions: {
      setMode:    'POST /ama/mode {mode}',
      killSwitch: 'POST /ama/kill-switch',
      analyzeNow: 'POST /ama/analyze-now',
      mandateDraft:'POST /ama/mandate/drafts',
      mandateApprove:'POST /ama/mandate/approve',
      mandateActivate:'POST /ama/mandate/activate',
    },
  },
  spot: {
    positions:   'GET /open-positions',
    diagnostics: 'GET /positions/smart-exit-diagnostics',
    actions: {
      close:   'POST /positions/:pair/close',
      buy:     'POST /positions/:pair/buy',
      timeStop:'PATCH /positions/:lotId/time-stop',
      delOrphan:'DELETE /positions/:lotId/orphan',
    },
  },
  common: {
    portfolio:   'GET /portfolio/summary',
    holdings:    'GET /portfolio/holdings',
    ledger:      'GET /portfolio/ledger',
    reservations:'GET /portfolio/reservations',
    inventory:   'GET /portfolio/inventory',
    budgets:     'GET /portfolio/budgets',
    market:      'GET /market/:pair',
    balances:    'GET /balances/all',
    prices:      'GET /prices/portfolio',
    notifications:'GET /notifications',
    fisco:       'GET /fisco/summary (ver fisco.routes.ts)',
  },
};

// ---------- Normalización defensiva ----------
const pick = (o, ...keys) => { for(const k of keys){ const v = o?.[k]; if(v!==undefined && v!==null) return v; } return null; };
// El bot devuelve importes como string decimal ("2400.00"): se parsean, nunca se inventan.
const num = v => {
  const n = typeof v==='string' && v.trim()!=='' ? Number(v) : v;
  return (typeof n==='number' && Number.isFinite(n)) ? n : null;
};
// Respuestas del bot con envoltura {success,data,timestamp}: se desenvuelve el payload real.
export const unwrap = raw =>
  (raw && typeof raw==='object' && !Array.isArray(raw) && 'data' in raw && 'success' in raw)
    ? raw.data : raw;

export function normEngineStatus(raw){
  if(!raw || typeof raw!=='object') return null;
  return {
    mode: pick(raw,'mode','executionMode','state'),
    enabled: pick(raw,'enabled','active','isEnabled','institutionalDcaEnabled','normalBotEnabled'),
    tickAt: pick(raw,'lastTickAt','tickAt','lastUpdate','updatedAt','timestamp','lastUpdated'),
    globalTradingPause: pick(raw,'globalTradingPause','paused','globalPause'),
    emergency: pick(raw,'emergency','emergencyActive'),
    source:'api', ts: Date.now(),
  };
}

export function normIdcaSummary(raw){
  if(!raw || typeof raw!=='object') return null;
  return {
    pairs: raw.pairs || raw.assetConfigs || null,
    mode: pick(raw,'mode','schedulerMode'),
    capitalAllocated: num(pick(raw,'capitalAllocated','allocatedCapitalUsd','allocatedUsd','allocated','totalCapital')),
    capitalUsed: num(pick(raw,'capitalUsed','capitalUsedUsd','used','capitalInUse')),
    capitalFree: num(pick(raw,'capitalFree','capitalFreeUsd','free','available')),
    realizedPnl: num(pick(raw,'realizedPnl','realizedPnlUsd','pnlRealized','realized')),
    unrealizedPnl: num(pick(raw,'unrealizedPnl','unrealizedPnlUsd','pnlUnrealized','unrealized')),
    activeCycles: pick(raw,'activeCyclesCount','activeCycles','liveCyclesCount','openCycles','cycles'),
    buysToday: num(pick(raw,'buysToday','purchasesToday')),
    sellsToday: num(pick(raw,'sellsToday','salesToday')),
    strategyScore: num(pick(raw,'strategyScore','score','entryScore')),
    trailingActive: pick(raw,'trailingActiveCount','trailingActive','trailing'),
    smartMode: pick(raw,'smartModeEnabled','smartMode','smart'),
    ts: Date.now(),
  };
}

export function normIdcaCycle(raw){
  if(!raw || typeof raw!=='object') return null;
  return {
    id: pick(raw,'id','cycleId'),
    pair: pick(raw,'pair','symbol','asset'),
    mode: pick(raw,'mode'),
    startedAt: pick(raw,'startedAt','openedAt','createdAt','startTs'),
    buys: num(pick(raw,'buys','buyCount','numBuys','purchases')),
    anchor: num(pick(raw,'anchor','cycleAnchor','anchorPrice')),
    entryBase: num(pick(raw,'entryBase','baseEntry','base')),
    avgPrice: num(pick(raw,'avgPrice','avgEntryPrice','averagePrice','meanPrice')),
    qty: num(pick(raw,'qty','totalQuantity','quantity','amount')),
    capitalUsed: num(pick(raw,'capitalUsed','capitalUsedUsd','capital','invested')),
    capitalReserved: num(pick(raw,'capitalReservedUsd','capitalReserved')),
    currentPrice: num(pick(raw,'currentPrice','lastPrice')),
    marketValue: num(pick(raw,'marketValue','value')),
    pnlUsd: num(pick(raw,'pnlUsd','unrealizedPnlUsd','realizedPnlUsd','pnl','profitUsd')),
    pnlPct: num(pick(raw,'pnlPct','unrealizedPnlPct','pnlPercent','profitPct')),
    pnlNet: num(pick(raw,'pnlNet','realizedPnlUsd','netPnl')),
    drawdown: num(pick(raw,'drawdown','dd')),
    tpTarget: num(pick(raw,'tpTarget','tpTargetPrice','targetTp','tp')),
    tpTargetPct: num(pick(raw,'tpTargetPct')),
    tpBase: pick(raw,'tpBase','tpRef'),
    nextEntry: num(pick(raw,'nextEntry','nextBuy','nextDca')),
    breakEven: pick(raw,'breakEven','be'),
    trailing: pick(raw,'trailing','trailingPct','trailingStop'),
    timeStop: pick(raw,'timeStop','timeStopRule'),
    status: pick(raw,'status','state'),
  };
}

export function normOrder(raw){
  if(!raw || typeof raw!=='object') return null;
  return {
    id: pick(raw,'id','orderId'),
    cycleId: pick(raw,'cycleId','cycle'),
    ts: pick(raw,'ts','timestamp','executedAt','createdAt'),
    side: pick(raw,'side','type'),
    type: pick(raw,'orderType','execType','kind'),
    price: num(pick(raw,'price','avgPrice','fillPrice','avgFillPrice')),
    qty: num(pick(raw,'qty','quantity','volume','amount')),
    value: num(pick(raw,'value','netValueUsd','grossValueUsd','notional','cost')),
    fee: num(pick(raw,'fee','feesUsd','commission')),
    slippage: num(pick(raw,'slippage','slippageUsd','slippagePct','slip')),
    reason: pick(raw,'humanReason','reason','triggerReason','motivo','cause','trigger'),
    result: pick(raw,'result','executionStatus','outcome'),
  };
}

export function normGridCycle(raw){
  if(!raw || typeof raw!=='object') return null;
  return {
    id: pick(raw,'id','cycleId'),
    cycleNumber: num(pick(raw,'cycleNumber')),
    pair: pick(raw,'pair','symbol'),
    buyQty: num(pick(raw,'buyQty','quantity','qty','buyAmount')),
    sellQty: num(pick(raw,'sellQty','targetSellQuantity','targetQty')),
    buyPrice: num(pick(raw,'buyPrice','fillPrice','entryPrice')),
    sellTarget: num(pick(raw,'sellTarget','targetSellPrice','targetPrice','sellPrice')),
    buyTs: pick(raw,'buyTs','buyAt','filledAt'),
    sellState: pick(raw,'sellState','state','status'),
    fees: num(pick(raw,'fees','feeTotalUsd','fee','commission')),
    pnl: num(pick(raw,'pnl','netPnlUsd','grossPnlUsd','profit')),
    rangeVersion: pick(raw,'rangeVersion','rangeVersionId','range'),
  };
}

// Estado GRID: conserva los campos reales del bot y añade claves canónicas.
export function normGridStatus(raw){
  const s = normEngineStatus(raw);
  if(!s) return null;
  return { ...raw, ...s,
    rangeStatus: pick(raw,'activeRangeStatus','rangeStatus'),
    rangeVersion: num(pick(raw,'activeRangeVersionNumber')),
    openLevels: num(pick(raw,'openLevels')),
    plannedLevels: num(pick(raw,'plannedLevelsCount')),
    openCycles: num(pick(raw,'openCycles','globalOpenCyclesCount')),
    netPnl: num(pick(raw,'totalNetPnlUsd','netPnlUsd')),
    capitalReserved: num(pick(raw,'capitalReservedUsd')),
    capitalAvailable: num(pick(raw,'capitalAvailableUsd')),
    pumpDump: pick(raw,'pumpDumpState'),
    circuitBreaker: pick(raw,'circuitBreakerOpen'),
  };
}

// Estado AMA: idéntica preservación; mode y state son reales y distintos.
export function normAmaStatus(raw){
  const s = normEngineStatus(raw);
  if(!s) return null;
  return { ...raw, ...s,
    operationalState: pick(raw,'state'),
    killSwitch: pick(raw,'killSwitchActive'),
  };
}

// Cartera consolidada: claves canónicas calculadas desde la respuesta real.
export function normPortfolioSummary(raw){
  if(!raw || typeof raw!=='object') return null;
  return { ...raw,
    navUsd: num(pick(raw,'navUsd','totalValueUsd')),
    exposureUsd: num(pick(raw,'exposureUsd','deployedUsd','totalDeployedUsd')),
    realizedPnlUsd: num(pick(raw,'realizedPnlUsd','totalRealizedPnlUsd')),
    unrealizedPnlUsd: num(pick(raw,'unrealizedPnlUsd','totalUnrealizedPnlUsd')),
    holdUsd: num(pick(raw,'holdUsd')),
  };
}

export function normAmaMandate(raw){
  if(!raw || typeof raw!=='object') return null;
  return { ...raw, id: pick(raw,'id','mandateId') };
}

export function normMarket(raw){
  if(!raw || typeof raw!=='object') return null;
  return {
    pair: pick(raw,'pair','symbol'),
    price: num(pick(raw,'price','last','lastPrice')),
    bid: num(pick(raw,'bid','bestBid')),
    ask: num(pick(raw,'ask','bestAsk')),
    change24h: num(pick(raw,'change24h','pct24h','change')),
    volume: num(pick(raw,'volume','volume24h','vol','vol24h')),
    candles: raw.candles || raw.ohlcv || null,
    indicators: raw.indicators || null,
    provider: pick(raw,'provider','source','exchange'),
    ts: pick(raw,'ts','timestamp') || Date.now(),
  };
}

export function normEvent(raw){
  if(!raw || typeof raw!=='object') return null;
  return {
    ts: pick(raw,'ts','timestamp','createdAt'),
    level: pick(raw,'level','severity','sev'),
    engine: pick(raw,'engine','motor','source'),
    type: pick(raw,'eventType','type'),
    msg: pick(raw,'msg','naturalMessage','message','text','summary'),
    detail: pick(raw,'detail','details','payload'),
  };
}

// Envoltura con estado/frescura — jamás devuelve datos inventados.
export function wrap(raw, normalizer, meta={}){
  if(raw===undefined || raw===null) return { data:null, state:'unavailable', ts:null, source:meta.source||'api' };
  const d = Array.isArray(raw) ? raw.map(normalizer).filter(Boolean) : normalizer(raw);
  const ts = meta.ts || Date.now();
  return { data:d, state: meta.state || freshness(typeof ts==='number'? new Date(ts).toISOString(): ts), ts, source: meta.source||'api' };
}
