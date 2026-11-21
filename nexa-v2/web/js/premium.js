// NEXA PREMIUM UX — rev11. Real data only, two genuinely distinct trees.
// Presentation does not mutate execution mode or submit orders.
// Source of truth: engine status/read-model, never labels inferred from missing values.
import {esc,fmtUsd,signedUsd,signedPct,fmtNum,fmtPct,fmtTs,fmtAge,NA} from './util.js';
import {candleChart,lineChart,modeBadge} from './ui.js';
import {ohlcvChart} from './premium-chart.js';

const NAMES={idca:'IDCA',spot:'SPOT / Swing',grid:'GRID aislado',ama:'AMA'};
const DESCS={idca:'Acumulación inteligente por ciclos',spot:'Señales y gestión de posiciones',grid:'Órdenes por niveles BUY → SELL',ama:'Mandatos y acumulación macro'};
const ICON={
  chart:'<path d="m3 17 6-6 4 4 8-10M17 5h4v4"/>',
  wallet:'<rect x="3" y="6" width="18" height="15" rx="3"/><path d="M6 6V3h12v3M16 13h5v4h-5"/>',
  shield:'<path d="M12 2 4 6v6c0 6 4 9 8 10 4-1 8-4 8-10V6z"/><path d="m8 12 3 3 5-6"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 10-10m-5 5 3 3m-7 1 3 3"/>',
  activity:'<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  arrow:'<path d="m5 12 7 7 7-7"/>'
};
const ico=k=>`<svg viewBox="0 0 24 24" class="nxp-ico" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">${ICON[k]||ICON.chart}</svg>`;
const num=v=>typeof v==='number'&&Number.isFinite(v);
const first=(obj,...keys)=>{for(const key of keys){const v=obj?.[key];if(v!==null&&v!==undefined)return v;}return null;};
const money=v=>num(v)?fmtUsd(v):'—';
const pnl=v=>num(v)?signedUsd(v):'—';
const pct=v=>num(v)?signedPct(v):'—';
const value=v=>v===null||v===undefined||v===''?'—':esc(String(v));
const moneyClass=v=>num(v)?(v>=0?'nxp-up':'nxp-down'):'nxp-missing';
const raw=(ctx,kind)=>ctx.data?.[kind]?.data||{};
const goodCommon=(ctx,kind)=>!!ctx.authenticated&&['ok','fresh','partial'].includes(ctx.data?.[kind]?.state);
const goodEngine=(ctx,id)=>!!ctx.authenticated && ['ok','fresh','partial'].includes(ctx.enginesData?.[id]?.state);
const wrap=(s,cls='')=>`<div class="nxp ${cls}">${s}</div>`;
const chip=(label,cls='')=>`<span class="nxp-chip ${cls}">${esc(label)}</span>`;
const eyebrow=t=>`<span class="nxp-eyebrow">${esc(t)}</span>`;
const meta=(label,val)=>`<div class="nxp-meta"><span>${esc(label)}</span><strong>${val}</strong></div>`;
const block=(label,v,cls='')=>`<div class="nxp-figure ${cls}"><span>${esc(label)}</span><b>${v}</b></div>`;
const link=(target,label,cls='')=>`<button class="nxp-navlink ${cls}" data-nav="${esc(target)}">${esc(label)}<span aria-hidden="true">↗</span></button>`;
const section=(ey,title,sub='')=>`<div class="nxp-heading">${eyebrow(ey)}<h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div>`;
const code=v=>`<code>${value(v)}</code>`;
function notice(kind,details){
 const title=kind==='auth'?'Vincula tu dispositivo':'Datos temporalmente inaccesibles';
 const why=kind==='auth'?'El panel de gestión necesita una sesión de este dispositivo, autorizada por el servidor.':
 'No se han podido verificar los datos del backend. Se mantiene el estado sin inventar cifras ni operaciones.';
 return `<section class="nxp-connect" role="status"><div class="nxp-connect-icon">${ico('shield')}</div><div class="nxp-connect-main">
   ${eyebrow('Conexión privada')}<h3>${title}</h3><p>${why}</p>
   ${details?`<p class="nxp-connect-detail">${esc(details)}</p>`:''}
   <div class="nxp-actions"><button data-app="pair-device" class="nxp-primary">Vincular NEXA</button>
     <button data-app="settings-api" class="nxp-secondary">Servidor seguro</button></div>
 </div></section>`;
}
function offline(ctx,topic){return notice(ctx.authenticated?'api':'auth',topic);}
function noDataFrame(title,more=''){
 return `<div class="nxp-emptychart"><div class="nxp-graphline" aria-hidden="true">
  <span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
  <div class="nxp-emptychart-label">${ico('chart')}<b>${esc(title)}</b><small>${esc(more||'La gráfica aparecerá cuando lleguen datos verificables.')}</small></div>
  </div>`;
}
const getTicker=(m,pair)=>m.tickers?.[pair]||(m.pair===pair?m:{});
const getInd=(m,pair)=>m.indicators?.[pair]||(m.pair===pair?m.indicators:{})||{};
function getCandles(m,pair){
 const rawCandles=Array.isArray(m.candles)?(m.pair===pair?m.candles:[]):m.candles?.[pair];
 if(!Array.isArray(rawCandles))return [];
 return rawCandles.map(c=>({t:first(c,'t','ts','time','timestamp'),o:first(c,'o','open'),h:first(c,'h','high'),l:first(c,'l','low'),c:first(c,'c','close'),v:first(c,'v','volume')}))
 .filter(c=>[c.o,c.h,c.l,c.c].every(num)&&c.h>=c.l).slice(-100);
}
function candleSurface(ctx,{pair='BTC/USD',title='Mercado',compact=false,levels=[]}={}){
 const m=raw(ctx,'market');const ready=goodCommon(ctx,'market');
 const candles=getCandles(m,pair);
 return `<section class="nxp-chartbox ${compact?'nxp-chart-compact':''}">
   <div class="nxp-charthead"><div>${eyebrow(title)}<strong>${esc(pair)}</strong></div>
     <span class="nxp-timeframe" title="Temporalidad disponible del contrato">15m</span></div>
   ${ready&&candles.length>1?`<div class="nxp-chartcanvas">${ohlcvChart(candles,{height:compact?240:315,levels:levels.filter(x=>num(x.price)),label:pair+' · velas OHLCV'})}</div>`:
      noDataFrame(ready?'Sin velas válidas':'Esperando el mercado','Sin datos OHLCV válidos de este par. No se dibujan curvas ficticias.')}
   <div class="nxp-chartfoot">${ready?`Origen: ${esc(m.provider||m.source||'API')} · ${m.ts?esc(fmtAge(m.ts)):'hora no verificada'}`:
     'Precio y velas pendientes de autenticación y fuente'}</div>
 </section>`;
}
function engineMode(ctx,id){
 const entry=ctx.enginesData?.[id];
 const s=entry?.data?.status||{};
 const name=goodEngine(ctx,id)?first(s,'mode','executionMode'):null;
 return name==null?chip('Estado no verificado','muted'):modeBadge(name);
}
function engineCard(ctx,e){
 const good=goodEngine(ctx,e.id),d=good?ctx.enginesData[e.id].data:{};
 const sums=raw(ctx,'portfolio').summary||{},row=(sums.byEngine||[]).find(x=>x.engine===e.id)||{};
 const result=good&&goodCommon(ctx,'portfolio')?first(row,'pnlUsd','realizedPnlUsd'):null;
 return `<button class="nxp-engine-row" data-nav="engine:${esc(e.id)}">
 <span class="nxp-engine-glyph ${esc(e.id)}">${ico(e.id==='grid'?'grid':e.id==='ama'?'shield':'chart')}</span>
 <span class="nxp-engine-info"><b>${esc(NAMES[e.id]||e.name)}</b><small>${esc(DESCS[e.id]||e.desc||'')}</small></span>
 <span class="nxp-engine-balance ${moneyClass(result)}"><b>${pnl(result)}</b><small>${good?value(first(d.status,'mode','state')):(ctx.authenticated?'Sin datos':'Sin vincular')}</small></span>
 <span class="nxp-row-arrow">›</span></button>`;
}
function portfolioSummary(ctx){
 const s=raw(ctx,'portfolio').summary||{};
 return {s,connected:goodCommon(ctx,'portfolio')&&(num(s.navUsd)||num(s.exposureUsd))};
}
function basicHome(ctx){
 const {s,connected}=portfolioSummary(ctx);
 const rows=(ctx.engineList||[]).map(e=>engineCard(ctx,e)).join('');
 return wrap(`<div class="nxp-basic-home">
   <div class="nxp-home-greeting">${eyebrow('NEXA · Inicio')}<span>${connected?chip('Datos verificados','good'):chip('Sin vincular','warn')}</span></div>
   <section class="nxp-basic-balance"><span>${connected?'Mi patrimonio':'Tu centro de control'}</span>
    <h1>${connected?money(s.navUsd):'Un vistazo a todo tu bot.'}</h1>
    <p>${connected?'Tu actividad consolidada, sin mezclar reservas con resultados.':'Cuatro estrategias, una cartera y un acceso protegido.'}</p>
    ${connected?`<div class="nxp-pnl-pair">${block('PnL realizado',pnl(s.realizedPnlUsd),moneyClass(s.realizedPnlUsd))}${block('Sin realizar',pnl(s.unrealizedPnlUsd),moneyClass(s.unrealizedPnlUsd))}</div>`:
      `<div class="nxp-actions"><button class="nxp-primary" data-app="pair-device">Vincular mi bot <b>↗</b></button></div>`}
   </section>
   ${section('Tus estrategias','Motores automáticos')}
   <div class="nxp-engine-list">${rows}</div>
   <div class="nxp-basic-shortcuts">${link('market','Ver mercados')}${link('activity','Actividad reciente')}</div>
   ${connected?`<div class="nxp-inline-note">${block('Exposición',money(s.exposureUsd))}${link('portfolio','Detalle de la cartera')}</div>`:''}
 </div>`,'nxp-mode-basic');
}
function proHome(ctx){
 const {s,connected}=portfolioSummary(ctx);
 const market=raw(ctx,'market'),ticker=getTicker(market,ctx.ui?.marketPair||'BTC/USD');
 const events=raw(ctx,'activity').events||[];
 return wrap(`<div class="nxp-pro-home">
   <div class="nxp-terminal-title"><div>${eyebrow('NEXA / TERMINAL')}<h1>Centro de operaciones</h1></div>
      ${connected?chip('Cartera conectada','good'):chip('Datos sin verificar','warn')}</div>
   <div class="nxp-command-strip">
    ${block('Patrimonio',connected?money(s.navUsd):'—')}
    ${block('PnL realizado',connected?pnl(s.realizedPnlUsd):'—',moneyClass(connected?s.realizedPnlUsd:null))}
    ${block('Exposición',connected?money(s.exposureUsd):'—')}
    ${block('No realizado',connected?pnl(s.unrealizedPnlUsd):'—',moneyClass(connected?s.unrealizedPnlUsd:null))}
   </div>
   <div class="nxp-terminal-grid">
     <div class="nxp-main-column">
       ${candleSurface(ctx,{pair:ctx.ui?.marketPair||'BTC/USD',title:'Mercado · velas verificadas'})}
       <section class="nxp-terminal-panel">
        ${section('OPERATIVA','Motores y estrategias')}
        <div class="nxp-engine-list">${(ctx.engineList||[]).map(e=>engineCard(ctx,e)).join('')}</div>
       </section>
     </div>
     <aside class="nxp-side-column">
       <section class="nxp-terminal-panel">${section('CONTROL','Riesgo y protección')}
        <div class="nxp-vertical-stats">
         ${block('Exposición total',connected?money(s.exposureUsd):'—')}
         ${block('HOLD separado',connected?money(s.holdUsd):'—')}
         ${block('Estado de sesión',ctx.authenticated?'Autorizada':'Sin vincular')}
        </div>
        ${!ctx.authenticated?`<button class="nxp-primary nxp-full" data-app="pair-device">Vincular dispositivo</button>`:''}
       </section>
       <section class="nxp-terminal-panel">${section('EVENTOS','Actividad del bot')}
        ${ctx.authenticated&&Array.isArray(events)&&events.length?eventList(events,5):
          `<p class="nxp-panel-empty">Aún no hay eventos verificados de la API.</p>`}
        ${link('activity','Ver monitor completo')}
       </section>
       <section class="nxp-terminal-panel">${section('ACCESO','Herramientas')}
        <div class="nxp-tool-list">${link('portfolio','Balances y exposición')}${link('fisco','FISCO / AEAT')}${link('settings','Ajustes del sistema')}</div>
       </section>
     </aside>
   </div>
 </div>`,'nxp-mode-pro');
}
export function renderHomePremium(ctx){return ctx.mode==='basic'?basicHome(ctx):proHome(ctx);}

