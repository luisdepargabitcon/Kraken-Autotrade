// NEXA V2 — CONTRATOS READ-MODEL (F3). Modelos de lectura canónicos por motor.
// Cada contrato lista los campos que la UI NUEVA debe poder representar.
// La prueba tests/parity.test.mjs verifica que los fixtures DEMO cubren todos
// los campos y que cada contrato tiene destino en pantallas Básico/Pro.
// Nada aquí ejecuta mutaciones: solo lectura.

export const ENGINES = [
  { id:'idca', name:'IDCA',        desc:'DCA institucional · ciclos, ladder, TP/BE/trailing', modes:['disabled','simulation','live'] },
  { id:'spot', name:'SPOT / Swing',desc:'Motor spot normal: estrategias, protecciones, posiciones', modes:['dry-run','live'] },
  { id:'grid', name:'Grid aislado',desc:'Grid propio: niveles, ciclos BUY→SELL 1:1, rangos', modes:['OFF','SHADOW','REAL_LIMITED','REAL_FULL'] },
  { id:'ama',  name:'AMA',         desc:'Acumulación macro adaptativa: mandatos, HWM, scheduler', modes:['OFF','LAB','REPLAY','SHADOW_SCENARIO','SHADOW_LIVE','REAL_LIMITED','REAL_FULL'] },
];

// Aviso estructural obligatorio (C040): tres "grid" distintos.
export const GRID_DISTINCTION =
  'Tres conceptos distintos NO intercambiables: (1) «grid» interno de la estrategia SPOT normal, '+
  '(2) overlay IDCA Hybrid/Grid y (3) Grid aislado con ciclos BUY→SELL propios.';

