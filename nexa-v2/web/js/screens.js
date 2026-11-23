// NEXA V2 — pantallas. Básico = composición minimalista con detalle accesible;
// Pro = composición exhaustiva. Misma información, distinta presentación (C004/C060).
import {
  fmtUsd, signedUsd, signedPct, fmtPct, fmtQty, fmtNum, fmtTs, fmtAge, duration,
  NA, esc, isNum, provenance,
} from './util.js';
import {
  card, badge, modeBadge, kv, row, provLine, freshChip, table, expandable,
  microBar, signed, stateBanner, lineChart, candleChart, miniSpark,
} from './ui.js';
import { GRID_DISTINCTION } from './contracts.js';
import { BUILD_INFO } from './build-info.js';
import { renderHomePremium, renderMarketPremium, renderEnginePremium, renderPortfolioPremium, renderActivityPremium, renderFiscoPremium, renderSettingsPremium } from './premium.js';

const P = (v, src, ts) => provenance(v, {source:src, ts});

// No presentar una montaña de "No disponible" cuando la sesión/API no está preparada.
// El contenido completo permanece disponible cuando hay datos auténticos.
function connectionEmpty(title, detail, {icon='↗', action='Configurar conexión'}={}){
  return `<section class="connection-empty" role="status" aria-live="polite">
    <span class="empty-icon" aria-hidden="true">${esc(icon)}</span>
    <h2>${esc(title)}</h2><p>${esc(detail)}</p>
    <button class="btn primary" data-app="settings-api">${esc(action)}</button>
    <small class="tiny">No se muestran valores ficticios ni se confunde una sesión pendiente con un motor detenido.</small>
  </section>`;
}



// ==================== INICIO ====================
function renderHomeLegacy(ctx){
  const { mode, data } = ctx;
  const port = data.portfolio?.data ?? {};
  const sum = port.summary ?? {};
  const engines = ctx.enginesData ?? {};
  if(data.portfolio?.state!=='ok' && sum.navUsd==null && sum.exposureUsd==null){
    return connectionEmpty('Tu centro de control está preparado',
      'Vincula NEXA al servidor seguro del bot para consultar patrimonio, PnL, motores y actividad. No hay datos reales disponibles todavía.',
      {icon:'◈',action:'Configurar servidor'});
  }
  const navSeries = (ctx.market?.data?.candles?.['BTC/USD']||[]).slice(-40).map(c=>({v:c.c}));
  const engineCards = ctx.engineList.map(e=>{
    const d = engines[e.id]?.data ?? {};
    const st = d.status ?? {};
    const pnl = (sum.byEngine||[]).find(x=>x.engine===e.id)?.pnlUsd;
    const chip = mode==='basic' ? '' : `<span class="tiny">${esc(e.desc)}</span>`;
    return `<button class="card pick-btn" data-nav="engine:${e.id}" style="text-align:left;cursor:pointer">
      <div class="row" style="border:0"><b>${esc(e.name)}</b>${modeBadge(st.mode||'?')}</div>
      ${chip}<div class="row"><span class="k">PnL</span><span class="v">${signed(pnl, signedUsd(pnl))}</span></div>
      <div class="tiny">${st.lastTickAt?`tick ${fmtAge(st.lastTickAt)}`:''}</div></button>`;
  }).join('');
  const core = `
    ${card('Patrimonio', `
      <div class="big-num">${fmtUsd(sum.navUsd)}</div>
      <div class="row"><span class="k">PnL realizado</span><span class="v">${signed(sum.realizedPnlUsd, signedUsd(sum.realizedPnlUsd))}</span></div>
      <div class="row"><span class="k">PnL no realizado</span><span class="v">${signed(sum.unrealizedPnlUsd, signedUsd(sum.unrealizedPnlUsd))}</span></div>
      <div class="row"><span class="k">Exposición</span><span class="v">${fmtUsd(sum.exposureUsd)}</span></div>
      ${freshChip(port.ts||ctx.market?.ts, port.source||'api')}
      ${mode==='pro'?`<div style="margin-top:8px">${lineChart(navSeries,{hh:120,ylabel:'BTC/USD'})}</div>`:''}
    `, {right: badge(ctx.dataTag,'demo')})}
    ${card('Estado de motores', `<div class="grid g2">${engineCards}</div>`)}`;
  const extra = mode==='pro' ? `
    ${card('Por motor', table(
      [{label:'Motor'},{label:'PnL USD',num:1},{label:'Exposición USD',num:1}],
      (sum.byEngine||[]).map(x=>[esc(x.engine), signed(x.pnlUsd,signedUsd(x.pnlUsd)), fmtUsd(x.exposureUsd)]),{minWidth:380}))}
    ${card('Avisos', `<div class="feed">${(data.activity?.data||[]).slice(0,6).map(evRow).join('')}</div>`)}` : '';
  return `<div class="grid">${core}${extra}</div>`;
}

// ==================== MERCADO ====================
function renderMarketLegacy(ctx){
  const { mode, data } = ctx;
  const m = data.market?.data ?? {};
  const pair = ctx.ui.marketPair;
  if(data.market?.state!=='ok' && !m.price && !m.tickers){
    return connectionEmpty('Mercado pendiente de conexión',
      'Al conectar el bot aparecerán precios, velas, volumen e indicadores técnicos completos. Mientras tanto, no se muestran cotizaciones inventadas.',
      {icon:'⌁',action:'Configurar fuente de mercado'});
  }
  const t = m.tickers?.[pair] ?? (m.pair===pair?m:{});
  const ind = m.indicators?.[pair] ?? (m.pair===pair?m.indicators:{}) ?? {};
  const candles = m.candles?.[pair] ?? (m.pair===pair?m.candles:[]) ?? [];
  const pairChips = Object.keys(m.tickers||{}).map(p=>
    `<button class="chip ${p===pair?'on':''}" data-ui="marketPair:${p}">${esc(p)}</button>`).join('');
  const priceBlock = card(`Mercado · ${esc(pair)}`, `
    <div class="chips" style="margin-bottom:10px">${pairChips}</div>
    <div class="big-num">${fmtUsd(t.price)} <span class="small ${isNum(t.change24hPct)?(t.change24hPct>=0?'pos':'neg'):''}">${signedPct(t.change24hPct)}</span></div>
    <div class="kv" style="margin-top:8px">
      <div class="item"><div class="k">Bid</div><div class="v">${fmtUsd(t.bid)}</div></div>
      <div class="item"><div class="k">Ask</div><div class="v">${fmtUsd(t.ask)}</div></div>
      <div class="item"><div class="k">Spread</div><div class="v">${fmtUsd(t.spread)}</div></div>
      <div class="item"><div class="k">Vela</div><div class="v">15m</div></div>
    </div>
    ${provLine({source:t.source, ts:t.ts, state:'fresh'})}`);
  const chartCard = card(`Velas ${esc(pair)} · 15m`, candleChart(candles,{hh:230}));
  const indBasic = card('Indicadores', kv([
    ['RSI', fmtNum(ind.rsi,{dec:1})], ['ADX', fmtNum(ind.adx,{dec:1})],
    ['ATR%', fmtPct(ind.atrpPct)], ['Volumen×', fmtNum(ind.volume?.ratio,{dec:2})],
  ]));
  const indPro = card('Indicadores completos', `
    <details class="ind-group" open><summary>Tendencia</summary>${kv([
      ['EMA20', fmtUsd(ind.ema?.ema20)], ['EMA50', fmtUsd(ind.ema?.ema50)], ['EMA200', fmtUsd(ind.ema?.ema200)],
      ['ADX', fmtNum(ind.adx,{dec:1}), ind.adx>25?'tendencia fuerte':'débil'],
      ['Momentum 4h', signedPct(ind.momentum?.pct4h)], ['Momentum 24h', signedPct(ind.momentum?.pct24h)],
    ])}</details>
    <details class="ind-group"><summary>Momentum</summary>${kv([
      ['RSI(14)', fmtNum(ind.rsi,{dec:1}), ind.rsi<30?'sobreventa':ind.rsi>70?'sobrecompra':''],
      ['MACD', fmtNum(ind.macd?.macd,{dec:1}), `señal ${fmtNum(ind.macd?.signal,{dec:1})}`],
      ['MACD hist', fmtNum(ind.macd?.histogram,{dec:1})],
    ])}</details>
    <details class="ind-group"><summary>Volatilidad y volumen</summary>${kv([
      ['ATR', fmtNum(ind.atr,{dec:1}), `ATRP ${fmtPct(ind.atrpPct)}`],
      ['BB %B', fmtNum(ind.bollinger?.pctB,{dec:2})],
      ['BB media', fmtUsd(ind.bollinger?.mid)],
      ['BB sup/inf', `${fmtUsd(ind.bollinger?.upper)} / ${fmtUsd(ind.bollinger?.lower)}`],
      ['Volumen último', fmtNum(ind.volume?.last,{dec:1}), `media ${fmtNum(ind.volume?.avg24,{dec:1})}`],
    ])}</details>
    <div class="row"><span class="k">Régimen</span><span class="v">${esc(ind.regime??NA)}</span></div>
    ${provLine({source:'indicadores', ts:ind.computedAt, state:'fresh'})}`);
  const sources = card('Fuentes de datos', table(
    [{label:'Fuente'},{label:'Rol'},{label:'Estado'},{label:'Último OK'},{label:'Nota'}],
    ((m.sources||m.externalSources)||[]).map(s=>[esc(s.name), esc(s.role), badge(s.state, s.state==='active'?'on':s.state==='offline'?'err':'warn'), s.lastOk?esc(fmtAge(s.lastOk)):NA, esc(s.note||'')]),
    {minWidth:620}));
  return `<div class="grid">${priceBlock}${chartCard}${mode==='basic'?indBasic:indPro}${mode==='pro'?sources:''}</div>`;
}

