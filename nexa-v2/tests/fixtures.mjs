// NEXA V2 — FIXTURES DEMO. Datos SINTÉTICOS etiquetados DEMO para desarrollo y QA local.
// NO son datos reales ni del VPS. Todos llevan provenance {source:'FIXTURE DEMO', ts}.

const NOW = Date.now();
const min = m => new Date(NOW - m*60000).toISOString();
const hour = h => min(h*60);
const day = d => hour(d*24);

function prov(source='FIXTURE DEMO', ts=null){
  return { source, ts: ts ?? min(4) };
}

// ---------- MERCADO ----------
function candlesFor(pair, base, drift, vol){
  const out=[]; let p=base;
  for(let i=96;i>=0;i--){
    const t = new Date(NOW - i*15*60000);
    const o=p; const c=o*(1+drift/96 + (Math.sin(i*0.7)+Math.sin(i*2.3)*0.6)*vol);
    const h=Math.max(o,c)*(1+vol*0.35), l=Math.min(o,c)*(1-vol*0.35);
    out.push({t:t.toISOString(), o,h,l,c, v: 12+Math.abs(Math.sin(i*1.7))*38});
    p=c;
  }
  return out;
}
export const DEMO_MARKET = {
  tickers: {
    'BTC/USD': { pair:'BTC/USD', price:97340.25, change24hPct:-1.82, currency:'USD', ts:min(2), source:'kraken · demo', spread:6.4, bid:97333.9, ask:97340.3 },
    'ETH/USD': { pair:'ETH/USD', price:3284.10, change24hPct:-3.05, currency:'USD', ts:min(2), source:'kraken · demo', spread:1.1, bid:3283.6, ask:3284.7 },
    'SOL/USD': { pair:'SOL/USD', price:214.66, change24hPct:0.74, currency:'USD', ts:min(7), source:'kraken · demo', spread:0.21, bid:214.55, ask:214.76 },
  },
  candles: { 'BTC/USD': candlesFor('BTC/USD',100200,-0.032,0.004), 'ETH/USD': candlesFor('ETH/USD',3410,-0.045,0.006), 'SOL/USD': candlesFor('SOL/USD',208,0.031,0.007) },
  indicators: {
    'BTC/USD': { rsi:38.4, macd:{macd:-412.6, signal:-355.1, histogram:-57.5}, bollinger:{mid:99840,upper:101260,lower:97390,pctB:0.02},
      ema:{ema20:99620,ema50:101480,ema200:104310}, atr:712.4, atrpPct:0.73, adx:31.8,
      volume:{last:41.2, avg24:36.8, ratio:1.12}, momentum:{pct4h:-1.9,pct24h:-1.8},
      regime:'downtrend · volatilidad alta', computedAt:min(3) },
    'ETH/USD': { rsi:34.1, macd:{macd:-18.2, signal:-14.9, histogram:-3.3}, bollinger:{mid:3412,upper:3560,lower:3270,pctB:0.06},
      ema:{ema20:3405,ema50:3522,ema200:3688}, atr:38.9, atrpPct:1.18, adx:34.2,
      volume:{last:52.7, avg24:41.1, ratio:1.28}, momentum:{pct4h:-2.4,pct24h:-3.1},
      regime:'downtrend · tendencia fuerte', computedAt:min(3) },
    'SOL/USD': { rsi:52.6, macd:{macd:1.9, signal:1.4, histogram:0.5}, bollinger:{mid:211.2,upper:222.4,lower:200.1,pctB:0.66},
      ema:{ema20:212.9,ema50:209.4,ema200:196.8}, atr:3.4, atrpPct:1.58, adx:22.4,
      volume:{last:61.3, avg24:55.9, ratio:1.10}, momentum:{pct4h:0.9,pct24h:0.7},
      regime:'rango · sesgo alcista', computedAt:min(3) },
  },
  externalSources: [
    { name:'Kraken OHLCV', state:'active', role:'mercado', lastOk:min(2), note:'fuente de velas/ticker' },
    { name:'Revolut X', state:'active', role:'ejecución', lastOk:min(6), note:'venue de trading' },
    { name:'CoinGlass OI/funding', state:'disabled', role:'derivados', lastOk:null, note:'sin licencia activa (demo: no disponible)' },
    { name:'DeFiLlama', state:'conditional', role:'macro', lastOk:hour(26), note:'fuente condicional AMA' },
    { name:'Coin Metrics', state:'conditional', role:'macro', lastOk:hour(30), note:'fuente condicional AMA' },
    { name:'Binance (offline research)', state:'offline', role:'research', lastOk:day(2), note:'dataset histórico · NO feed LIVE' },
    { name:'Whale Alert', state:'disabled', role:'on-chain', lastOk:null, note:'no configurada' },
  ],
};

