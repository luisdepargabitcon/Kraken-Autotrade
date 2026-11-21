// NEXA: panel transversal, fichas por activo y gestión IDCA. Solo datos API.
// Un registro reservado o planificado NO representa una compra ejecutada.
import {esc,fmtUsd,signedUsd,signedPct,fmtNum,fmtTs} from './util.js';
import {ohlcvChart} from './premium-chart.js';
import {actionBtn} from './actions.js';

const val=(o,...keys)=>{for(const k of keys){if(o?.[k]!==null&&o?.[k]!==undefined&&o[k]!=='')return o[k]}return null};
const n=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
const usd=v=>n(v)===null?'—':fmtUsd(n(v));
const pnl=v=>n(v)===null?'—':signedUsd(n(v));
const percent=v=>n(v)===null?'—':signedPct(n(v));
const id=x=>String(x??'');
const out=v=>esc(String(v??'—'));
const engine=(ctx,k)=>ctx.enginesData?.[k]?.data||{};
const ready=(ctx,k)=>['ok','partial'].includes(ctx.enginesData?.[k]?.state)&&ctx.authenticated;
const closed=r=>['closed','sold','completed','cancelled','canceled'].includes(String(val(r,'status','state','sellState')||'').toLowerCase())||val(r,'closedAt','sellAt')!=null;
const asset=v=>{const s=String(v||'').toUpperCase().replace('XBT','BTC');return s.includes('BTC')?'BTC/USD':s.includes('ETH')?'ETH/USD':s||null};
const matching=(r,pair)=>asset(val(r,'pair','symbol','asset'))===pair;
const metric=(label,v)=>'<div class="nxh-metric"><small>'+esc(label)+'</small><strong>'+v+'</strong></div>';
const section=(eyebrow,title,action='')=>'<div class="nxh-section-head"><div><span>'+eyebrow+'</span><h2>'+title+'</h2></div>'+action+'</div>';
const go=(where,label)=>'<button type="button" class="nxh-link" data-nav="'+esc(where)+'">'+esc(label)+' ↗</button>';
const openStatus=ctx=>['idca','spot','grid','ama'].filter(x=>!ready(ctx,x)).map(x=>x.toUpperCase()+' sin lectura verificada');

export function collectPositions(ctx){
 const entries=[],issues=openStatus(ctx);
 function collect(key,records,path,filter,title){
   if(!ready(ctx,key))return;
   if(!Array.isArray(records)){issues.push(key.toUpperCase()+': sin lista verificable');return;}
   records.forEach((r,i)=>{
     if(!r||typeof r!=='object'||!filter(r))return;
     entries.push({
       pair:asset(val(r,'pair','symbol','asset')),engine:key,id:val(r,'id','cycleId','positionId'),
       mode:val(r,'mode','executionMode')??val(engine(ctx,key).status,'mode','executionMode'),title,ref:key+':'+path+':'+i,
       capital:val(r,'capitalUsedUsd','capitalUsed','investedUsd','valueUsd'),
       gain:val(r,'unrealizedPnlUsd','unrealizedPnl','pnlUsd'),
       pct:val(r,'unrealizedPnlPct','pnlPct'),entry:val(r,'avgEntryPrice','avgPrice','buyPrice','entryPrice'),
       target:val(r,'tpTargetPrice','sellTargetPrice','sellTarget'),status:val(r,'status','state'),
       raw:r
     });
   });
 }
 collect('idca',engine(ctx,'idca').cycles,'cycles',r=>!closed(r),'Ciclo IDCA');
 collect('spot',engine(ctx,'spot').positions,'positions',()=>true,'Posición SPOT');
 collect('grid',engine(ctx,'grid').cycles,'cycles',r=>!closed(r)&&n(val(r,'buyQty','filledBuyQty','filledQty'))>0,'Ciclo GRID ejecutado');
 // AMA no expone necesariamente las órdenes ejecutadas: excluir mandatos y reservas.
 collect('ama',engine(ctx,'ama').cycles,'cycles',r=>!closed(r)&&n(val(r,'filledQty','executedQty','filledQuantity'))>0,'Ciclo AMA ejecutado');
 return {entries,issues,complete:issues.length===0};
}