// ==================== MOTOR (selector de subvista) ====================
function renderEngineLegacy(ctx){
  const { engineId, subtab } = ctx.ui;
  const eng = ctx.engineList.find(e=>e.id===engineId);
  const d = ctx.enginesData?.[engineId]?.data;
  const st = ctx.enginesData?.[engineId];
  if(!eng) return `<div class="banner err">Motor desconocido</div>`;
  const head = `<div class="eng-head"><h1>${esc(eng.name)}</h1>${st?.state==='ok'?modeBadge(d?.status?.mode):badge('Sin conexión','warn')}
    ${badge(ctx.dataTag,'sim')}<span class="sub">${esc(eng.desc)} · modos propios: ${eng.modes.join(' / ')}</span>
    ${stateBanner(st?.state||'desconocido', st?.error||'')}</div>`;
  const subtabs = ctx.subtabs.map(s=>`<button class="${s.id===subtab?'on':''}" data-ui="subtab:${s.id}">${esc(s.label)}</button>`).join('');
  const body = ctx.renderEngineSub(engineId, subtab);
  return `${head}<div class="subnav">${subtabs}</div>${body}`;
}

// ==================== IDCA ====================
export function idcaPanel(ctx){
  const d = ctx.data;
  const { mode } = ctx;
  const st = d.status ?? {}, s = d.summary ?? {};
  const pc = d.pairContexts?.[ctx.ui.marketPair && d.pairContexts[ctx.ui.marketPair] ? ctx.ui.marketPair : 'BTC/USD'] ?? {};
  const basic = `
    ${card('IDCA — Panel', `
      <div class="row"><span class="k">Modo</span><span class="v">${modeBadge(st.mode)}</span></div>
      <div class="row"><span class="k">Motor</span><span class="v">${badge(st.running==null?'Sin confirmar':st.running?'en marcha':'detenido',st.running==null?'warn':st.running?'on':'off')} ${freshChip(st.lastTickAt,'scheduler')}</span></div>
      <div class="row"><span class="k">Pausa global</span><span class="v">${badge(st.globalTradingPause==null?'Sin confirmar':st.globalTradingPause?'PAUSADO':'sin pausa',st.globalTradingPause==null?'warn':st.globalTradingPause?'err':'on')}</span></div>
      <div class="row"><span class="k">Pares</span><span class="v">${(st.assetPairs||[]).map(p=>`<span class="chip ${p.enabled?'on':''}" style="margin-left:4px">${esc(p.pair)}·${esc(p.mode)}</span>`).join('')}</span></div>
      <div class="row"><span class="k">Score de entrada</span><span class="v">${fmtNum(pc.entryScore,{dec:2})} / umbral ${fmtNum(pc.entryThreshold,{dec:2})} ${microBar((pc.entryScore||0)/(pc.entryThreshold||1)*100,{mark:100})}</span></div>
      <div class="row"><span class="k">Capital usado / libre</span><span class="v">${fmtUsd(s.capitalUsedUsd)} / ${fmtUsd(s.capitalFreeUsd)}</span></div>
      <div class="row"><span class="k">PnL realizado / no realizado</span><span class="v">${signed(s.realizedPnlUsd,signedUsd(s.realizedPnlUsd))} · ${signed(s.unrealizedPnlUsd,signedUsd(s.unrealizedPnlUsd))}</span></div>
      <div class="row"><span class="k">Ciclos activos</span><span class="v">${s.activeCyclesCount??NA}</span></div>
      ${expandable('Detalle de mercado y protecciones', idcaMarketDetail(pc, s))}
    `)}`;
  if(mode==='basic') return basic;
  return `
    ${card('IDCA — Panel (Pro)', `
      ${kv([
        ['Modo', modeBadge(st.mode)], ['Motor', badge(st.running==null?'Sin confirmar':st.running?'en marcha':'detenido',st.running==null?'warn':st.running?'on':'off')],
        ['Pausa global', badge(st.globalTradingPause==null?'Sin confirmar':st.globalTradingPause?'PAUSADA':'sin pausa',st.globalTradingPause==null?'warn':st.globalTradingPause?'err':'on')],
        ['Último tick', fmtTs(st.lastTickAt,{withSec:true}), `ticks ${fmtNum(st.tickCount,{dec:0})}`],
        ['Último error', esc(st.lastError||'—')],
      ])}
      <div class="row"><span class="k">Pares habilitados</span><span class="v">${(st.assetPairs||[]).map(p=>`<span class="chip ${p.enabled?'on':''}">${esc(p.pair)} · ${esc(p.mode)}</span>`).join(' ')}</span></div>`)}
    <div class="row"><span class="k">Protecciones</span><span class="v">Break-even · Trailing · TP dinámico<small class="tiny"> detalle por ciclo en «Ciclos abiertos»</small></span></div>
    ${idcaMarketDetail(pc, s, true)}
    ${card('Métricas de estrategia', kv([
      ['Score estrategia', fmtNum(s.strategyScore,{dec:2})],['Win rate', (typeof s.winRate==='number'?fmtPct(s.winRate*100):NA)],
      ['Profit factor', fmtNum(s.profitFactor,{dec:2})],['Expectancy', fmtUsd(s.expectancy)],
      ['Compras hoy', s.buysToday],['Ventas hoy', s.sellsToday],
      ['Trailing activos', s.trailingActiveCount],['Smart Mode', badge(s.smartModeEnabled==null?'Sin confirmar':s.smartModeEnabled?'ON':'off',s.smartModeEnabled==null?'warn':s.smartModeEnabled?'on':'off')],
    ]))}
    ${card('Controles del motor (protegidos)', `
      <div class="btn-row">
        ${typeof st.globalTradingPause==='boolean'?`<button class="btn prot" data-action="idca.pauseGlobal" data-params="${esc(JSON.stringify({pause:!st.globalTradingPause}))}">${st.globalTradingPause?'Reanudar IDCA':'Pausar IDCA'}</button>`:'<span class="tiny">Pausa global sin verificar</span>'}
        ${(st.assetPairs||[]).filter(p=>typeof p.enabled==='boolean').map(p=>`<button class="btn prot" data-action="idca.togglePair" data-params="${esc(JSON.stringify({pair:p.pair,enabled:!p.enabled}))}">${p.enabled?'Desactivar':'Activar'} ${esc(p.pair)}</button>`).join('')}
        <button class="btn danger prot" data-action="idca.emergencyClose" data-params="{}">Cierre de emergencia</button>
      </div>
      <div class="tiny" style="margin-top:8px">Acciones protegidas: requieren una sesión autorizada y confirmación en el servidor.</div>`)}`;
}
function idcaMarketDetail(pc, s, pro=false){
  return `
    ${kv([
      ['Precio '+esc(pc.pair||''), fmtUsd(pc.currentPrice), pc.currency],
      ['Régimen', esc(pc.regime??NA)], ['Tendencia', esc(pc.trend??NA)],
      ['ATR / ATRP', `${fmtNum(pc.atr,{dec:1})} / ${fmtPct(pc.atrpPct)}`],
      ['Volatilidad', esc(pc.volatility??NA)],
      ['Caída detectada / exigida', `${fmtPct(pc.dipDetectedPct)} / ${fmtPct(pc.requiredDipPct)}`],
      ['Score / umbral', `${fmtNum(pc.entryScore,{dec:2})} / ${fmtNum(pc.entryThreshold,{dec:2})}`],
      ['Señal rebote', esc(pc.reboundSignal??NA)],
      ['Referencia', esc(pc.reference??NA)],
      ['Market score', fmtNum(pc.marketScore,{dec:2})],
    ])}
    <div class="row"><span class="k">Progreso hacia umbral de entrada</span><span class="v">${isNum(pc.entryScore)&&isNum(pc.entryThreshold)&&pc.entryThreshold>0?microBar(Math.min(100,pc.entryScore/pc.entryThreshold*100),{mark:100}):NA}</span></div>
    ${pc.priceTs?provLine({source:pc.source||pc.exchange||'API',ts:pc.priceTs,state:'unknown'}):''}
    ${pro?`<h4 class="small" style="margin:10px 0 4px">Desglose score V/C/R/D/M</h4>
      ${table([{label:'Componente'},{label:'Valor',num:1}],
        Object.entries(pc.scoreBreakdown||{}).map(([k,v])=>[esc(k),fmtNum(v,{dec:2})]),{minWidth:260})}`:''}`;
}
export function idcaCycles(ctx){
  const d = ctx.data;
  const list = d.cycles ?? [];
  const cards = list.map((c,index)=>{
    const pnlCls = (c.unrealizedPnlUsd||0)>=0?'pos':'neg';
    const head = `<div class="row" style="border:0"><b>${esc(c.pair)} · ${esc(c.id)}</b>
      <span>${badge(c.status, c.status==='open'?'on':'off')} ${badge(c.mode,'sim')}</span></div>`;
    const core = kv([
      ['Inicio', fmtTs(c.startedAt), `abierto ${duration(c.startedAt)}`],
      ['Compras', c.buyCount],
      ['Capital usado', fmtUsd(c.capitalUsedUsd)],
      ['Precio medio / actual', `${fmtUsd(c.avgEntryPrice)} / ${fmtUsd(c.currentPrice)}`],
      ['Cantidad', fmtQty(c.totalQuantity, c.pair?.split('/')[0])],
      ['Próxima compra', fmtUsd(c.nextBuyPrice)],
      ['TP dinámico', `${fmtUsd(c.tpTargetPrice)} (${fmtPct(c.tpTargetPct)})`],
      ['Dip entrada', fmtPct(c.entryDipPct)],
      ['PnL', `<span class="${pnlCls}">${signedUsd(c.unrealizedPnlUsd)} · ${signedPct(c.unrealizedPnlPct)}</span>`, 'no realizado'],
      ['Fee est.', fmtUsd(c.estimatedFeeUsd)],
    ]);
    const anchors = `
      <div class="row"><span class="k">Ancla de ciclo</span><span class="v">${fmtUsd(c.cycleAnchorPrice)}<small>${esc(c.cycleAnchorLabel||'')} · ${esc(c.cycleAnchorSource||'')} · ${fmtNum(c.cycleAnchorAgeHours,{dec:1})}h</small></span></div>
      <div class="row"><span class="k">Base</span><span class="v">${fmtUsd(c.basePrice)}</span></div>`;
    const prot = `
      <div class="row"><span class="k">Break-even</span><span class="v">${badge(c.breakEven?.enabled?'habilitado':'off',c.breakEven?.armed?'warn':(c.breakEven?.enabled?'on':'off'))}
        <small class="tiny"> arma en ${fmtPct(c.breakEven?.armPct)} · dist. ${fmtPct(c.breakEven?.distancePct)}</small></span></div>
      ${c.breakEven?.armed===true?microBar(100):''}
      <div class="row"><span class="k">Trailing</span><span class="v">${badge(c.trailing?.enabled?'habilitado':'off',c.trailing?.armed?'warn':'on')}
        <small class="tiny"> ${fmtPct(c.trailing?.pct)} · dist. ${fmtPct(c.trailing?.distancePct)}</small></span></div>
      ${isNum(c.trailing?.progressPct)?microBar(c.trailing.progressPct):''}
      <div class="row"><span class="k">Duración / regla</span><span class="v">${duration(c.startedAt)}<small>${esc(c.timeStop?.rule||'')} · quedan ${esc(c.timeStop?.remaining||'')}</small></span></div>`;
    const tp = expandable('Desglose TP dinámico', table(
      [{label:'Componente'},{label:'Valor'}],
      Object.entries(c.tpBreakdown||{}).map(([k,v])=>[esc(k), typeof v==='number'?fmtNum(v,{dec:2}):esc(String(v))]),{minWidth:280}));
    const orders = expandable('Órdenes del ciclo', table(
      [{label:'ID'},{label:'Fecha'},{label:'Lado'},{label:'Tipo'},{label:'Precio',num:1},{label:'Cantidad',num:1},{label:'Valor',num:1},{label:'Fee',num:1},{label:'Slip %',num:1},{label:'Motivo'}],
      (ctx.data.orders||[]).filter(o=>o.cycleId===c.id).map(o=>[
        `<span class="mono">${esc(o.id)}</span>`, esc(fmtTs(o.ts)), `<b class="${o.side==='BUY'?'pos':'neg'}">${esc(o.side)}</b>`, esc(o.type),
        fmtUsd(o.price), fmtQty(o.quantity), fmtUsd(o.valueUsd), fmtUsd(o.feeUsd),
        fmtPct(o.slippagePct), `<small>${esc(o.reason)}</small>`]),{minWidth:760}));
    const actions = `<div class="btn-row">
      <button class="btn prot" data-action="idca.cycleStatus" data-params='{"cycleId":"'+esc(c.id)+'","status":"paused"}'>Pausar ciclo</button>
      <button class="btn prot" data-manual-buy="${esc(c.id)}">Registrar compra externa</button>
      ${c.isImported===true ? `<button class="btn prot" data-action="idca.soloSalida" data-params="${esc(JSON.stringify({cycleId:c.id,soloSalida:!c.soloSalida}))}">${c.soloSalida?'Gestión completa':'Solo salida'}</button>` : ''}
      <button class="btn danger prot" data-action="idca.closeCycle" data-params='{"cycleId":"'+esc(c.id)+'"}'>Cerrar posición</button>
      ${c.isManualCycle===true ? `<button class="btn danger prot" data-action="idca.deleteCycle" data-params="${esc(JSON.stringify({cycleId:c.id}))}">Eliminar ciclo manual</button>` : ''}</div>
      <div class="tiny">Acciones sujetas a permisos y comprobación del servidor.</div>`;
    return card(head+core+anchors+prot+
      '<button class="btn nx-inspect-open" type="button" data-inspect="idca:cycles:'+index+'">Ver ficha completa del ciclo ↗</button>'+
      (ctx.mode==='pro'?tp+orders+actions:expandable('Detalle completo (TP, órdenes, acciones)', tp+orders+actions)),{});
  }).join('');
  return `<div class="grid">${cards||'<div class="na">Sin ciclos</div>'}</div>`;
}