// ---------- IDCA ----------
export const DEMO_IDCA = {
  status: { mode:'simulation', running:true, globalTradingPause:false,
    lastTickAt:min(1), tickCount:12488, lastError:null,
    assetPairs:[ {pair:'BTC/USD', enabled:true, mode:'simulation'}, {pair:'ETH/USD', enabled:true, mode:'simulation'} ] },
  summary: { allocatedCapitalUsd:4000, capitalUsedUsd:2380.44, capitalFreeUsd:1619.56,
    realizedPnlUsd:184.22, unrealizedPnlUsd:-96.35, totalPnlUsd:87.87,
    activeCyclesCount:2, buysToday:1, sellsToday:0, trailingActiveCount:1, smartModeEnabled:true,
    strategyScore:0.62, winRate:0.58, profitFactor:1.34, expectancy:12.4 },
  pairContexts: {
    'BTC/USD': { pair:'BTC/USD', currentPrice:97340.25, currency:'USD', priceTs:min(2),
      regime:'downtrend', atr:712.4, atrpPct:0.73, volatility:'alta', trend:'bajista',
      dipDetectedPct:-2.9, requiredDipPct:-4.0, reboundSignal:'vigilar rebote — sin confirmación',
      entryScore:0.62, entryThreshold:0.70, reference:'ancla viva EMA20 1h',
      marketScore:0.41,
      scoreBreakdown:{ V:0.55, C:0.70, R:0.62, D:0.48, M:0.66 } },
    'ETH/USD': { pair:'ETH/USD', currentPrice:3284.10, currency:'USD', priceTs:min(2),
      regime:'downtrend', atr:38.9, atrpPct:1.18, volatility:'alta', trend:'bajista',
      dipDetectedPct:-3.4, requiredDipPct:-4.0, reboundSignal:'esperando cruce de referencia',
      entryScore:0.58, entryThreshold:0.70, reference:'ancla híbrida VWAP 24h',
      marketScore:0.38,
      scoreBreakdown:{ V:0.61, C:0.55, R:0.59, D:0.44, M:0.71 } },
  },
  cycles: [
    { id:'cyc_btc_114', pair:'BTC/USD', mode:'simulation', status:'open', startedAt:hour(52),
      buyCount:3, capitalUsedUsd:1240.20, avgEntryPrice:100412.50, currentPrice:97340.25,
      totalQuantity:0.012351, nextBuyPrice:94880.00, tpTargetPrice:103926.00, tpTargetPct:3.5,
      tpBreakdown:{ base:'avgEntry', buys:3, volatilityAdj:0.4, reboundAdj:-0.1, intervalMinPct:2.5, finalPct:3.5 },
      cycleAnchorPrice:101880.00, cycleAnchorLabel:'Ancla de ciclo · VWAP anclado', cycleAnchorSource:'vwap_anchor', cycleAnchorAgeHours:51.7,
      basePrice:100412.50, entryDipPct:-4.2, unrealizedPnlUsd:-37.92, unrealizedPnlPct:-3.06,
      realizedPnlUsd:0, estimatedFeeUsd:1.12, estimatedFeePct:0.09,
      breakEven:{ enabled:true, armPct:1.2, distancePct:-4.26, armed:false },
      trailing:{ enabled:true, pct:1.1, armed:false, progressPct:0, distancePct:-4.16 },
      timeStop:{ rule:'max 21 días', startedAt:hour(52), endsAt:day(21), remaining:'19d 4h', protectionOnly:false },
      soloSalida:false, marketScore:0.41, exchangeSource:'kraken demo', skippedSafetyLevels:0, isImported:false, isManualCycle:false },
    { id:'cyc_eth_87', pair:'ETH/USD', mode:'simulation', status:'open', startedAt:hour(31),
      buyCount:2, capitalUsedUsd:1140.24, avgEntryPrice:3444.40, currentPrice:3284.10,
      totalQuantity:0.3310, nextBuyPrice:3210.00, tpTargetPrice:3565.00, tpTargetPct:3.5,
      tpBreakdown:{ base:'avgEntry', buys:2, volatilityAdj:0.5, reboundAdj:0.0, intervalMinPct:2.5, finalPct:3.5 },
      cycleAnchorPrice:3498.00, cycleAnchorLabel:'Ancla viva · referencia dinámica', cycleAnchorSource:'dynamic_hybrid', cycleAnchorAgeHours:30.9,
      basePrice:3444.40, entryDipPct:-4.0, unrealizedPnlUsd:-58.43, unrealizedPnlPct:-5.13,
      realizedPnlUsd:0, estimatedFeeUsd:1.03, estimatedFeePct:0.09,
      breakEven:{ enabled:true, armPct:1.2, distancePct:-6.33, armed:false },
      trailing:{ enabled:true, pct:1.1, armed:false, progressPct:0, distancePct:-6.23 },
      timeStop:{ rule:'max 21 días', startedAt:hour(31), endsAt:day(21), remaining:'19d 17h', protectionOnly:false },
      soloSalida:false, marketScore:0.38, exchangeSource:'kraken demo', skippedSafetyLevels:0, isImported:false, isManualCycle:false },
  ],
  orders: [
    { id:'ord_9012', cycleId:'cyc_btc_114', ts:hour(52), side:'BUY', type:'entry', price:102310.00, quantity:0.004891, valueUsd:500.40, feeUsd:0.45, slippagePct:0.05, reason:'entrada base · dip -4.2% · score 0.71 ≥ 0.70', mode:'simulation' },
    { id:'ord_9034', cycleId:'cyc_btc_114', ts:hour(30), side:'BUY', type:'safety', price:99720.00, quantity:0.003759, valueUsd:374.90, feeUsd:0.34, slippagePct:0.05, reason:'compra seguridad L2 · ladder ATRP', mode:'simulation' },
    { id:'ord_9055', cycleId:'cyc_btc_114', ts:hour(9), side:'BUY', type:'safety', price:99410.00, quantity:0.003701, valueUsd:367.90, feeUsd:0.33, slippagePct:0.04, reason:'compra seguridad L3 · ladder ATRP', mode:'simulation' },
    { id:'ord_9101', cycleId:'cyc_eth_87', ts:hour(31), side:'BUY', type:'entry', price:3512.30, quantity:0.1708, valueUsd:599.70, feeUsd:0.54, slippagePct:0.05, reason:'entrada base · dip -4.0% · score 0.70', mode:'simulation' },
    { id:'ord_9118', cycleId:'cyc_eth_87', ts:hour(12), side:'BUY', type:'safety', price:3380.50, quantity:0.1602, valueUsd:540.55, feeUsd:0.49, slippagePct:0.05, reason:'compra seguridad L2 · distancia dinámica', mode:'simulation' },
    { id:'ord_8970', cycleId:'cyc_btc_98', ts:day(9), side:'BUY', type:'entry', price:94820.00, quantity:0.006331, valueUsd:600.10, feeUsd:0.54, slippagePct:0.05, reason:'entrada base', mode:'simulation' },
    { id:'ord_8991', cycleId:'cyc_btc_98', ts:day(6), side:'SELL', type:'tp', price:98200.00, quantity:0.006331, valueUsd:621.63, feeUsd:0.56, slippagePct:0.04, reason:'TP dinámico alcanzado +3.5%', mode:'simulation' },
  ],
  history: [
    { id:'cyc_btc_98', pair:'BTC/USD', mode:'simulation', startedAt:day(9), closedAt:day(6),
      buyCount:1, capitalUsedUsd:600.10, realizedPnlUsd:20.43, realizedPnlPct:3.40,
      closeReason:'take_profit', exitType:'tp', orders:['ord_8970','ord_8991'] },
    { id:'cyc_eth_66', pair:'ETH/USD', mode:'simulation', startedAt:day(14), closedAt:day(11),
      buyCount:4, capitalUsedUsd:1500.00, realizedPnlUsd:-21.36, realizedPnlPct:-1.42,
      closeReason:'time_stop', exitType:'time-stop', orders:['ord_8802','ord_8821','ord_8839','ord_8871','ord_8890'] },
    { id:'cyc_btc_77', pair:'BTC/USD', mode:'simulation', startedAt:day(20), closedAt:day(17),
      buyCount:2, capitalUsedUsd:980.00, realizedPnlUsd:33.15, realizedPnlPct:3.38,
      closeReason:'take_profit', exitType:'tp', orders:['ord_8601','ord_8618','ord_8644'] },
  ],
  hybrid: { enabled:true, mode:'dynamic_hybrid', gridLegs:2, regimeByPair:{'BTC/USD':'downtrend','ETH/USD':'downtrend'},
    note:'Overlay interno IDCA — distinto del Grid aislado (ver aviso).' },
  alerts: { telegramEnabled:true, simulationTelegramEnabled:true, trailingBuyAlerts:true,
    channels:['telegram #bot-alerts'], intervalMin:30 },
  configParams: [
    { key:'allocatedCapitalUsd', group:'Dinero y límites', stored:4000, effective:4000, def:2000, scope:'engine', legacy:false, appliesTo:'entry sizing', reason:'' },
    { key:'maxModuleExposurePct', group:'Dinero y límites', stored:40, effective:40, def:50, scope:'engine', legacy:false, appliesTo:'exposición máxima módulo', reason:'' },
    { key:'entryDipPct', group:'Cuándo comprar', stored:-4.0, effective:-4.0, def:-3.0, scope:'pair', legacy:false, appliesTo:'umbral dip entrada', reason:'' },
    { key:'entryScoreThreshold', group:'Cuándo comprar', stored:0.70, effective:0.70, def:0.60, scope:'engine', legacy:false, appliesTo:'score mínimo', reason:'' },
    { key:'tpTargetPct', group:'Cuándo vender', stored:3.5, effective:3.5, def:3.0, scope:'engine', legacy:false, appliesTo:'TP dinámico', reason:'' },
    { key:'trailingPct', group:'Cuándo vender', stored:1.1, effective:1.1, def:1.0, scope:'engine', legacy:false, appliesTo:'trailing stop', reason:'' },
    { key:'breakEvenArmPct', group:'Cuándo vender', stored:1.2, effective:1.2, def:1.0, scope:'engine', legacy:false, appliesTo:'armado BE', reason:'' },
    { key:'safetyOrdersJson', group:'Compras extra', stored:'legacy-array', effective:'IGNORADO', def:'', scope:'pair', legacy:true, appliesTo:'nada (ladder ATRP activo)', reason:'Ladder ATRP activo — ver hallazgo A-7' },
    { key:'ladderAtrpEnabled', group:'Compras extra', stored:true, effective:true, def:false, scope:'pair', legacy:false, appliesTo:'escalera ATRP', reason:'' },
    { key:'recoveryConfigJson', group:'Recovery', stored:'{enabled:true}', effective:'{enabled:true}', def:'{}', scope:'engine', legacy:false, appliesTo:'ciclo recuperación', reason:'' },
    { key:'vwapAnchorEnabled', group:'VWAP & Rebound', stored:true, effective:true, def:false, scope:'pair', legacy:false, appliesTo:'ancla VWAP', reason:'' },
    { key:'dynamicDistanceEnabled', group:'Distancia dinámica', stored:true, effective:true, def:false, scope:'pair', legacy:false, appliesTo:'distancia entre compras', reason:'' },
    { key:'smartModeEnabled', group:'Smart Mode', stored:true, effective:true, def:false, scope:'engine', legacy:false, appliesTo:'modo confluencia', reason:'' },
    { key:'volatilityTrailingEnabled', group:'Smart Mode', stored:true, effective:false, def:false, scope:'engine', legacy:false, appliesTo:'—', reason:'deshabilitado por gate de régimen' },
  ],
};