function market(ctx,pair){
 const snap=ctx.data?.marketPairs?.[pair]||ctx.data?.market;
 const m=snap?.data||{},valid=snap?.state==='ok'&&ctx.authenticated;
 return {m,valid,price:valid?val(m,'price','lastPrice'):null,change:valid?val(m,'change24hPct','pct24h'):null,
  indicators:valid?m.indicators||{}:{},state:snap?.state||'unavailable'};
}
function candles(ctx,pair){
 const {m,valid}=market(ctx,pair);
 if(!valid)return [];
 const src=Array.isArray(m.candles)?m.candles:Array.isArray(m.candles?.[pair])?m.candles[pair]:[];
 return src.map(c=>({t:val(c,'t','ts','timestamp','time'),o:n(val(c,'o','open')),h:n(val(c,'h','high')),
 l:n(val(c,'l','low')),c:n(val(c,'c','close')),v:n(val(c,'v','volume'))}))
 .filter(c=>[c.o,c.h,c.l,c.c].every(x=>x!==null)&&c.h>=c.l);
}
function sparkline(ctx,pair){
 const cs=candles(ctx,pair).slice(-32),values=cs.map(x=>x.c);
 if(values.length<3)return '<span class="nxh-spark-absent">Sin velas verificables</span>';
 const lo=Math.min(...values),hi=Math.max(...values),range=hi-lo||1,step=168/(values.length-1);
 const points=values.map((v,i)=>(i*step).toFixed(1)+','+(46-(v-lo)/range*39).toFixed(1)).join(' ');
 const up=values.at(-1)>=values[0],stroke=up?'#5bd9a6':'#ff8195';
 return '<svg class="nxh-sparkline" viewBox="0 0 170 51" role="img" aria-label="Evolución real de '+esc(pair)+' en las últimas '+
   values.length+' velas" preserveAspectRatio="none"><polyline fill="none" stroke="'+stroke+
   '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="'+points+'"/></svg>';
}
function marketTile(ctx,pair){
 const q=market(ctx,pair),tone=n(q.change)===null?'':q.change<0?'negative':'positive';
 return '<button type="button" data-asset="'+pair+'" class="nxh-market-tile '+tone+'"><span><b>'+pair.slice(0,3)+'</b>'+
 '<small>'+out(q.valid?'API · '+(q.m.provider||'mercado'):'Cotización no verificada')+'</small></span>'+
 '<strong>'+usd(q.price)+'</strong>'+sparkline(ctx,pair)+
 '<span class="nxh-market-foot"><b>'+percent(q.change)+'</b><em>Indicadores y operaciones ↗</em></span></button>';
}
function positionRow(x){
 const tone=n(x.gain)===null?'unknown':n(x.gain)<0?'negative':'positive';
 return '<div class="nxh-position '+tone+'"><div class="nxh-position-main"><div><span class="nxh-engine-tag">'+x.engine.toUpperCase()+'</span>'+
 '<b>'+out(x.pair||'Par desconocido')+'</b><small>'+out(x.title)+' #'+out(x.id)+' · '+out(x.mode)+'</small></div>'+
 '<strong>'+pnl(x.gain)+'<small>'+percent(x.pct)+'</small></strong></div>'+
 '<div class="nxh-position-actions"><button data-inspect="'+esc(x.ref)+'">Ficha completa</button>'+
 (x.pair?'<button data-asset="'+esc(x.pair)+'">Ver activo</button>':'')+
 (x.engine==='idca'&&x.id!=null?'<button data-manage-cycle="'+esc(id(x.id))+'">Gestionar ciclo</button>':'')+'</div></div>';
}
function engineLinks(ctx){
 return '<div class="nxh-engine-grid">'+['idca','spot','grid','ama'].map(x=>
 '<button data-nav="engine:'+x+'"><b>'+ (x==='spot'?'SPOT / Swing':x.toUpperCase())+'</b>'+
 '<small>'+out(ready(ctx,x)?'Lectura disponible':'Sin verificar')+'</small><span>›</span></button>').join('')+'</div>';
}
export function renderDashboard(ctx){
 const s=collectPositions(ctx),summary=ctx.data?.portfolio?.data?.summary||{};
 const classify=x=>{const m=String(x.mode||'').toUpperCase();return ['LIVE','REAL','REAL_LIMITED','REAL_FULL'].includes(m)?'live':
  ['SIM','SIMULATION','SHADOW','DRY_RUN','LAB','REPLAY'].includes(m)?'sim':'unknown'};
 const liveCount=s.entries.filter(x=>classify(x)==='live').length,
  simCount=s.entries.filter(x=>classify(x)==='sim').length,
  unknownCount=s.entries.filter(x=>classify(x)==='unknown').length;
 const nav=ctx.authenticated&&ctx.data?.portfolio?.state==='ok'?val(summary,'navUsd'):null;
 const corr=pearson(ctx);
 const events=ctx.data?.activity?.data?.events;
 const verifiedPortfolio=ctx.authenticated&&ctx.data?.portfolio?.state==='ok';
 const proExtras=ctx.mode==='pro'?
  section('RIESGO Y CONTABILIDAD','Lectura profesional')+
  '<div class="nxh-pro-grid">'+
   metric('PnL realizado',verifiedPortfolio?pnl(summary.realizedPnlUsd):'—')+
   metric('PnL no realizado',verifiedPortfolio?pnl(summary.unrealizedPnlUsd):'—')+
   metric('Exposición consolidada',verifiedPortfolio?usd(summary.exposureUsd):'—')+
   metric('HOLD separado',verifiedPortfolio?usd(summary.holdUsd):'—')+
   metric('Ciclos IDCA',out(engine(ctx,'idca').summary?.activeCyclesCount))+
   metric('Pausa global IDCA',typeof engine(ctx,'idca').status?.globalTradingPause==='boolean'?
      (engine(ctx,'idca').status.globalTradingPause?'Activada':'Sin pausa'):'—')+
  '</div>':'';
 return '<div class="nxh-root"><header class="nxh-title"><span>NEXA · VISIÓN GLOBAL</span><h1>Tu bot, de un vistazo</h1>'+
 '<p>Mercado, exposición y movimientos de todas tus estrategias.</p></header>'+
 '<section class="nxh-hero"><small>POSICIONES ABIERTAS CONFIRMADAS</small>'+
 '<div class="nxh-bigline"><strong>'+s.entries.length+'</strong>'+go('positions','Ver todas')+'</div>'+
 '<p>'+(s.complete?'Lectura disponible de los cuatro motores':'Visión parcial: faltan lecturas de uno o más motores')+'</p>'+  '<div class="nxh-mode-breakdown"><span>LIVE '+liveCount+'</span><span>SIM / SHADOW '+simCount+'</span>'+(unknownCount?'<span>Modo no verificado '+unknownCount+'</span>':'')+'</div>'+
 '<div class="nxh-hero-stats">'+metric('NAV informado',usd(nav))+metric('Motores','4')+
 metric('Estado',ctx.authenticated?'Conectado':'Sin sesión')+'</div></section>'+
 section('MERCADOS','BTC y ETH',go('market','Mercados'))+
 '<div class="nxh-market-grid">'+marketTile(ctx,'BTC/USD')+marketTile(ctx,'ETH/USD')+'</div>'+  '<div class="nxh-corr-mini"><span>Relación BTC ↔ ETH</span><strong>'+(n(corr.r)===null?'Pendiente':fmtNum(corr.r,{dec:2}))+'</strong><small>'+(corr.count<8?'Sin suficientes velas sincronizadas':corr.count+' intervalos de 15m')+'</small><button data-asset="BTC/USD">Analizar ↗</button></div>'+
 section('OPERATIVA','Posiciones abiertas',go('positions','Todas las posiciones'))+
 '<div class="nxh-position-list">'+(s.entries.length?s.entries.slice(0,ctx.mode==='pro'?6:3).map(positionRow).join(''):
 '<p class="nxh-empty">Sin posiciones confirmadas en las fuentes recibidas.</p>')+'</div>'+
 (s.issues.length?'<p class="nxh-caution">Lectura parcial: '+out(s.issues.join(' · '))+'. No significa que no existan posiciones.</p>':'')+
 section('ACTIVIDAD','Últimos movimientos',go('activity','Monitor'))+
 '<div class="nxh-activity">'+(Array.isArray(events)&&events.length?events.slice(0,4).map(e=>
 '<div><b>'+out(val(e,'engine','source')||'BOT')+'</b><span>'+out(val(e,'msg','message','type')||'Evento')+'</span></div>').join(''):
 '<p class="nxh-empty">Sin eventos verificables en la respuesta actual.</p>')+'</div>'+
 proExtras+section('ESTRATEGIAS','Motores')+engineLinks(ctx)+'</div>';
}
export function renderPositions(ctx){
 const s=collectPositions(ctx),f=ctx.ui?.positionFilter||'all',list=s.entries.filter(x=>f==='all'||x.pair===f||x.engine===f);
 return '<div class="nxh-root"><header class="nxh-title"><span>TODOS LOS MOTORES</span><h1>Posiciones abiertas</h1>'+
 '<p>'+s.entries.length+' confirmadas · '+(s.complete?'lectura completa':'lectura parcial')+'</p></header>'+
 '<div class="nxh-filters">'+['all','BTC/USD','ETH/USD','idca','spot','grid','ama'].map(x=>
 '<button data-ui="positionFilter:'+x+'" class="'+(f===x?'on':'')+'">'+out(x==='all'?'Todas':x.toUpperCase())+'</button>').join('')+'</div>'+
 '<div class="nxh-position-list">'+(list.length?list.map(positionRow).join(''):'<p class="nxh-empty">Sin posiciones verificadas para el filtro elegido.</p>')+'</div>'+
 (s.issues.length?'<p class="nxh-caution">'+out(s.issues.join(' · '))+'</p>':'')+
 go('home','Volver al inicio')+'</div>';
}
function operations(ctx,pair){
 const outArr=[];
 function add(key,list,path,kind){
  if(!ready(ctx,key)||!Array.isArray(list))return;
  list.forEach((r,i)=>{if(!matching(r,pair))return;outArr.push({
   key,kind,r,ref:key+':'+path+':'+i,ts:val(r,'ts','executedAt','closedAt','startedAt','createdAt','buyTs'),
   gain:val(r,'realizedPnlUsd','netPnlUsd','pnl'),amount:val(r,'valueUsd','grossValueUsd','capitalUsedUsd'),
   side:val(r,'side'),mode:val(r,'mode'),reason:val(r,'reason','closeReason','type')
  });});
 }
 add('idca',engine(ctx,'idca').orders,'orders','Orden IDCA');
 add('idca',engine(ctx,'idca').history,'history','Ciclo cerrado IDCA');
 add('idca',engine(ctx,'idca').cycles,'cycles','Ciclo abierto IDCA');
 add('spot',engine(ctx,'spot').positions,'positions','Posición SPOT');
 // trades es historial GLOBAL del bot. No presentar como SPOT sin el identificador del motor.
 add('spot',engine(ctx,'spot').trades,'trades','Operación global · motor no atribuido');
 add('grid',engine(ctx,'grid').cycles,'cycles','Ciclo GRID');
 add('ama',engine(ctx,'ama').cycles,'cycles','Ciclo AMA');
 return outArr.sort((a,b)=>new Date(b.ts||0)-new Date(a.ts||0));
}
function pearson(ctx){
 const b=candles(ctx,'BTC/USD'),e=candles(ctx,'ETH/USD');
 function epoch(v){const t=typeof v==='number'?v:new Date(v).getTime();return Number.isFinite(t)?Math.round((t<1e11?t*1000:t)/60000):null}
 const em=new Map(e.filter(x=>epoch(x.t)!==null).map(x=>[epoch(x.t),x.c]));
 const aligned=b.map(x=>({t:epoch(x.t),b:x.c,e:em.get(epoch(x.t))})).filter(x=>x.t!==null&&n(x.e)!==null);
 const a=[],c=[];for(let i=1;i<aligned.length;i++){
  const x=aligned[i-1],y=aligned[i];if(y.t-x.t!==15||x.b<=0||x.e<=0||y.b<=0||y.e<=0)continue;
  a.push(Math.log(y.b/x.b));c.push(Math.log(y.e/x.e));
 }
 if(a.length<8)return {r:null,count:a.length};
 const avg=v=>v.reduce((s,x)=>s+x,0)/v.length,am=avg(a),cm=avg(c);
 const cov=a.reduce((s,x,i)=>s+(x-am)*(c[i]-cm),0);
 const va=a.reduce((s,x)=>s+(x-am)**2,0),vc=c.reduce((s,x)=>s+(x-cm)**2,0);
 return {r:va>0&&vc>0?cov/Math.sqrt(va*vc):null,count:a.length};
}
function indicators(ind){
 const ema=ind.ema||{},macd=ind.macd||{},bb=ind.bollinger||{},mom=ind.momentum||{},vol=ind.volume||{};
 const groups=[
 ['Tendencia',[['EMA20',usd(ema.ema20)],['EMA50',usd(ema.ema50)],['EMA200',usd(ema.ema200)],['ADX',out(ind.adx)]]],
 ['Momentum',[['RSI14',out(ind.rsi)],['MACD',out(macd.macd)],['Señal',out(macd.signal)],['Histograma',out(macd.histogram)],['4h',out(mom.pct4h)],['24h',out(mom.pct24h)]]],
 ['Bandas Bollinger',[['Superior',usd(bb.upper)],['Media',usd(val(bb,'middle','mid','basis'))],['Inferior',usd(bb.lower)],['%B',out(val(bb,'percentB','pctB'))]]],
 ['Volatilidad y volumen',[['ATR',out(ind.atr)],['ATRP',out(ind.atrpPct)],['Volumen',out(vol.last)],['Volumen medio',out(val(vol,'avg24','avg'))]]]
 ];
 return '<div class="nxh-indicators">'+groups.map(g=>'<details open><summary>'+g[0]+'</summary>'+
 '<div>'+g[1].map(([k,v])=>metric(k,v)).join('')+'</div></details>').join('')+'</div>';
}
export function renderAsset(ctx){
 const pair=ctx.ui?.marketPair==='ETH/USD'?'ETH/USD':'BTC/USD';
 const q=market(ctx,pair),c=candles(ctx,pair),s=collectPositions(ctx),open=s.entries.filter(x=>x.pair===pair),ops=operations(ctx,pair);
 const correlation=pearson(ctx),diag=engine(ctx,'idca').pairContexts?.[pair]||{};
 return '<div class="nxh-root"><header class="nxh-title"><span>ACTIVO · DETALLE COMPLETO</span><h1>'+pair+'</h1>'+
 '<p>Mercado, posiciones, operaciones y diagnóstico IDCA en un mismo lugar.</p></header>'+
 '<div class="nxh-asset-hero"><small>PRECIO API</small><strong>'+usd(q.price)+'</strong><b>'+percent(q.change)+' / 24h</b>'+
 '<small>'+out(q.valid?q.m.provider||'API de mercado':'Sin precio confirmado')+'</small></div>'+
 '<div class="nxh-filters"><button data-asset="BTC/USD" class="'+(pair==='BTC/USD'?'on':'')+'">BTC</button>'+
 '<button data-asset="ETH/USD" class="'+(pair==='ETH/USD'?'on':'')+'">ETH</button>'+go('market','Mercado')+'</div>'+
 section('GRÁFICO','Velas y volumen')+
 (c.length>1?ohlcvChart(c,{height:270,label:'Velas reales '+pair}):
 '<div class="nxh-empty">La API no facilita suficientes velas OHLCV válidas: no se dibujan curvas inventadas.</div>')+
 section('POSICIONES','Abiertas en '+pair,go('positions','Vista global'))+
 '<div class="nxh-position-list">'+(open.length?open.map(positionRow).join(''):
 '<p class="nxh-empty">No hay posiciones verificadas para este activo en las lecturas disponibles.</p>')+'</div>'+
 section('OPERACIONES','Compras, ventas y ciclos')+
 '<div class="nxh-operation-list">'+(ops.length?ops.slice(0,100).map(x=>{
 const side=String(x.side||'').toUpperCase(),gain=n(x.gain),tone=gain===null?'unknown':gain<0?'negative':'positive';
 const kind=side==='BUY'?'COMPRA':side==='SELL'?'VENTA':x.kind;
 return '<button type="button" class="nxh-operation '+tone+'" data-inspect="'+esc(x.ref)+'"><span><b>'+out(kind)+'</b>'+
 '<small>'+out(x.key.toUpperCase())+' · '+out(x.ts?fmtTs(x.ts):'Fecha no confirmada')+'</small>'+
 '<small>'+out(x.reason||'Abrir para ver motivo y cronología')+'</small></span>'+
 '<span><strong>'+(gain===null?usd(x.amount):pnl(gain))+'</strong><small>'+(gain===null?'Importe · no PnL':'PnL')+'</small></span>›</button>';
 }).join(''):'<p class="nxh-empty">No se han recibido operaciones atribuibles a este activo en los endpoints consultados.</p>')+'</div>'+
 section('ANÁLISIS','Indicadores completos')+indicators(q.indicators)+
 section('ESTRATEGIA','Diagnóstico de entrada IDCA',go('engine:idca','Ir a IDCA'))+
 '<div class="nxh-diagnostics">'+metric('Confianza',out(val(diag,'entryScore','confidenceScore')))+
 metric('Régimen',out(val(diag,'regime','marketRegime')))+metric('ATRP',out(diag.atrpPct))+
 metric('Caída / requerida',out(diag.dipDetectedPct)+' / '+out(diag.requiredDipPct))+
 metric('Rebote',out(diag.reboundSignal||diag.trailingBuy?.state))+
 metric('Decisión',out(diag.entryDecision))+'</div>'+
 section('RELACIÓN','Correlación BTC ↔ ETH')+
 '<div class="nxh-correlation"><strong>'+(n(correlation.r)===null?'—':fmtNum(correlation.r,{dec:3}))+'</strong>'+
 '<p>'+correlation.count+' rendimientos sincronizados de 15 minutos. Pearson sobre cambios logarítmicos. '+(n(correlation.r)===null?
 'No hay datos suficientes y comparables para calcularla.':'La correlación no predice cotizaciones futuras.')+'</p></div></div>';
}
export function renderCycleManager(ctx){
 const d=engine(ctx,'idca'),arr=d.cycles,id0=String(ctx.ui?.cycleId||'');
 const c=Array.isArray(arr)?arr.find(x=>String(x.id)===id0):null;
 if(!c)return '<div class="nxh-root"><h1>Ciclo no disponible</h1><p>No se ha recibido el ciclo en la API.</p>'+go('engine:idca','Volver a IDCA')+'</div>';
 const off=closed(c),idx=arr.indexOf(c),params={cycleId:id0};
 const act=(code,arg,label)=>actionBtn(code,arg,label,{cls:'nxh-manage-action'});
 return '<div class="nxh-root"><header class="nxh-title"><span>IDCA · GESTIÓN CON AUTORIZACIÓN</span>'+
 '<h1>'+out(c.pair)+' #'+out(c.id)+'</h1><p>Acciones reales protegidas por permisos y confirmación.</p></header>'+
 '<div class="nxh-manager-summary">'+metric('Estado',out(c.status))+metric('Modo',out(c.mode))+
 metric('Capital usado',usd(c.capitalUsedUsd))+metric('PnL sin realizar',pnl(c.unrealizedPnlUsd))+
 metric('Precio medio',usd(c.avgEntryPrice))+metric('Objetivo TP',usd(c.tpTargetPrice))+'</div>'+
 section('LECTURA','Ficha y órdenes')+
 '<div class="nxh-manager-actions"><button data-inspect="idca:cycles:'+idx+'">Ficha completa ↗</button>'+
 '<button data-engine-sub="orders">Órdenes IDCA ↗</button><button data-engine-sub="history">Historial IDCA ↗</button></div>'+
 (off?'<p class="nxh-caution">Ciclo cerrado: no se ofrecen acciones de gestión.</p>':
 section('CONTROL','Gestionar ciclo')+
 '<div class="nxh-manager-actions">'+
 act('idca.cycleStatus',{...params,status:String(c.status)==='paused'?'active':'paused'},String(c.status)==='paused'?'Reanudar':'Pausar')+
 act('idca.cycleStatus',{...params,status:'blocked'},'Bloquear')+
 (c.isImported===true?act('idca.soloSalida',{...params,soloSalida:!c.soloSalida},c.soloSalida?'Gestión completa':'Solo salida'):'')+
 act('idca.timeStop',{...params,disabled:!c.exitOverrides?.timeStopDisabled},c.exitOverrides?.timeStopDisabled?'Reactivar TimeStop':'Desactivar TimeStop')+
 '<button data-manual-buy="'+out(c.id)+'" class="nxh-manage-action">Registrar compra externa ↗</button>'+
 act('idca.closeCycle',params,'Cerrar manualmente')+
 (c.isManualCycle===true?act('idca.deleteCycle',params,'Eliminar ciclo manual'):'')+'</div>')+
 '<div class="nxh-global-idca"><h2>Control general IDCA</h2><p>El estado global es distinto del estado de este ciclo. Estas acciones afectan a todo IDCA.</p>'+
 (typeof d.status?.globalTradingPause==='boolean'?
   act('idca.pauseGlobal',{pause:!d.status.globalTradingPause},d.status.globalTradingPause?'Reanudar entradas IDCA':'Pausar entradas IDCA'):
   '<span>Estado de pausa global sin verificar</span>')+
 (Array.isArray(d.status?.assetPairs)?d.status.assetPairs.filter(x=>typeof x.enabled==='boolean').map(x=>
   act('idca.togglePair',{pair:x.pair,enabled:!x.enabled},(x.enabled?'Desactivar ':'Activar ')+x.pair)).join(''):'')+
 act('idca.emergencyClose',{},'CIERRE DE EMERGENCIA IDCA')+'</div>'+
'<p class="nxh-caution">Registrar compra externa NO envía una compra al exchange. Solo salida está disponible para ciclos importados. El servidor puede rechazar acciones aunque aparezcan en la interfaz.</p>'+
 go('engine:idca','Volver a IDCA')+'</div>';
}