const idcaKnownNum=v=>typeof v==='number'&&Number.isFinite(v);
const idcaPlain=v=>v===null||v===undefined||v===''?NA:esc(String(v));
const idcaSide=s=>String(s||'').toUpperCase()==='BUY'?'Compra':String(s||'').toUpperCase()==='SELL'?'Venta':'Operación';

export function idcaHistory(ctx){
 // Historial comparable al IDCA original: resumen económico, estados, semántica LIVE/SIM,
 // PnL verificado y detalle al toque (ficha universal). No inventar resultados.
 const items=Array.isArray(ctx.data.history)?ctx.data.history:[];
 const amount=v=>idcaKnownNum(v)?signedUsd(v):'—';
 const known=items.filter(c=>idcaKnownNum(c.realizedPnlUsd));
 const wins=known.filter(c=>c.realizedPnlUsd>0).length;
 const losses=known.filter(c=>c.realizedPnlUsd<0).length;
 const even=known.filter(c=>c.realizedPnlUsd===0).length;
 const unknown=items.length-known.length;
 const sum=known.length?known.reduce((n,c)=>n+c.realizedPnlUsd,0):null;
 const explain={
  fail_safe:'Salida de seguridad',trailing:'Trailing stop',trailing_stop:'Trailing stop',
  trailing_exit_dust_adj:'Trailing · ajuste residual',take_profit:'Objetivo de beneficio',
  break_even:'Break-even',breakeven_sell:'Break-even',manual:'Cierre manual',
  mode_transition_simulation_to_live:'Transición SIM → LIVE',
 };
 const human=v=>v?explain[String(v).toLowerCase()]||String(v).replaceAll('_',' '):'Motivo no informado';
 const counts='<div class="nx-idca-history-overview">'+
   '<div class="nx-idca-stat nx-idca-stat-total"><small>Ciclos cerrados</small><strong>'+items.length+'</strong></div>'+
   '<div class="nx-idca-stat nx-idca-stat-won"><small>Ganadores</small><strong>✓ '+wins+'</strong></div>'+
   '<div class="nx-idca-stat nx-idca-stat-lost"><small>Perdedores</small><strong>● '+losses+'</strong></div>'+
   '<div class="nx-idca-stat nx-idca-stat-neutral"><small>Neutros</small><strong>'+even+'</strong></div>'+
   '<div class="nx-idca-stat nx-idca-stat-unknown"><small>Sin PnL verificado</small><strong>? '+unknown+'</strong></div></div>';
 const profit='<div class="nx-idca-history-profit '+(sum===null?'nx-idca-profit-unknown':sum<0?'nx-idca-profit-loss':sum>0?'nx-idca-profit-gain':'nx-idca-profit-even')+'">'+
   '<div><span>PnL neto</span><small>Solo ciclos con resultado verificable'+(unknown?' · '+unknown+' pendientes':'')+'</small></div>'+
   '<strong>'+amount(sum)+'</strong></div>';
 const summary='<section class="nx-idca-historical-summary">'+
   '<div class="nx-idca-history-title"><h2>Historial de ciclos IDCA</h2><span>Datos de la API</span></div>'+
   counts+profit+'<p class="nx-idca-period-label">Ganados / perdidos: '+wins+' / '+losses+
   ' · Neutros / sin PnL confirmado: '+even+' / '+unknown+'</p>'+
   (unknown?'<p class="nx-idca-hint">Falta PnL verificado en '+unknown+' ciclo(s); el resultado mostrado no representa el total definitivo.</p>':'')+'</section>';
 const renderCycle=(c,index)=>{
   const value=idcaKnownNum(c.realizedPnlUsd)?c.realizedPnlUsd:null;
   const cls=value===null?'unknown':value>0?'gain':value<0?'loss':'neutral';
   const mode=String(c.mode||'').toLowerCase();
   const imported=c.isImported===true||c.imported===true;
   const manual=c.isManualCycle===true||c.manual===true;
   const dur=c.startedAt&&c.closedAt?duration(c.startedAt,c.closedAt):'—';
   const pct=idcaKnownNum(c.realizedPnlPct)?signedPct(c.realizedPnlPct):'';
   const date=c.closedAt?esc(fmtTs(c.closedAt)):'Fecha de cierre no verificada';
   const phrase=value===null?'Resultado insuficiente':value>0?'Ciclo con beneficio':value<0?'Ciclo con pérdida':'Ciclo sin beneficio ni pérdida';
   return '<div class="nx-idca-history-row nx-idca-history-'+cls+'">'+
    '<button type="button" class="nx-idca-history-open" data-inspect="idca:history:'+index+'" aria-label="Abrir detalle ciclo '+esc(c.id||index)+'">'+
     '<span class="nx-idca-history-sign" aria-hidden="true">'+(value===null?'?':value>0?'✓':value<0?'●':'=')+'</span>'+
     '<span class="nx-idca-history-info"><b>'+idcaPlain(c.pair)+' <small>#'+idcaPlain(c.id)+'</small></b>'+
       '<span class="nx-idca-history-badges"><em class="nx-idca-mode '+(mode==='live'?'is-live':'is-sim')+'">'+(mode?esc(mode.toUpperCase()):'MODO SIN VERIFICAR')+'</em>'+
       (imported?'<em>IMPORTADO</em>':'')+(manual?'<em>MANUAL</em>':'')+'</span>'+
       '<small>'+date+' · '+esc(dur)+' · '+idcaPlain(c.buyCount)+' compras</small>'+
       '<small>'+esc(human(c.closeReason||c.exitType))+'</small>'+ (c.closeReason?'<small class="nx-idca-technical-reason">Código: '+esc(String(c.closeReason))+'</small>':'')+'</span>'+
     '<span class="nx-idca-history-money"><strong>'+amount(value)+'</strong>'+
      (pct?'<b>'+esc(pct)+'</b>':'<small>'+phrase+'</small>')+'</span>'+
     '<span class="nx-idca-history-arrow" aria-hidden="true">›</span></button>'+
    '</div>';
 };
 const list=items.slice(0,12).map(renderCycle).join('');
 const rest=items.length>12?'<details class="nx-idca-rest"><summary>Ver otros '+(items.length-12)+' ciclos del historial</summary>'+
  '<div class="nx-idca-history-list">'+items.slice(12).map((c,i)=>renderCycle(c,i+12)).join('')+'</div></details>':'';
 return '<div class="nx-idca-history nx-idca-history-refined">'+summary+
   (items.length?'<div class="nx-idca-history-list">'+list+'</div>'+rest:
   '<div class="nx-idca-historical-empty"><strong>Historial no disponible</strong><p>La API no ha proporcionado ciclos cerrados en esta lectura. Esto no demuestra que no existan operaciones.</p></div>')+
   '</div>';
}
export function idcaOrders(ctx){
 const all=Array.isArray(ctx.data.orders)?ctx.data.orders:[];
 const usable=all.filter(o=>idcaKnownNum(o.valueUsd)&&['BUY','SELL'].includes(String(o.side).toUpperCase()));
 const missing=all.length-usable.length;
 const group=side=>{
   const matches=usable.filter(o=>String(o.side).toUpperCase()===side);
   return matches.length?fmtUsd(matches.reduce((n,o)=>n+o.valueUsd,0)):'—';
 };
 const item=(o,index)=>{
   const side=String(o.side||'').toUpperCase(),buy=side==='BUY',sell=side==='SELL';
   const amount=idcaKnownNum(o.valueUsd)?fmtUsd(o.valueUsd):'Importe sin verificar';
   return '<details class="nx-idca-trade" data-inspect="idca:orders:'+index+'"><summary><span class="nx-idca-trade-kind '+(buy?'is-buy':sell?'is-sell':'')+'">'+
     idcaSide(side)+'</span><span class="nx-idca-trade-main"><b>'+amount+'</b><small>'+
     esc(fmtTs(o.ts))+' · Ciclo #'+idcaPlain(o.cycleId)+'</small></span><span class="nx-idca-trade-chevron">⌄</span></summary>'+
     '<div class="nx-idca-trade-detail">'+
     kv([['Par',idcaPlain(o.pair)],['Orden',idcaPlain(o.id)],['Tipo',idcaPlain(o.type)],
       ['Modo',idcaPlain(o.mode)],['Precio',fmtUsd(o.price)],
       ['Cantidad',fmtQty(o.quantity)],['Valor bruto',fmtUsd(o.grossValueUsd)],
       ['Valor neto',fmtUsd(o.netValueUsd)],['Comisión',fmtUsd(o.feeUsd)],
       ['Deslizamiento USD',fmtUsd(o.slippageUsd)],
       ['Deslizamiento %',fmtPct(o.slippagePct)],
       ['Motivo',idcaPlain(o.reason)],['Estado',idcaPlain(o.status)]])+
     '</div></details>';
 };
 const warn=missing?'<p class="nx-idca-hint">En '+missing+' operación(es) falta lado o importe bruto confirmado; no se han sumado como cero.</p>':'';
 return '<div class="nx-idca-orders">'+
   '<section class="nx-idca-trade-totals"><div><span>Compras registradas</span><strong>'+group('BUY')+'</strong></div>'+
      '<div><span>Ventas registradas</span><strong>'+group('SELL')+'</strong></div>'+
      '<small>'+all.length+' operaciones recibidas · importes brutos USD confirmados</small></section>'+warn+
   (all.length?'<div class="nx-idca-trade-list">'+all.slice(0,15).map(item).join('')+'</div>'+
     (all.length>15?'<details class="nx-idca-rest"><summary>Ver '+(all.length-15)+' operaciones más</summary>'+
       '<div class="nx-idca-trade-list">'+all.slice(15).map((o,i)=>item(o,i+15)).join('')+'</div></details>':''):
     '<p class="nx-idca-hint">La API no ha enviado órdenes en esta lectura. No se presupone un histórico vacío.</p>')+
   '</div>';
}
export function idcaHybrid(ctx){
  const h = ctx.data.hybrid ?? {};
  return `<div class="banner info"><b>Overlay interno IDCA.</b> ${esc(GRID_DISTINCTION)}</div>`+
    card('Hybrid/Grid overlay', kv([
      ['Estado', badge(h.enabled?'activo':'off',h.enabled?'on':'off')],['Modo', esc(h.mode)],
      ['Legs grid', h.gridLegs],
      ...Object.entries(h.regimeByPair||{}).map(([p,r])=>[`Régimen ${p}`, esc(r)]),
    ])+`<div class="tiny">${esc(h.note||'')}</div>`);
}
export function idcaConfig(ctx){
 const rows=Array.isArray(ctx.data.configParams)?ctx.data.configParams:[];
 if(!rows.length)return card('Configuración efectiva IDCA',
  '<p class="nx-idca-hint">La API no ha facilitado parámetros comparables «guardado / efectivo» en esta lectura. No se muestran tablas vacías ni se inventan valores.</p>');
 const list=rows.map(p=>{
   const val=x=>x===null||x===undefined?NA:esc(String(x));
   return '<details class="nx-idca-param"><summary><b>'+val(p.key)+'</b><span>'+val(p.effective)+'</span></summary>'+
     '<div class="nx-idca-param-detail">'+kv([['Grupo',val(p.group)],
       ['Guardado',val(p.stored)],['Efectivo',val(p.effective)],
       ['Predeterminado',val(p.def)],['Ámbito',val(p.scope)],
       ['Legacy',p.legacy?'Sí':'No'],['Nota',val(p.reason||p.appliesTo)]])+'</div></details>';
 }).join('');
 return card('Configuración IDCA · guardado y efectivo',
  '<p class="nx-idca-hint">Efectivo = valor aplicado por el motor; Guardado = valor almacenado. Toca un parámetro para abrir su detalle.</p>'+
  '<div class="nx-idca-param-list">'+list+'</div>');
}
export function idcaAlerts(ctx){
  const a = ctx.data.alerts ?? {};
  return card('Alertas IDCA', kv([
    ['Telegram', badge(a.telegramEnabled?'ON':'off',a.telegramEnabled?'on':'off')],
    ['Simulación→Telegram', badge(a.simulationTelegramEnabled?'ON':'off',a.simulationTelegramEnabled?'on':'off')],
    ['Avisos trailing buy', badge(a.trailingBuyAlerts?'ON':'off',a.trailingBuyAlerts?'on':'off')],
    ['Canales', esc((a.channels||[]).join(', '))],['Intervalo avisos', `${a.intervalMin??NA} min`],
  ]));
}

