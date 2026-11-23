// NEXA: scope-aware motor and activity views. No REAL records inside SHADOW.
import {esc,fmtUsd,fmtTs,signedUsd} from './util.js';
import {classifyMode,inScope,scopeTitle,SCOPE_SHADOW} from './display-scope.js';
import {eventCategory,describeEvent,eventCode,dedupeEvents} from './event-labels.js';
const n=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
const first=(o,...ks)=>{for(const k of ks){const x=o?.[k];if(x!==null&&x!==undefined&&x!=='')return x;}return null;};
const text=v=>v==null||v===''?'—':esc(String(v));
const amount=v=>n(v)===null?'—':fmtUsd(n(v));
const profit=v=>n(v)===null?'—':signedUsd(n(v));
const engines={idca:'IDCA · Acumulación por ciclos',spot:'SPOT / Swing',grid:'GRID aislado',ama:'AMA · Macro adaptativo'};
const stream=[
  ['idca','cycles','Ciclos abiertos'],['idca','history','Historial'],['idca','orders','Órdenes'],['idca','events','Eventos'],
  ['spot','positions','Posiciones'],['spot','trades','Historial global (origen no atribuido)'],
  ['grid','cycles','Ciclos BUY → SELL'],['grid','events','Eventos de GRID'],
  ['ama','cycles','Ciclos AMA'],['ama','tranches','Tramos'],['ama','trace.decisions','Decisiones'],
];
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
export function renderScopedEngine(ctx){
 const id=ctx.ui?.engineId||'idca',info=meta(ctx,id),scope=ctx.viewScope||'real';
 const active=(ctx.ui?.subtab||'panel');
 const sections=stream.filter(([engine])=>engine===id).map(([engine,path,label])=>({engine,path,label}));
 if(!sections.length)return '<div class="nxs-root"><h2>Motor no identificado</h2></div>';
 const sub=sections.find(x=>x.path===active);
 const selected=active==='panel'?sections:sub?[sub]:sections;
 let html='<div class="nxs-root"><div class="nxs-heading"><span>MODOS · '+esc(scopeTitle(scope))+'</span>'+
 '<h1>'+esc(engines[id]||id)+'</h1>'+
 '<p>Estado y actividad del modo en el entorno seleccionado.</p></div>'+
 '<nav class="nxs-mode-tabs" aria-label="Elegir modo">'+Object.entries(engines).map(([key,label])=>
 '<button data-nav="engine:'+key+'" class="'+(id===key?'on':'')+'" aria-current="'+(id===key?'page':'false')+'">'+esc(key.toUpperCase())+'</button>').join('')+'</nav>'+
 facts(ctx,id)+
 '<nav class="nxs-tabs" aria-label="Secciones del motor">'+
 '<button data-ui="subtab:panel" class="'+(active==='panel'?'on':'')+'">Panel</button>'+
 sections.map(x=>'<button data-ui="subtab:'+esc(x.path)+'" class="'+(active===x.path?'on':'')+'">'+esc(x.label)+'</button>').join('')+
 '</nav>';
 if(info.state!=='ok'&&info.state!=='partial')html+='<p class="nxs-warning">El motor no está disponible desde la API. No se genera un estado ficticio.</p>';
 let globalUnknown=0,total=0;
 for(const x of selected){
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
    (f.sev==='all'||!f.sev||String(x.e.severity||x.e.level||'')===f.sev)):null;
 const unknown=Array.isArray(all)?all.filter(x=>classifyMode(x)==='unknown').length:null;
 return '<div class="nxs-root"><div class="nxs-heading"><span>'+esc(scopeTitle(scope))+' · ACTIVIDAD</span>'+
 '<h1>Movimientos del bot</h1><p>Solo eventos identificados de este entorno. Los eventos de modo desconocido se excluyen de ambos modos.</p></div>'+
 '<div class="nxs-filters"><button data-ui="eng:all">Todos</button>'+['idca','spot','grid','ama'].map(x=>
 '<button data-ui="eng:'+x+'">'+x.toUpperCase()+'</button>').join('')+'</div>'+
 (visible?dedupeEvents(visible.map(x=>({...x.e,_sourceIndex:x.i}))).slice(0,100).map(e=>recordCard(String(e.engine||'common'),'events',e,e._sourceIndex,ctx)
    .replace('data-inspect="'+esc(String(e.engine||'common')+':events:'+e._sourceIndex)+'"',
      'data-inspect="common:events:'+e._sourceIndex+'"')).join('')||
  '<p class="nxs-empty">Sin eventos verificados de este entorno en la lectura actual.</p>':
 '<p class="nxs-empty">La API no devuelve el historial de eventos. No significa que no existan.</p>')+
 (unknown?'<p class="nxs-warning">'+unknown+' eventos no tienen modo operativo identificable; no se han atribuido a REAL ni SHADOW.</p>':'')+'</div>';
}