function marketPairBar(ctx){
 const pairs=['BTC/USD','ETH/USD'];
 return `<div class="nxp-pairbar" role="group" aria-label="Elegir mercado">${pairs.map(p=>`<button data-ui="marketPair:${p}" class="${(ctx.ui?.marketPair||'BTC/USD')===p?'is-active':''}" aria-pressed="${(ctx.ui?.marketPair||'BTC/USD')===p}">${p}</button>`).join('')}</div>`;
}
function indicatorRows(ind){
 const rows=[
 ['Tendencia',[['EMA 20',money(ind.ema?.ema20)],['EMA 50',money(ind.ema?.ema50)],['EMA 200',money(ind.ema?.ema200)],['ADX',num(ind.adx)?fmtNum(ind.adx,{dec:1}):'—']]],
 ['Momentum',[['RSI 14',num(ind.rsi)?fmtNum(ind.rsi,{dec:1}):'—'],['MACD',num(ind.macd?.macd)?fmtNum(ind.macd.macd):'—'],['Señal',num(ind.macd?.signal)?fmtNum(ind.macd.signal):'—'],['Histograma',num(ind.macd?.histogram)?fmtNum(ind.macd.histogram):'—']]],
 ['Volatilidad',[['ATR',num(ind.atr)?fmtNum(ind.atr):'—'],['ATRP',pct(ind.atrpPct)],['Bollinger superior',money(ind.bollinger?.upper)],['Bollinger inferior',money(ind.bollinger?.lower)]]],
 ['Volumen',[['Último volumen',num(ind.volume?.last)?fmtNum(ind.volume.last):'—'],['Volumen medio',num(ind.volume?.avg24)?fmtNum(ind.volume.avg24):'—'],['Momentum 4h',pct(ind.momentum?.pct4h)],['Momentum 24h',pct(ind.momentum?.pct24h)]]]
 ];
 return rows.map(([name,items],i)=>`<details class="nxp-ind-group" ${i===0?'open':''}><summary>${esc(name)}<span>⌄</span></summary><div class="nxp-ind-grid">
   ${items.map(([k,v])=>block(k,v)).join('')}</div></details>`).join('');
}
function basicMarket(ctx){
 const pair=ctx.ui?.marketPair||'BTC/USD',m=raw(ctx,'market'),t=getTicker(m,pair);
 const active=goodCommon(ctx,'market')&&(num(t.price)||getCandles(m,pair).length>1);
 return wrap(`${section('COTIZACIONES','Mercado')}
   ${marketPairBar(ctx)}
   <div class="nxp-market-price"><span>${esc(pair)}</span><h1>${active?money(t.price):'—'}
   ${num(t.change24hPct)?`<small class="${moneyClass(t.change24hPct)}">${pct(t.change24hPct)}</small>`:''}</h1></div>
   ${candleSurface(ctx,{pair,title:'Evolución · 15m',compact:true})}
   ${active?`<div class="nxp-basic-market-indicators">
    ${block('RSI (14)',num(getInd(m,pair).rsi)?fmtNum(getInd(m,pair).rsi,{dec:1}):'—')}
    ${block('ADX',num(getInd(m,pair).adx)?fmtNum(getInd(m,pair).adx,{dec:1}):'—')}
    ${block('Spread',money(t.spread))}
   </div>`:offline(ctx,'Consulta mercado BTC/ETH, velas e indicadores')}
   ${link('engines','Ver estrategias vinculadas')}
 </div>`,'nxp-mode-basic nxp-market');
}
function proMarket(ctx){
 const pair=ctx.ui?.marketPair||'BTC/USD',m=raw(ctx,'market'),t=getTicker(m,pair),ind=getInd(m,pair);
 const active=goodCommon(ctx,'market');
 return wrap(`<div class="nxp-terminal-title"><div>${eyebrow('TRADING · ANÁLISIS')}<h1>Mercados</h1></div>${chip(active?'API conectada':'API pendiente',active?'good':'warn')}</div>
  ${marketPairBar(ctx)}
  <div class="nxp-market-terminal">
   <div class="nxp-main-column">
    <div class="nxp-quote"><div>${eyebrow(pair+' · PRECIO')}<strong>${active?money(t.price):'—'}</strong></div>
    ${block('24h',active?pct(t.change24hPct):'—',moneyClass(active?t.change24hPct:null))}</div>
    ${candleSurface(ctx,{pair,title:'OHLCV · Velas 15m'})}
    <div class="nxp-terminal-panel">${section('ANÁLISIS','Indicadores técnicos')}
      ${active?indicatorRows(ind):`<p class="nxp-panel-empty">Los indicadores están preparados para datos reales del proveedor, sin valores de relleno.</p>`}
    </div>
   </div>
   <aside class="nxp-side-column">
    <section class="nxp-terminal-panel">${section('LIBRO DE PRECIO','Bid / Ask / Spread')}
      <div class="nxp-vertical-stats">${block('Mejor BID',active?money(t.bid):'—')}
      ${block('Mejor ASK',active?money(t.ask):'—')}${block('Spread',active?money(t.spread):'—')}</div>
    </section>
    <section class="nxp-terminal-panel">${section('DATOS','Origen y frescura')}
      ${block('Proveedor',active?value(m.provider||m.source):'—')}
      ${block('Última lectura',active&&m.ts?esc(fmtAge(m.ts)):'—')}
      ${block('Régimen',active?value(ind.regime):'—')}
    </section>
    ${!active?offline(ctx,'Precios, velas, indicadores y fuentes'):''}
    <section class="nxp-terminal-panel">${section('CONTEXTO','Aplicación automática')}
      <p class="nxp-panel-empty">Los botones de este panel no lanzan compras ni ventas. Cada motor decide según sus propias reglas.</p>
      ${link('engines','Ver decisiones de motores')}
    </section>
   </aside>
  </div>
 </div>`,'nxp-mode-pro nxp-market');
}
export function renderMarketPremium(ctx){return ctx.mode==='basic'?basicMarket(ctx):proMarket(ctx);}

