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
export function renderHome(ctx){
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
export function renderMarket(ctx){
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
export function renderEngine(ctx){
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
      <div class="row"><span class="k">Motor</span><span class="v">${badge(st.running?'en marcha':'detenido', st.running?'on':'off')} ${freshChip(st.lastTickAt,'scheduler')}</span></div>
      <div class="row"><span class="k">Pausa global</span><span class="v">${badge(st.globalTradingPause?'PAUSADO':'sin pausa', st.globalTradingPause?'err':'on')}</span></div>
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
        ['Modo', modeBadge(st.mode)], ['Motor', badge(st.running?'en marcha':'detenido',st.running?'on':'off')],
        ['Pausa global', badge(st.globalTradingPause?'PAUSADA':'sin pausa', st.globalTradingPause?'err':'on')],
        ['Último tick', fmtTs(st.lastTickAt,{withSec:true}), `ticks ${fmtNum(st.tickCount,{dec:0})}`],
        ['Último error', esc(st.lastError||'—')],
      ])}
      <div class="row"><span class="k">Pares habilitados</span><span class="v">${(st.assetPairs||[]).map(p=>`<span class="chip ${p.enabled?'on':''}">${esc(p.pair)} · ${esc(p.mode)}</span>`).join(' ')}</span></div>`)}
    <div class="row"><span class="k">Protecciones</span><span class="v">Break-even · Trailing · TP dinámico<small class="tiny"> detalle por ciclo en «Ciclos abiertos»</small></span></div>
    ${idcaMarketDetail(pc, s, true)}
    ${card('Métricas de estrategia', kv([
      ['Score estrategia', fmtNum(s.strategyScore,{dec:2})],['Win rate', fmtPct((s.winRate||0)*100)],
      ['Profit factor', fmtNum(s.profitFactor,{dec:2})],['Expectancy', fmtUsd(s.expectancy)],
      ['Compras hoy', s.buysToday],['Ventas hoy', s.sellsToday],
      ['Trailing activos', s.trailingActiveCount],['Smart Mode', badge(s.smartModeEnabled?'ON':'off',s.smartModeEnabled?'on':'off')],
    ]))}
    ${card('Controles del motor (protegidos)', `
      <div class="btn-row">
        <button class="btn prot" data-action="idca.pauseGlobal" data-params="{&quot;pause&quot;:true}">Pausar / reanudar</button>
        <button class="btn prot" data-action="idca.togglePair" data-params="{&quot;pair&quot;:&quot;BTC/USD&quot;,&quot;enabled&quot;:true}">Activar par</button>
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
    <div class="row"><span class="k">Progreso hacia umbral de entrada</span><span class="v">${microBar(Math.min(100,(pc.entryScore||0)/(pc.entryThreshold||1)*100),{mark:100})}</span></div>
    ${provLine({source:'kraken', ts:pc.priceTs, state:'fresh'})}
    ${pro?`<h4 class="small" style="margin:10px 0 4px">Desglose score V/C/R/D/M</h4>
      ${table([{label:'Componente'},{label:'Valor',num:1}],
        Object.entries(pc.scoreBreakdown||{}).map(([k,v])=>[esc(k),fmtNum(v,{dec:2})]),{minWidth:260})}`:''}`;
}
export function idcaCycles(ctx){
  const d = ctx.data;
  const list = d.cycles ?? [];
  const cards = list.map(c=>{
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
      ${microBar(Math.min(100,(c.breakEven?.armed?100:35)))}
      <div class="row"><span class="k">Trailing</span><span class="v">${badge(c.trailing?.enabled?'habilitado':'off',c.trailing?.armed?'warn':'on')}
        <small class="tiny"> ${fmtPct(c.trailing?.pct)} · dist. ${fmtPct(c.trailing?.distancePct)}</small></span></div>
      ${microBar(c.trailing?.progressPct??0)}
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
      <button class="btn prot" data-action="idca.manualBuy" data-params='{"cycleId":"'+esc(c.id)+'"}'>Compra manual</button>
      <button class="btn prot" data-action="idca.soloSalida" data-params='{"cycleId":"'+esc(c.id)+'"}'>Solo salida</button>
      <button class="btn danger prot" data-action="idca.closeCycle" data-params='{"cycleId":"'+esc(c.id)+'"}'>Cerrar posición</button>
      <button class="btn danger prot" data-action="idca.deleteCycle" data-params='{"cycleId":"'+esc(c.id)+'"}'>Eliminar ciclo</button></div>
      <div class="tiny">Acciones sujetas a permisos y comprobación del servidor.</div>`;
    return card(head+core+anchors+prot+(ctx.mode==='pro'?tp+orders+actions:expandable('Detalle completo (TP, órdenes, acciones)', tp+orders+actions)),{});
  }).join('');
  return `<div class="grid">${cards||'<div class="na">Sin ciclos</div>'}</div>`;
}
export function idcaHistory(ctx){
  const h = ctx.data.history ?? [];
  const totPnl = h.reduce((a,c)=>a+(c.realizedPnlUsd||0),0);
  const wins = h.filter(c=>c.realizedPnlUsd>0).length, losses=h.filter(c=>c.realizedPnlUsd<0).length, neutral=h.length-wins-losses;
  const summary = card('Historial IDCA', kv([
    ['Ciclos cerrados', h.length],['Wins / losses / neutros', `${wins} / ${losses} / ${neutral}`],
    ['PnL histórico', signed(totPnl, signedUsd(totPnl))],
  ]));
  const list = h.map(c=>expandable(
    `<b>${esc(c.pair)}</b> · ${esc(c.id)} · ${badge(c.exitType||c.closeReason,'sim')} · ${signed(c.realizedPnlUsd,signedUsd(c.realizedPnlUsd))}`,
    kv([
      ['Modo', esc(c.mode)],['Entrada', fmtTs(c.startedAt)],['Salida', fmtTs(c.closedAt)],
      ['Duración', duration(c.startedAt,c.closedAt)],['Compras', c.buyCount],
      ['Capital invertido', fmtUsd(c.capitalUsedUsd)],
      ['PnL neto', `${signedUsd(c.realizedPnlUsd)} · ${signedPct(c.realizedPnlPct)}`],
      ['Tipo de cierre', esc(c.closeReason)],
    ]) + expandable('Órdenes', table(
      [{label:'ID'}],[(c.orders||[]).map(o=>[`<span class="mono">${esc(o)}</span>`])],{minWidth:200})),
  )).join('');
  const exp = ctx.mode==='pro'?`<div class="btn-row"><button class="btn" data-app="export-idca">Exportar CSV</button>
    <span class="tiny" style="align-self:center">Filtro modo: simulación y live separados — sin mezcla.</span></div>`:'';
  return `<div class="grid">${summary}<div class="grid">${list}</div>${exp}</div>`;
}
export function idcaOrders(ctx){
  const rows=(ctx.data.orders||[]).map(o=>[
    esc(fmtTs(o.ts)), `<span class="mono">${esc(o.id)}</span>`, esc(o.cycleId),
    `<b class="${o.side==='BUY'?'pos':'neg'}">${esc(o.side)}</b>`, esc(o.type),
    fmtUsd(o.price), fmtQty(o.quantity), fmtUsd(o.valueUsd), fmtUsd(o.feeUsd),
    fmtPct(o.slippagePct), badge(o.mode,'sim'), `<small>${esc(o.reason)}</small>`]);
  const totBuy = (ctx.data.orders||[]).filter(o=>o.side==='BUY').reduce((a,o)=>a+o.valueUsd,0);
  const totSell = (ctx.data.orders||[]).filter(o=>o.side==='SELL').reduce((a,o)=>a+o.valueUsd,0);
  return card('Órdenes IDCA', `
    ${kv([['Total compras', fmtUsd(totBuy)],['Total ventas', fmtUsd(totSell)]])}
    ${table(
      [{label:'Fecha'},{label:'ID'},{label:'Ciclo'},{label:'Lado'},{label:'Tipo'},{label:'Precio',num:1},{label:'Cant.',num:1},{label:'Valor',num:1},{label:'Fee',num:1},{label:'Slip%',num:1},{label:'Modo'},{label:'Motivo'}],
      rows,{minWidth:940})}`);
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
  const rows=(ctx.data.configParams||[]).map(p=>[
    `<span class="mono">${esc(p.key)}</span>`, esc(p.group), esc(String(p.stored)),
    `<b>${esc(String(p.effective))}</b>`, esc(String(p.def)), esc(p.scope),
    p.legacy?badge('legacy','warn'):'', `<small>${esc(p.reason||p.appliesTo||'')}</small>`]);
  return card('Configuración IDCA — guardado vs efectivo', `
    <div class="tiny" style="margin-bottom:8px">Columna «efectivo» = valor que usa el motor en su decisión; no solo el guardado.</div>
    ${table([{label:'Param'},{label:'Grupo'},{label:'Guardado'},{label:'Efectivo'},{label:'Default'},{label:'Ámbito'},{label:'Legacy'},{label:'Nota'}],rows,{minWidth:820})}`);
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
      ['Modo', modeBadge(st.mode)],['Motor', badge(st.running?'en marcha':'detenido',st.running?'on':'off')],
      ['Venue', esc(st.venue)],['Fuente datos', esc(st.dataExchange)],
      ['Estrategia', esc(st.strategy)],['Último tick', fmtAge(st.lastTickAt)],
    ])}
    <div class="row"><span class="k">Pares</span><span class="v">${(st.pairs||[]).map(p=>`<span class="chip">${esc(p)}</span>`).join(' ')}</span></div>
    <div class="row"><span class="k">dryRun efectivo</span><span class="v">${st.configEffective?.dryRunMode?badge('DRY-RUN','sim'):badge('LIVE','real')}<small class="tiny"> ${esc(st.configEffective?.resolvedFrom||'')}</small></span></div>
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
  const rows = list.map(p=>[esc(p.pair), fmtQty(p.quantity), fmtUsd(p.avgPrice), fmtUsd(p.currentPrice),
    fmtUsd(p.costUsd), fmtUsd(p.valueUsd), signed(p.pnlUsd,signedUsd(p.pnlUsd)), signedPct(p.pnlPct),
    fmtPct(p.exposurePct), esc((p.protections||[]).join(', '))]);
  return card('Posiciones SPOT', table(
    [{label:'Par'},{label:'Cantidad',num:1},{label:'Precio medio',num:1},{label:'Actual',num:1},
     {label:'Coste',num:1},{label:'Valor',num:1},{label:'PnL $',num:1},{label:'PnL %',num:1},
     {label:'Exposición',num:1},{label:'Protecciones'}],rows,{minWidth:780}));
}
export function spotHistory(ctx){
  const rows=(ctx.data.trades||[]).map(t=>[esc(fmtTs(t.ts)), `<span class="mono">${esc(t.id)}</span>`,
    esc(t.pair), `<b class="${t.side==='BUY'?'pos':'neg'}">${esc(t.side)}</b>`, fmtUsd(t.price),
    fmtQty(t.quantity), fmtUsd(t.feeUsd), fmtPct(t.slippagePct), esc(t.closeReason||'—'),
    badge(t.mode,'sim'), `<small>${esc(t.reason)}</small>`]);
  return card('Historial de operaciones SPOT', table(
    [{label:'Fecha'},{label:'ID'},{label:'Par'},{label:'Lado'},{label:'Precio',num:1},{label:'Cant.',num:1},
     {label:'Fee',num:1},{label:'Slip%',num:1},{label:'Cierre'},{label:'Modo'},{label:'Motivo'}],rows,{minWidth:820}));
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
    cycles.map(c=>[`<span class="mono">${esc(c.id)}</span>`, `<small>${esc(c.rangeVersionId)}</small>`,
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
      (l.levels||[]).map(x=>[fmtUsd(x.price), badge(x.side,x.side==='BUY'?'on':'sim'), esc(x.state)]),{minWidth:360}))}
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
  return `<div class="grid">
    ${card('Capital', kv([
      ['Bloqueado', fmtUsd(m.capitalLockedUsd)],['Liberado', fmtUsd(m.capitalReleasedUsd)],
    ]))}
    ${card('Estados de órdenes', table([{label:'ID'},{label:'Lado'},{label:'Precio',num:1},{label:'Estado'}],
      (m.orderStates||[]).map(o=>[esc(o.id),esc(o.side),fmtUsd(o.price),badge(o.state,'sim')]),{minWidth:360}))}
    ${card('Cancelaciones', table([{label:'Fecha'},{label:'Orden'},{label:'Motivo'}],
      (m.cancellations||[]).map(c=>[fmtTs(c.ts),esc(c.orderId),`<small>${esc(c.reason)}</small>`]),{minWidth:420}))}
    ${card('Eventos', `<div class="feed">${(m.events||[]).map(evRow).join('')}</div>
      <div class="feed">${(m.alerts||[]).map(evRow).join('')}</div>`)}
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
      ['ID', esc(m.id)],['Estado', badge(m.status,'on')],
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
      (t.orders||[]).map(o=>[`<span class="mono">${esc(o.id)}</span>`,esc(o.cycleId),badge(o.state,o.state==='filled'?'on':'warn'),
        badge(String(o.executed),o.executed?'on':'off'),`<span class="mono">${esc(o.orderId??'null')}</span>`,`<small>${esc(o.venue)}</small>`]),{minWidth:560})
      + `<div class="tiny" style="margin-top:6px">executed/reserved/submitted/filled NO son sinónimos (hallazgo P0-1).</div>`)}
    ${card('Tranches', table([{label:'ID'},{label:'Ciclo'},{label:'Nº'},{label:'Plan USD',num:1},{label:'Ejec. USD',num:1},{label:'Estado'}],
      (t.tranches||[]).map(x=>[esc(x.id),esc(x.cycleId),x.idx,fmtUsd(x.plannedUsd),fmtUsd(x.executedUsd),badge(x.state,'sim')]),{minWidth:520}))}
    ${card('Ledger', `<div class="feed">${(t.ledger||[]).map(l=>`<div class="ev"><span class="sev info"></span><div class="msg">${esc(l.entry)}<small>${esc(fmtTs(l.ts))}</small></div></div>`).join('')}</div>`)}
    ${card('Decisiones', `<div class="feed">${(t.decisions||[]).map(x=>`<div class="ev"><span class="sev info"></span><div class="msg">${esc(x.text)}<small>${esc(fmtTs(x.ts))}</small></div></div>`).join('')}</div>`)}
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
export function renderPortfolio(ctx){
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
      <div class="row"><span class="k">Exposición</span><span class="v">${fmtUsd(s.exposureUsd)}</span></div>
      <div class="row"><span class="k">PnL realizado</span><span class="v">${signed(s.realizedPnlUsd,signedUsd(s.realizedPnlUsd))}</span></div>
      <div class="row"><span class="k">PnL no realizado</span><span class="v">${signed(s.unrealizedPnlUsd,signedUsd(s.unrealizedPnlUsd))}</span></div>
      <div class="row"><span class="k">HOLD (separado)</span><span class="v">${fmtUsd(s.holdUsd)}</span></div>
      ${expandable('Desglose', kv(
        (s.byEngine||[]).map(e=>[`Motor ${e.engine}`, `${fmtUsd(e.exposureUsd)} · ${signedUsd(e.pnlUsd)}`])))}`)}`;
  const pro = `
    ${card('NAV y exposición', kv([
      ['NAV', fmtUsd(s.navUsd)],['Exposición', fmtUsd(s.exposureUsd)],
      ['PnL realizado', signed(s.realizedPnlUsd,signedUsd(s.realizedPnlUsd))],
      ['PnL no realizado', signed(s.unrealizedPnlUsd,signedUsd(s.unrealizedPnlUsd))],
      ['HOLD separado', fmtUsd(s.holdUsd)],
    ]))}
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
export function renderActivity(ctx){
  const { mode, data } = ctx;
  const list = data.activity?.data ?? [];
  const filters = ctx.ui.activityFilter;
  const filtered = list.filter(e=>
    (filters.sev==='all'||e.severity===filters.sev) &&
    (filters.engine==='all'||e.engine===filters.engine));
  const sevBtn=(v,l)=>`<button class="chip ${filters.sev===v?'on':''}" data-ui="sev:${v}">${l}</button>`;
  const engBtn=(v,l)=>`<button class="chip ${filters.engine===v?'on':''}" data-ui="eng:${v}">${l}</button>`;
  const head = `
    <div class="chips" style="margin-bottom:8px">${sevBtn('all','Todas')}${sevBtn('ok','OK')}${sevBtn('info','Info')}${sevBtn('warn','Aviso')}${sevBtn('err','Error')}</div>
    <div class="chips" style="margin-bottom:10px">${engBtn('all','Todos')}${engBtn('idca','IDCA')}${engBtn('spot','SPOT')}${engBtn('grid','Grid')}${engBtn('ama','AMA')}${engBtn('system','Sistema')}</div>`;
  const feed = `<div class="feed">${filtered.map(evRow).join('')||'<div class="na">Sin eventos</div>'}</div>`;
  return `${head}${card(`Actividad (${filtered.length}/${list.length})`,feed)}
    ${mode==='pro'?'<div class="tiny" style="margin-top:6px">Stream · estados de exchange, latencias y staleness visibles por evento.</div>':''}`;
}
function evRow(e){
  return `<div class="ev"><span class="sev ${esc(e.severity||'info')}"></span>
    <div class="msg"><b>${esc(e.engine||'')}</b> · ${esc(e.type||'')} — ${esc(e.message)}
    <small>${esc(fmtTs(e.ts,{withSec:true}))}${e.source?` · ${esc(e.source)}`:''}${e.detail?` · ${esc(e.detail)}`:''}</small></div></div>`;
}

// ==================== FISCO ====================
export function renderFisco(ctx){
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
export function renderSettings(ctx){
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
  const note = `<div class="banner info">Las ediciones son <b>borrador local</b>: no se envían hasta confirmar en el editor propietario del motor. Cambiar Básico/Pro nunca envía POST.</div>`;
  return `<div class="grid">${note}${paramTables}${mode==='pro'?flags+exch:''}</div>`;
}

// ---------- utilidades internas ----------
function ctxMarketCandles(){
  return (globalThis.__nexa?.ctx?.market?.data?.candles?.['BTC/USD'])||[];
}
export { evRow };