// ==================== SPOT ====================
export function spotPanel(ctx){
  const d = ctx.data, st = d.status ?? {};
  const sigs = d.signals ?? [];
  const head = card('SPOT — Panel', `
    ${kv([
      ['Modo', st.mode==null?NA:modeBadge(st.mode)],['Motor', typeof st.running==='boolean'?badge(st.running?'en marcha':'detenido',st.running?'on':'off'):NA],
      ['Venue', esc(st.venue)],['Fuente datos', esc(st.dataExchange)],
      ['Estrategia', esc(st.strategy)],['Último tick', fmtAge(st.lastTickAt)],
    ])}
    <div class="row"><span class="k">Pares</span><span class="v">${(st.pairs||[]).map(p=>`<span class="chip">${esc(p)}</span>`).join(' ')}</span></div>
    <div class="row"><span class="k">dryRun efectivo</span><span class="v">${typeof st.configEffective?.dryRunMode==='boolean'?(st.configEffective.dryRunMode?badge('DRY-RUN','sim'):badge('LIVE','real')):NA}<small class="tiny"> ${esc(st.configEffective?.resolvedFrom||'')}</small></span></div>
    <div class="tiny warn-tx" style="margin-top:4px">${esc(st.configEffective?.conflict||'')}</div>`);
  const sigTable = card('Señales', table(
    [{label:'Par'},{label:'Score',num:1},{label:'Setup'},{label:'Régimen'},{label:'Estado'},{label:'Vetos'},{label:'Motivo'}],
    sigs.map(s=>[esc(s.pair), fmtNum(s.score,{dec:2}), esc(s.setup), esc(s.regime),
      badge(s.entryState, s.entryState==='watch'?'warn':s.entryState==='blocked'?'err':'on'),
      esc((s.vetoes||[]).join(', ')||'—'), `<small>${esc(s.reason)}</small>`]),{minWidth:680}));
  const indDetail = ctx.mode==='pro'? card('Indicadores por señal', sigs.map(s=>
    expandable(`${esc(s.pair)} — vela ${fmtTs(s.candleTs)}`, kv([
      ['RSI',fmtNum(s.indicators?.rsi,{dec:1})],['MACD hist',fmtNum(s.indicators?.macdHist,{dec:1})],
      ['ADX',fmtNum(s.indicators?.adx,{dec:1})],['ATR',fmtNum(s.indicators?.atr,{dec:1})],
      ['BB %B',fmtNum(s.indicators?.bbPctB,{dec:2})],['Vol×',fmtNum(s.indicators?.volRatio,{dec:2})],
    ]))).join('')) : '';
  return `<div class="grid">${head}${sigTable}${indDetail}</div>`;
}
export function spotPositions(ctx){
  const list = ctx.data.positions ?? [];
  const rows = list.map((p,i)=>[`<button type="button" class="nx-inspect-inline" data-inspect="spot:positions:${i}">${esc(p.pair)} ↗</button>`, fmtQty(p.quantity), fmtUsd(p.avgPrice), fmtUsd(p.currentPrice),
    fmtUsd(p.costUsd), fmtUsd(p.valueUsd), signed(p.pnlUsd,signedUsd(p.pnlUsd)), signedPct(p.pnlPct),
    fmtPct(p.exposurePct), esc((p.protections||[]).join(', '))]);
  return card('Posiciones SPOT', table(
    [{label:'Par'},{label:'Cantidad',num:1},{label:'Precio medio',num:1},{label:'Actual',num:1},
     {label:'Coste',num:1},{label:'Valor',num:1},{label:'PnL $',num:1},{label:'PnL %',num:1},
     {label:'Exposición',num:1},{label:'Protecciones'}],rows,{minWidth:780}));
}
export function spotHistory(ctx){
 // GET /trades/closed retorna histórico GLOBAL del bot. Atribución a SPOT solo
 // cuando strategy/origin/engine explícitos del backend lo demuestran.
 const list=Array.isArray(ctx.data.trades)?ctx.data.trades:null;
 const health=ctx.data.resourceStates?.trades||'unavailable';
 const total=Number.isInteger(ctx.data.tradeTotal)?ctx.data.tradeTotal:null;
 if(list===null)return '<section class="nx-idca-historical-empty nx-spot-history-unavailable"><h2>Historial de operaciones</h2>'+
   '<p>La pasarela no ha entregado el historial global de operaciones ('+esc(health)+'). '+ 
   'Esto NO significa que el bot no tenga compras ni ventas. El acceso GET /trades/closed debe verificarse y autorizarse en la pasarela de solo lectura.</p></section>';
 const amount=v=>idcaKnownNum(v)?fmtUsd(v):'—';
 const result=v=>idcaKnownNum(v)?signedUsd(v):'—';
 const sells=list.filter(x=>String(x.side).toUpperCase()==='SELL');
 const buys=list.filter(x=>String(x.side).toUpperCase()==='BUY');
 const valued=sells.filter(x=>idcaKnownNum(x.realizedPnlUsd));
 const totalNet=valued.length?valued.reduce((sum,x)=>sum+x.realizedPnlUsd,0):null;
 const heading='<div class="nx-idca-historical-summary">'+
   '<div class="nx-idca-history-title"><h2>Historial de operaciones</h2><span>Lectura real del bot</span></div>'+
   '<div class="nx-idca-history-overview nx-spot-history-overview">'+
   '<div class="nx-idca-stat"><small>Registros recibidos</small><strong>'+list.length+'</strong></div>'+
   '<div class="nx-idca-stat nx-idca-stat-won"><small>Compras</small><strong>'+buys.length+'</strong></div>'+
   '<div class="nx-idca-stat nx-idca-stat-lost"><small>Ventas</small><strong>'+sells.length+'</strong></div>'+
   '<div class="nx-idca-stat nx-idca-stat-unknown"><small>Ventas sin PnL</small><strong>'+Math.max(0,sells.length-valued.length)+'</strong></div></div>'+
   '<div class="nx-idca-history-profit '+(totalNet===null?'nx-idca-profit-unknown':totalNet<0?'nx-idca-profit-loss':'nx-idca-profit-gain')+'">'+
   '<div><span>PnL neto de ventas con dato</span><small>Resumen de registros RECIBIDOS; no implica que todo el historial esté cargado</small></div>'+
   '<strong>'+result(totalNet)+'</strong></div>'+
   '<p class="nx-idca-hint">Origen: GET /trades/closed (registro global). No atribuir toda esta actividad a SPOT, GRID o IDCA sin identificar el motor de cada operación.</p>'+
   (total!==null&&total>list.length?'<p class="nx-idca-hint">Vista parcial: '+list.length+' de '+total+
   ' registros. Quedan páginas pendientes; no se presenta como total definitivo.</p>':'')+'</div>';
 const row=(t,i)=>{
   const side=String(t.side||'').toUpperCase(),sell=side==='SELL',buy=side==='BUY';
   const profit=sell&&idcaKnownNum(t.realizedPnlUsd)?t.realizedPnlUsd:null;
   const tone=sell&&profit!==null?(profit>0?'gain':profit<0?'loss':'neutral'):buy?'gain':'unknown';
   const source=t.strategy||t.origin||'Motor sin verificar';
   const main=sell&&profit!==null?result(profit):amount(t.valueUsd);
   const label=sell&&profit!==null?'PnL neto':'Importe registrado (no PnL)';
   return '<div class="nx-idca-history-row nx-idca-history-'+tone+'">'+
    '<button class="nx-idca-history-open" type="button" data-inspect="spot:trades:'+i+'">'+
    '<span class="nx-idca-history-sign" aria-hidden="true">'+(buy?'↓':sell?'↑':'·')+'</span>'+
    '<span class="nx-idca-history-info"><b>'+idcaPlain(t.pair)+' <small>#'+idcaPlain(t.id)+'</small></b>'+
       '<span class="nx-idca-history-badges"><em>'+esc(buy?'COMPRA':sell?'VENTA':side||'REGISTRO')+'</em>'+
         (t.exchange?'<em>'+esc(t.exchange)+'</em>':'')+'</span>'+
       '<small>'+esc(fmtTs(t.ts))+' · '+esc(source)+'</small>'+
       '<small>'+esc(t.reason||t.type||'Motivo sin verificar')+'</small></span>'+
    '<span class="nx-idca-history-money"><strong>'+main+'</strong><small>'+label+'</small></span>'+
    '<span class="nx-idca-history-arrow" aria-hidden="true">›</span></button></div>';
 };
 return '<div class="nx-idca-history nx-spot-history-refined">'+heading+
   (list.length?'<div class="nx-idca-history-list">'+list.map(row).join('')+'</div>':
    '<div class="nx-idca-historical-empty"><strong>0 operaciones en esta página</strong><p>El endpoint respondió con una lista vacía; no se ha probado que el historial completo esté vacío.</p></div>')+
   (list.length>=100&&(total===null||total>list.length)?
     '<button type="button" class="nx-spot-load-more" data-app="spot-history-more">Ver más operaciones verificadas ↓</button>':'')+
   '</div>';
}
export function spotProtections(ctx){
  const rows=(ctx.data.protections||[]).map(p=>[esc(p.type), badge(p.enabled?'ON':'off',p.enabled?'on':'off'),
    badge(p.state, p.armed?'warn':'sim'), p.threshold!=null?fmtNum(p.threshold,{dec:1}):NA,
    p.distancePct!=null?fmtPct(p.distancePct):NA, esc(p.scope)]);
  return card('Protecciones SPOT', table(
    [{label:'Tipo'},{label:'Activa'},{label:'Estado'},{label:'Umbral',num:1},{label:'Distancia',num:1},{label:'Ámbito'}],
    rows,{minWidth:560}));
}
export function spotConfig(ctx){
  const c = ctx.data.config ?? {};
  return `<div class="grid">
    ${card('Estrategia SPOT', kv([
      ['Activa', esc(c.activeStrategy)],
      ['Disponibles', esc((c.availableStrategies||[]).join(', '))],
    ])+`<div class="banner info" style="margin-top:8px">${esc(GRID_DISTINCTION)}</div>`)}
    ${card('Riesgo', kv(Object.entries(c.riskParams||{}).map(([k,v])=>[k, fmtNum(v,{dec:2})])))}
    ${card('Feature flags', table([{label:'Flag'},{label:'Estado'}],
      (c.featureFlags||[]).map(f=>[`<span class="mono">${esc(f.key)}</span>`,badge(f.enabled?'ON':'off',f.enabled?'on':'off')]),{minWidth:300}))}
    ${card('Time-stops', table([{label:'Par'},{label:'Horas',num:1},{label:'Activo'}],
      (c.timeStops||[]).map(t=>[esc(t.pair),fmtNum(t.hours,{dec:0}),badge(t.active?'ON':'off',t.active?'on':'off')]),{minWidth:300}))}
  </div>`;
}