// ---------- SPOT ----------
export const DEMO_SPOT = {
  status: { mode:'dry-run', running:true, pairs:['BTC/USD','ETH/USD','SOL/USD','XRP/USD'],
    venue:'revolutx (ejecución) · kraken (datos)', dataExchange:'kraken', strategy:'momentum',
    configEffective:{ dryRunMode:true, resolvedFrom:'bot_config.dryRunMode', conflict:'global.dryRunMode también existe — ver hallazgo' },
    lastTickAt:min(1) },
  signals: [
    { pair:'BTC/USD', score:0.44, setup:'momentum breakout', regime:'downtrend',
      indicators:{ rsi:38.4, macdHist:-57.5, adx:31.8, atr:712.4, bbPctB:0.02, volRatio:1.12 },
      reason:'rechazado · régimen bajista (veto)', candleTs:min(15), entryState:'blocked', vetoes:['regime:downtrend','score<0.6'] },
    { pair:'SOL/USD', score:0.67, setup:'momentum continuation', regime:'rango alcista',
      indicators:{ rsi:52.6, macdHist:0.5, adx:22.4, atr:3.4, bbPctB:0.66, volRatio:1.10 },
      reason:'candidata · esperando cierre de vela 15m', candleTs:min(15), entryState:'watch', vetoes:[] },
  ],
  positions: [
    { id:'pos_221', pair:'SOL/USD', quantity:1.205, avgPrice:206.10, currentPrice:214.66,
      costUsd:248.36, valueUsd:258.67, pnlUsd:9.19, pnlPct:3.70, exposurePct:2.6,
      protections:['stop','take_profit','trailing','time_stop'] },
    { id:'pos_198', pair:'XRP/USD', quantity:420.5, avgPrice:2.31, currentPrice:2.18,
      costUsd:971.36, valueUsd:916.69, pnlUsd:-55.78, pnlPct:-5.74, exposurePct:9.1,
      protections:['stop','break_even','time_stop'] },
  ],
  protections: [
    { type:'stop_loss', enabled:true, armed:true, threshold:-4.0, distancePct:-5.7, state:'armed', scope:'pos_198' },
    { type:'take_profit', enabled:true, armed:false, threshold:6.0, distancePct:2.3, state:'watching', scope:'pos_221' },
    { type:'break_even', enabled:true, armed:false, threshold:1.5, distancePct:-7.2, state:'pending', scope:'pos_198' },
    { type:'trailing', enabled:true, armed:true, threshold:1.8, distancePct:1.9, state:'armed', scope:'pos_221' },
    { type:'time_stop', enabled:true, armed:true, threshold:72, distancePct:null, state:'armed', scope:'global' },
    { type:'smart_guard', enabled:true, armed:true, threshold:null, distancePct:null, state:'active', scope:'engine' },
  ],
  trades: [
    { id:'tr_3312', ts:day(2), pair:'SOL/USD', side:'BUY', price:206.10, quantity:1.205, feeUsd:0.22, slippagePct:0.05, reason:'momentum continuation · score 0.71', closeReason:null, mode:'dry-run' },
    { id:'tr_3288', ts:day(5), pair:'XRP/USD', side:'BUY', price:2.31, quantity:420.5, feeUsd:0.87, slippagePct:0.06, reason:'mean_reversion · oversold', closeReason:null, mode:'dry-run' },
    { id:'tr_3201', ts:day(8), pair:'ETH/USD', side:'SELL', price:3410.00, quantity:0.15, feeUsd:0.46, slippagePct:0.05, reason:'salida', closeReason:'trailing_stop', mode:'dry-run' },
    { id:'tr_3150', ts:day(12), pair:'BTC/USD', side:'SELL', price:99520.00, quantity:0.004, feeUsd:0.36, slippagePct:0.05, reason:'salida', closeReason:'take_profit', mode:'dry-run' },
  ],
  config: { activeStrategy:'momentum',
    availableStrategies:['momentum','mean_reversion','scalping','grid (interno SPOT)'],
    featureFlags:[ {key:'SMART_GUARD',enabled:true},{key:'DRY_RUN',enabled:true},{key:'GRID_INTERNAL',enabled:false} ],
    timeStops:[ {pair:'*',hours:72,active:true},{pair:'XRP/USD',hours:48,active:false} ],
    riskParams:{ riskPerTradePct:5.0, maxExposurePct:25, spreadMaxPct:0.35 } },
};

