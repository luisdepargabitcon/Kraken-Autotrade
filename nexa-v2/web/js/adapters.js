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
    monitor:   'GET /grid-isolated/monitor/audit',
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
    events:    'GET /ama/events',
    ledger:    'GET /ama/ledger',
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

// Adaptadores no destructivos. Alias canónicos sin perder la información original.
export function normIdcaSummary(raw){
 if(!raw||typeof raw!=='object')return null;
 const allocated=num(pick(raw,'capitalAllocatedUsd','allocatedCapitalUsd','capitalAllocated','allocatedUsd','allocated','totalCapital'));
 const used=num(pick(raw,'capitalUsedUsd','capitalUsed','used','capitalInUse'));
 const free=num(pick(raw,'capitalFreeUsd','capitalFree','free','available'));
 const realized=num(pick(raw,'realizedPnlUsd','realizedPnl','pnlRealized','realized'));
 const unrealized=num(pick(raw,'unrealizedPnlUsd','unrealizedPnl','pnlUnrealized','unrealized'));
 const active=num(pick(raw,'activeCyclesCount','activeCycles','liveCyclesCount','openCycles'));
 return {...raw,pairs:pick(raw,'pairs','assetConfigs'),
  capitalAllocatedUsd:allocated,allocatedCapitalUsd:allocated,capitalAllocated:allocated,
  capitalUsedUsd:used,capitalUsed:used,capitalFreeUsd:free,capitalFree:free,
  realizedPnlUsd:realized,realizedPnl:realized,
  unrealizedPnlUsd:unrealized,unrealizedPnl:unrealized,
  activeCyclesCount:active,activeCycles:active,
  buysToday:num(pick(raw,'buysToday','purchasesToday')),
  sellsToday:num(pick(raw,'sellsToday','salesToday')),
  trailingActiveCount:num(pick(raw,'trailingActiveCount','trailingActive','trailing')),
  smartModeEnabled:pick(raw,'smartModeEnabled','smartMode','smart'),
  ts:Date.now()};
}
export function normIdcaCycle(raw){
 if(!raw||typeof raw!=='object')return null;
 const quantity=num(pick(raw,'totalQuantity','quantity','qty','amount'));
 const invested=num(pick(raw,'capitalUsedUsd','capitalUsed','capital','invested'));
 const avg=num(pick(raw,'avgEntryPrice','avgPrice','averagePrice','meanPrice'));
 const count=num(pick(raw,'buyCount','buys','numBuys','purchases'));
 return {...raw,id:pick(raw,'id','cycleId'),pair:pick(raw,'pair','symbol','asset'),
  startedAt:pick(raw,'startedAt','openedAt','createdAt','startTs'),
  closedAt:pick(raw,'closedAt','endedAt','closedTs','exitAt'),
  totalQuantity:quantity,qty:quantity,buyCount:count,buys:count,
  capitalUsedUsd:invested,capitalUsed:invested,
  capitalReservedUsd:num(pick(raw,'capitalReservedUsd','capitalReserved')),
  avgEntryPrice:avg,avgPrice:avg,
  cycleAnchorPrice:num(pick(raw,'cycleAnchorPrice','cycleAnchor','anchorPrice','anchor')),
  basePrice:num(pick(raw,'basePrice','entryBase','baseEntry','base')),
  currentPrice:num(pick(raw,'currentPrice','lastPrice')),
  nextBuyPrice:num(pick(raw,'nextBuyPrice','nextEntry','nextBuy','nextDca')),
  tpTargetPrice:num(pick(raw,'tpTargetPrice','tpTarget','targetTp','tp')),
  tpTargetPct:num(pick(raw,'tpTargetPct')),
  unrealizedPnlUsd:num(pick(raw,'unrealizedPnlUsd','unrealizedPnl')),
  realizedPnlUsd:num(pick(raw,'realizedPnlUsd','netPnl','pnlNet')),
  realizedPnlPct:num(pick(raw,'realizedPnlPct','realizedPct')),
  unrealizedPnlPct:num(pick(raw,'unrealizedPnlPct','pnlPct')),
  closeReason:pick(raw,'closeReason','exitType','reason'),
  status:pick(raw,'status','state'),
  breakEven:pick(raw,'breakEven','be'),trailing:pick(raw,'trailing','trailingStop'),
  timeStop:pick(raw,'timeStop','timeStopRule')};
}
export function normOrder(raw){
 if(!raw||typeof raw!=='object')return null;
 const side=pick(raw,'side'),price=num(pick(raw,'price','avgPrice','fillPrice','avgFillPrice'));
 const quantity=num(pick(raw,'quantity','qty','volume','amount'));
 const gross=num(pick(raw,'grossValueUsd','valueUsd','value','notional','cost'));
 const net=num(pick(raw,'netValueUsd'));
 const fee=num(pick(raw,'feesUsd','feeUsd','fee','commission'));
 const slipUsd=num(pick(raw,'slippageUsd','slippage'));
 return {...raw,id:pick(raw,'id','orderId'),cycleId:pick(raw,'cycleId','cycle'),
   ts:pick(raw,'executedAt','ts','timestamp','createdAt'),
   side:typeof side==='string'?side.toUpperCase():null,
   type:pick(raw,'orderType','execType','kind','type'),
   price,quantity,qty:quantity,valueUsd:gross,grossValueUsd:gross,
   netValueUsd:net,feeUsd:fee,feesUsd:fee,
   slippageUsd:slipUsd,slippagePct:num(pick(raw,'slippagePct')),
   reason:pick(raw,'triggerReason','humanReason','reason','motivo','cause','trigger'),
   mode:pick(raw,'mode'),status:pick(raw,'executionStatus','status','result','outcome')};
}

export function normGridCycle(raw){
  if(!raw || typeof raw!=='object') return null;
  // Preservar todos los campos del API (fees, fills, cierres, rangos y estado)
  // para la ficha universal; los alias canónicos no deben destruir el detalle.
  return { ...raw,
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
  const sev=pick(raw,'level','severity','sev');
  const msg=pick(raw,'msg','naturalMessage','message','text','summary');
  return { ...raw,
    id: pick(raw,'id','eventId','event_id'),
    ts: pick(raw,'ts','timestamp','createdAt','created_at'),
    level: sev,
    severity: sev,
    engine: pick(raw,'engine','motor','source'),
    type: pick(raw,'eventType','event_name','type'),
    msg,
    message: msg,
    detail: pick(raw,'detail','details','payload','data'),
  };
}

// Envoltura con estado/frescura — jamás devuelve datos inventados.
export function wrap(raw, normalizer, meta={}){
  if(raw===undefined || raw===null) return { data:null, state:'unavailable', ts:null, source:meta.source||'api' };
  const d = Array.isArray(raw) ? raw.map(normalizer).filter(Boolean) : normalizer(raw);
  const ts = meta.ts || Date.now();
  return { data:d, state: meta.state || freshness(typeof ts==='number'? new Date(ts).toISOString(): ts), ts, source: meta.source||'api' };
}