// ==================== GRID AISLADO ====================
export function gridPanel(ctx){
  const d = ctx.data, st = d.status ?? {};
  const u = st.unlock ?? {};
  const cycles = d.cycles ?? [];
  const open = cycles.filter(c=>c.status!=='closed');
  const cur = open.filter(c=>c.rangeRelation==='current_range');
  const old = open.filter(c=>c.rangeRelation==='previous_range');
  return `<div class="grid">
    ${card('Grid aislado — Panel', kv([
      ['Modo', modeBadge(st.mode)],['Par', esc(st.pair)],
      ['Política', badge((st.makerOnly?'MAKER_ONLY':''), 'sim')+ (st.postOnly?' '+badge('post-only','sim'):'')],
      ['Capital presupuesto', fmtUsd(st.capitalBudgetUsd)],
      ['Capital en ciclos', fmtUsd(st.capitalUsedUsd)],
      ['Ciclos abiertos', open.length],
    ]))}
    ${card('Desbloqueo de modos (unlock-check)', `
      <div class="row"><span class="k">REAL_LIMITED</span><span class="v">${badge(u.realLimited?'disponible':'bloqueado', u.realLimited?'on':'err')}</span></div>
      <div class="row"><span class="k">REAL_FULL</span><span class="v">${badge(u.realFull?'disponible':'bloqueado', u.realFull?'on':'err')}</span></div>
      ${kv([['Gates OK',(u.checksPass||[]).join(', ')],['Gates fallando',(u.checksFail||[]).join(', ')]])}`)}
    ${card(`Ciclos rango actual (${cur.length})`, cyclesChart(d))}
    ${old.length?card(`SELL pendientes de rangos antiguos (${old.length}) — no se mezclan`, `<div class="banner warn">Objetivos SELL heredados de rangos anteriores; se gestionan aparte y no venden HOLD.</div>`+cyclesTable(old)) : ''}
    ${card('Ciclos abiertos (BUY → SELL 1:1)', cyclesTable(cur))}
  </div>`;
}
function cyclesTable(cycles){
  return table(
    [{label:'Ciclo'},{label:'Rango'},{label:'BUY',num:1},{label:'Cant.',num:1},{label:'SELL objetivo',num:1},
     {label:'Cant. SELL',num:1},{label:'Estado'},{label:'Fee',num:1},{label:'Obj. USD',num:1},{label:'PnL',num:1}],
    cycles.map(c=>[`<button type="button" class="nx-inspect-inline" data-inspect="grid:cycles:id=${encodeURIComponent(String(c.id))}">#${esc(c.id)} ↗</button>`, `<small>${esc(c.rangeVersionId)}</small>`,
      `${fmtUsd(c.buyPrice)}<small>${esc(fmtAge(c.buyFillTs))}</small>`, fmtQty(c.buyQty,'BTC',6),
      fmtUsd(c.sellTargetPrice), fmtQty(c.sellQty,'BTC',6),
      badge(c.status, /closed/.test(c.status)?'on':/legacy/.test(c.status)?'warn':'sim'),
      fmtUsd(c.feeUsd), fmtUsd(c.targetProfitUsd), signed(c.pnlUsd, signedUsd(c.pnlUsd))]),{minWidth:820});
}
function cyclesChart(d){
  const candles = ctxMarketCandles();
  const levels = (d.levels?.levels||[]).map(l=>({price:l.price,label:`${l.side} ${l.price}`}));
  const oldLv = (d.levels?.previousRanges||[]).flatMap(r=>[{price:r.low,old:true,label:`rango antiguo ${r.id}`},{price:r.high,old:true}]);
  const buys = (d.cycles||[]).map(c=>({ts:c.buyFillTs,price:c.buyPrice}));
  const tgts = (d.cycles||[]).filter(c=>c.status!=='closed').map(c=>({ts:c.buyFillTs,price:c.sellTargetPrice}));
  const sells = (d.cycles||[]).filter(c=>c.sellFillTs).map(c=>({ts:c.sellFillTs,price:c.sellTargetPrice}));
  return `<div class="tiny" style="margin-bottom:4px">Velas BTC/USD · niveles (azul=actual, ámbar=antiguo) · ● compras ● targets ● ventas</div>`
    + candleChart(candles,{hh:220,levels:[...levels,...oldLv],buys,targets:tgts,sells});
}
export function gridCycles(ctx){
  const cycles = ctx.data.cycles ?? [];
  return card('Todos los ciclos Grid', cyclesTable(cycles));
}
export function gridLevels(ctx){
  const l = ctx.data.levels ?? {};
  return `<div class="grid">
    ${card('Rango actual', kv([
      ['ID rango', esc(l.rangeVersionId)],
      ['Centro', fmtUsd(l.center)],['Spacing', esc(l.spacing)],
      ['Límites', `${fmtUsd(l.currentRange?.low)} — ${fmtUsd(l.currentRange?.high)}`],
      ['Abierto', fmtTs(l.currentRange?.openedAt)],
    ]) + gridLevelsChart(l))}
    ${card('Niveles', table([{label:'Precio',num:1},{label:'Lado'},{label:'Estado'}],
      (l.levels||[]).map((x,i)=>[`<button type="button" class="nx-inspect-inline" data-inspect="grid:levels.levels:${i}">${fmtUsd(x.price)} ↗</button>`, badge(x.side,x.side==='BUY'?'on':'sim'), esc(x.state)]),{minWidth:360}))}
    ${card('Rangos anteriores', table(
      [{label:'ID'},{label:'Límites'},{label:'Abierto'},{label:'Cerrado'},{label:'SELL pendientes',num:1}],
      (l.previousRanges||[]).map(r=>[esc(r.id), `${fmtUsd(r.low)} — ${fmtUsd(r.high)}`,
        fmtTs(r.openedAt), fmtTs(r.closedAt), r.openSellTargets]),{minWidth:520}))}
  </div>`;
}
function gridLevelsChart(l){
  const candles = ctxMarketCandles();
  const levels=(l.levels||[]).map(x=>({price:x.price,label:`${x.side} ${x.price}`}));
  const old=(l.previousRanges||[]).flatMap(r=>[{price:r.low,old:true,label:r.id},{price:r.high,old:true}]);
  return candleChart(candles,{hh:210,levels:[...levels,...old]});
}
export function gridMonitor(ctx){
  const m = ctx.data.monitor ?? {};
  const blocks = (m.safety?.blockingReasons||[]).map(r=>`<div class="ev nx-inspect-clickable"><span class="sev warn"></span><div class="msg">${esc(r)}</div></div>`).join('');
  const evRows=(arr,base)=>arr.map((e,i)=>`<div class="ev nx-inspect-clickable" tabindex="0" role="button" data-inspect="grid:monitor.${base}:${e.id!=null?'id='+encodeURIComponent(String(e.id)):i}"><span class="sev ${esc(e.severity||'info')}"></span><div class="msg"><b>${esc(e.engine||'grid')}</b> · ${esc(e.type||'')} — ${esc(e.message||e.msg||'')}<small>${esc(fmtTs(e.ts,{withSec:true}))}</small></div></div>`).join('');
  return `<div class="grid">
    ${card('Capital', kv([
      ['Total cartera grid', fmtUsd(m.walletTotalUsd)],
      ['Bloqueado', fmtUsd(m.capitalLockedUsd)],['Liberado', fmtUsd(m.capitalReleasedUsd)],
    ]))}
    ${m.safety?card('Seguridad y bloqueos', `<div class="feed">${blocks||'<div class="na">Sin razones de bloqueo verificadas</div>'}</div>`):''}
    ${card('Estados de órdenes', table([{label:'ID'},{label:'Lado'},{label:'Precio',num:1},{label:'Estado'}],
      (m.orderStates||[]).map((o,i)=>[`<button type="button" class="nx-inspect-inline" data-inspect="grid:monitor.orderStates:${i}">${esc(o.id)} ↗</button>`,esc(o.side),fmtUsd(o.price),badge(o.state,'sim')]),{minWidth:360}))}
    ${card('Cancelaciones', table([{label:'Fecha'},{label:'Orden'},{label:'Motivo'}],
      (m.cancellations||[]).map((c,i)=>[`<button type="button" class="nx-inspect-inline" data-inspect="grid:monitor.cancellations:${i}">${fmtTs(c.ts)} ↗</button>`,esc(c.orderId),`<small>${esc(c.reason)}</small>`]),{minWidth:420}))}
    ${card('Eventos', `<div class="feed">${evRows(m.events||[],'events')||'<div class="na">Sin eventos verificados</div>'}</div>`)}
    ${(m.alerts||[]).length?card('Decisiones', `<div class="feed">${evRows(m.alerts,'alerts')}</div>`):''}
  </div>`;
}
export function gridConfig(ctx){
  const c = ctx.data.config ?? {};
  return card('Configuración Grid', kv([
    ['Política', esc(c.policy)],['Maker/Taker', esc(c.makerTaker)],['Perfil capital', esc(c.capitalProfile)],
  ])+table([{label:'Recomendación'},{label:'Tipo'},{label:'Estado'},{label:'Nota'}],
    (c.recommendations||[]).map(r=>[esc(r.id),esc(r.kind),badge(r.state,'warn'),`<small>${esc(r.note)}</small>`]),{minWidth:520}));
}