// ---------- GRID AISLADO ----------
export const DEMO_GRID = {
  status: { mode:'SHADOW', pair:'BTC/USD', makerOnly:true, postOnly:true,
    capitalBudgetUsd:2000, capitalUsedUsd:980.40, activeCyclesCount:3,
    unlock:{ realLimited:false, realFull:false, checksPass:['shadow_consistency','maker_only','no_live_keys'], checksFail:['real_authorized'] } },
  levels: { rangeVersionId:'rv_2026_w47', center:99600, spacing:'geométrico 0.9%',
    levels:[ {price:98700,side:'BUY',state:'planned'},{price:97800,side:'BUY',state:'filled'},{price:96900,side:'BUY',state:'filled'},{price:96000,side:'BUY',state:'planned'},
      {price:100500,side:'SELL',state:'target'},{price:101400,side:'SELL',state:'target'},{price:102300,side:'SELL',state:'planned'} ],
    currentRange:{ id:'rv_2026_w47', low:96000, high:102300, openedAt:day(3) },
    previousRanges:[ {id:'rv_2026_w44', low:91200, high:98500, openedAt:day(17), closedAt:day(4), openSellTargets:2} ] },
  cycles: [
    { id:'gc_311', rangeVersionId:'rv_2026_w47', rangeRelation:'current_range', side:'cycle',
      buyPrice:97800, buyQty:0.005102, buyFillTs:hour(28), sellTargetPrice:98700, sellQty:0.005102,
      sellFillTs:null, feeUsd:0.09, targetProfitUsd:4.50, pnlUsd:null, status:'open_buy_filled' },
    { id:'gc_310', rangeVersionId:'rv_2026_w47', rangeRelation:'current_range', side:'cycle',
      buyPrice:96900, buyQty:0.005160, buyFillTs:hour(10), sellTargetPrice:97800, sellQty:0.005160,
      sellFillTs:null, feeUsd:0.09, targetProfitUsd:4.55, pnlUsd:null, status:'open_buy_filled' },
    { id:'gc_298', rangeVersionId:'rv_2026_w44', rangeRelation:'previous_range', side:'cycle',
      buyPrice:95200, buyQty:0.005250, buyFillTs:day(8), sellTargetPrice:96100, sellQty:0.005250,
      sellFillTs:null, feeUsd:0.09, targetProfitUsd:4.64, pnlUsd:null, status:'open_legacy_sell_pending' },
    { id:'gc_297', rangeVersionId:'rv_2026_w44', rangeRelation:'previous_range', side:'cycle',
      buyPrice:94400, buyQty:0.005296, buyFillTs:day(9), sellTargetPrice:95300, sellQty:0.005296,
      sellFillTs:null, feeUsd:0.09, targetProfitUsd:4.68, pnlUsd:null, status:'open_legacy_sell_pending' },
    { id:'gc_250', rangeVersionId:'rv_2026_w47', rangeRelation:'current_range', side:'cycle',
      buyPrice:97200, buyQty:0.005144, buyFillTs:day(2), sellTargetPrice:98100, sellQty:0.005144,
      sellFillTs:hour(40), feeUsd:0.18, targetProfitUsd:4.45, pnlUsd:4.27, status:'closed' },
  ],
  monitor: {
    capitalLockedUsd:980.40, capitalReleasedUsd:124.10,
    alerts:[ {ts:hour(9),sev:'warn',msg:'spread>0.35% — maker gate esperando',} ],
    orderStates:[ {id:'go_11',side:'BUY',price:98700,state:'planned'},{id:'go_12',side:'SELL',price:98700,state:'target'} ],
    cancellations:[ {ts:hour(30), orderId:'go_09', reason:'rebuild planned levels (range refresh)' } ],
    events:[ {ts:min(12),sev:'info',msg:'tick SHADOW · 3 ciclos abiertos · maker_only'},{ts:hour(2),sev:'ok',msg:'fill BUY 96900 · 0.00516 BTC (simulado)'} ],
  },
  config: { policy:'maker_only con targets 1:1 (documentada: simétrica/adyacente sin cambios)',
    makerTaker:'MAKER_ONLY', recommendations:[ {id:'rec_4',kind:'range',note:'ensanchar rango si ADX>35',state:'pending'} ],
    capitalProfile:'balanced' },
};

