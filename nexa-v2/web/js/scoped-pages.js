// NEXA: scope-aware motor and activity views. No REAL records inside SHADOW.
import {esc,fmtUsd,fmtNum,fmtTs,signedUsd} from './util.js';
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
// Estados de ciclo GRID (GridCycleStatus del backend) en castellano.
const GRID_CYCLE_WORDS={
  pending:'Pendiente',buy_placed:'Compra colocada',buy_filled:'Compra ejecutada',
  sell_placed:'Venta colocada',sell_filled:'Venta ejecutada',completed:'Completado',
  stop_loss_hit:'Stop-loss alcanzado',trailing_closed:'Cerrado por trailing',
  hodl_recovery:'Recuperación HODL',cancelled:'Cancelado',cycle_open:'Ciclo abierto',
  open:'Abierto',active:'Activo',closed:'Cerrado',open_buy_filled:'Ciclo abierto · compra ejecutada',
  open_legacy_sell_pending:'Ciclo de rango anterior · venta pendiente',
};
const gridCycleWord=(v,pro)=>{
  if(v===null||v===undefined||v==='')return null;
  const s=String(v),low=s.toLowerCase();
  const t=GRID_CYCLE_WORDS[low]||STATE_WORDS[low]||translateCode(s);
  const out=t===s?s.replace(/_/g,' '):t;
  return pro&&String(v)!==out?esc(out)+' <code class="nxs-code">'+esc(s)+'</code>':esc(out);
};
// PnL neto del tramo SOLO con datos reales del ciclo: si la venta se ejecutó
// (sellPrice) y hay compra y cantidad, neto = venta − compra − comisiones
// registradas. Si el backend ya publica netPnlUsd se usa ese valor. En cualquier
// otro caso '—' honesto: nunca se estima.
function gridTrancheNet(row){
  const sell=n(row.sellPrice),buy=n(row.buyPrice),qty=n(row.quantity)??n(row.buyQty);
  const fee=n(row.feeTotalUsd)??n(row.fees)??n(row.feeUsd);
  if(sell!==null&&buy!==null&&qty!==null&&qty>0){
    const gross=(sell-buy)*qty;
    return {value:fee===null?gross:gross-fee,
      note:fee===null?'Venta − compra · sin comisiones registradas':'Venta − compra − comisiones'};
  }
  const backend=n(row.netPnlUsd)??n(row.pnl);
  if(backend!==null)return {value:backend,note:'PnL neto registrado por el motor'};
  return {value:null,note:null};
}
// Ciclo GRID = un tramo BUY (nivel comprado) + un tramo SELL (objetivo/ejecución).
// Muestra lado, precio, cantidad, estado y fecha de cada tramo; la ganancia neta
// solo aparece cuando es calculable con los campos reales del ciclo.
function gridCycleCard(ctx,row,index){
  const pro=ctx.mode==='pro';
  const pair=text(first(row,'pair','symbol','asset'))||'Par no informado';
  const cyc=first(row,'cycleNumber','id');
  const buyP=n(row.buyPrice),sellP=n(row.sellPrice),
    targetP=n(row.sellTarget)??n(row.targetSellPrice),
    qty=n(row.quantity)??n(row.buyQty),tqty=n(row.targetSellQuantity)??n(row.sellQty);
  const buyTs=first(row,'buyFilledAt','buyTs','buyAt','filledAt'),
    sellTs=first(row,'sellFilledAt','sellTs','completedAt');
  const stt=first(row,'status','state','sellState');
  const sellDone=sellP!==null||sellTs!=null||/sell_filled|completed|closed|trailing_closed|stop_loss/.test(String(stt||''));
  const buyDone=buyP!==null||buyTs!=null||!/pending|buy_placed|open$/.test(String(stt||''));
  const net=gridTrancheNet(row);
  const leg=(side,label,price,q,when,state)=>'<div class="nxs-leg nxs-leg-'+side.toLowerCase()+'">'+
   '<small>TRAMO '+side+'</small><strong>'+(price===null?'—':amount(price))+'</strong>'+
   '<span>'+(q===null?'':fmtNum(q,{dec:8})+' · ')+esc(label)+'</span>'+
   '<small>'+(state?gridCycleWord(state,pro)||'—':'—')+(when?' · '+esc(fmtTs(when)):'')+'</small></div>';
  return '<article class="nxs-record nxs-grid-cycle"><div class="nxs-record-top"><div>'+
   '<span class="nxs-record-kind">GRID · CICLO'+(cyc!=null?' #'+esc(String(cyc)):'')+'</span>'+
   '<h3>'+pair+'</h3><small>'+(stt?gridCycleWord(stt,pro):'Estado no informado')+'</small></div>'+
   '<div class="nxs-record-money"><strong>'+(net.value===null?'—':signedUsd(net.value))+'</strong>'+
   '<small>'+(net.value===null?(net.note||(sellDone?'Sin desglose de precio/comisiones':'La venta aún no se ha ejecutado; solo hay objetivo')):net.note)+'</small></div></div>'+
   '<div class="nxs-grid-legs">'+
   leg('BUY','Compra',buyP,qty,buyTs,buyDone?'buy_filled':stt)+
   leg('SELL',sellDone?'Venta ejecutada':'Objetivo de venta',sellP??targetP,tqty??qty,sellTs,sellDone?'sell_filled':(targetP!==null?'sell_placed':stt))+
   '</div>'+
   (sellP===null&&targetP!==null?'<p class="nxs-foot">Objetivo de venta '+amount(targetP)+
    (sellDone?'':' · pendiente de ejecución')+'. La ganancia neta se calcula solo cuando la venta tiene precio real.</p>':'')+
   '<div class="nxs-record-actions"><button data-inspect="'+esc('grid:cycles:'+index)+'">Ficha completa ↗</button></div></article>';
}
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
// Modos/estados de motor y checks de desbloqueo en castellano. El código crudo
// solo se imprime en Pro dentro de <code> (mismo patrón que marketStatus).
const STATE_WORDS={
  off:'Apagado',on:'Encendido',observing:'Observando',observe:'Observando',
  shadow:'Solo simulación',simulation:'Simulación',sim:'Simulación',
  dry_run:'Simulación (dry-run)',dryrun:'Simulación (dry-run)',paper:'Simulación',
  live:'Operativa real',real:'Operativa real',real_limited:'Operativa real limitada',
  real_full:'Operativa real completa',production:'Producción',prod:'Producción',
  shadow_live:'Simulación en vivo',disabled:'Desactivado',enabled:'Activado',
  running:'En marcha',stopped:'Detenido',pending:'Pendiente',active:'Activo',
  // Checks de desbloqueo GRID (status.unlock.checksPass/checksFail).
  real_authorized:'Autorización de ejecución real concedida',
  shadow_consistency:'Consistencia de la simulación',
  maker_only:'Solo órdenes maker',no_live_keys:'Sin claves de producción',
};
const stateWord=v=>{
  if(v===null||v===undefined||v==='')return null;
  const low=String(v).trim().toLowerCase();
  if(STATE_WORDS[low])return STATE_WORDS[low];
  const t=translateCode(v);
  return t===String(v)?String(v).replace(/_/g,' '):t;
};
const word=(v,pro)=>{const t=stateWord(v);if(t===null)return null;
  return pro&&String(v)!==t?esc(t)+' <code class="nxs-code">'+esc(String(v))+'</code>':esc(t);};
