// NEXA PREMIUM UX — rev11. Real data only, two genuinely distinct trees.
// Presentation does not mutate execution mode or submit orders.
// Source of truth: engine status/read-model, never labels inferred from missing values.
import {esc,fmtUsd,signedUsd,signedPct,fmtNum,fmtPct,fmtTs,fmtAge,NA} from './util.js';
import {candleChart,lineChart,modeBadge} from './ui.js';
import {ohlcvChart} from './premium-chart.js';
import {BUILD_INFO} from './build-info.js';
import {valueExchangeBalances} from './portfolio-view.js';
import {translateCode} from './event-labels.js';

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
// change24h sin sufijo % es un cambio ABSOLUTO del precio, no un porcentaje:
// se muestra como Δ en USD y nunca se presenta como variación porcentual.
// Regla honesta: upstream fija change24h:"0.00" hardcodeado, así que un 0 es
// indistinguible de «sin dato». Sin change24hPct numérico y con absoluto 0 o
// ausente → '—' (nunca «Δ +$0,00» como si fuera una lectura real).
const chg24=t=>{
 if(num(t?.change24hPct))return {v:pct(t.change24hPct),cls:moneyClass(t.change24hPct),unreliable:false};
 // num() es predicado booleano: el absoluto se lee del valor crudo.
 const abs=typeof t?.change24h==='number'&&Number.isFinite(t.change24h)?t.change24h:null;
 if(abs!==null&&abs!==0)return {v:'Δ '+signedUsd(abs),cls:'nxp-missing',unreliable:false};
 return {v:'—',cls:'nxp-missing',unreliable:true};
};
// Fecha → epoch ms parseable; null si no lo es (nunca se inventa frescura).
// Acepta ISO, epoch ms, epoch segundos y strings numéricos.
const parseTs=v=>{
 if(v===null||v===undefined||v==='')return null;
 let t=NaN;
 if(typeof v==='number'&&Number.isFinite(v))t=v;
 else if(typeof v==='string'){
  const p=Date.parse(v);
  t=Number.isFinite(p)?p:(v.trim()!==''&&Number.isFinite(Number(v))?Number(v):NaN);
 }
 if(!Number.isFinite(t))return null;
 return Math.abs(t)<1e12?t*1000:t;
};
function marketFresh(m){
 if(!m||typeof m!=='object')return {txt:null,stale:false};
 const ts=parseTs(m.ts)??parseTs(m.timestamp)??parseTs(m.lastCandleTs)??parseTs(m.candleTs)??parseTs(m.priceTs);
 const age=num(m.candleAgeMs)?m.candleAgeMs:null;
 const txt=ts?'Datos de '+fmtAge(ts):age!==null?'Velas de hace '+fmtAge(Date.now()-age):null;
 return {txt,stale:m.candlesStale===true||m.dataState==='stale'};
}
const raw=(ctx,kind)=>ctx.data?.[kind]?.data||{};
// 'stale' = última recarga fallida con datos previos válidos: se muestran con
// su antigüedad (ver data-loader.js), nunca como si fueran lectura nueva.
const goodCommon=(ctx,kind)=>!!ctx.authenticated&&['ok','fresh','partial','stale'].includes(ctx.data?.[kind]?.state);
const goodEngine=(ctx,id)=>!!ctx.authenticated && ['ok','fresh','partial','stale'].includes(ctx.enginesData?.[id]?.state);
const wrap=(s,cls='')=>`<div class="nxp ${cls}">${s}</div>`;
const chip=(label,cls='')=>`<span class="nxp-chip ${cls}">${esc(label)}</span>`;
const eyebrow=t=>`<span class="nxp-eyebrow">${esc(t)}</span>`;
const meta=(label,val)=>`<div class="nxp-meta"><span>${esc(label)}</span><strong>${val}</strong></div>`;
const block=(label,v,cls='')=>`<div class="nxp-figure ${cls}"><span>${esc(label)}</span><b>${v}</b></div>`;
const link=(target,label,cls='')=>`<button class="nxp-navlink ${cls}" data-nav="${esc(target)}">${esc(label)}<span aria-hidden="true">↗</span></button>`;
const section=(ey,title,sub='')=>`<div class="nxp-heading">${eyebrow(ey)}<h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div>`;
const code=v=>`<code>${value(v)}</code>`;
function notice(ctx,details){
 const registered=ctx.deviceEnrolled&&!ctx.repairRequired;
 const title=registered?'Conexión temporalmente interrumpida':
   ctx.authenticated?'Datos temporalmente inaccesibles':'Conecta tu móvil';
 const why=registered?
   'Este teléfono sigue autorizado. NEXA recuperará la sesión cuando vuelva la conexión; no necesitas otro código.':
   ctx.authenticated?'No se han podido verificar los datos del backend. No se inventan cifras ni operaciones.':
   'Para conectar este dispositivo por primera vez, introduce el código de vinculación.';
 return `<section class="nxp-connect" role="status"><div class="nxp-connect-icon">${ico('shield')}</div><div class="nxp-connect-main">
   ${eyebrow('Conexión privada')}<h3>${title}</h3><p>${why}</p>
   ${details?`<p class="nxp-connect-detail">${esc(details)}</p>`:''}
   <div class="nxp-actions"><button data-app="${registered?'refresh':'pair-device'}" class="nxp-primary">${registered?'Reintentar conexión':'Conectar NEXA'}</button>
     <button data-app="settings-api" class="nxp-secondary">Servidor seguro</button></div>
 </div></section>`;
}
function offline(ctx,topic){return notice(ctx,topic);}
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
// Niveles etiquetados sobre la gráfica: EMA/Bollinger calculados sobre las
// mismas velas (valores actuales, no series históricas) + contexto IDCA del par
// vía m.marketContext (contrato de enrichMarket). Si el bot emite un nivel
// efectivo (targetEntryPrice/nextBuyPrice) se dibuja como «nivel del bot»;
// sin él, la fórmula referencia−caída requerida es solo fallback y se etiqueta
// explícitamente como umbral derivado — nunca como orden ni compra garantizada.
export function chartLevels(m,pair){
 const ind=m?.indicators||{},e=ind.ema||{},bb=ind.bollinger||{},mc=m?.marketContext||{};
 const nn=v=>num(v)?v:num(Number(v))?Number(v):null;
 // origin: 'app' = calculado por la app sobre las velas; 'bot' = emitido por
 // el bot (IDCA); 'derivado' = fórmula de la app, nunca una orden real.
 const L=(price,label,origin='app')=>nn(price)&&nn(price)>0?{price:nn(price),label,origin}:null;
 const ref=nn(mc.referencePrice),req=nn(mc.requiredDipPct);
 return [
   L(e.ema20,'EMA 20'),L(e.ema50,'EMA 50'),L(e.ema200,'EMA 200'),
   L(bb.upper,'Bollinger sup.'),L(bb.mid,'Bollinger media'),L(bb.lower,'Bollinger inf.'),
   L(ref,'Referencia IDCA','bot'),
   L(mc.targetEntryPrice,'Activación (nivel del bot)','bot')||
   L(mc.nextBuyPrice,'Activación (nivel del bot)','bot')||
   L(ref&&req?ref*(1-req/100):null,'Umbral derivado (ref. − caída req.)','derivado'),
 ].filter(Boolean);
}
function candleSurface(ctx,{pair='BTC/USD',title='Mercado',compact=false,levels=[]}={}){
 const m=raw(ctx,'market');const ready=goodCommon(ctx,'market');
 const candles=getCandles(m,pair);
 const tf=m.candleTimeframe||ctx.ui?.marketTf||'15';
 const tfLabel={1:'1m',5:'5m',15:'15m',60:'1h',240:'4h',1440:'1d'}[String(tf)]||tf+'m';
 const tfBar=compact?'':'<div class="nxp-tfbar" role="group" aria-label="Intervalo de velas">'+
   [['1','1m'],['5','5m'],['15','15m'],['60','1h'],['240','4h'],['1440','1d']].map(([v,l])=>
   `<button data-ui="tf:${v}" class="${String(tf)===v?'on':''}">${l}</button>`).join('')+'</div>';
 if(!levels.length) levels=chartLevels(m,pair);
 return `<section class="nxp-chartbox ${compact?'nxp-chart-compact':''}">
   <div class="nxp-charthead"><div>${eyebrow(title)}<strong>${esc(pair)}</strong></div>
     <span class="nxp-timeframe" title="Temporalidad de las velas mostradas">${esc(tfLabel)}</span></div>
   ${tfBar}
   ${ready&&candles.length>1?`<div class="nxp-chartcanvas">${ohlcvChart(candles,{height:compact?240:315,levels:levels.filter(x=>num(x.price)),label:pair+' · velas OHLCV '+tfLabel})}</div>`:
      noDataFrame(ready?'Sin velas válidas':'Esperando el mercado',
        ready?(m.candlesError?'La fuente de velas respondió: '+esc(m.candlesError)+'. ':'')+
          'El bot no publica velas por esta vía todavía; el despliegue del backend está pendiente. No se dibujan curvas ficticias.':
        'Sin datos OHLCV válidos de este par. No se dibujan curvas ficticias.')}
   <div class="nxp-chartfoot">${ready?`Origen: ${esc(m.candlesSource==='kraken-public'?'Kraken OHLC público (fuente externa verificable)':(m.provider||m.source||'API'))} · ${m.ts?esc(fmtAge(m.ts)):'hora no verificada'}`:
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
 <span class="nxp-engine-balance ${moneyClass(result)}"><b>${pnl(result)}</b><small>${good?value(first(d.status,'mode','state')):(ctx.deviceEnrolled?'Conexión pendiente':ctx.authenticated?'Sin datos':'Sin vincular')}</small></span>
 <span class="nxp-row-arrow">›</span></button>`;
}
function portfolioSummary(ctx){
 const s=raw(ctx,'portfolio').summary||{};
 const p=raw(ctx,'portfolio'),rs=p.resourceStates||{};
 // Patrimonio real = saldos de exchange × precios verificados. navUsd es el
 // presupuesto interno del bot: nunca se presenta como patrimonio.
 const exchangeUsd=(rs.exchangeBalances==='ok'&&rs.prices==='ok'&&p.exchangeBalances)?
  valueExchangeBalances(p.exchangeBalances,p.prices).totalUsd:null;
 return {s,connected:goodCommon(ctx,'portfolio')&&(num(s.navUsd)||num(s.exposureUsd)),exchangeUsd};
}
function basicHome(ctx){
 const {s,connected,exchangeUsd}=portfolioSummary(ctx);
 const rows=(ctx.engineList||[]).map(e=>engineCard(ctx,e)).join('');
 return wrap(`<div class="nxp-basic-home">
   <div class="nxp-home-greeting">${eyebrow('NEXA · Inicio')}<span>${connected?chip(exchangeUsd!==null?'Saldos exchange leídos':'Lectura parcial',exchangeUsd!==null?'good':'warn'):chip(ctx.deviceEnrolled?'Conexión pendiente':'Sin vincular','warn')}</span></div>
   <section class="nxp-basic-balance"><span>${connected?(exchangeUsd!==null?'Mi patrimonio (saldos exchange)':'Patrimonio sin conciliar'):'Tu centro de control'}</span>
    <h1>${connected?(exchangeUsd!==null?money(exchangeUsd):'—'):'Un vistazo a todo tu bot.'}</h1>
    <p>${connected?(exchangeUsd!==null?'Saldos reales de Kraken y Revolut X a precios verificados.':'El presupuesto interno del bot no es patrimonio: falta conciliación de saldos o precios.'):'Cuatro estrategias, una cartera y un acceso protegido.'}</p>
    ${connected?`<div class="nxp-pnl-pair">${block('PnL realizado',pnl(s.realizedPnlUsd),moneyClass(s.realizedPnlUsd))}${block('Sin realizar',pnl(s.unrealizedPnlUsd),moneyClass(s.unrealizedPnlUsd))}</div>`:
      `<div class="nxp-actions"><button class="nxp-primary" data-app="${ctx.deviceEnrolled?'refresh':'pair-device'}">${ctx.deviceEnrolled?'Reintentar conexión':'Conectar mi bot'} <b>↗</b></button></div>`}
   </section>
   ${section('Tus estrategias','Motores automáticos')}
   <div class="nxp-engine-list">${rows}</div>
   <div class="nxp-basic-shortcuts">${link('market','Ver mercados')}${link('activity','Actividad reciente')}${link('fisco','FISCO / AEAT')}</div>
   ${connected?`<div class="nxp-inline-note">${block('Exposición',money(s.exposureUsd))}${link('portfolio','Detalle de la cartera')}</div>`:''}
 </div>`,'nxp-mode-basic');
}
function proHome(ctx){
 const {s,connected,exchangeUsd}=portfolioSummary(ctx);
 const market=raw(ctx,'market'),ticker=getTicker(market,ctx.ui?.marketPair||'BTC/USD');
 const events=raw(ctx,'activity').events||[];
 return wrap(`<div class="nxp-pro-home">
   <div class="nxp-terminal-title"><div>${eyebrow('NEXA / TERMINAL')}<h1>Centro de operaciones</h1></div>
      ${connected?chip(exchangeUsd!==null?'Saldos exchange leídos':'Sin conciliación completa',exchangeUsd!==null?'good':'warn'):chip('Datos sin verificar','warn')}</div>
   <div class="nxp-command-strip">
    ${block('Patrimonio exchange',exchangeUsd!==null?money(exchangeUsd):'No confirmado')}
    ${block('Presupuesto bot',connected?money(s.navUsd):'—')}
    ${block('PnL realizado',connected?pnl(s.realizedPnlUsd):'—',moneyClass(connected?s.realizedPnlUsd:null))}
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
         ${block('Estado de sesión',ctx.authenticated?'Autorizada':ctx.deviceEnrolled?'Conexión pendiente':'Sin vincular')}
        </div>
        ${!ctx.authenticated?`<button class="nxp-primary nxp-full" data-app="${ctx.deviceEnrolled?'refresh':'pair-device'}">${ctx.deviceEnrolled?'Reintentar conexión':'Conectar dispositivo'}</button>`:''}
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
// Panel «Niveles»: los mismos chartLevels que se dibujan sobre la gráfica, en
// texto — cada nivel declara su ORIGEN (calculado por la app / emitido por el
// bot / derivado por fórmula). Referencias informativas, nunca órdenes.
const LEVEL_ORIGIN={app:'Calculado por la app sobre las velas',
 bot:'Emitido por el bot (IDCA)',derivado:'Fórmula de la app — no es una orden'};
function levelsPanel(ctx,pair,active){
 const m=raw(ctx,'market'),lv=chartLevels(m,pair);
 return `<section class="nxp-terminal-panel">${section('NIVELES','Niveles etiquetados')}
  ${active&&lv.length?`<div class="nxp-level-list">`+lv.map(l=>`<div class="nxp-level-row"><span>${esc(l.label)}<small class="nxp-level-origin">${esc(LEVEL_ORIGIN[l.origin]||'Origen no especificado')}</small></span><b>${money(l.price)}</b></div>`).join('')+`</div>`:
   `<p class="nxp-panel-empty">${active?'Sin niveles calculables con los datos actuales.':'Pendiente de una lectura verificada del mercado.'}</p>`}
  <p class="nxp-panel-empty">Referencias informativas; el «umbral derivado» es una fórmula de la app y nunca una orden ni compra garantizada.</p>
 </section>`;
}
// Fuente y frescura reales: proveedor, fuente de velas, edad de la lectura y
// aviso de velas antiguas. Es la única zona donde vive la proveniencia.
function freshnessPanel(ctx,m,active){
 const f=marketFresh(m);
 return `<section class="nxp-terminal-panel">${section('DATOS','Fuente y frescura')}
  ${block('Proveedor',active?value(m.provider||m.source):'—')}
  ${block('Fuente de velas',active?value(m.candlesSource||(m.candleTimeframe?m.candleTimeframe+'m':null)): '—')}
  ${block('Última lectura',active?(f.txt||'—'):'—')}
  ${active?block('Estado de datos',m.candlesStale===true?'Velas antiguas':value(m.dataState)):''}
  ${f.stale?`<p class="nxp-panel-empty">Velas antiguas: la fuente no ha publicado datos recientes; los niveles e indicadores pueden estar desfasados.</p>`:''}
 </section>`;
}
// Cabecera de cotización compartida por las subpestañas: precio, Δ 24h honesto
// y volumen. Nunca incluye gráfica ni contexto de decisión.
function quoteLine(ctx,pair,t,active,compact=false){
 const c24=chg24(t);
 return `<div class="nxp-quote ${compact?'nxp-quote-compact':''}"><div>${eyebrow(pair+' · PRECIO')}<strong>${active?money(t.price):'—'}</strong></div>
  <div class="nxp-quote-side">${block('24h',active?c24.v:'—',active?c24.cls:'nxp-missing')}
  ${block('Volumen 24h',active&&num(t.volume)?fmtNum(t.volume,{dec:2}):'—')}
  ${active&&c24.unreliable&&(num(t.price)||num(t.change24hPct)||typeof t.change24h==='number')?`<p class="nxp-panel-empty">El bot no reporta una variación 24h fiable.</p>`:''}</div></div>`;
}
// Básico — una responsabilidad por subpestaña: Precio = solo cotización;
// Gráfico = velas; Niveles = niveles con origen. (Indicadores no existe en
// Básico: la barra inferior lo oculta, pero si llega se muestra compacto.)
function basicMarket(ctx){
 const pair=ctx.ui?.marketPair||'BTC/USD',m=raw(ctx,'market'),t=getTicker(m,pair);
 const sub=ctx.ui?.marketSub||'price';
 const active=goodCommon(ctx,'market')&&(num(t.price)||getCandles(m,pair).length>1);
 const book=active&&(num(t.bid)||num(t.ask))?
  `<div class="nxp-basic-market-indicators">
   ${block('BID',money(t.bid))}${block('ASK',money(t.ask))}${block('Spread',money(t.spread))}</div>`:'';
 let body='';
 if(sub==='chart') body=`${quoteLine(ctx,pair,t,active,true)}${candleSurface(ctx,{pair,title:'Evolución · velas',compact:true})}`;
 else if(sub==='levels') body=`${quoteLine(ctx,pair,t,active,true)}${levelsPanel(ctx,pair,active)}`;
 else if(sub==='indicators') body=`${quoteLine(ctx,pair,t,active,true)}<div class="nxp-basic-market-indicators">
    ${block('RSI (14)',num(getInd(m,pair).rsi)?fmtNum(getInd(m,pair).rsi,{dec:1}):'—')}
    ${block('ADX',num(getInd(m,pair).adx)?fmtNum(getInd(m,pair).adx,{dec:1}):'—')}
    ${block('Spread',money(t.spread))}
   </div>`;
 else body=`<div class="nxp-market-price"><span>${esc(pair)}</span>${quoteLine(ctx,pair,t,active)}</div>
   ${book}${freshnessPanel(ctx,m,active)}
   ${active?'':offline(ctx,'Precios, velas e indicadores')}
   ${link('engines','Ver estrategias vinculadas')}`;
 return wrap(`${section('COTIZACIONES','Mercado')}
   ${marketPairBar(ctx)}
   ${body}
 </div>`,'nxp-mode-basic nxp-market');
}
// Traduce un código de estado/decisión del bot. En Pro se conserva el código
// crudo en <code> (mismo patrón que scoped-pages); en Básico solo el texto.
function trCode(ctx,v){
 if(v===null||v===undefined||v==='')return null;
 const t=translateCode(v);
 if(t===null||t==='')return null;
 const raw=String(v);
 return ctx.mode==='pro'&&t!==raw?`${esc(t)} <code class="nxp-code">${esc(raw)}</code>`:esc(t);
}
// Contexto de decisión — SOLO en la subpestaña «Indicadores». Cada bloque
// declara su fuente: AMA market-view publica contexto macro únicamente para
// BTC/USD; IDCA entry-diagnostics aplica por par. Nunca se mezclan en una línea.
function marketContextPanel(ctx,m,pair,ind){
 const cx=m.marketContext||{};
 const pctU=v=>num(v)?fmtPct(v):null; // magnitud en %; la etiqueta indica la dirección
 const amaRows=[
  ['Zona macro',trCode(ctx,cx.macroZone)],
  ['Caída actual',pctU(cx.currentDropPct)],
  ['Rebote desde mínimo',pctU(cx.reboundFromLowPct)],
 ].filter(([,v])=>v!=null&&v!=='');
 const idcaRows=[
  ['Decisión del bot',trCode(ctx,cx.entryDecision)],
  ['Régimen de mercado',trCode(ctx,ind.regime)],
  ['Score de entrada',num(cx.entryScore)?fmtNum(cx.entryScore,{dec:1})+(cx.confidenceGrade?' · grado '+esc(cx.confidenceGrade):''):null],
  ['Caída detectada / requerida',(num(cx.dipDetectedPct)||num(cx.requiredDipPct))?
    (num(cx.dipDetectedPct)?fmtPct(cx.dipDetectedPct):'—')+' / '+(num(cx.requiredDipPct)?fmtPct(cx.requiredDipPct):'—'):null],
  ['Señal de rebote / trailing',trCode(ctx,cx.reboundSignal)],
  ['Referencia de precio',num(cx.referencePrice)?money(cx.referencePrice):null],
  ['Activación prevista',num(cx.targetEntryPrice)?money(cx.targetEntryPrice):null],
  ['Próxima compra',num(cx.nextBuyPrice)?money(cx.nextBuyPrice):null],
  ['Bloqueo de seguridad',cx.hardBlocked===true?'Sí':cx.hardBlocked===false?'No':null],
 ].filter(([,v])=>v!=null&&v!=='');
 const grp=(title,rows,note='')=>`<div class="nxp-ctx-group"><span class="nxp-eyebrow">${esc(title)}</span>
   ${rows.length?`<div class="nxp-vertical-stats">${rows.map(([k,v])=>block(k,v)).join('')}</div>`:`<p class="nxp-panel-empty">${esc(note)}</p>`}</div>`;
 const amaNote=pair==='BTC/USD'?'AMA market-view no devolvió contexto macro en esta lectura.':'AMA market-view solo publica BTC/USD; no hay contexto macro para '+pair+'.';
 return `<section class="nxp-terminal-panel">${section('CONTEXTO','Lectura real de los motores')}
   ${grp('AMA · mercado (solo BTC/USD)',amaRows,amaNote)}
   ${grp('IDCA · decisión de entrada',idcaRows,'IDCA entry-diagnostics no devolvió lectura para este par.')}
   <p class="nxp-panel-empty">Los botones de este panel no lanzan compras ni ventas. Cada motor decide según sus propias reglas.</p>
   ${link('engines','Ver decisiones de motores')}
 </section>`;
}
function proMarket(ctx){
 const pair=ctx.ui?.marketPair||'BTC/USD',m=raw(ctx,'market'),t=getTicker(m,pair),ind=getInd(m,pair);
 const sub=ctx.ui?.marketSub||'price';
 const active=goodCommon(ctx,'market');
 const hasQuote=num(t.price)||num(t.bid)||num(t.ask);
 const quoted=active&&hasQuote;
 const head=`<div class="nxp-terminal-title"><div>${eyebrow('TRADING · ANÁLISIS')}<h1>Mercados</h1></div>${chip(active?'API conectada':'API pendiente',active?'good':'warn')}</div>
  ${marketPairBar(ctx)}`;
 const indicatorsPanel=`<div class="nxp-terminal-panel">${section('ANÁLISIS','Indicadores técnicos')}
      ${active?indicatorRows(ind):`<p class="nxp-panel-empty">Los indicadores están preparados para datos reales del proveedor, sin valores de relleno.</p>`}
    </div>`;
 const bookPanel=`<section class="nxp-terminal-panel">${section('LIBRO DE PRECIO','Bid / Ask / Spread')}
      <div class="nxp-vertical-stats">${block('Mejor BID',quoted?money(t.bid):'—')}
      ${block('Mejor ASK',quoted?money(t.ask):'—')}${block('Spread',quoted?money(t.spread):'—')}</div>
      ${pair!=='BTC/USD'&&!num(t.bid)&&!num(t.ask)?`<p class="nxp-panel-empty">Libro de ejecución solo disponible para BTC/USD (AMA market-view).</p>`:''}
    </section>`;
 const sourcesPanel=`<section class="nxp-terminal-panel">${section('Fuentes de datos','Origen y frescura')}
      ${block('Proveedor',active?value(m.provider||m.source):'—')}
      ${block('Fuente de velas',active?value(m.candlesSource||(m.candleTimeframe?m.candleTimeframe+'m':null)):'—')}
      ${block('Intervalo',active?value({1:'1m',5:'5m',15:'15m',60:'1h',240:'4h',1440:'1d'}[String(m.candleTimeframe||ctx.ui?.marketTf||'15')]||(m.candleTimeframe||ctx.ui?.marketTf||'15')+'m'):'—')}
      ${block('Última lectura',active?(marketFresh(m).txt||'—'):'—')}
      ${active?block('Estado de datos',m.candlesStale===true?'Velas antiguas':value(m.dataState)):''}
      ${active&&marketFresh(m).stale?`<p class="nxp-panel-empty">Velas antiguas: la fuente no ha publicado datos recientes.</p>`:''}
      ${active&&Array.isArray(m.sources||m.externalSources)&&(m.sources||m.externalSources).length?`<div class="nxp-source-list">`+(m.sources||m.externalSources).map(x=>`<div class="nxp-source-row"><span>${esc(x.name||x.id||'fuente')}</span><small>${esc(x.state||x.role||'')}${x.lastOk?' · '+esc(fmtAge(x.lastOk)):''}</small></div>`).join('')+`</div>`:''}
    </section>`;
 let body='';
 if(sub==='chart') body=`<div class="nxp-market-terminal"><div class="nxp-main-column">
    ${quoteLine(ctx,pair,t,quoted,true)}
    ${candleSurface(ctx,{pair,title:'OHLCV · Velas'})}
   </div></div>`;
 else if(sub==='levels') body=`<div class="nxp-market-terminal"><div class="nxp-main-column">
    ${quoteLine(ctx,pair,t,quoted,true)}${levelsPanel(ctx,pair,quoted)}</div></div>`;
 else if(sub==='indicators') body=`<div class="nxp-market-terminal"><div class="nxp-main-column">${indicatorsPanel}</div>
    <aside class="nxp-side-column">${marketContextPanel(ctx,m,pair,ind)}${sourcesPanel}</aside></div>`;
 else body=`<div class="nxp-market-terminal">
   <div class="nxp-main-column">
    ${quoteLine(ctx,pair,t,quoted)}
   </div>
   <aside class="nxp-side-column">
    ${bookPanel}
    ${freshnessPanel(ctx,m,active)}
    ${!quoted?offline(ctx,'Precios, velas, indicadores y fuentes'):''}
   </aside>
  </div>`;
 return wrap(`${head}${body}
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
 return cycles.slice(0,limit).map((c,i)=>{
  const cp=first(c,'unrealizedPnlUsd','pnlUsd','pnlNet');
  return `<article class="nxp-cycle-card nx-inspect-clickable" role="button" tabindex="0" data-inspect="idca:cycles:${i}" aria-label="Ver ficha completa del ciclo"><div class="nxp-cycle-top"><div><b>${esc(c.pair||'Par sin identificar')}</b><small>${value(c.id)}</small></div>
   <strong class="${moneyClass(cp)}">${pnl(cp)}</strong></div>
   ${cyclePriceTrack(c)}
   <div class="nxp-cycle-bottom">
    ${block('Compras',value(first(c,'buyCount','buys')))}
    ${block('Capital',money(first(c,'capitalUsedUsd','capitalUsed')))}
    ${block('Trailing',c.trailing?.enabled===true?'Activo':c.trailing?.enabled===false?'Inactivo':'—')}
   </div></article>`;
 }).join('');
}
function eventList(events,limit=6,origin=events){
 if(!Array.isArray(events)||!events.length)return `<p class="nxp-panel-empty">Sin eventos confirmados por la API.</p>`;
 return `<div class="nxp-event-list">${events.slice(0,limit).map(e=>`<div class="nxp-event nx-inspect-clickable" role="button" tabindex="0" data-inspect="common:events:${origin.indexOf(e)}">
  <span class="nxp-event-mark ${e.severity==='err'?'danger':e.severity==='warn'?'warning':''}"></span>
  <div><strong>${value(e.type||e.engine||'Evento')}</strong><p>${value(e.message||e.msg)}</p></div>
  <small>${e.ts?esc(fmtTs(e.ts)):'—'}</small>
 </div>`).join('')}</div>`;
}

function idcaEntryCards(contexts,basic=false){
 if(!contexts.length)return '<p class="nxp-panel-empty">No se ha recibido el diagnóstico de entrada por par. Esto NO confirma que falten señales: la pasarela puede no tener habilitada la ruta de lectura.</p>';
 const human=v=>String(v??'Sin evaluar').replaceAll('_',' ');
 return '<div class="nxp-entry-cards">'+contexts.map(x=>{
  if(x.error||x.unavailable||(x.entryScore==null&&x.confidenceScore==null&&x.currentPrice==null))return '<article class="nxp-entry-card nxp-entry-pending"><b>'+esc(x.pair||'Par')+
   '</b><p>Diagnóstico de entrada no disponible para este par. La lectura de pares habilitados no equivale a información de mercado. '+esc(x.error||'')+'</p></article>';
  const drop=first(x,'dipDetectedPct','drawdownFromReferencePct'),
    required=first(x,'requiredDipPct','requiredDistancePct'),score=first(x,'entryScore','confidenceScore');
  const progress=num(drop)&&num(required)&&required>0?Math.max(0,Math.min(100,drop/required*100)):null;
  const label=x.hardBlocked===true?'Entrada bloqueada':human(first(x,'entryDecision','decisionClass'));
  const col=x.hardBlocked===true?'is-blocked':progress!==null&&progress>=100?'is-watch':'is-pending';
  const state=x.trailingBuy?.state||x.reboundSignal||null;
  const scoreLabel=num(score)?fmtNum(score,{dec:Number.isInteger(score)?0:1}):'—';
  const family=x.scoreBreakdown&&typeof x.scoreBreakdown==='object'?Object.entries(x.scoreBreakdown).slice(0,7):[];
  const scoreDetails=family.length?'<div class="nxp-entry-factors">'+family.map(([k,v])=>
   '<span><b>'+esc(k)+'</b>: '+(num(v)?esc(fmtNum(v,{dec:1})):v&&typeof v==='object'?esc(String(v.score??v.value??'—')):value(v))+'</span>').join('')+'</div>':'';
  return '<article class="nxp-entry-card '+col+'"><div class="nxp-entry-top"><div><b>'+esc(x.pair||'Par')+
   '</b><strong>'+money(x.currentPrice)+'</strong></div><span class="nxp-entry-decision">'+esc(label)+'</span></div>'+
   '<div class="nxp-entry-context"><span>Confianza <b>'+scoreLabel+
     (x.confidenceGrade?' ('+esc(x.confidenceGrade)+')':'')+'</b></span>'+
   '<span>Mercado <b>'+esc(human(x.regime||x.marketRegime))+'</b></span>'+
   '<span>ATRP <b>'+ (num(x.atrpPct)?fmtPct(x.atrpPct):'—')+'</b></span></div>'+
   '<div class="nxp-entry-drop"><div><span>Caída desde referencia</span><b>'+
     (num(drop)?fmtPct(drop):'—')+' / '+(num(required)?fmtPct(required):'—')+
     '</b></div><div class="nxp-entry-track"><i style="width:'+(progress??0)+'%"></i></div></div>'+
   (!basic?'<div class="nxp-entry-extra"><span>Rebote <b>'+esc(human(state))+'</b></span>'+
    '<span>Referencia <b>'+money(x.referencePrice)+'</b></span>'+
    '<span>Fuente <b>'+esc(human(x.reference))+'</b></span>'+
    (x.hardBlockers?.length?'<p>Bloqueos: '+esc(x.hardBlockers.map(String).join(' · '))+'</p>':'')+
    scoreDetails+'</div>':'')+
   '<small class="nxp-entry-note">Diagnóstico API. No equivale a una orden o autorización de compra.</small></article>';
 }).join('')+'</div>';
}
function idcaPanel(d,mode){
 const {s,contexts,cycles,st}=idcaData(d);
 if(mode==='basic')return `<div class="nxp-strategy-simple">
  ${twoValueGrid([['Ciclos activos',value(first(s,'activeCyclesCount','activeCycles'))],['Capital en ciclos',money(first(s,'capitalUsedUsd','capitalUsed'))],
    ['PnL realizado',pnl(first(s,'realizedPnlUsd','realizedPnl'))],['Disponible',money(first(s,'capitalFreeUsd','capitalFree'))]])}
  <div class="nxp-section-row">${section('MERCADO','Estado de entrada por par')}</div>
  ${idcaEntryCards(contexts,true)}
  <div class="nxp-section-row">${section('EN SEGUIMIENTO','Ciclos de inversión')}</div>
  ${idcaCycleCards(cycles,2)}
 </div>`;
 return `<div class="nxp-pro-workspace">
  <section class="nxp-terminal-panel">${section('ENTRADAS','Lectura por par')}
   ${idcaEntryCards(contexts,false)}
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
    ${last.length?last.map(x=>`<div class="nxp-grid-level nx-inspect-clickable ${x.side==='BUY'?'buy':'sell'}" role="button" tabindex="0" data-inspect="grid:levels.levels:${levels.indexOf(x)}">
      <span>${money(x.price)}</span><i></i><strong>${value(x.side)}</strong><small>${value(first(x,'state','status'))}</small></div>`).join(''):
    `<div class="nxp-grid-placeholder">Los niveles aparecerán aquí con sus precios, lados y objetivos reales.</div>`}
   </div>`;
 const blocks=twoValueGrid([['Capital previsto',money(first(st,'capitalBudgetUsd','capitalAvailableUsd'))],
 ['Capital usado',money(first(st,'capitalUsedUsd','capitalReservedUsd'))],['Ciclos',num(first(st,'activeCyclesCount','openCycles'))?first(st,'activeCyclesCount','openCycles'):cycles.length],
 ['Maker-only',st.makerOnly===true?'Sí':st.makerOnly===false?'No':'—']]);
 if(mode==='basic')return `${blocks}${visual}`;
 const open=cycles.filter(c=>c.status!=='closed');
 return `<div class="nxp-pro-workspace"><section class="nxp-terminal-panel">
  ${section('MALLA DE PRECIOS','Rango actual y niveles')}${visual}</section>
  <section class="nxp-terminal-panel">${section('POLÍTICA Y CAPITAL','BUY → SELL · 1:1')}${blocks}
   <p class="nxp-safety-note">Los SELL de rangos anteriores se mantienen separados de entradas nuevas y de HOLD.</p></section>
  <section class="nxp-terminal-panel">${section('CICLOS','En seguimiento')}
   <div class="nxp-grid-cycles">${open.slice(0,8).map(c=>`<div class="nxp-grid-cycle nx-inspect-clickable" role="button" tabindex="0" data-inspect="grid:cycles:id=${encodeURIComponent(String(c.id))}">
     <span>${value(c.id)}</span><b>${money(first(c,'buyPrice'))} <i>→</i> ${money(first(c,'sellTargetPrice','sellTarget'))}</b>
     <small>${value(first(c,'status','sellState'))} · ${value(first(c,'rangeVersionId','rangeVersion'))}</small></div>`).join('')||`<p class="nxp-panel-empty">No hay ciclos verificados en la respuesta.</p>`}</div>
   <div class="nxp-inline">Rangos anteriores con SELL: <b>${legacy.length||'0'}</b></div></section></div>`;
}
function spotCards(d,mode){
 const st=d.status||{},positions=Array.isArray(d.positions)?d.positions:[],signals=Array.isArray(d.signals)?d.signals:[];
 const dmode=first(st,'mode','executionMode');
 const dd=st.configEffective?.dryRunMode;
 const strategy=value(st.strategy||d.config?.activeStrategy);
 const body=`<div class="nxp-positions">${positions.slice(0,mode==='basic'?3:6).map(p=>`<article class="nxp-position nx-inspect-clickable" role="button" tabindex="0" data-inspect="spot:positions:${positions.indexOf(p)}">
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
 ['Asignado',money(first(s,'allocatedCapitalUsd','capitalAllocated'))],
 ['Usado',money(first(s,'capitalUsedUsd','capitalUsed'))]],
 grid:[['Capital',money(first(st,'capitalUsedUsd','capitalReservedUsd'))],['Ciclos',first(st,'activeCyclesCount','openCycles')!==null?value(first(st,'activeCyclesCount','openCycles')):'—'],['Par',value(st.pair)]],
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
    <h2>${ctx.deviceEnrolled?'Conexión pendiente':ctx.authenticated?'Sin datos verificados del motor':'Conecta tu móvil'}</h2><p>${ctx.deviceEnrolled?'Este dispositivo sigue vinculado. Al volver Internet, NEXA recuperará la sesión sin pedir otro código.':ctx.authenticated?'El servidor no ha devuelto un estado válido; no se inventan operaciones.':'Los datos de los motores aparecerán cuando vincules por primera vez este dispositivo.'}</p>
    <button class="nxp-primary" data-app="${ctx.deviceEnrolled?'refresh':'pair-device'}">${ctx.deviceEnrolled?'Reintentar conexión':'Conectar dispositivo'}</button></div>`,'nxp-mode-basic nxp-engine');
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
 if(!Array.isArray(rows)||!rows.length)return `<p class="nxp-panel-empty">No se han recibido valores por activo en esta lectura.</p>`;
 const metric=x=>first(x,'valueUsd','currentValueUsd','exposureUsd');
 const sorted=rows.filter(x=>num(metric(x))).sort((a,b)=>metric(b)-metric(a)).slice(0,9);
 if(!sorted.length)return '<p class="nxp-panel-empty">Se recibieron activos, pero sin valoración en USD confirmada.</p>';
 const sum=sorted.reduce((t,x)=>t+Math.max(0,metric(x)),0);
 return `<div class="nxp-allocation">${sorted.map(x=>{
  const val=metric(x),ratio=sum>0?Math.max(0,Math.min(100,val/sum*100)):0;
  return `<div class="nxp-alloc-row"><div><b>${value(x[nameKey]||x.engine||x.asset||x.currency||x.pair)}</b>
   <span>${money(val)}</span></div><div class="nxp-track"><i style="width:${ratio}%"></i></div></div>`;
 }).join('')}</div>`;
}
function basicPortfolio(ctx){
 const s=raw(ctx,'portfolio').summary||{},ready=goodCommon(ctx,'portfolio');
 const p=raw(ctx,'portfolio'),rs=p.resourceStates||{};
 const exchangeUsd=(rs.exchangeBalances==='ok'&&rs.prices==='ok'&&p.exchangeBalances)?
  valueExchangeBalances(p.exchangeBalances,p.prices).totalUsd:null;
 const byAsset=s.byAsset||raw(ctx,'portfolio').holdings||[];
 const verifiedAssets=Array.isArray(byAsset)&&byAsset.some(x=>num(x.valueUsd??x.exposureUsd??x.currentValueUsd));
 const label=exchangeUsd!==null?'Patrimonio en exchanges':'Lectura sin conciliación completa';
 return wrap(`${section('CARTERA','Mi cartera')}
  ${ready?`<section class="nxp-basic-balance nxp-balanced">
    <span>${label}</span><h1>${exchangeUsd!==null?money(exchangeUsd):'—'}</h1>
    <p>${exchangeUsd!==null?'Suma de saldos reales de Kraken y Revolut X valorados a precios actuales.':'Faltan saldos de exchange o precios para confirmar el patrimonio. No se muestra el presupuesto interno del bot como patrimonio.'}</p>
    ${num(s.navUsd)?`<p class="nxp-inline-note" style="opacity:.8">Presupuesto interno del bot (NAV contable): ${money(s.navUsd)} — no es saldo del exchange.</p>`:''}
    <div class="nxp-pnl-pair">${block('PnL realizado',pnl(s.realizedPnlUsd),moneyClass(s.realizedPnlUsd))}
      ${block('Sin realizar',pnl(s.unrealizedPnlUsd),moneyClass(s.unrealizedPnlUsd))}</div></section>
    ${verifiedAssets?`${section('DISTRIBUCIÓN','Mis activos')}${allocationBars(byAsset)}`:
      `<div class="nxp-portfolio-empty"><b>Activos sin desglose</b><span>La API no devuelve valores por moneda en esta lectura. No se generan distribuciones ficticias.</span></div>`}
    <div class="nxp-basic-shortcuts">${link('engines','Motores')}${link('fisco','Fiscalidad')}</div>`:
      offline(ctx,'tu cartera, resultados y exposición')}
 </div>`,'nxp-mode-basic nxp-portfolio');
}
function proPortfolio(ctx){
 const s=raw(ctx,'portfolio').summary||{},ready=goodCommon(ctx,'portfolio');
 const p=raw(ctx,'portfolio'),rs=p.resourceStates||{};
 const exchangeUsd=(rs.exchangeBalances==='ok'&&rs.prices==='ok'&&p.exchangeBalances)?
  valueExchangeBalances(p.exchangeBalances,p.prices).totalUsd:null;
 return wrap(`<div class="nxp-terminal-title">${section('CAPITAL Y EXPOSICIÓN','Análisis de cartera')}
  ${chip(exchangeUsd!==null?'Saldos exchange leídos':'Sin conciliación completa',exchangeUsd!==null?'good':'warn')}</div>
  <div class="nxp-command-strip">${block('Patrimonio exchange',exchangeUsd!==null?money(exchangeUsd):'No confirmado')}
   ${block('Presupuesto bot (NAV interno)',ready?money(s.navUsd):'—')}
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
 const all=raw(ctx,'activity').events||[],ready=goodCommon(ctx,'activity');
 const f=ctx.ui?.activityFilter||{};
 const events=all.filter(e=>{ const sev=e.severity||e.level||e.sev;
   return (!f.sev||f.sev==='all'||sev===f.sev) && (!f.engine||f.engine==='all'||(e.engine||'')===f.engine); });
 if(ctx.mode==='basic')return wrap(`${section('SEGUIMIENTO','Actividad reciente')}
   ${ready?eventList(events,12,all):offline(ctx,'actividad y alertas del bot')}
   ${link('engines','Ver motores')}</div>`,'nxp-mode-basic nxp-activity');
 return wrap(`<div class="nxp-terminal-title">${section('MONITORIZACIÓN','Registro de actividad')}
   ${chip(ready?'Fuente conectada':'Pendiente',ready?'good':'warn')}</div>
   <div class="nxp-terminal-grid"><div class="nxp-main-column"><section class="nxp-terminal-panel">
     ${section('EVENTOS','Últimas decisiones')}${ready?eventList(events,40,all):offline(ctx,'logs, estados y alertas')}
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
  const denied=ctx.data?.fisco?.state==='forbidden';
  const pending=ctx.data?.fisco?.state==='auth_required';
  const title=denied?'Falta autorización fiscal':pending?'Inicia sesión para consultar FISCO':'Informes fiscales no disponibles';
  const desc=denied?'Tu teléfono está vinculado, pero no tiene el permiso adicional fisco:read. Reintentar no lo concederá: solicita a Cascade una autorización fiscal de solo lectura.':
      'Los informes no están disponibles en esta lectura; se mantiene protegida la información y no se generan cifras ficticias.';
  return wrap(`${header}<div class="nxp-privacy-head">${ico('shield')}
    <div><h3>${title}</h3><p>${desc}</p>
      ${denied?`<p class="nxp-privacy-note">Estado: acceso restringido. La conexión al resto del bot sigue funcionando.</p>`:
        `<button data-app="refresh" class="nxp-secondary">Reintentar consulta</button>`}
    </div></div>
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
 const authorized=!!ctx.authenticated;
 const header=section('NEXA / PREFERENCIAS','Ajustes');
 const option=(glyph,title,desc,action)=>`<button type="button" class="nxp-settings-option" data-app="${action}">
   <span class="nxp-settings-option-icon">${ico(glyph)}</span>
   <span class="nxp-settings-option-copy"><strong>${esc(title)}</strong><small>${esc(desc)}</small></span>
   <span class="nxp-settings-option-arrow" aria-hidden="true">›</span>
 </button>`;
 const content=`<div class="nxp-settings-compact">
  <div class="nxp-settings-status">
   <div class="nxp-settings-status-mark">${ico('shield')}</div>
   <div><strong>${authorized?'Dispositivo autorizado':ctx.deviceEnrolled?'Dispositivo registrado':'Conecta tu móvil'}</strong>
     <span>${authorized?'Sesión protegida · solo lectura':ctx.deviceEnrolled?'La conexión se recuperará automáticamente; no necesitas otro código.':'Sin usuario ni contraseña. Un código únicamente la primera vez.'}</span></div>
   ${chip(authorized?'Conectado':ctx.deviceEnrolled?'Sin conexión':'Pendiente',authorized?'good':'warn')}
  </div>
  <div class="nxp-settings-options">
   ${option('shield','Servidor','Conexión HTTPS segura','settings-api')}
   ${option('key',ctx.deviceEnrolled?'Reintentar conexión':'Conectar este móvil',ctx.deviceEnrolled?'Este teléfono ya está registrado':'Código de vinculación solo para el alta inicial',ctx.deviceEnrolled?'refresh':'pair-device')}
   <div class="nxp-settings-option nxp-settings-static">
    <span class="nxp-settings-option-icon">${ico('key')}</span>
    <span class="nxp-settings-option-copy"><strong>PIN y biometría</strong><small>Desbloqueo local del dispositivo</small></span>
    <span class="nxp-settings-option-arrow nxp-settings-ready">${ico('shield')}</span>
   </div>
   ${option('activity','Actualizar datos','Consultar de nuevo el estado del bot','refresh')}
   <button type="button" class="nxp-settings-option" data-nav="fisco">
    <span class="nxp-settings-option-icon">${ico('shield')}</span>
    <span class="nxp-settings-option-copy"><strong>FISCO / AEAT</strong><small>Informes fiscales privados · permiso independiente fisco:read</small></span>
    <span class="nxp-settings-option-arrow" aria-hidden="true">›</span>
   </button>
   ${authorized?option('key','Cerrar sesión','Desconectar sin borrar tu PIN','logout'):''}
  </div>
  ${ctx.mode==='pro'&&goodCommon(ctx,'settings')?`<details class="nxp-audit"><summary>Configuración técnica <span>⌄</span></summary>${legacy(ctx)}</details>`:''}
  <p class="nxp-settings-footnote">La vinculación no autoriza compras, ventas ni cambios en el bot.</p>
  <p class="nxp-settings-footnote">NEXA ${esc(BUILD_INFO.version)} · ${esc(BUILD_INFO.commit)} · ${esc(BUILD_INFO.channel)}${BUILD_INFO.builtAt?' · '+esc(BUILD_INFO.builtAt.slice(0,16).replace('T',' ')):''}</p>
 </div>`;
 return wrap(`${header}${content}`,ctx.mode==='basic'?'nxp-mode-basic nxp-settings':'nxp-mode-pro nxp-settings');
}
