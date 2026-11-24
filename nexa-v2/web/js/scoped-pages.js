// NEXA: scope-aware motor and activity views. No REAL records inside SHADOW.
import {esc,fmtUsd,fmtTs,signedUsd} from './util.js';
import {classifyMode,inScope,scopeTitle,SCOPE_SHADOW} from './display-scope.js';
import {eventCategory,describeEvent,eventCode,dedupeEvents,translateCode} from './event-labels.js';
const n=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
const first=(o,...ks)=>{for(const k of ks){const x=o?.[k];if(x!==null&&x!==undefined&&x!=='')return x;}return null;};
const text=v=>v==null||v===''?'—':esc(String(v));
const amount=v=>n(v)===null?'—':fmtUsd(n(v));
const profit=v=>n(v)===null?'—':signedUsd(n(v));
const engines={idca:'IDCA · Acumulación por ciclos',spot:'SPOT / Swing',grid:'GRID aislado',ama:'AMA · Macro adaptativo'};
// STREAM se exporta: nav-model.js deriva de estos path las secciones internas
// de cada motor (Estado/Posiciones/Historial/Órdenes) sin duplicar la lista.
export const STREAM=[
  ['idca','cycles','Ciclos abiertos'],['idca','history','Historial'],['idca','orders','Órdenes'],['idca','events','Eventos'],
  ['spot','positions','Posiciones'],['spot','trades','Historial global (origen no atribuido)'],
  // 'orders' existe como sección de navegación Pro, pero el gateway/BFF aún no
  // expone un GET de órdenes SPOT: renderScopedEngine lo muestra como fuente
  // ausente nombrando el endpoint que falta, nunca como «0 órdenes».
  ['spot','orders','Órdenes'],
  ['grid','cycles','Ciclos BUY → SELL'],['grid','events','Eventos de GRID'],
  ['ama','cycles','Ciclos AMA'],['ama','tranches','Tramos'],['ama','trace.decisions','Decisiones'],
];
const stream=STREAM;
function getPath(obj,path){return String(path).split('.').reduce((o,k)=>o?.[k],obj);}
function meta(ctx,id){return ctx.enginesData?.[id]||{state:'unavailable',data:{}};}
function modeFallback(ctx,id){const d=meta(ctx,id).data||{};
 return first(d.status,'mode','executionMode','schedulerMode')||first(d.summary,'mode','executionMode')||null;}