// ==================== AMA ====================
export function amaPanel(ctx){
  const d = ctx.data, st = d.status ?? {};
  const r = d.readiness ?? {};
  return `<div class="grid">
    ${card('AMA — Panel', kv([
      ['Modo', modeBadge(st.mode)],['Entorno', esc(st.environment)],
      ['Scheduler', badge(st.scheduler?.running?'en marcha':'detenido',st.scheduler?.running?'on':'off')],
      ['Último tick', fmtTs(st.scheduler?.lastTickAt,{withSec:true}), `ticks ${fmtNum(st.scheduler?.tickCount,{dec:0})} · err ${st.scheduler?.errorCount}`],
      ['Último error', esc(st.scheduler?.lastError||'—')],
      ['Kill switch', badge(st.killSwitch?.armed?'ACCIONADO':'operativo','warn')],
    ]))}
    ${card('Readiness', `
      <div class="row"><span class="k">Checks</span><span class="v">${r.readyCount??NA}/${r.totalCount??NA} listos ${microBar((r.readyCount||0)/(r.totalCount||1)*100)}</span></div>
      ${(r.blockers||[]).map(b=>`<div class="banner warn" style="margin-top:6px">${esc(b)}</div>`).join('')}`)}
    ${card('REAL', `<div class="banner err"><b>REAL cerrado.</b> El gateway REAL es placeholder; una reserva NO es una orden enviada. Activar REAL requeriría gates fail-closed + autorización — no se muestra como ejecutado.</div>
      <div class="btn-row"><button class="btn prot" disabled>Activación REAL (no disponible)</button></div>`)}
  </div>`;
}
export function amaReadiness(ctx){
  const r = ctx.data.readiness ?? {};
  return card('Readiness AMA — checks fail-closed', table(
    [{label:'Check'},{label:'Descripción'},{label:'Estado'}],
    (r.checks||[]).map(c=>[`<span class="mono">${esc(c.id)}</span>`,esc(c.label),badge(c.ok?'OK':'FALLO',c.ok?'on':'err')]),{minWidth:420}));
}
export function amaMandate(ctx){
  const m = ctx.data.mandate ?? {};
  return `<div class="grid">
    ${card('Mandato', kv([
      ['ID', `<button type="button" class="nx-inspect-inline" data-inspect="ama:mandate:single">${esc(m.id||'Ver mandato')} ↗</button>`],['Estado', badge(m.status,'on')],
      ['Activos', (m.assets||[]).map(a=>`${esc(a.asset)} ${a.weightPct}%`).join(' · ')],
      ['Score macro', fmtNum(m.scoring?.macroScore,{dec:2}), `umbral ${fmtNum(m.scoring?.threshold,{dec:2})}`],
      ['Banda riesgo', esc(m.scoring?.riskBand)],
      ['Régimen macro', esc(m.macroContext?.regime)],['Flujos ETF', esc(m.macroContext?.etfFlows)],['Tendencia', esc(m.macroContext?.trend)],
    ]))}
    ${card('Fuentes del mandato', table([{label:'Fuente'},{label:'Tipo'}],
      ((m.sources||m.externalSources)||[]).map(s=>[esc(s.name), badge(s.kind, s.kind==='real'?'on':s.kind==='placeholder'?'err':'warn')]),{minWidth:320}))}
    ${card('Explicación decisión', `<div class="banner info">${esc(m.explanation)}</div>`)}
  </div>`;
}
export function amaTrace(ctx){
  const t = ctx.data.trace ?? {};
  return `<div class="grid">
    ${card('Órdenes / tranches — semántica estricta', table(
      [{label:'ID'},{label:'Ciclo'},{label:'Estado'},{label:'executed'},{label:'orderId'},{label:'Venue'}],
      (t.orders||[]).map((o,i)=>[`<button type="button" class="nx-inspect-inline" data-inspect="ama:trace.orders:${i}">${esc(o.id)} ↗</button>`,esc(o.cycleId),badge(o.state,o.state==='filled'?'on':'warn'),
        badge(String(o.executed),o.executed?'on':'off'),`<span class="mono">${esc(o.orderId??'null')}</span>`,`<small>${esc(o.venue)}</small>`]),{minWidth:560})
      + `<div class="tiny" style="margin-top:6px">executed/reserved/submitted/filled NO son sinónimos (hallazgo P0-1).</div>`)}
    ${card('Tranches', table([{label:'ID'},{label:'Ciclo'},{label:'Nº'},{label:'Plan USD',num:1},{label:'Ejec. USD',num:1},{label:'Estado'}],
      (t.tranches||[]).map((x,i)=>[`<button type="button" class="nx-inspect-inline" data-inspect="ama:trace.tranches:${i}">${esc(x.id)} ↗</button>`,esc(x.cycleId),x.idx,fmtUsd(x.plannedUsd),fmtUsd(x.executedUsd),badge(x.state,'sim')]),{minWidth:520}))}
    ${card('Ledger', `<div class="feed">${(t.ledger||[]).map((l,i)=>`<div class="ev nx-inspect-clickable" tabindex="0" role="button" data-inspect="ama:trace.ledger:${i}"><span class="sev info"></span><div class="msg">${esc(l.entry)}<small>${esc(fmtTs(l.ts))}</small></div></div>`).join('')}</div>`)}
    ${card('Decisiones', `<div class="feed">${(t.decisions||[]).map((x,i)=>`<div class="ev nx-inspect-clickable" tabindex="0" role="button" data-inspect="ama:trace.decisions:${i}"><span class="sev info"></span><div class="msg">${esc(x.text)}<small>${esc(fmtTs(x.ts))}</small></div></div>`).join('')}</div>`)}
  </div>`;
}
export function amaLab(ctx){
  const l = ctx.data.lab ?? {};
  return `<div class="grid">
    ${card('Sesiones LAB', table([{label:'ID'},{label:'Inicio'},{label:'Tipo'},{label:'Resultado'}],
      (l.sessions||[]).map(s=>[esc(s.id),fmtTs(s.startedAt),esc(s.kind),esc(s.result)]),{minWidth:420}))}
    ${card('Replays', table([{label:'ID'},{label:'Rango'},{label:'Velas',num:1},{label:'Cobertura',num:1},{label:'Hash'}],
      (l.replayRuns||[]).map(r=>[esc(r.id),`<small>${esc(r.range)}</small>`,r.candles,fmtPct(r.coveragePct),`<span class="mono">${esc(r.hash)}</span>`]),{minWidth:560}))}
    ${card('Shadow scenarios', table([{label:'ID'},{label:'Estado'},{label:'Órdenes',num:1},{label:'Fills',num:1},{label:'USD sim',num:1}],
      (l.shadowScenarios||[]).map(s=>[esc(s.id),badge(s.state,'sim'),s.orders,s.fills,fmtUsd(s.simulatedUsd)]),{minWidth:460}))}
  </div>`;
}
export function amaConfig(ctx){
  const p = ctx.data.portfolio ?? {};
  return `<div class="grid">
    ${card('Presupuesto y riesgo', kv([
      ['Presupuesto', fmtUsd(p.budgetUsd)],['Reservado', fmtUsd(p.reservedUsd)],['Libre', fmtUsd(p.freeUsd)],
      ['Exposición', fmtUsd(p.exposureUsd)],
      ['HWM', fmtUsd(p.hwm?.value), `${esc(p.hwm?.bootstrapStatus||'')} · ${fmtPct(p.hwm?.dataCoveragePct)}`],
      ['Límite exposición', fmtPct(p.limits?.maxExposurePct)],['Max drawdown', fmtPct(p.limits?.maxDrawdownPct)],
    ]))}
  </div>`;
}