function engineHeader(ctx,id){
 return `<div class="nxp-engine-head">
  <div class="nxp-engine-identity">${eyebrow('NEXA / ESTRATEGIA')}<h1>${esc(NAMES[id]||id)}</h1>
  <p>${esc(DESCS[id]||'Motor automático')}</p></div>
  ${engineMode(ctx,id)}
 </div>`;
}
function engineNav(ctx,mini=false){
 const tabs=ctx.subtabs||[];
 return `<nav class="nxp-engine-tabs ${mini?'nxp-mini-tabs':''}" aria-label="Secciones del motor">
  ${tabs.map(t=>`<button type="button" data-ui="subtab:${esc(t.id)}" aria-current="${t.id===ctx.ui?.subtab?'page':'false'}"
    class="${t.id===(ctx.ui?.subtab||'panel')?'is-active':''}">${esc(t.label)}</button>`).join('')}</nav>`;
}
function detailLink(ctx,sub,label){
 return `<button data-ui="subtab:${esc(sub)}" class="nxp-detail-link">${esc(label)}<span>↗</span></button>`;
}
function twoValueGrid(items){
 return `<div class="nxp-keyfigures">${items.map(([k,v])=>block(k,v)).join('')}</div>`;
}
function scoreGauge(label,score,threshold){
 const valid=num(score)&&num(threshold)&&threshold>0;
 const valueP=valid?Math.max(0,Math.min(100,score/threshold*100)):0;
 return `<div class="nxp-gauge"><div class="nxp-gauge-top"><span>${esc(label)}</span>
 <strong>${valid?fmtNum(score,{dec:2})+' / '+fmtNum(threshold,{dec:2}):'—'}</strong></div>
 <div class="nxp-track" role="img" aria-label="${valid?'Progreso real hacia el umbral':'Progreso no disponible'}"><i style="width:${valueP}%"></i></div></div>`;
}
function idcaData(d){
 const s=d.summary||{},st=d.status||{};
 const pairs=d.pairContexts||{};
 const contexts=Object.keys(pairs).length?Object.entries(pairs).map(([pair,x])=>({...x,pair})):
   (st.assetPairs||[]).map(x=>({pair:x.pair,enabled:x.enabled}));
 const cycles=Array.isArray(d.cycles)?d.cycles:[];
 return {s,st,contexts,cycles};
}
function cyclePriceTrack(c){
 const points=[
 ['Ancla',first(c,'cycleAnchorPrice','anchor')],
 ['Compra media',first(c,'avgEntryPrice','avgPrice')],
 ['Actual',first(c,'currentPrice','marketPrice')],
 ['Objetivo TP',first(c,'tpTargetPrice','tpTarget')]
 ].filter(([,v])=>num(v));
 if(points.length<2)return `<p class="nxp-panel-empty">Faltan precios de referencia suficientes para el esquema del ciclo.</p>`;
 const lo=Math.min(...points.map(x=>x[1])),hi=Math.max(...points.map(x=>x[1])),range=hi-lo||1;
 return `<div class="nxp-price-track" role="img" aria-label="Ancla, precio medio, precio actual y objetivo del ciclo">
  <div class="nxp-price-track-axis"></div>
  ${points.map(([label,v])=>`<div class="nxp-track-pin" style="left:${Math.max(5,Math.min(95,5+(v-lo)/range*90))}%" title="${esc(label)}: ${esc(money(v))}">
    <span class="nxp-pin-dot"></span><small>${esc(label)}</small></div>`).join('')}</div>
  <div class="nxp-track-legend">${points.map(([label,v])=>`<span>${esc(label)} <b>${money(v)}</b></span>`).join('')}</div>`;
}
function idcaCycleCards(cycles,limit=3){
 if(!cycles.length)return `<p class="nxp-panel-empty">Sin información verificada de ciclos abiertos.</p>`;
 return cycles.slice(0,limit).map(c=>{
  const cp=first(c,'unrealizedPnlUsd','pnlUsd','pnlNet');
  return `<article class="nxp-cycle-card"><div class="nxp-cycle-top"><div><b>${esc(c.pair||'Par sin identificar')}</b><small>${value(c.id)}</small></div>
   <strong class="${moneyClass(cp)}">${pnl(cp)}</strong></div>
   ${cyclePriceTrack(c)}
   <div class="nxp-cycle-bottom">
    ${block('Compras',value(first(c,'buyCount','buys')))}
    ${block('Capital',money(first(c,'capitalUsedUsd','capitalUsed')))}
    ${block('Trailing',c.trailing?.enabled===true?'Activo':c.trailing?.enabled===false?'Inactivo':'—')}
   </div></article>`;
 }).join('');
}
function eventList(events,limit=6){
 if(!Array.isArray(events)||!events.length)return `<p class="nxp-panel-empty">Sin eventos confirmados por la API.</p>`;
 return `<div class="nxp-event-list">${events.slice(0,limit).map(e=>`<div class="nxp-event">
  <span class="nxp-event-mark ${e.severity==='err'?'danger':e.severity==='warn'?'warning':''}"></span>
  <div><strong>${value(e.type||e.engine||'Evento')}</strong><p>${value(e.message||e.msg)}</p></div>
  <small>${e.ts?esc(fmtTs(e.ts)):'—'}</small>
 </div>`).join('')}</div>`;
}
function idcaPanel(d,mode){
 const {s,contexts,cycles,st}=idcaData(d);
 if(mode==='basic')return `<div class="nxp-strategy-simple">
  ${twoValueGrid([['Ciclos activos',value(first(s,'activeCyclesCount','activeCycles'))],['Capital en ciclos',money(first(s,'capitalUsedUsd','capitalUsed'))],
    ['PnL realizado',pnl(first(s,'realizedPnlUsd','realizedPnl'))],['Disponible',money(first(s,'capitalFreeUsd','capitalFree'))]])}
  <div class="nxp-section-row">${section('EN SEGUIMIENTO','Ciclos de inversión')}</div>
  ${idcaCycleCards(cycles,2)}
 </div>`;
 return `<div class="nxp-pro-workspace">
  <section class="nxp-terminal-panel">${section('ENTRADAS','Lectura por par')}
   <div class="nxp-pair-cards">${contexts.length?contexts.map(x=>`<article class="nxp-pair-card">
    <div><b>${esc(x.pair||'Par')}</b>${chip(x.regime||x.mode||'Estado no verificado')}</div>
    ${scoreGauge('Score de entrada',first(x,'entryScore'),first(x,'entryThreshold'))}
    <div class="nxp-compact-meta">${meta('Precio',money(x.currentPrice))}${meta('Caída',pct(x.dipDetectedPct))}
    ${meta('ATR',num(x.atr)?fmtNum(x.atr):'—')}${meta('Rebote',value(x.reboundSignal))}</div></article>`).join(''):
    `<p class="nxp-panel-empty">Los contextos por par aún no están incluidos en esta lectura; el motor conservará sus reglas originales.</p>`}</div>
  </section>
  <section class="nxp-terminal-panel">${section('CICLOS','Posiciones y protecciones')}
    ${idcaCycleCards(cycles,3)}
  </section>
  <section class="nxp-terminal-panel">${section('CAPITAL','Presupuesto y resultado')}
   ${twoValueGrid([['Asignado',money(first(s,'allocatedCapitalUsd','capitalAllocated'))],
    ['Usado',money(first(s,'capitalUsedUsd','capitalUsed'))],
    ['Disponible',money(first(s,'capitalFreeUsd','capitalFree'))],
    ['Realizado',pnl(first(s,'realizedPnlUsd','realizedPnl'))],
    ['No realizado',pnl(first(s,'unrealizedPnlUsd','unrealizedPnl'))],
    ['Pausa global',st.globalTradingPause===true?'Activa':st.globalTradingPause===false?'Sin pausa':'—']])}
  </section></div>`;
}
function gridCards(d,mode){
 const st=d.status||{},l=Array.isArray(d.levels)?{levels:d.levels}:d.levels||{},cycles=Array.isArray(d.cycles)?d.cycles:[];
 const levels=Array.isArray(l.levels)?l.levels:[],legacy=Array.isArray(l.previousRanges)?l.previousRanges:[];
 const last=levels.slice().sort((a,b)=>(b.price||0)-(a.price||0)).slice(0,mode==='basic'?5:12);
 const visual=`<div class="nxp-grid-map">
    <div class="nxp-grid-scale"><span>Precio</span><span>Acción / estado</span></div>
    ${last.length?last.map(x=>`<div class="nxp-grid-level ${x.side==='BUY'?'buy':'sell'}">
      <span>${money(x.price)}</span><i></i><strong>${value(x.side)}</strong><small>${value(x.state)}</small></div>`).join(''):
    `<div class="nxp-grid-placeholder">Los niveles aparecerán aquí con sus precios, lados y objetivos reales.</div>`}
   </div>`;
 const blocks=twoValueGrid([['Capital previsto',money(first(st,'capitalBudgetUsd'))],
 ['Capital usado',money(first(st,'capitalUsedUsd'))],['Ciclos',num(st.activeCyclesCount)?st.activeCyclesCount:cycles.length],
 ['Maker-only',st.makerOnly===true?'Sí':st.makerOnly===false?'No':'—']]);
 if(mode==='basic')return `${blocks}${visual}`;
 const open=cycles.filter(c=>c.status!=='closed');
 return `<div class="nxp-pro-workspace"><section class="nxp-terminal-panel">
  ${section('MALLA DE PRECIOS','Rango actual y niveles')}${visual}</section>
  <section class="nxp-terminal-panel">${section('POLÍTICA Y CAPITAL','BUY → SELL · 1:1')}${blocks}
   <p class="nxp-safety-note">Los SELL de rangos anteriores se mantienen separados de entradas nuevas y de HOLD.</p></section>
  <section class="nxp-terminal-panel">${section('CICLOS','En seguimiento')}
   <div class="nxp-grid-cycles">${open.slice(0,8).map(c=>`<div class="nxp-grid-cycle">
     <span>${value(c.id)}</span><b>${money(first(c,'buyPrice'))} <i>→</i> ${money(first(c,'sellTargetPrice','sellTarget'))}</b>
     <small>${value(c.status)} · ${value(first(c,'rangeVersionId','rangeVersion'))}</small></div>`).join('')||`<p class="nxp-panel-empty">No hay ciclos verificados en la respuesta.</p>`}</div>
   <div class="nxp-inline">Rangos anteriores con SELL: <b>${legacy.length||'0'}</b></div></section></div>`;
}
function spotCards(d,mode){
 const st=d.status||{},positions=Array.isArray(d.positions)?d.positions:[],signals=Array.isArray(d.signals)?d.signals:[];
 const dmode=first(st,'mode','executionMode');
 const dd=st.configEffective?.dryRunMode;
 const strategy=value(st.strategy||d.config?.activeStrategy);
 const body=`<div class="nxp-positions">${positions.slice(0,mode==='basic'?3:6).map(p=>`<article class="nxp-position">
  <div class="nxp-position-head"><b>${value(p.pair)}</b><strong class="${moneyClass(p.pnlUsd)}">${pnl(p.pnlUsd)}</strong></div>
  ${twoValueGrid([['Entrada media',money(first(p,'avgPrice'))],['Actual',money(p.currentPrice)],
  ['Cantidad',num(p.quantity)?fmtNum(p.quantity,{dec:6}):'—'],['Protecciones',Array.isArray(p.protections)?p.protections.length:'—']])}
 </article>`).join('')||`<p class="nxp-panel-empty">No hay posiciones incluidas en esta respuesta.</p>`}</div>`;
 if(mode==='basic')return `<div class="nxp-strategy-simple">
 ${twoValueGrid([['Modo',value(dmode)],['Estrategia',strategy],['Posiciones',positions.length],['Fuente',value(st.dataExchange)]])}
 ${section('CARTERA','Posiciones vigiladas')}${body}</div>`;
 return `<div class="nxp-pro-workspace">
 <section class="nxp-terminal-panel">${section('SEÑALES','Análisis por par')}
   ${signals.length?signals.slice(0,8).map(s=>`<div class="nxp-signal">
     <div><b>${value(s.pair)}</b>${chip(s.entryState||s.setup||'Evaluación')}</div>
     ${scoreGauge('Score de la señal',s.score,first(s,'threshold','entryThreshold'))}
     <small>${value(s.reason||s.regime)}</small></div>`).join(''):`<p class="nxp-panel-empty">El proveedor no ha remitido señales de entrada verificables.</p>`}
 </section>
 <section class="nxp-terminal-panel">${section('POSICIONES','Exposición y salidas')}${body}</section>
 <section class="nxp-terminal-panel">${section('CONFIGURACIÓN EFECTIVA','Estrategia y seguridad')}
 ${twoValueGrid([['Modo',value(dmode)],['Estrategia',strategy],['Venue',value(st.venue)],
 ['Fuente de datos',value(st.dataExchange)],['dryRun efectivo',typeof dd==='boolean'?(dd?'Sí':'No'):'—'],
 ['Último tick',st.lastTickAt?esc(fmtAge(st.lastTickAt)):'—']])}
 </section></div>`;
}
function amaCards(d,mode){
 const st=d.status||{},read=d.readiness||{},mand=d.mandate||{},port=d.portfolio||{};
 const ratio=num(read.readyCount)&&num(read.totalCount)&&read.totalCount>0?Math.max(0,Math.min(100,read.readyCount/read.totalCount*100)):null;
 const ready=`<div class="nxp-readiness"><div class="nxp-readiness-title">
 <span>Readiness</span><b>${num(read.readyCount)?read.readyCount:'—'} / ${num(read.totalCount)?read.totalCount:'—'}</b></div>
 <div class="nxp-track"><i style="width:${ratio??0}%"></i></div></div>`;
 const budget=twoValueGrid([['Presupuesto',money(port.budgetUsd)],['Reservado',money(port.reservedUsd)],
 ['Libre',money(port.freeUsd)],['Exposición',money(port.exposureUsd)]]);
 if(mode==='basic')return `${budget}${ready}<p class="nxp-safety-note">Reservado no significa enviado ni ejecutado.</p>`;
 return `<div class="nxp-pro-workspace">
   <section class="nxp-terminal-panel">${section('SEGURIDAD','Disponibilidad de estrategia')}${ready}
     <div class="nxp-blocker-list">${(read.blockers||[]).slice(0,5).map(b=>`<span>${ico('shield')}${esc(String(b))}</span>`).join('')||`<span>Sin lista de bloqueos verificada.</span>`}</div>
   </section>
   <section class="nxp-terminal-panel">${section('MANDATO','Criterio macro')}
      ${twoValueGrid([['Mandato',value(mand.id)],['Estado',value(mand.status)],
        ['Score macro',num(mand.scoring?.macroScore)?fmtNum(mand.scoring.macroScore):'—'],
        ['Régimen',value(mand.macroContext?.regime)]])}
      <p class="nxp-panel-empty">${value(mand.explanation)}</p>
   </section>
   <section class="nxp-terminal-panel">${section('CUSTODIA','Capital y trazabilidad')}${budget}
     <p class="nxp-safety-note">Reserva ≠ orden enviada ≠ ejecutada ≠ filled. El estado REAL necesita una autorización independiente.</p>
   </section>
 </div>`;
}
function mainEngineContent(ctx,id,d,mode){
 if(id==='idca')return idcaPanel(d,mode);
 if(id==='grid')return gridCards(d,mode);
 if(id==='spot')return spotCards(d,mode);
 if(id==='ama')return amaCards(d,mode);
 return '';
}
function engineSummary(ctx,id,d){
 const st=d.status||{},s=d.summary||{};
 const obj={
 idca:[['PnL',pnl(first(s,'realizedPnlUsd','realizedPnl'))],
 ['Ciclos',value(first(s,'activeCyclesCount','activeCycles'))],
 ['Capital',money(first(s,'capitalUsedUsd','capitalUsed'))]],
 grid:[['Capital',money(first(st,'capitalUsedUsd'))],['Ciclos',num(st.activeCyclesCount)?st.activeCyclesCount:Array.isArray(d.cycles)?d.cycles.length:'—'],['Par',value(st.pair)]],
 spot:[['Posiciones',Array.isArray(d.positions)?d.positions.length:'—'],['Estrategia',value(st.strategy)],['Fuente',value(st.dataExchange)]],
 ama:[['Presupuesto',money(d.portfolio?.budgetUsd)],['Reservado',money(d.portfolio?.reservedUsd)],['Mandato',value(d.mandate?.status)]]
 }[id]||[];
 return `<div class="nxp-engine-kpis">${obj.map(([a,b])=>block(a,b)).join('')}</div>`;
}
function basicEngine(ctx,id,d){
 const sub=ctx.ui?.subtab||'panel',other=sub!=='panel';
 return wrap(`${engineHeader(ctx,id)}
  ${other?`<div class="nxp-simple-details">${detailLink(ctx,'panel','Volver al resumen')}
    ${ctx.renderEngineSub(id,sub)}</div>`:
  `<section class="nxp-simple-card"><div class="nxp-simple-title">${eyebrow('ESTADO DE MOTOR')}<span>${engineMode(ctx,id)}</span></div>
   ${engineSummary(ctx,id,d)}${mainEngineContent(ctx,id,d,'basic')}
   <div class="nxp-basic-action">${(ctx.subtabs||[]).filter(t=>t.id!=='panel').slice(0,3).map(t=>detailLink(ctx,t.id,t.label)).join('')}</div>
   <details class="nxp-audit"><summary>Todos los datos del motor <span>⌄</span></summary>${ctx.renderEngineSub(id,'panel')}</details>
  </section>`}
 </div>`,'nxp-mode-basic nxp-engine');
}
function proEngine(ctx,id,d){
 const sub=ctx.ui?.subtab||'panel',panel=sub==='panel';
 return wrap(`<div class="nxp-terminal-title">${engineHeader(ctx,id)}
 <span class="nxp-header-source">Motor · API</span></div>
 ${engineNav(ctx)}
 ${panel?
  `<div class="nxp-engine-layout"><div class="nxp-main-column">
  ${id!=='ama'?candleSurface(ctx,{pair:ctx.ui?.marketPair||'BTC/USD',title:'Mercado y contexto del motor'}):''}
  ${mainEngineContent(ctx,id,d,'pro')}
  </div><aside class="nxp-side-column">
  <section class="nxp-terminal-panel">${section('CONTROL','Estado y exposición')}
    ${engineSummary(ctx,id,d)}</section>
  <section class="nxp-terminal-panel">${section('NAVEGACIÓN','Gestionar motor')}
  <div class="nxp-tool-list">${(ctx.subtabs||[]).filter(t=>t.id!=='panel').map(t=>detailLink(ctx,t.id,t.label)).join('')}</div></section>
  <section class="nxp-terminal-panel">${section('EVIDENCIA','Valores íntegros')}
    <p class="nxp-panel-empty">Conserva histórico, parámetros, operaciones y controles originales. Las acciones de gestión requieren permiso y confirmación.</p>
  </section></aside></div>
  <details class="nxp-audit"><summary>Auditoría integral y controles originales <span>⌄</span></summary>
   ${ctx.renderEngineSub(id,'panel')}</details>`:
  `<section class="nxp-detailed-page">${section('DATOS COMPLETOS',(ctx.subtabs||[]).find(x=>x.id===sub)?.label||sub)}
   ${(id==='idca'&&sub==='cycles')?idcaCycleCards(idcaData(d).cycles,30):
      (id==='grid'&&sub==='levels')?gridCards(d,'pro'):
      (id==='spot'&&sub==='positions')?spotCards(d,'pro'):
      (id==='ama'&&sub==='readiness')?amaCards(d,'pro'):''}
   <div class="nxp-detailed-legacy">${ctx.renderEngineSub(id,sub)}</div></section>`}
 </div>`,'nxp-mode-pro nxp-engine');
}
export function renderEnginePremium(ctx){
 const id=ctx.ui?.engineId||'idca';
 const entry=ctx.enginesData?.[id],ready=goodEngine(ctx,id),d=entry?.data||{};
 if(!ready){
  const head=engineHeader(ctx,id);
  if(ctx.mode==='basic')return wrap(`${head}<div class="nxp-basic-engine-unlinked">
    <div class="nxp-unlinked-symbol">${ico(id==='grid'?'grid':'chart')}</div>
    <h2>${ctx.authenticated?'Sin datos verificados del motor':'Este motor aún no está vinculado'}</h2><p>${ctx.authenticated?'El servidor no ha devuelto un estado válido. No se interpreta como apagado, sin ciclos ni LIVE.':'Los ciclos, resultados y el estado real aparecerán tras autorizar el dispositivo. No se considera detenido ni vacío.'}</p>
    <button class="nxp-primary" data-app="${ctx.authenticated?'refresh':'pair-device'}">${ctx.authenticated?'Reintentar lectura':'Vincular dispositivo'}</button></div>`,'nxp-mode-basic nxp-engine');
  return wrap(`${head}${engineNav(ctx)}
   <div class="nxp-engine-layout"><div class="nxp-main-column">
     ${candleSurface(ctx,{title:'Mercado del motor'})}
     <section class="nxp-terminal-panel">${section('ESTADO','Sin lectura verificada')}
        <div class="nxp-keyfigures">${block('Modo','—')}${block('Posiciones / ciclos','—')}${block('Último tick','—')}</div>
     </section>
   </div><aside class="nxp-side-column">${offline(ctx,'todos los datos y acciones de '+(NAMES[id]||id))}
     <section class="nxp-terminal-panel">${section('ESTRUCTURA PROFESIONAL','Secciones disponibles')}
        <div class="nxp-tool-list">${(ctx.subtabs||[]).map(t=>detailLink(ctx,t.id,t.label)).join('')}</div>
     </section></aside></div>`,'nxp-mode-pro nxp-engine');
 }
 return ctx.mode==='basic'?basicEngine(ctx,id,d):proEngine(ctx,id,d);
}
function allocationBars(rows,nameKey='asset'){
 if(!Array.isArray(rows)||!rows.length)return `<p class="nxp-panel-empty">No hay desglose disponible en esta lectura.</p>`;
 const sorted=rows.filter(x=>num(x.valueUsd??x.exposureUsd)).sort((a,b)=>(b.valueUsd??b.exposureUsd)-(a.valueUsd??a.exposureUsd)).slice(0,9);
 const sum=sorted.reduce((t,x)=>t+Math.max(0,x.valueUsd??x.exposureUsd),0);
 return `<div class="nxp-allocation">${sorted.map(x=>{
  const val=x.valueUsd??x.exposureUsd;
  const ratio=sum>0?Math.max(0,Math.min(100,val/sum*100)):0;
  return `<div class="nxp-alloc-row"><div><b>${value(x[nameKey]||x.engine||x.asset)}</b><span>${money(val)}</span></div>
  <div class="nxp-track"><i style="width:${ratio}%"></i></div></div>`;}).join('')}</div>`;
}
function basicPortfolio(ctx){
 const s=raw(ctx,'portfolio').summary||{},ready=goodCommon(ctx,'portfolio');
 const byAsset=s.byAsset||raw(ctx,'portfolio').holdings||[];
 return wrap(`${section('PATRIMONIO','Mi cartera')}
  ${ready?`<section class="nxp-basic-balance"><span>Valor total</span><h1>${money(s.navUsd)}</h1>
    <div class="nxp-pnl-pair">${block('PnL realizado',pnl(s.realizedPnlUsd),moneyClass(s.realizedPnlUsd))}
      ${block('Sin realizar',pnl(s.unrealizedPnlUsd),moneyClass(s.unrealizedPnlUsd))}</div></section>
    ${section('DISTRIBUCIÓN','Mis activos')}${allocationBars(byAsset)}
    <div class="nxp-basic-shortcuts">${link('engines','Motores')}${link('fisco','Fiscalidad')}</div>`:
      offline(ctx,'tu cartera, resultados y exposición')}
 </div>`,'nxp-mode-basic nxp-portfolio');
}
function proPortfolio(ctx){
 const s=raw(ctx,'portfolio').summary||{},ready=goodCommon(ctx,'portfolio');
 return wrap(`<div class="nxp-terminal-title">${section('CAPITAL Y EXPOSICIÓN','Análisis de cartera')}
  ${chip(ready?'Balance verificado':'Balance no verificado',ready?'good':'warn')}</div>
  <div class="nxp-command-strip">${block('NAV',ready?money(s.navUsd):'—')}
   ${block('Realizado',ready?pnl(s.realizedPnlUsd):'—',moneyClass(ready?s.realizedPnlUsd:null))}
   ${block('No realizado',ready?pnl(s.unrealizedPnlUsd):'—',moneyClass(ready?s.unrealizedPnlUsd:null))}
   ${block('Exposición',ready?money(s.exposureUsd):'—')}</div>
  ${ready?`<div class="nxp-terminal-grid"><div class="nxp-main-column">
    <section class="nxp-terminal-panel">${section('ESTRUCTURA','Distribución por activos')}${allocationBars(s.byAsset||raw(ctx,'portfolio').holdings)}</section>
    <section class="nxp-terminal-panel">${section('ESTRUCTURA','Exposición por motor')}${allocationBars(s.byEngine,'engine')}</section>
  </div><aside class="nxp-side-column">
    <section class="nxp-terminal-panel">${section('RIESGO','Reservas y HOLD')}
      ${block('HOLD separado',money(s.holdUsd))}<p class="nxp-safety-note">El patrimonio, las reservas y la fiscalidad mantienen contabilidad separada.</p></section>
    <section class="nxp-terminal-panel">${section('OPERATIVA','Accesos rápidos')}
    <div class="nxp-tool-list">${link('engines','Motores')}${link('fisco','FISCO / AEAT')}${link('activity','Eventos y alertas')}</div></section>
  </aside></div>
  <details class="nxp-audit"><summary>Balances, reservas e históricos íntegros <span>⌄</span></summary>
   ${ctx.renderPortfolioLegacy?ctx.renderPortfolioLegacy(ctx):''}</details>`:
   `<div class="nxp-terminal-grid"><div class="nxp-main-column">${noDataFrame('Patrimonio pendiente de conexión')}</div>
      <aside class="nxp-side-column">${offline(ctx,'balances, posiciones y resultados')}</aside></div>`}
 </div>`,'nxp-mode-pro nxp-portfolio');
}
export function renderPortfolioPremium(ctx,legacy){
 return ctx.mode==='basic'?basicPortfolio(ctx):proPortfolio({...ctx,renderPortfolioLegacy:legacy});
}
export function renderActivityPremium(ctx,legacy){
 const events=raw(ctx,'activity').events||[],ready=goodCommon(ctx,'activity');
 if(ctx.mode==='basic')return wrap(`${section('SEGUIMIENTO','Actividad reciente')}
   ${ready?eventList(events,12):offline(ctx,'actividad y alertas del bot')}
   ${link('engines','Ver motores')}</div>`,'nxp-mode-basic nxp-activity');
 return wrap(`<div class="nxp-terminal-title">${section('MONITORIZACIÓN','Registro de actividad')}
   ${chip(ready?'Fuente conectada':'Pendiente',ready?'good':'warn')}</div>
   <div class="nxp-terminal-grid"><div class="nxp-main-column"><section class="nxp-terminal-panel">
     ${section('EVENTOS','Últimas decisiones')}${ready?eventList(events,40):offline(ctx,'logs, estados y alertas')}
    </section></div><aside class="nxp-side-column"><section class="nxp-terminal-panel">
       ${section('FILTROS','Monitor avanzado')}<p class="nxp-panel-empty">Los filtros completos de severidad y motor están disponibles aquí.</p>
       <div class="nxp-tool-list">${link('engines','Motores')}${link('settings','Ajustes')}</div>
    </section></aside></div>
   ${ready?`<details class="nxp-audit"><summary>Eventos con filtros y detalles de auditoría <span>⌄</span></summary>${legacy(ctx)}</details>`:''}
 </div>`,'nxp-mode-pro nxp-activity');
}