// ---------- AMA ----------
const AMA_CHECKS = [
  ['schema','Esquema DB',true],['database','Base de datos',true],['market','Frescura mercado <5min',true],
  ['hwm','HWM bootstrap',true],['mandate','Mandato activo',true],['policy','Política activa',true],
  ['budget','Presupuesto asignado',true],['capital','Capital libre',true],['reconciliation','Reconciliación',true],
  ['gateway','Gateway bid/ask',false],['scheduler','Scheduler',true],['shadowScenario','Shadow scenario',true],
  ['shadowLive','Shadow live',false],['realGate','Gate REAL',false],['featureFlag','Flag REAL off',false],
  ['killSwitch','Kill switch operativo',true],['realFullLocked','REAL_FULL bloqueado',true],
];
export const DEMO_AMA = {
  status: { mode:'SHADOW_LIVE', environment:'OFF',
    scheduler:{ running:true, lastTickAt:min(1), tickCount:8421, errorCount:2, lastError:'provider timeout (hace 3d)' },
    killSwitch:{ armed:false, lastAction:null }, lastTickAt:min(1) },
  readiness: { checks: AMA_CHECKS.map(([id,label,ok])=>({id,label,ok})),
    readyCount: AMA_CHECKS.filter(c=>c[2]).length, totalCount: AMA_CHECKS.length,
    blockers:['gateway sin bid/ask válido (demo)','shadow_live incompleto','REAL_GATE cerrado','feature flag off'] },
  mandate: { id:'mand_2026_11', status:'active',
    assets:[ {asset:'BTC',weightPct:60},{asset:'ETH',weightPct:40} ],
    scoring:{ macroScore:0.31, riskBand:'cautela', threshold:0.55 },
    macroContext:{ regime:'risk-off', etfFlows:'salidas', trend:'bajista' },
    sources:[ {name:'macro composite',kind:'real'},{name:'taxonomía regime',kind:'conditional'},{name:'L2 depth',kind:'placeholder'} ],
    explanation:'No compra: score macro 0.31 < umbral 0.55; mandato permite solo SHADOW.' },
  portfolio: { budgetUsd:3000, reservedUsd:0, freeUsd:3000, exposureUsd:0,
    hwm:{ value:10420.55, bootstrapStatus:'ready', dataCoveragePct:96 },
    limits:{ maxExposurePct:30, maxDrawdownPct:15 } },
  trace: {
    cycles:[ {id:'ac_41',asset:'BTC',state:'shadow',openedAt:day(4),tranches:3,notionalUsd:600} ],
    tranches:[ {id:'tr_1',cycleId:'ac_41',idx:1,plannedUsd:200,executedUsd:200,state:'reserved'},
      {id:'tr_2',cycleId:'ac_41',idx:2,plannedUsd:200,executedUsd:200,state:'submitted'},
      {id:'tr_3',cycleId:'ac_41',idx:3,plannedUsd:200,executedUsd:200,state:'filled'} ],
    ledger:[ {ts:day(4),entry:'reserva 200 USD · tranche 1'},{ts:day(3),entry:'submit 200 USD · tranche 2'},{ts:day(3),entry:'fill 200 USD · tranche 3'} ],
    orders:[ {id:'ao_77',cycleId:'ac_41',state:'filled',executed:true,orderId:'sim-ord-77',venue:'shadow'},
      {id:'ao_78',cycleId:'ac_41',state:'reserved',executed:false,orderId:null,venue:'shadow — reserva sin envío'} ],
    decisions:[ {ts:min(20),text:'skip: macroScore<threshold'},{ts:hour(6),text:'shadow fill tranche 3 (simulado)'} ],
    events:[ {id:'ae_1',ts:min(20),severity:'info',type:'decision',message:'skip compra · score insuficiente'} ],
  },
  lab: { sessions:[ {id:'lab_9',startedAt:day(2),kind:'prueba rápida',result:'fills>0'} ],
    replayRuns:[ {id:'rp_3',range:'2026-08-01→2026-11-18',candles:3384,hash:'demo-hash',coveragePct:96} ],
    shadowScenarios:[ {id:'sh_2',state:'open',orders:4,fills:2,simulatedUsd:400} ] },
};