// Contrato de lectura por motor. required: campos que deben existir en el read-model.
export const CONTRACTS = {
  idca: {
    status: ['mode','running','globalTradingPause','lastTickAt','tickCount','lastError','assetPairs'],
    summary:['allocatedCapitalUsd','capitalUsedUsd','capitalFreeUsd','realizedPnlUsd','unrealizedPnlUsd',
      'totalPnlUsd','activeCyclesCount','buysToday','sellsToday','trailingActiveCount','smartModeEnabled',
      'strategyScore','winRate','profitFactor','expectancy'],
    pairContext:['pair','currentPrice','currency','priceTs','regime','atr','atrpPct','volatility','trend',
      'dipDetectedPct','requiredDipPct','reboundSignal','entryScore','entryThreshold','reference','marketScore'],
    cycle:['id','pair','mode','status','startedAt','buyCount','capitalUsedUsd','avgEntryPrice','currentPrice',
      'totalQuantity','nextBuyPrice','tpTargetPrice','tpTargetPct','tpBreakdown','cycleAnchorPrice',
      'cycleAnchorLabel','cycleAnchorSource','cycleAnchorAgeHours','basePrice','entryDipPct',
      'unrealizedPnlUsd','unrealizedPnlPct','realizedPnlUsd','estimatedFeeUsd','breakEven','trailing',
      'timeStop','soloSalida','marketScore','exchangeSource'],
    order:['id','cycleId','ts','side','type','price','quantity','valueUsd','feeUsd','slippagePct','reason','mode'],
    history:['id','pair','mode','startedAt','closedAt','buyCount','capitalUsedUsd','realizedPnlUsd',
      'realizedPnlPct','closeReason','exitType','orders'],
    config:['params','assetConfigs','effectiveVsStored'],
  },
  spot: {
    status:['mode','running','pairs','venue','dataExchange','strategy','configEffective','lastTickAt'],
    signal:['pair','score','setup','regime','indicators','reason','candleTs','entryState','vetoes'],
    position:['id','pair','quantity','avgPrice','currentPrice','costUsd','valueUsd','pnlUsd','pnlPct','exposurePct','protections'],
    protection:['type','enabled','armed','threshold','distancePct','state','scope'],
    trade:['id','ts','pair','side','price','quantity','feeUsd','slippagePct','reason','closeReason','mode'],
    config:['activeStrategy','availableStrategies','featureFlags','timeStops','riskParams'],
  },
  grid: {
    status:['mode','pair','makerOnly','postOnly','capitalBudgetUsd','capitalUsedUsd','activeCyclesCount','unlock'],
    levels:['rangeVersionId','center','spacing','levels','currentRange','previousRanges'],
    cycle:['id','rangeVersionId','rangeRelation','side','buyPrice','buyQty','buyFillTs','sellTargetPrice',
      'sellQty','sellFillTs','feeUsd','targetProfitUsd','pnlUsd','status'],
    monitor:['events','capitalLockedUsd','capitalReleasedUsd','alerts','orderStates','cancellations'],
    config:['policy','makerTaker','recommendations','capitalProfile'],
  },
  ama: {
    status:['mode','scheduler','killSwitch','lastTickAt','environment'],
    readiness:['checks','readyCount','totalCount','blockers'],
    mandate:['id','status','assets','scoring','macroContext','sources','explanation'],
    portfolio:['budgetUsd','reservedUsd','freeUsd','exposureUsd','hwm','limits'],
    trace:['cycles','tranches','ledger','orders','decisions','events'],
    lab:['sessions','replayRuns','shadowScenarios'],
  },
  market: {
    ticker:['pair','price','change24hPct','currency','ts','source','spread','bid','ask'],
    candles:['pair','timeframe','candles','lastCandleTs','source','finalized'],
    indicators:['rsi','macd','bollinger','ema','atr','adx','volume','momentum','regime','computedAt'],
    sources:['list'],
  },
  portfolio: {
    balances:['items'],
    summary:['navUsd','exposureUsd','realizedPnlUsd','unrealizedPnlUsd','byEngine','byAsset','holdUsd'],
    budgets:['items','reservations','locks','reconciliation'],
  },
  fisco: {
    restricted:['accessLevel','notice'],
    summary:['year','exchange','lotsCount','operationsCount','disposalsCount','reportsAvailable','syncStatus'],
  },
  activity: {
    events:['id','ts','severity','source','engine','type','message','detail'],
  },
  settings: {
    params:['key','group','stored','effective','default','scope','legacy','appliesTo','reason'],
    flags:['key','enabled','description'],
    exchanges:['venue','role','connected','lastOk','note'],
  },
};

// Reglas de presentación: qué secciones se muestran en Básico vs Pro.
// En Básico todo sigue accesible vía detalle expandible (C004).
export const ENGINE_SUBTABS = {
  idca: [{id:'panel',label:'Panel'},{id:'cycles',label:'Ciclos abiertos'},{id:'history',label:'Historial'},
    {id:'orders',label:'Órdenes'},{id:'hybrid',label:'Hybrid/Grid'},{id:'config',label:'Configuración'},{id:'alerts',label:'Alertas'}],
  spot: [{id:'panel',label:'Panel'},{id:'positions',label:'Posiciones'},{id:'history',label:'Historial'},
    {id:'protections',label:'Protecciones'},{id:'config',label:'Configuración'}],
  grid: [{id:'panel',label:'Panel'},{id:'cycles',label:'Ciclos'},{id:'levels',label:'Niveles/Rangos'},
    {id:'monitor',label:'Monitor'},{id:'config',label:'Configuración'}],
  ama: [{id:'panel',label:'Panel'},{id:'readiness',label:'Readiness'},{id:'mandate',label:'Mandato'},
    {id:'trace',label:'Trazabilidad'},{id:'lab',label:'Laboratorio'},{id:'config',label:'Configuración'}],
};

// Comprobación exportable para tests: ¿cubre el fixture todos los campos?
export function coverageReport(contractSection, sample){
  const missing=[];
  for(const key of contractSection){
    if(sample && Object.prototype.hasOwnProperty.call(sample,key)) continue;
    missing.push(key);
  }
  return { missing, covered: contractSection.length - missing.length, total: contractSection.length };
}