// Último evento relevante del motor: prefiere tipos que no sean telemetría
// periódica (ticks del monitor) y conserva ts real; nunca se inventa uno.
function lastRelevantEvent(ctx,id){
  const d=meta(ctx,id).data||{},cands=[];
  const grab=arr=>{if(Array.isArray(arr))for(const e of arr){
    if(!e||typeof e!=='object')continue;
    const ms=Date.parse(first(e,'ts','executedAt','createdAt','timestamp')||'');
    if(Number.isFinite(ms))cands.push({e,ms});
  }};
  grab(d.events);grab(d.monitor?.events);grab(d.monitor?.alerts);grab(d.trace?.decisions);
  if(!cands.length)return null;
  // Mismo criterio de scope que el resto de la vista: un evento con modo
  // explícito del otro entorno no se cuela; sin modo hereda el del motor.
  const scope=ctx.viewScope||'real',fb=modeFallback(ctx,id);
  const scoped=cands.filter(c=>inScope(c.e,scope,fb));
  const pool=scoped.length?scoped:cands;
  pool.sort((a,b)=>b.ms-a.ms);
  const tick=/tick|heartbeat|monitor_tick/i;
  const best=pool.find(c=>!tick.test(String(first(c.e,'type','kind','eventType','reason','msg')||'')));
  return (best||pool[0]).e;
}
function lastEventCard(ctx,id,e){
  const pro=ctx.mode==='pro',code=eventCode(e),cat=eventCategory(e);
  const ts=first(e,'ts','executedAt','createdAt','timestamp');
  return '<h2>Último evento relevante</h2><article class="nxs-record"><div class="nxs-record-top"><div>'+
   (cat?'<span class="nxs-cat nxs-cat-'+cat.id+'">'+cat.label+'</span>':'')+
   '<span class="nxs-record-kind">'+esc(id.toUpperCase())+(pro&&code?' <code class="nxs-code">'+esc(code)+'</code>':'')+'</span>'+
   '<h3>'+esc(describeEvent(e))+'</h3><small>'+(ts?esc(fmtTs(ts)):'Sin fecha comprobada')+'</small></div></div></article>';
}
// Resumen del motor para la subpestaña Estado: modo/estado, capital o
// configuración relevante, qué falta para actuar y el último evento. El
// historial completo NO se repite aquí: vive en sus subpestañas (STREAM).
function engineSummary(ctx,id){
  const d=meta(ctx,id).data||{},pro=ctx.mode==='pro';
  // Scope honesto: el modo puede ser 'OFF' (AMA) y el estado 'OBSERVING';
  // classifyMode solo devuelve en la primera clave conocida no desconocida,
  // así que se prueba mode y luego state/operationalState como environment.
  const fb=modeFallback(ctx,id),engState=first(d.status,'state','operationalState');
  if(!inScope({mode:fb,environment:engState},ctx.viewScope||'real'))
    return '<section class="nxs-group"><h2>Resumen del motor</h2><p class="nxs-empty">'+
     'El modo del motor no está confirmado para esta vista. Se omiten los agregados sin separar REAL y SHADOW.</p></section>';
  const fact=(l,v)=>v===null||v===undefined||v===''?'':'<div><small>'+esc(l)+'</small><strong>'+v+'</strong></div>';
  let facts='',pending='';
  if(id==='idca'){
    const s=d.summary||{},stt=d.status||{};
    const cap=n(s.capitalAllocatedUsd??s.allocatedCapitalUsd),used=n(s.capitalUsedUsd??s.capitalUsed),
      free=n(s.capitalFreeUsd??s.capitalFree),active=n(s.activeCyclesCount??s.activeCycles),
      bt=n(s.buysToday),st2=n(s.sellsToday);
    facts=
     fact('Capital asignado',amount(cap))+fact('Capital usado',amount(used))+fact('Capital libre',amount(free))+
     fact('PnL realizado',profit(n(s.realizedPnlUsd??s.realizedPnl)))+
     fact('PnL no realizado',profit(n(s.unrealizedPnlUsd??s.unrealizedPnl)))+
     fact('Ciclos activos',active===null?null:String(active))+
     (bt===null&&st2===null?'':fact('Compras / ventas hoy',String(bt??0)+' / '+String(st2??0)));
    if(stt.globalTradingPause===true)
      pending+='<p class="nxs-warning">La pausa global de negociación está activada: el motor no abrirá nuevas entradas aunque se cumplan las condiciones.</p>';
  }else if(id==='spot'){
    const stt=d.status||{},pos=chosen(ctx,id,'positions'),tr=chosen(ctx,id,'trades');
    const strat=first(stt,'strategy','activeStrategy','strategyName'),pairs=first(stt,'pairs');
    facts=
     fact('Estrategia',strat?text(strat):null)+
     fact('Pares configurados',Array.isArray(pairs)?String(pairs.length):null)+
     fact('Posiciones abiertas',pos.rows===null?'—':String(pos.rows.length))+
     fact('Operaciones en historial',tr.rows===null?'—':String(tr.rows.length));
    pending+='<p class="nxs-foot">El historial de operaciones es global del bot (origen no atribuido); no equivale a actividad exclusiva de SPOT.</p>';
    if(pos.rows!==null&&!pos.rows.length)
      pending+='<p class="nxs-empty">No hay posiciones abiertas en este entorno.</p>';
  }else if(id==='grid'){
    const s=d.status||{};
    const rng=s.rangeStatus??s.activeRangeStatus,rv=s.rangeVersion??s.activeRangeVersionNumber;
    const oc=n(s.openCycles??s.globalOpenCyclesCount??s.activeCyclesCount),
      ol=n(s.openLevels),pl=n(s.plannedLevels??s.plannedLevelsCount),
      np=n(s.netPnl??s.totalNetPnlUsd),
      cr=n(s.capitalReserved??s.capitalReservedUsd),ca=n(s.capitalAvailable??s.capitalAvailableUsd);
    const unlock=(s.unlock&&typeof s.unlock==='object')?s.unlock:null;
    const fails=Array.isArray(unlock?.checksFail)?unlock.checksFail:(Array.isArray(s.checksFail)?s.checksFail:[]);
    const passes=Array.isArray(unlock?.checksPass)?unlock.checksPass.length:null;
    const budget=n(s.capitalBudgetUsd),used=n(s.capitalUsedUsd);
    facts=
     fact('Rango',(rng||rv!==null&&rv!==undefined)?[text(rng),rv!==null&&rv!==undefined?'v'+esc(String(rv)):null].filter(Boolean).join(' · ')||null:null)+
     fact('Ciclos abiertos',oc===null?null:String(oc))+
     fact('Niveles abiertos / planificados',ol===null&&pl===null?null:(ol===null?'—':String(ol))+' / '+(pl===null?'—':String(pl)))+
     fact('PnL neto',profit(np))+
     fact('Capital reservado / disponible',cr===null&&ca===null?null:amount(cr)+' / '+amount(ca))+
     (budget===null?null:fact('Presupuesto',amount(budget)))+
     (used===null?null:fact('Capital usado',amount(used)))+
     fact('Controles SHADOW superados',passes===null?null:String(passes));
    if(s.circuitBreaker===true)
      pending+='<p class="nxs-warning">El interruptor de circuito del motor está abierto: la ejecución está detenida por seguridad.</p>';
    if(fails.length)
      pending+='<p class="nxs-empty"><b>Condiciones pendientes para ejecutar en real:</b> '+
       fails.map(x=>esc(stateWord(x)||String(x))).join(' · ')+'.</p>';
  }else if(id==='ama'){
    const s=d.status||{},m=d.mandate||{},r=d.readiness||{},p=d.portfolio||{};
    const score=n(m.scoring?.macroScore),thr=n(m.scoring?.threshold);
    const rc=n(r.readyCount),tc=n(r.totalCount);
    const blockers=Array.isArray(r.blockers)?r.blockers:[];
    const failed=(Array.isArray(r.checks)?r.checks:[]).filter(c=>c&&c.ok===false);
    facts=
     fact('Estado operativo',word(s.state??s.operationalState??null,pro))+
     fact('Par',text(first(s,'pair','symbol'))) +
     fact('Kill switch',s.killSwitch===true||s.killSwitchActive===true?'Activado':(s.killSwitch===false||s.killSwitchActive===false?'Inactivo':null))+
     fact('Mandato',text(first(m,'status')))+
     fact('Score macro / umbral',score===null&&thr===null?null:(score===null?'—':score.toFixed(2))+' / '+(thr===null?'—':thr.toFixed(2)))+
     fact('Comprobaciones de preparación',rc===null&&tc===null?null:String(rc??'—')+' / '+String(tc??'—'))+
     fact('Presupuesto AMA',amount(n(p.budgetUsd??p.allocatedCapitalUsd)))+
     fact('Exposición',amount(n(p.exposureUsd)));
    if(m.explanation)pending+='<p class="nxs-empty">'+esc(String(m.explanation))+'</p>';
    if(blockers.length||failed.length)
      pending+='<p class="nxs-empty"><b>Condiciones pendientes para actuar:</b> '+
       [...blockers.map(b=>esc(typeof b==='string'?stateWord(b)||b:(b?.detail||b?.message||b?.code||String(b)))),
        ...failed.map(c=>esc(c.label||c.id||'Comprobación fallida'))].join(' · ')+'.</p>';
  }
  const ev=lastRelevantEvent(ctx,id);
  return '<section class="nxs-group"><h2>Resumen del motor</h2>'+
   (facts?'<div class="nxs-engine-facts">'+facts+'</div>':'<p class="nxs-empty">La API no devuelve campos de resumen para este motor.</p>')+
   pending+
   (ev?lastEventCard(ctx,id,ev):'<p class="nxs-empty">Sin eventos del motor en la lectura actual.</p>')+
   '</section>';
}
function marketStatus(ctx,id){
 const d=meta(ctx,id).data||{};
 const contexts=d.pairContexts||{};
 const isPro=ctx.mode==='pro';
 const tr=v=>{const t=translateCode(v);return t===null?null:(isPro&&v&&t!==v?t+' <code class="nxs-code">'+esc(String(v))+'</code>':esc(t));};
 return '<section class="nxs-group"><h2>Qué está esperando el bot</h2>'+Object.entries(contexts).map(([pair,c])=>{
  const cycles=chosen(ctx,id,'cycles').rows||[];
  const open=cycles.filter(x=>x.row.pair===pair);
  const target=first(c,'targetEntryPrice','entryTargetPrice','nextBuyPrice');
  const cur=n(c.currentPrice),tgtN=n(target);
  const dist=Number.isFinite(cur)&&cur>0&&Number.isFinite(tgtN)&&tgtN>0?(((tgtN-cur)/cur)*100):null;
  const tb=c.trailingBuy&&typeof c.trailingBuy==='object'?c.trailingBuy:null;
  const fact=(l,v)=>v===null||v===undefined||v===''?'' :'<div><small>'+l+'</small><strong>'+v+'</strong></div>';
  const blockers=(c.hardBlockers||[]).map(x=>translateCode(x)).join(', ');
  const dec=tr(c.entryDecision),reb=tr(c.reboundSignal),reg=tr(c.regime),conf=tr(tb?.state??c.reboundSignal);
  // Una sola línea de decisión primero; los datos de contexto quedan compactos.
  const lead=c.hardBlocked
   ?'Entrada bloqueada'+(blockers?' por '+blockers:'')+'.'
   :dec?'Decisión del bot: '+dec+'.'
   :reb?reb+'.'
   :'El bot sigue evaluando la entrada; todavía no ha decidido comprar.';
  const dip=n(c.dipDetectedPct),req=n(c.requiredDipPct);
  const dipTxt=dip===null?null:fmtNum(dip,{dec:2})+' %'+(req===null?'':' (exigida '+fmtNum(req,{dec:2})+' %)');
  const actTxt=target?amount(tgtN)+(dist===null?'':' · '+(dist>0?'+':'')+fmtNum(Math.abs(dist),{dec:2})+' %')
   :(dist===null?null:(dist>0?'+':'')+fmtNum(Math.abs(dist),{dec:2})+' %');
  return '<article class="nxs-record"><h3>'+esc(pair)+'</h3><p><b>Qué decide ahora:</b> '+lead+'</p>'+
   '<div class="nxs-engine-facts">'+
   fact('Precio actual',amount(cur))+
   fact('Referencia (ancla)',amount(c.referencePrice)+(c.reference?' · '+esc(String(c.reference)):''))+
   fact('Activación / distancia',actTxt)+
   fact('Caída desde referencia',dipTxt)+
   fact('Confirmación (trailing)',conf)+
   fact('Régimen',reg)+
   fact('Score',n(c.entryScore)===null?null:n(c.entryScore).toFixed(1)+(c.confidenceGrade?' · '+esc(String(c.confidenceGrade)):''))+'</div>'+
   open.map(x=>'<p>Objetivo de venta del ciclo #'+text(x.row.id)+': '+amount(first(x.row,'tpTargetPrice','sellTarget'))+'</p>').join('')+
   '<small>Los precios son referencias del bot; la ejecución depende de sus condiciones y protecciones.</small></article>';
 }).join('')+(Object.keys(contexts).length?'':'<p class="nxs-empty">Este modo todavía no entrega un contexto de entrada por activo.</p>')+'</section>';
}
export function renderModesOverview(ctx){
 return '<div class="nxs-root"><div class="nxs-heading"><span>MODOS · '+esc(scopeTitle(ctx.viewScope))+'</span><h1>Tus modos de inversión</h1><p>Elige un modo para consultar su estado y sus próximas decisiones.</p></div><div class="nxs-overview">'+Object.entries(engines).map(([id,label])=>'<button class="nxs-mode-card" data-nav="engine:'+id+'"><strong>'+esc(label)+'</strong><span>'+esc(meta(ctx,id).state==='ok'?'Lectura disponible':meta(ctx,id).state==='stale'?'Datos de lectura anterior':'Lectura parcial o pendiente')+'</span><b>Abrir modo →</b></button>').join('')+'</div></div>';
}
export function renderScopedEngine(ctx){
 const id=ctx.ui?.engineId||'idca',info=meta(ctx,id),scope=ctx.viewScope||'real';
 const active=ctx.mode==='basic'&&ctx.ui?.subtab==='orders'?'panel':(ctx.ui?.subtab||'panel');
 const sections=stream.filter(([engine])=>engine===id).map(([engine,path,label])=>({engine,path,label}));
 if(!sections.length)return '<div class="nxs-root"><h2>Motor no identificado</h2></div>';
 const sub=sections.find(x=>x.path===active);
 // «Estado» es un RESUMEN del motor (modo, capital/config, qué falta para
 // actuar y último evento relevante): el historial completo NO se repite aquí,
 // cada lista sigue accesible en su subpestaña inferior (STREAM).
 const selected=active==='panel'?[]:sub?[sub]:[];
 let html='<div class="nxs-root"><div class="nxs-heading"><span>MODOS · '+esc(scopeTitle(scope))+'</span>'+
 '<h1>'+esc(engines[id]||id)+'</h1>'+
 '<p>Estado y actividad del modo en el entorno seleccionado.</p></div>'+
 '<nav class="nxs-mode-tabs" aria-label="Elegir modo">'+Object.entries(engines).map(([key,label])=>
 '<button data-nav="engine:'+key+'" class="'+(id===key?'on':'')+'" aria-current="'+(id===key?'page':'false')+'">'+esc(key.toUpperCase())+'</button>').join('')+'</nav>'+
 facts(ctx,id);
 if(info.state!=='ok'&&info.state!=='partial'&&info.state!=='stale')html+='<p class="nxs-warning">El motor no está disponible desde la API. No se genera un estado ficticio.</p>';
 if(active==='panel'){
   // IDCA conserva su contexto de entrada por par («qué decide ahora»);
   // SPOT/GRID/AMA muestran su propio resumen honesto de lo que devuelve
   // realmente cada endpoint (ver engineSummary).
   if(id==='idca')html+=marketStatus(ctx,id);
   html+=engineSummary(ctx,id);
 }
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
  (got.rows.length?got.rows.slice(0,80).map(({row,index})=>
    (id==='grid'&&x.path==='cycles'?gridCycleCard(ctx,row,index):recordCard(id,x.path,row,index,ctx))).join(''):
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
// Fuentes de actividad por motor, además del feed de notificaciones. Los
// trades de /trades/closed son GLOBALES (el backend no atribuye motor): se
// etiquetan 'common' y nunca se presentan como SPOT.
const ACTIVITY_PATHS={
  idca:[['events','events']],
  grid:[['events','events'],['monitor.events','monitor.events'],['monitor.alerts','monitor.alerts']],
  // provider.ama no emite trace.events (solo trace.decisions, alimentado por
  // GET /ama/events): el path muerto se retira; si el backend lo publica en el
  // futuro basta re-añadirlo aquí.
  ama:[['trace.decisions','trace.decisions']],
};
// Une feed + eventos reales de cada motor. Cada fila conserva `_ref`, la ruta
// exacta (motor:path:índice) que resuelve el inspector sin inventar datos.
// Deduplica por motor+id+ts+texto para no repetir el mismo evento dos veces.
export function collectActivity(ctx){
  const rows=[],seen=new Set(),sources=[];
  const feed=ctx.data?.activity?.data?.events;
  const feedIsArray=Array.isArray(feed);
  if(feedIsArray)sources.push('notifications');
  const push=(e,engine,ref)=>{
    if(!e||typeof e!=='object')return;
    // La fuente conocida (motor dueño del endpoint) manda sobre una etiqueta
    // `engine` ambigua del payload: el fallback de modo se resuelve por motor.
    const eng=engine||e.engine||'common';
    const key=String(eng)+'|'+String(e.id??'')+'|'+String(e.ts??e.executedAt??'')+'|'+String(e.msg??e.message??e.text??e.type??'');
    if(seen.has(key))return;seen.add(key);
    rows.push({e:{...e,engine:eng},ref});
  };
  if(feedIsArray)feed.forEach((e,i)=>push(e,null,'common:events:'+i));
  for(const id of Object.keys(ACTIVITY_PATHS)){
    const d=meta(ctx,id).data||{};
    for(const [path,inspectPath] of ACTIVITY_PATHS[id]){
      const arr=getPath(d,path);
      if(Array.isArray(arr)){sources.push(id+':'+path);arr.forEach((e,i)=>push(e,id,id+':'+inspectPath+':'+i));}
    }
  }
  // Los trades de /trades/closed NO entran aquí: son globales y sin modo
  // identificado siempre caerían en «desconocidos». Ya se consultan en la
  // sección «Historial global (origen no atribuido)» del motor SPOT.
  rows.sort((a,b)=>new Date(b.e.ts||b.e.executedAt||0)-new Date(a.e.ts||a.e.executedAt||0));
  return {rows,sources};
}
export function renderScopedActivity(ctx){
 const scope=ctx.viewScope||'real',f=ctx.ui?.activityFilter||{};
 const {rows,sources}=collectActivity(ctx);
 const fb=e=>modeFallback(ctx,String(e.engine||''));
 const visible=sources.length?rows.filter(x=>inScope(x.e,scope,fb(x.e)))
   .filter(x=>(f.engine==='all'||!f.engine||String(x.e.engine||'')===f.engine)&&
    (f.sev==='all'||!f.sev||String(x.e.severity||x.e.level||'')===f.sev)&&
    (f.cat==='all'||!f.cat||eventCategory(x.e).id===f.cat)):null;
 const unknown=sources.length?rows.filter(x=>classifyMode(x.e,fb(x.e))==='unknown').length:null;
 return '<div class="nxs-root"><div class="nxs-heading"><span>'+esc(scopeTitle(scope))+' · ACTIVIDAD</span>'+
 '<h1>Movimientos del bot</h1><p>Solo eventos identificados de este entorno. Los eventos de modo desconocido se excluyen de ambos modos.</p></div>'+
 '<div class="nxs-filters"><button data-ui="eng:all">Todos</button>'+['idca','spot','grid','ama','common'].map(x=>
 '<button data-ui="eng:'+x+'">'+x.toUpperCase()+'</button>').join('')+'</div>'+
 (visible?dedupeEvents(visible.map(x=>({...x.e,_ref:x.ref}))).slice(0,100).map(e=>{
   const fake=esc(String(e.engine||'common')+':events:0');
   return recordCard(String(e.engine||'common'),'events',e,0,ctx)
    .replace('data-inspect="'+fake+'"','data-inspect="'+esc(e._ref)+'"');
  }).join('')||
  '<p class="nxs-empty">Sin eventos verificados de este entorno en la lectura actual.</p>':
 '<p class="nxs-empty">La API no devuelve el historial de eventos. No significa que no existan.</p>')+
 (unknown?'<p class="nxs-warning">'+unknown+' eventos no tienen modo operativo identificable; no se han atribuido a REAL ni SHADOW.</p>':'')+'</div>';
}