// ---------- CARTERA ----------
export const DEMO_PORTFOLIO = {
  balances: [
    { engine:'idca', asset:'USD', exchange:'revolutx', total:1619.56, used:0, reserved:0, free:1619.56 },
    { engine:'idca', asset:'BTC', exchange:'revolutx', total:0.012351, used:0.012351, reserved:0, free:0 },
    { engine:'idca', asset:'ETH', exchange:'revolutx', total:0.3310, used:0.3310, reserved:0, free:0 },
    { engine:'spot', asset:'USD', exchange:'revolutx', total:830.95, used:0, reserved:0, free:830.95 },
    { engine:'spot', asset:'SOL', exchange:'revolutx', total:1.205, used:1.205, reserved:0, free:0 },
    { engine:'spot', asset:'XRP', exchange:'revolutx', total:420.5, used:420.5, reserved:0, free:0 },
    { engine:'grid', asset:'USD', exchange:'revolutx', total:1019.60, used:0, reserved:980.40, free:39.20 },
    { engine:'grid', asset:'BTC', exchange:'revolutx', total:0.015558, used:0.015558, reserved:0, free:0 },
    { engine:'ama', asset:'USD', exchange:'revolutx', total:3000, used:0, reserved:0, free:3000 },
    { engine:'hold', asset:'BTC', exchange:'kraken', total:0.02, used:0, reserved:0, free:0.02, hold:true },
  ],
  summary: { navUsd:10042.18, exposureUsd:3471.23, realizedPnlUsd:184.22, unrealizedPnlUsd:-142.90,
    byEngine:[ {engine:'idca',pnlUsd:87.87,exposureUsd:2380.44},{engine:'spot',pnlUsd:-46.59,exposureUsd:1175.36},
      {engine:'grid',pnlUsd:4.27,exposureUsd:980.40},{engine:'ama',pnlUsd:0,exposureUsd:0} ],
    byAsset:[ {asset:'BTC',valueUsd:4128.30,pnlUsd:-12.40},{asset:'ETH',valueUsd:1086.64,pnlUsd:-58.43},
      {asset:'SOL',valueUsd:258.67,pnlUsd:9.19},{asset:'XRP',valueUsd:916.69,pnlUsd:-55.78},
      {asset:'USD',valueUsd:6470.11,pnlUsd:0} ],
    holdUsd:1946.81 },
  budgets: {
    items:[ {mode:'idca',exchange:'revolutx',asset:'USD',budgetUsd:4000,usedUsd:2380.44,status:'active'},
      {mode:'spot',exchange:'revolutx',asset:'USD',budgetUsd:2000,usedUsd:1175.36,status:'active'},
      {mode:'grid',exchange:'revolutx',asset:'USD',budgetUsd:2000,usedUsd:980.40,status:'active'},
      {mode:'ama',exchange:'revolutx',asset:'USD',budgetUsd:3000,usedUsd:0,status:'active'} ],
    reservations:[ {id:'res_1',mode:'grid',asset:'USD',amountUsd:980.40,state:'locked',createdAt:day(3)} ],
    locks:[ {key:'lock_grid_rv47',holder:'gridIsolatedEngine',state:'held',since:day(3)} ],
    reconciliation:{ status:'ok', lastRun:hour(8), pending:0 } },
};