// ==================== CARTERA ====================
function renderPortfolioLegacy(ctx){
  if(ctx.data.portfolio?.state!=='ok') return connectionEmpty(
    'Cartera pendiente de vinculación',
    'El patrimonio, las posiciones y el PnL aparecerán cuando exista una sesión segura con el backend. No mostramos ceros ni balances ficticios.',
    {icon:'▣',action:'Configurar cartera'});
  const { mode, data } = ctx;
  const p = data.portfolio?.data ?? {};
  const s = p.summary ?? {};
  const basic = `
    ${card('Cartera', `
      <div class="big-num">${fmtUsd(s.navUsd)}</div>
      <div class="tiny">Valor total según lectura /portfolio/summary del bot${s.ts?` · ${esc(fmtTs(s.ts))}`:''}. Presupuesto asignado ≠ patrimonio de mercado.</div>
      <div class="row"><span class="k">Capital asignado</span><span class="v">${fmtUsd(s.allocatedUsd)}</span></div>
      <div class="row"><span class="k">Desplegado</span><span class="v">${fmtUsd(s.deployedUsd)}</span></div>
      <div class="row"><span class="k">Libre asignado</span><span class="v">${fmtUsd(s.freeAssignedUsd)}</span></div>
      <div class="row"><span class="k">Exposición</span><span class="v">${fmtUsd(s.exposureUsd)}</span></div>
      <div class="row"><span class="k">PnL realizado</span><span class="v">${signed(s.realizedPnlUsd,signedUsd(s.realizedPnlUsd))}</span></div>
      <div class="row"><span class="k">PnL no realizado</span><span class="v">${signed(s.unrealizedPnlUsd,signedUsd(s.unrealizedPnlUsd))}</span></div>
      <div class="row"><span class="k">HOLD (separado)</span><span class="v">${fmtUsd(s.holdUsd)}</span></div>
      ${expandable('Desglose', kv(
        (s.byEngine||[]).map(e=>[`Motor ${e.engine}`, `${fmtUsd(e.exposureUsd)} · ${signedUsd(e.pnlUsd)}`])))}`)}`;
  const pro = `
    ${card('NAV y exposición', kv([
      ['Valor total (API)', fmtUsd(s.navUsd)],['Capital asignado', fmtUsd(s.allocatedUsd)],
      ['Desplegado', fmtUsd(s.deployedUsd)],['Libre asignado', fmtUsd(s.freeAssignedUsd)],
      ['Exposición', fmtUsd(s.exposureUsd)],
      ['PnL realizado', signed(s.realizedPnlUsd,signedUsd(s.realizedPnlUsd))],
      ['PnL no realizado', signed(s.unrealizedPnlUsd,signedUsd(s.unrealizedPnlUsd))],
      ['HOLD separado', fmtUsd(s.holdUsd)],
    ])+`<div class="tiny">«Valor total» procede de totalValueUsd en la API. No es una prueba independiente de NAV de exchange.</div>`)}
    ${card('Activos en cartera', table(
      [{label:'Activo'},{label:'Cantidad',num:1},{label:'Valor USD',num:1},{label:'Detalle'}],
      (p.holdings||[]).map((h,i)=>[esc(h.asset||h.symbol||'—'),fmtNum(h.quantity??h.qty,{dec:8}),
        fmtUsd(h.valueUsd??h.usdValue),
        `<button type="button" class="nx-inspect-inline" data-inspect="common:portfolio.holdings:${i}">Ficha ↗</button>`]),{minWidth:420}))}
    ${card('Movimientos', table(
      [{label:'Fecha'},{label:'Tipo'},{label:'Activo'},{label:'Importe',num:1},{label:'Detalle'}],
      (p.ledger||[]).map((l,i)=>[fmtTs(l.ts||l.createdAt),esc(l.type||l.kind||'—'),esc(l.asset||'—'),
        fmtUsd(l.amountUsd??l.valueUsd),
        `<button type="button" class="nx-inspect-inline" data-inspect="common:portfolio.ledger:${i}">Ficha ↗</button>`]),{minWidth:480}))}
    ${card('Reservas activas', table(
      [{label:'ID'},{label:'Modo'},{label:'Importe',num:1},{label:'Estado'},{label:'Detalle'}],
      (p.reservations||[]).map((r,i)=>[esc(r.id||'—'),esc(r.mode||r.engine||'—'),fmtUsd(r.amountUsd??r.usd),
        badge(r.state||r.status,'sim'),
        `<button type="button" class="nx-inspect-inline" data-inspect="common:portfolio.reservations:${i}">Ficha ↗</button>`]),{minWidth:480}))}
    ${card('Por activo', table(
      [{label:'Activo'},{label:'Valor USD',num:1},{label:'PnL USD',num:1}],
      (s.byAsset||[]).map(a=>[esc(a.asset),fmtUsd(a.valueUsd),signed(a.pnlUsd,signedUsd(a.pnlUsd))]),{minWidth:360}))}
    ${card('Por motor', table(
      [{label:'Motor'},{label:'Exposición',num:1},{label:'PnL',num:1}],
      (s.byEngine||[]).map(e=>[esc(e.engine),fmtUsd(e.exposureUsd),signed(e.pnlUsd,signedUsd(e.pnlUsd))]),{minWidth:360}))}
    ${card('Balances por motor/activo', table(
      [{label:'Motor'},{label:'Activo'},{label:'Exchange'},{label:'Total',num:1},{label:'Usado',num:1},{label:'Reservado',num:1},{label:'Libre',num:1},{label:'HOLD'}],
      (p.balances||[]).map(b=>[esc(b.engine),`<b>${esc(b.asset)}</b>`,esc(b.exchange),
        fmtNum(b.total,{dec:b.asset==='USD'?2:6}),fmtNum(b.used,{dec:b.asset==='USD'?2:6}),
        fmtNum(b.reserved,{dec:b.asset==='USD'?2:6}),fmtNum(b.free,{dec:b.asset==='USD'?2:6}),
        b.hold?badge('HOLD','warn'):'']),{minWidth:680}))}
    ${card('Presupuestos / reservas / locks', `
      ${table([{label:'Modo'},{label:'Activo'},{label:'Presupuesto',num:1},{label:'Usado',num:1},{label:'Estado'}],
        (p.budgets?.items||[]).map(b=>[esc(b.mode),esc(b.asset),fmtUsd(b.budgetUsd),fmtUsd(b.usedUsd),badge(b.status,'on')]),{minWidth:460})}
      ${table([{label:'Reserva'},{label:'Modo'},{label:'Importe',num:1},{label:'Estado'},{label:'Creada'}],
        (p.budgets?.reservations||[]).map(r=>[esc(r.id),esc(r.mode),fmtUsd(r.amountUsd),badge(r.state,'sim'),fmtTs(r.createdAt)]),{minWidth:460})}
      ${table([{label:'Lock'},{label:'Titular'},{label:'Estado'},{label:'Desde'}],
        (p.budgets?.locks||[]).map(l=>[`<span class="mono">${esc(l.key)}</span>`,esc(l.holder),badge(l.state,'sim'),fmtTs(l.since)]),{minWidth:420})}
      <div class="row"><span class="k">Reconciliación</span><span class="v">${badge(p.budgets?.reconciliation?.status,'on')}<small class="tiny"> ${esc(fmtAge(p.budgets?.reconciliation?.lastRun))} · pendientes ${p.budgets?.reconciliation?.pending??NA}</small></span></div>`)}`;
  return `<div class="grid">${basic}${mode==='pro'?pro:''}</div>`;
}