// ----- FISCO & security/settings — same design system, no invented tax numbers -----
export function renderFiscoPremium(ctx,legacy){
 const ready=goodCommon(ctx,'fisco');
 const f=raw(ctx,'fisco'),s=f.summary||{};
 const header=section('FISCALIDAD PRIVADA','FISCO / AEAT','Información fiscal con permisos independientes.');
 if(!ready){
  return wrap(`${header}<div class="nxp-privacy-head">${ico('shield')}
    <div><h3>Tus datos fiscales permanecen protegidos</h3><p>Solo se mostrarán tras autorizar el dispositivo y obtener el permiso fiscal correspondiente. No se generan cálculos fiscales de ejemplo.</p>
      <button data-app="pair-device" class="nxp-primary">Vincular acceso</button></div></div>
    <div class="nxp-privacy-steps">${meta('1 · Identidad','Dispositivo autorizado')}
      ${meta('2 · Acceso','Permiso FISCO')}${meta('3 · Informes','Datos verificados')}</div>
   </div>`,ctx.mode==='basic'?'nxp-mode-basic nxp-fisco':'nxp-mode-pro nxp-fisco');
 }
 const figures=twoValueGrid([
 ['Ejercicio',value(s.year)],['Lotes',value(s.lotsCount)],
 ['Operaciones',value(s.operationsCount)],['Disposiciones',value(s.disposalsCount)]
 ]);
 if(ctx.mode==='basic')return wrap(`${header}<section class="nxp-simple-card">${figures}
   <div class="nxp-privacy-note">La reserva fiscal no es una comisión.</div>
   ${link('portfolio','Volver a cartera')}</section></div>`,'nxp-mode-basic nxp-fisco');
 return wrap(`${header}<div class="nxp-terminal-grid"><div class="nxp-main-column">
   <section class="nxp-terminal-panel">${section('RESUMEN','Ejercicio y eventos')}${figures}</section>
   <section class="nxp-terminal-panel">${section('INFORMES','Documentación disponible')}
    ${Array.isArray(s.reportsAvailable)&&s.reportsAvailable.length?
      s.reportsAvailable.map(x=>`<div class="nxp-legal-row">${ico('shield')}${value(x)}</div>`).join(''):
      `<p class="nxp-panel-empty">No se han recibido informes disponibles.</p>`}</section>
 </div><aside class="nxp-side-column"><section class="nxp-terminal-panel">
   ${section('CONTROLES','Origen y sincronización')}
   ${block('Exchange',value(s.exchange))}${block('Sincronización',value(s.syncStatus))}
   <p class="nxp-safety-note">Los datos fiscales requieren autorización específica y reconciliación con los registros originales.</p>
 </section></aside></div>
 <details class="nxp-audit"><summary>Desglose fiscal íntegro <span>⌄</span></summary>${legacy(ctx)}</details>
 </div>`,'nxp-mode-pro nxp-fisco');
}
export function renderSettingsPremium(ctx,legacy){
 const header=section('PREFERENCIAS Y SEGURIDAD','Ajustes','Acceso del dispositivo y conexión al bot.');
 const ready=goodCommon(ctx,'settings');
 const shell=`<div class="nxp-settings-grid">
  <section class="nxp-setting-tile"><div class="nxp-setting-symbol">${ico('key')}</div>
    <h3>Dispositivos y acceso</h3><p>Desbloqueo por PIN o biometría. La vinculación con el servidor requiere una credencial segura.</p>
    <button data-app="pair-device" class="nxp-secondary">Vincular dispositivo</button></section>
  <section class="nxp-setting-tile"><div class="nxp-setting-symbol">${ico('shield')}</div>
    <h3>Conexión segura</h3><p>El panel solo utiliza una API autorizada. No se almacenan claves del exchange en la APK.</p>
    <button data-app="settings-api" class="nxp-secondary">Configurar servidor</button></section>
  <section class="nxp-setting-tile"><div class="nxp-setting-symbol">${ico('activity')}</div>
    <h3>Actualización y sesión</h3><p>Puedes volver a obtener los datos o cerrar la sesión del dispositivo.</p>
    <div class="nxp-actions"><button data-app="refresh" class="nxp-secondary">Actualizar</button>
      <button data-app="logout" class="nxp-secondary">Cerrar sesión</button></div></section>
  </div>`;
 return wrap(`${header}${shell}
   ${ctx.mode==='pro'&&ready?`<details class="nxp-audit"><summary>Configuración técnica efectiva <span>⌄</span></summary>${legacy(ctx)}</details>`:''}
   ${ctx.mode==='pro'&&!ready?`<p class="nxp-settings-note">Los parámetros efectivos del bot se mostrarán tras conectar el backend autorizado. Esta pantalla no modifica motores ni configuraciones LIVE por sí sola.</p>`:''}
 </div>`,ctx.mode==='basic'?'nxp-mode-basic nxp-settings':'nxp-mode-pro nxp-settings');
}