// ---------- FISCO (restringido, agregado sin datos personales) ----------
export const DEMO_FISCO = {
  accessLevel:'restricted-read',
  notice:'Sección FISCO/AEAT restringida. La vista V2 muestra solo agregados; los datos personales, lotes e informes no se publican en el repositorio y requieren la app operativa con sus permisos.',
  summary: { year:2026, exchange:'all', lotsCount:41, operationsCount:132, disposalsCount:18,
    reportsAvailable:['anual html','lotes.csv','disposals.csv','statement-items.csv'], syncStatus:'ok · hace 2h' },
};

// ---------- ACTIVIDAD ----------
export const DEMO_ACTIVITY = [
  { id:'e_991', ts:min(2),  severity:'info', source:'engine', engine:'idca', type:'tick', message:'IDCA tick · 2 ciclos abiertos · score BTC 0.62/ETH 0.58', detail:'' },
  { id:'e_990', ts:min(12), severity:'info', source:'engine', engine:'grid', type:'tick', message:'Grid SHADOW tick · maker_only · 3 ciclos', detail:'' },
  { id:'e_989', ts:min(20), severity:'info', source:'engine', engine:'ama', type:'decision', message:'AMA skip compra · macroScore 0.31 < 0.55', detail:'' },
  { id:'e_988', ts:hour(2), severity:'ok', source:'engine', engine:'grid', type:'fill', message:'Fill BUY 96900 · 0.00516 BTC (simulado)', detail:'ciclo gc_310' },
  { id:'e_987', ts:hour(9), severity:'warn', source:'gate', engine:'grid', type:'gate', message:'Spread >0.35% · maker gate esperando', detail:'bid/ask demo' },
  { id:'e_986', ts:hour(31), severity:'ok', source:'engine', engine:'idca', type:'order', message:'IDCA compra seguridad ETH L2 · 0.1602 ETH (sim)', detail:'ord_9118' },
  { id:'e_985', ts:hour(30), severity:'warn', source:'system', engine:'grid', type:'cancel', message:'Cancelada orden go_09 · rebuild niveles', detail:'' },
  { id:'e_984', ts:day(1), severity:'err', source:'provider', engine:'ama', type:'provider', message:'Timeout fuente macro (reintentado)', detail:'3d atrás' },
];