// ==================== ACTIVIDAD ====================
function renderActivityLegacy(ctx){
  const { mode, data } = ctx;
  const list = data.activity?.data?.events ?? [];
  const filters = ctx.ui.activityFilter;
  const filtered = list.filter(e=>
    (filters.sev==='all'||e.severity===filters.sev) &&
    (filters.engine==='all'||e.engine===filters.engine));
  const sevBtn=(v,l)=>`<button class="chip ${filters.sev===v?'on':''}" data-ui="sev:${v}">${l}</button>`;
  const engBtn=(v,l)=>`<button class="chip ${filters.engine===v?'on':''}" data-ui="eng:${v}">${l}</button>`;
  const head = `
    <div class="chips" style="margin-bottom:8px">${sevBtn('all','Todas')}${sevBtn('ok','OK')}${sevBtn('info','Info')}${sevBtn('warn','Aviso')}${sevBtn('err','Error')}</div>
    <div class="chips" style="margin-bottom:10px">${engBtn('all','Todos')}${engBtn('idca','IDCA')}${engBtn('spot','SPOT')}${engBtn('grid','Grid')}${engBtn('ama','AMA')}${engBtn('system','Sistema')}</div>`;
  const feed = `<div class="feed">${filtered.map((e)=>{
    const i=list.indexOf(e);
    const ref=e.id!=null?'id='+encodeURIComponent(String(e.id)):i;
    return `<div class="ev nx-inspect-clickable" tabindex="0" role="button" data-inspect="common:events:${ref}"><span class="sev ${esc(e.severity||'info')}"></span>
      <div class="msg"><b>${esc(e.engine||'')}</b> · ${esc(e.type||'')} — ${esc(e.message||e.msg||'')}
      <small>${esc(fmtTs(e.ts,{withSec:true}))}${e.source?` · ${esc(e.source)}`:''}${e.detail?` · ${esc(typeof e.detail==='object'?'':e.detail)}`:''}</small></div></div>`;
  }).join('')||'<div class="na">Sin eventos</div>'}</div>`;
  return `${head}${card(`Actividad (${filtered.length}/${list.length})`,feed)}
    ${mode==='pro'?'<div class="tiny" style="margin-top:6px">Stream · estados de exchange, latencias y staleness visibles por evento.</div>':''}`;
}
function evRow(e){
  return `<div class="ev"><span class="sev ${esc(e.severity||'info')}"></span>
    <div class="msg"><b>${esc(e.engine||'')}</b> · ${esc(e.type||'')} — ${esc(e.message)}
    <small>${esc(fmtTs(e.ts,{withSec:true}))}${e.source?` · ${esc(e.source)}`:''}${e.detail?` · ${esc(e.detail)}`:''}</small></div></div>`;
}

// ==================== FISCO ====================
function renderFiscoLegacy(ctx){
  if(ctx.data.fisco?.state!=='ok') return connectionEmpty('Fiscalidad privada',
    'Los informes de FISCO/AEAT requieren vinculación segura y permisos específicos. No se publican datos fiscales en el móvil sin autorización.',
    {icon:'▦',action:'Configurar acceso seguro'});
  const f = ctx.data.fisco?.data ?? {};
  const s = f.summary ?? {};
  return `<div class="grid">
    <div class="restricted"><h3>FISCO / AEAT — sección restringida</h3>
      <p class="small" style="margin:8px 0">${esc(f.notice||'')}</p>
      ${badge('acceso: '+ (f.accessLevel||'restringido'),'warn')}</div>
    ${ctx.mode==='pro'?card('Agregados (sin datos personales)', kv([
      ['Ejercicio', s.year],['Exchange', esc(s.exchange)],
      ['Lotes', s.lotsCount],['Operaciones', s.operationsCount],['Disposiciones', s.disposalsCount],
      ['Sync', esc(s.syncStatus)],
      ['Informes', esc((s.reportsAvailable||[]).join(', '))],
    ])+`<div class="tiny" style="margin-top:6px">Reserva fiscal ≠ comisiones. Detalle e informes solo en la app operativa con permisos.</div>`):''}
  </div>`;
}

// ==================== AJUSTES ====================
function renderSettingsLegacy(ctx){
  const { mode, data } = ctx;
  const st = data.settings?.data ?? {};
  const groups = {};
  (st.params||[]).forEach(p=>{ (groups[p.group]=groups[p.group]||[]).push(p); });
  const paramTables = Object.entries(groups).map(([g,items])=>
    card(`Ajustes · ${esc(g)}`, table(
      [{label:'Param'},{label:'Guardado'},{label:'Efectivo'},{label:'Default'},{label:'Ámbito'},{label:'Legacy'},{label:'Nota'}],
      items.map(p=>[`<span class="mono">${esc(p.key)}</span>`,esc(String(p.stored)),`<b>${esc(String(p.effective))}</b>`,
        esc(String(p.def)),esc(p.scope),p.legacy?badge('legacy','warn'):'',`<small>${esc(p.reason||p.appliesTo)}</small>`]),{minWidth:760}))).join('');
  const flags = card('Feature flags', table([{label:'Flag'},{label:'Estado'},{label:'Descripción'}],
    (st.flags||[]).map(f=>[`<span class="mono">${esc(f.key)}</span>`,badge(f.enabled?'ON':'off',f.enabled?'on':'off'),`<small>${esc(f.description)}</small>`]),{minWidth:520}));
  const exch = card('Exchanges / canales', table(
    [{label:'Venue'},{label:'Rol'},{label:'Conectado'},{label:'Último OK'},{label:'Nota'}],
    (st.exchanges||[]).map(e=>[esc(e.venue),esc(e.role),badge(e.connected?'OK':'fallo',e.connected?'on':'err'),
      e.lastOk?esc(fmtAge(e.lastOk)):NA,`<small>${esc(e.note)}</small>`]),{minWidth:560}));
  const note = `<div class="banner info">NEXA ${esc(BUILD_INFO.version)} · ${esc(BUILD_INFO.commit)} · ${esc(BUILD_INFO.channel)} — Las ediciones son <b>borrador local</b>: no se envían hasta confirmar en el editor propietario del motor. Cambiar Básico/Pro nunca envía POST.</div>`;
  return `<div class="grid">${note}${paramTables}${mode==='pro'?flags+exch:''}</div>`;
}

// ---------- utilidades internas ----------
function ctxMarketCandles(){
  return (globalThis.__nexa?.ctx?.market?.data?.candles?.['BTC/USD'])||[];
}
export { evRow };


// Rev9: public exports now use genuinely distinct mobile-first layouts.
// Legacy detail renderers remain available INSIDE progressive disclosures for 100% field parity.
export function renderHome(ctx){ return renderHomePremium(ctx); }
export function renderMarket(ctx){ return renderMarketPremium(ctx); }
export function renderEngine(ctx){ return renderEnginePremium(ctx); }
export function renderPortfolio(ctx){ return renderPortfolioPremium(ctx, renderPortfolioLegacy); }

// Revisión 11: actividad usa experiencia propia con los filtros originales disponibles en Pro.
export function renderActivity(ctx){return renderActivityPremium(ctx, renderActivityLegacy);}

export function renderFisco(ctx){ return renderFiscoPremium(ctx, renderFiscoLegacy); }
export function renderSettings(ctx){ return renderSettingsPremium(ctx, renderSettingsLegacy); }