function chosen(ctx,id,field){
 const original=getPath(meta(ctx,id).data,field);
 if(!Array.isArray(original))return {rows:null,missing:true,unknown:0,other:0};
 const fallback=modeFallback(ctx,id),out=[],scope=ctx.viewScope||'real';let unknown=0,other=0;
 original.forEach((row,i)=>{
  const kind=classifyMode(row,fallback);
  if(kind===scope)out.push({row,index:i});
  else if(kind==='unknown')unknown++;else other++;
 });
 return {rows:out,missing:false,unknown,other};
}
function eventText(r){return describeEvent(r);}
function recordCard(id,field,r,index,ctx){
 const title=first(r,'pair','symbol','asset')||id.toUpperCase();
 const pnl=first(r,'realizedPnlUsd','unrealizedPnlUsd','netPnlUsd');
 const type=first(r,'side','type','status','state');
 const when=first(r,'executedAt','ts','createdAt','closedAt','openedAt','startedAt');
 const tone=n(pnl)===null?'unknown':pnl<0?'loss':'profit';
 const isEvent=field==='events'||field==='trace.decisions'||field.indexOf('events')===0;
 const cat=isEvent?eventCategory(r):null;
 const catTag=cat?'<span class="nxs-cat nxs-cat-'+cat.id+'">'+cat.label+'</span>':'';
 const proCode=cat&&ctx.mode==='pro'&&eventCode(r)?' <code class="nxs-code">'+esc(eventCode(r))+'</code>':'';
 const dupBadge=r._n>1?'<span class="nxs-dup">×'+r._n+'</span>':'';
 return '<article class="nxs-record nxs-'+tone+'"><div class="nxs-record-top">'+
 '<div>'+catTag+dupBadge+'<span class="nxs-record-kind">'+esc(id.toUpperCase())+' · '+
 (cat&&cat.id!=='executed'?esc(describeEvent(r)):text(type))+proCode+'</span>'+
 '<h3>'+text(title)+(r.id!=null?' · #'+text(r.id):'')+'</h3>'+
 '<small>'+ (when?esc(fmtTs(when)):'Sin fecha comprobada')+'</small></div>'+
 '<div class="nxs-record-money"><strong>'+ (n(pnl)!==null?profit(pnl):amount(first(r,'valueUsd','capitalUsedUsd','investedUsd','notionalUsd')))+'</strong>'+
 '<small>'+(n(pnl)!==null?'PnL registrado':'Importe o capital, no beneficio')+'</small></div></div>'+
 '<p>'+esc(eventText(r))+'</p><div class="nxs-record-actions">'+
 '<button data-inspect="'+esc(id+':'+field+':'+index)+'">Ficha completa ↗</button>'+
 (id==='idca'&&field==='cycles'&&r.id!=null&&ctx.viewScope!=='shadow'?
 '<button data-manage-cycle="'+esc(String(r.id))+'">Gestionar ciclo ↗</button>':'')+'</div></article>';
}
const TECH_SECTIONS={
  idca:[['summary','Resumen y capital'],['status','Estado, pausas y pares'],['pairContexts','Confianza, ATR y rebote por par'],
     ['config','Configuración IDCA'],['configEffective','Configuración efectiva'],['hybrid','Hybrid/Grid interno']],
  spot:[['status','Motor SPOT, estrategia y protecciones'],['diagnostics','Smart Exit: diagnósticos reales']],
  grid:[['status','Modo, capital y rango'],['levels','Niveles y rangos originales'],
     ['monitor','Monitor y bloqueos'],['config','Política de ejecución y configuración']],
  ama:[['status','Modo y scheduler'],['readiness','Checks y límites'],
     ['mandate','Mandato y límites'],['portfolio','Contabilidad AMA'],['trace','Ledger y decisiones']],
};
function technical(ctx,id){
  const data=meta(ctx,id).data||{},fallback=modeFallback(ctx,id);
  if(!inScope({mode:fallback},ctx.viewScope||'real'))
    return '<section class="nxs-group"><h2>Diagnóstico técnico</h2><p class="nxs-empty">El entorno del motor no está confirmado para esta vista. Se omiten los agregados sin separar para no mezclar REAL y SHADOW.</p></section>';
  const safe=(k,v)=>/token|secret|password|credential|private.?key|authorization|cookie|bearer/i.test(k)?'[OCULTO]':v;
  return '<section class="nxs-group"><h2>Información técnica del motor</h2>'+
   '<p class="nxs-foot">Los apartados mantienen todos los campos devueltos por la API. Reservas, objetivos, órdenes y ejecuciones no son intercambiables.</p>'+
   '<div class="nxs-tech-list">'+(TECH_SECTIONS[id]||[]).map(([path,title])=>{
     const raw=getPath(data,path);
     if(raw===undefined||raw===null)return '<div class="nxs-tech-unavailable"><b>'+esc(title)+'</b><small>API no disponible para esta sección</small></div>';
     return '<details class="nxs-technical"><summary>'+esc(title)+' <span>⌄</span></summary>'+
       '<pre>'+esc(JSON.stringify(raw,safe,2))+'</pre></details>';
   }).join('')+'</div></section>';
}
function facts(ctx,id){
 const d=meta(ctx,id).data||{},fallback=modeFallback(ctx,id);
 const state=meta(ctx,id).state||'unavailable',matching=inScope({mode:fallback},ctx.viewScope||'real');
 const modeLabel=matching?text(fallback):'No aplicable a este entorno';
 return '<div class="nxs-engine-facts">'+
 '<div><small>Estado API</small><strong>'+text(state)+'</strong></div>'+
 '<div><small>Modo del motor</small><strong>'+modeLabel+'</strong></div>'+
 '<div><small>Vista</small><strong>'+esc(scopeTitle(ctx.viewScope))+'</strong></div></div>';
}
function marketStatus(ctx,id){
 const d=meta(ctx,id).data||{};
 const contexts=d.pairContexts||{};
 return '<section class="nxs-group"><h2>Qué está esperando el bot</h2>'+Object.entries(contexts).map(([pair,c])=>{
  const cycles=chosen(ctx,id,'cycles').rows||[];
  const open=cycles.filter(x=>x.row.pair===pair);
  const target=first(c,'targetEntryPrice','entryTargetPrice','nextBuyPrice');
  const cur=n(c.currentPrice),tgtN=n(target);
  const dist=Number.isFinite(cur)&&cur>0&&Number.isFinite(tgtN)&&tgtN>0?(((tgtN-cur)/cur)*100):null;
  const tb=c.trailingBuy&&typeof c.trailingBuy==='object'?c.trailingBuy:null;
  const isPro=ctx.mode==='pro';
  const tr=v=>{const t=translateCode(v);return t===null?null:(isPro&&v&&t!==v?t+' <code class="nxs-code">'+esc(String(v))+'</code>':esc(t));};
  const fact=(l,v)=>v===null||v===undefined||v===''?'' :'<div><small>'+l+'</small><strong>'+v+'</strong></div>';
  const blockers=(c.hardBlockers||[]).map(x=>translateCode(x)).join(', ');
  return '<article class="nxs-record"><h3>'+esc(pair)+'</h3><p>'+(c.hardBlocked?'Entrada bloqueada: '+esc(blockers||'condiciones del mercado'):tr(c.reboundSignal)||'Esperando confirmación de entrada.')+'</p>'+
   '<div class="nxs-engine-facts"><div><small>Precio actual</small><strong>'+amount(cur)+'</strong></div><div><small>Referencia (ancla)</small><strong>'+amount(c.referencePrice)+(c.reference?' · '+esc(String(c.reference)):'')+'</strong></div>'+
   fact('Precio de activación',target?amount(tgtN):null)+
   fact('Distancia a activación',dist===null?null:(dist>0?'+':'')+dist.toFixed(2)+' %')+
   fact('Caída desde referencia',n(c.dipDetectedPct)===null?null:n(c.dipDetectedPct).toFixed(2)+' %')+
   fact('Caída requerida',n(c.requiredDipPct)===null?null:n(c.requiredDipPct).toFixed(2)+' %')+
   fact('Confirmación (trailing)',tr(tb?.state??c.reboundSignal))+
   fact('Decisión',tr(c.entryDecision))+
   fact('Régimen',tr(c.regime))+
   fact('Score',n(c.entryScore)===null?null:n(c.entryScore).toFixed(1)+(c.confidenceGrade?' · '+esc(String(c.confidenceGrade)):''))+'</div>'+
   open.map(x=>'<p>Objetivo de venta del ciclo #'+text(x.row.id)+': '+amount(first(x.row,'tpTargetPrice','sellTarget'))+'</p>').join('')+
   '<small>Los precios son referencias del bot; la ejecución depende de sus condiciones y protecciones.</small></article>';
 }).join('')+(Object.keys(contexts).length?'':'<p class="nxs-empty">Este modo todavía no entrega un contexto de entrada por activo.</p>')+'</section>';
}
export function renderModesOverview(ctx){
 return '<div class="nxs-root"><div class="nxs-heading"><span>MODOS · '+esc(scopeTitle(ctx.viewScope))+'</span><h1>Tus modos de inversión</h1><p>Elige un modo para consultar su estado y sus próximas decisiones.</p></div><div class="nxs-overview">'+Object.entries(engines).map(([id,label])=>'<button class="nxs-mode-card" data-nav="engine:'+id+'"><strong>'+esc(label)+'</strong><span>'+esc(meta(ctx,id).state==='ok'?'Lectura disponible':'Lectura parcial o pendiente')+'</span><b>Abrir modo →</b></button>').join('')+'</div></div>';
}
export function renderScopedEngine(ctx){
 const id=ctx.ui?.engineId||'idca',info=meta(ctx,id),scope=ctx.viewScope||'real';
 const active=ctx.mode==='basic'&&ctx.ui?.subtab==='orders'?'panel':(ctx.ui?.subtab||'panel');
 const sections=stream.filter(([engine])=>engine===id).map(([engine,path,label])=>({engine,path,label}));
 if(!sections.length)return '<div class="nxs-root"><h2>Motor no identificado</h2></div>';
 const sub=sections.find(x=>x.path===active);
 const basic=ctx.mode==='basic';
 // En Básico solo se ocultan las Órdenes; el resto de secciones internas
 // (posiciones, historial, eventos, tramos, decisiones) siguen disponibles.
 const basicAllowed=x=>x.path!=='orders';
 const selected=active==='panel'?sections.filter(x=>!basic||basicAllowed(x)):sub?[sub]:[];
 let html='<div class="nxs-root"><div class="nxs-heading"><span>MODOS · '+esc(scopeTitle(scope))+'</span>'+
 '<h1>'+esc(engines[id]||id)+'</h1>'+
 '<p>Estado y actividad del modo en el entorno seleccionado.</p></div>'+
 '<nav class="nxs-mode-tabs" aria-label="Elegir modo">'+Object.entries(engines).map(([key,label])=>
 '<button data-nav="engine:'+key+'" class="'+(id===key?'on':'')+'" aria-current="'+(id===key?'page':'false')+'">'+esc(key.toUpperCase())+'</button>').join('')+'</nav>'+
 facts(ctx,id)+
 '<nav class="nxs-tabs" aria-label="Secciones del motor">'+
 '<button data-ui="subtab:panel" class="'+(active==='panel'?'on':'')+'">Panel</button>'+
 sections.filter(x=>!basic||basicAllowed(x)).map(x=>'<button data-ui="subtab:'+esc(x.path)+'" class="'+(active===x.path?'on':'')+'">'+esc(x.label)+'</button>').join('')+
 '</nav>';
 if(info.state!=='ok'&&info.state!=='partial')html+='<p class="nxs-warning">El motor no está disponible desde la API. No se genera un estado ficticio.</p>';
 if(active==='panel')html+=marketStatus(ctx,id);
 let globalUnknown=0,total=0;
 for(const x of selected){
  // Órdenes SPOT: el bot/BFF no expone aún un GET de órdenes abiertas del motor
  // SPOT (READ_ROUTES solo permite /open-positions, /positions/smart-exit-
  // diagnostics y /trades/closed). Si el dato llega en el futuro se muestra;
  // mientras tanto se declara la fuente ausente y el endpoint que falta.
  if(id==='spot'&&x.path==='orders'&&!Array.isArray(getPath(meta(ctx,id).data||{},'orders'))){
   html+='<section class="nxs-group"><div class="nxs-group-title"><h2>'+x.label+'</h2>'+
   '<span>Fuente no disponible</span></div>'+
   '<p class="nxs-empty">Órdenes SPOT: el gateway no expone este dato aún. Falta un endpoint de lectura autorizado (p. ej. <code>GET /api/spot/orders</code> o equivalente en las rutas del bot y en READ_ROUTES del BFF). Las posiciones abiertas sí se consultan en «Posiciones»; este vacío no significa «0 órdenes».</p></section>';
   continue;
  }
  const got=chosen(ctx,id,x.path);globalUnknown+=got.unknown;
  if(got.missing){
    html+='<section class="nxs-group"><h2>'+x.label+'</h2><p class="nxs-empty">La API no ha proporcionado esta lista. No significa que esté vacía.</p></section>';continue;
  }
  total+=got.rows.length;
  html+='<section class="nxs-group"><div class="nxs-group-title"><h2>'+x.label+'</h2>'+
  '<span>'+got.rows.length+' del entorno</span></div>'+
  (got.rows.length?got.rows.slice(0,80).map(({row,index})=>recordCard(id,x.path,row,index,ctx)).join(''):
  '<p class="nxs-empty">No se han recibido registros identificados de '+esc(scopeTitle(scope))+
   '. Se omiten '+got.unknown+' con modo desconocido y '+got.other+' del otro entorno.</p>')+'</section>';
 }
 if(ctx.mode==='pro')html+=technical(ctx,id);
 if(id==='idca'&&active==='panel')html+='<div class="nxs-import-hint"><b>Importar posición abierta</b>'+
   '<p>Replica el proceso de IDCA original con vista previa, comisiones y avisos de coexistencia.</p>'+
   '<button data-idca-import>Revisar importación ↗</button></div>';
 if(scope===SCOPE_SHADOW)html+='<p class="nxs-warning">Modo SHADOW exclusivamente visual: todos los controles de ejecución real permanecen bloqueados.</p>';
 html+='<p class="nxs-foot">No se contabilizan como cero los endpoints que fallen. Se conserva la identidad del motor, el ID y la API original en cada ficha.</p></div>';
 return html;
}
export function renderScopedActivity(ctx){
 const all=ctx.data?.activity?.data?.events;
 const scope=ctx.viewScope||'real',f=ctx.ui?.activityFilter||{};
 const visible=Array.isArray(all)?all.map((e,i)=>({e,i})).filter(x=>inScope(x.e,scope))
   .filter(x=>(f.engine==='all'||!f.engine||String(x.e.engine||'')===f.engine)&&
    (f.sev==='all'||!f.sev||String(x.e.severity||x.e.level||'')===f.sev)&&
    (f.cat==='all'||!f.cat||eventCategory(x.e).id===f.cat)):null;
 const unknown=Array.isArray(all)?all.filter(x=>classifyMode(x)==='unknown').length:null;
 return '<div class="nxs-root"><div class="nxs-heading"><span>'+esc(scopeTitle(scope))+' · ACTIVIDAD</span>'+
 '<h1>Movimientos del bot</h1><p>Solo eventos identificados de este entorno. Los eventos de modo desconocido se excluyen de ambos modos.</p></div>'+
 '<div class="nxs-filters"><button data-ui="eng:all">Todos</button>'+['idca','spot','grid','ama'].map(x=>
 '<button data-ui="eng:'+x+'">'+x.toUpperCase()+'</button>').join('')+'</div>'+
 '<div class="nxs-filters"><button data-ui="cat:all">Todas</button>'+[['executed','Ejecutadas'],['rejected','Rechazadas'],['decision','Decisiones'],['technical','Eventos'],['error','Errores']].map(([k,l])=>
 '<button data-ui="cat:'+k+'" class="'+(f.cat===k?'on':'')+'">'+l+'</button>').join('')+'</div>'+
 (visible?dedupeEvents(visible.map(x=>({...x.e,_sourceIndex:x.i}))).slice(0,100).map(e=>recordCard(String(e.engine||'common'),'events',e,e._sourceIndex,ctx)
    .replace('data-inspect="'+esc(String(e.engine||'common')+':events:'+e._sourceIndex)+'"',
      'data-inspect="common:events:'+e._sourceIndex+'"')).join('')||
  '<p class="nxs-empty">Sin eventos verificados de este entorno en la lectura actual.</p>':
 '<p class="nxs-empty">La API no devuelve el historial de eventos. No significa que no existan.</p>')+
 (unknown?'<p class="nxs-warning">'+unknown+' eventos no tienen modo operativo identificable; no se han atribuido a REAL ni SHADOW.</p>':'')+'</div>';
}