// ---------- AJUSTES ----------
export const DEMO_SETTINGS = {
  params: [
    { key:'dryRunMode', group:'Motor SPOT', stored:true, effective:true, def:false, scope:'global', legacy:false, appliesTo:'SPOT ejecución', reason:'dual source global/bot_config — ver hallazgo P0-2' },
    { key:'riskPerTradePct', group:'Motor SPOT', stored:5.0, effective:5.0, def:1.0, scope:'global', legacy:false, appliesTo:'sizing SPOT', reason:'' },
    { key:'spotStrategy', group:'Motor SPOT', stored:'momentum', effective:'momentum', def:'momentum', scope:'global', legacy:false, appliesTo:'router estrategias', reason:'' },
    { key:'smartGuard', group:'Motor SPOT', stored:true, effective:true, def:false, scope:'global', legacy:false, appliesTo:'salidas SG', reason:'' },
    { key:'idca.enabled', group:'IDCA', stored:true, effective:true, def:false, scope:'engine', legacy:false, appliesTo:'scheduler IDCA', reason:'' },
    { key:'idca.mode', group:'IDCA', stored:'simulation', effective:'simulation', def:'disabled', scope:'engine', legacy:false, appliesTo:'modo IDCA', reason:'' },
    { key:'grid.mode', group:'Grid aislado', stored:'SHADOW', effective:'SHADOW', def:'OFF', scope:'engine', legacy:false, appliesTo:'modo Grid', reason:'' },
    { key:'ama.mode', group:'AMA', stored:'SHADOW_LIVE', effective:'SHADOW_LIVE', def:'OFF', scope:'engine', legacy:false, appliesTo:'modo AMA', reason:'' },
    { key:'tradingExchange', group:'Venue', stored:'revolutx', effective:'revolutx', def:'kraken', scope:'global', legacy:false, appliesTo:'venue órdenes', reason:'' },
    { key:'dataExchange', group:'Venue', stored:'kraken', effective:'kraken', def:'kraken', scope:'global', legacy:false, appliesTo:'venue datos', reason:'ExchangeFactory fija kraken — ver hallazgo P0-4' },
    { key:'timestop.hours', group:'Protecciones', stored:72, effective:72, def:48, scope:'global', legacy:false, appliesTo:'time stop', reason:'' },
    { key:'sgAllowUnderMin', group:'Protecciones', stored:false, effective:'ambiguo', def:false, scope:'global', legacy:true, appliesTo:'rama condicional (ver A-17)', reason:'comentarios deprecated pero aún en rama de validación' },
  ],
  flags: [
    { key:'SMART_GUARD', enabled:true, description:'salidas protección SPOT' },
    { key:'IDCA_SCHEDULER', enabled:true, description:'scheduler IDCA' },
    { key:'GRID_SHADOW', enabled:true, description:'grid SHADOW maker-only' },
    { key:'AMA_REAL_EXECUTION', enabled:false, description:'REAL AMA — cerrado por política' },
    { key:'AUTOAPPLY_AUTOTUNING', enabled:false, description:'autoapply deshabilitado por defecto' },
    { key:'LOG_SENSITIVE', enabled:true, description:'logs /api completos — riesgo P0-5' },
  ],
  exchanges: [
    { venue:'Kraken', role:'datos (velas/ticker)', connected:true, lastOk:min(2), note:'dataExchange' },
    { venue:'Revolut X', role:'ejecución', connected:true, lastOk:min(6), note:'tradingExchange · taker 0.09% demo' },
    { venue:'Telegram', role:'alertas', connected:true, lastOk:min(15), note:'bot conectado' },
  ],
};

export const DEMO_META = {
  tag:'DEMO',
  note:'Todos los valores de esta vista son SINTÉTICOS (fixtures) para QA local. No provienen del bot real.',
  observedAt: new Date(NOW).toISOString(),
};
