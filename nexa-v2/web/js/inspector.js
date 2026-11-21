// NEXA V2 — ficha universal de inspección. SOLO LECTURA: no emite órdenes ni muta el estado.
// La referencia data-inspect apunta a un registro del read-model real de la sesión activa.
// Datos desconocidos = "—"; jamás inferir 0 ni rellenar precios/resultado.
import { openModal } from './ui.js';
import { esc, fmtUsd, fmtTs, signedUsd, signedPct, duration } from './util.js';

const SECRET=/(token|password|secret|api.?key|authorization|cookie|private.?key|credential|bearer|passphrase|mnemonic)/i;
const LABELS={
  id:'ID de registro',orderId:'ID de orden',cycleId:'ID de ciclo',pair:'Par',symbol:'Par',
  side:'Operación',status:'Estado',state:'Estado',mode:'Modo operativo',type:'Tipo de orden',
  execType:'Tipo de ejecución',createdAt:'Creación',updatedAt:'Última actualización',
  ts:'Fecha y hora',executedAt:'Ejecución',startedAt:'Apertura',closedAt:'Cierre',
  price:'Precio',avgPrice:'Precio medio',avgEntryPrice:'Precio de entrada',
  currentPrice:'Precio actual',buyPrice:'Precio de compra',sellPrice:'Precio de venta',
  sellTargetPrice:'Objetivo de venta',tpTargetPrice:'Objetivo Take Profit',
  quantity:'Cantidad',qty:'Cantidad',buyQty:'Cantidad comprada',sellQty:'Cantidad vendida',
  valueUsd:'Importe bruto (USD)',grossValueUsd:'Valor bruto (USD)',
  netValueUsd:'Valor neto (USD)',capitalUsedUsd:'Capital empleado (USD)',
  plannedUsd:'Importe previsto (USD)',executedUsd:'Importe ejecutado (USD)',
  realizedPnlUsd:'PnL realizado (USD)',unrealizedPnlUsd:'PnL sin realizar (USD)',
  pnlUsd:'PnL (USD)',pnl:'Resultado',feeUsd:'Comisión (USD)',
  feesUsd:'Comisiones (USD)',slippageUsd:'Deslizamiento (USD)',
  slippagePct:'Deslizamiento (%)',pnlPct:'Rentabilidad (%)',
  realizedPnlPct:'Rentabilidad realizada (%)',closeReason:'Motivo de salida',
  reason:'Motivo',triggerReason:'Disparador',exitType:'Tipo de cierre',
  breakEven:'Break-even',trailing:'Trailing stop',timeStop:'Límite de tiempo',
  rangeVersionId:'Versión del rango',rangeRelation:'Relación con el rango',
  buyFillTs:'Hora de compra ejecutada',sellFillTs:'Hora de venta ejecutada',
  buyCount:'Número de compras',executed:'Ejecutada',venue:'Exchange',
};
const TITLES={
 'idca:orders':'Orden IDCA','idca:history':'Ciclo cerrado IDCA','idca:cycles':'Ciclo IDCA',
 'spot:trades':'Operación SPOT','spot:positions':'Posición SPOT',
 'grid:cycles':'Ciclo GRID','grid:levels.levels':'Nivel GRID',
 'grid:monitor.orderStates':'Orden GRID','grid:monitor.cancellations':'Cancelación GRID',
 'ama:trace.orders':'Orden AMA','ama:trace.tranches':'Tramo AMA',
 'ama:trace.ledger':'Apunte de ledger AMA','ama:trace.decisions':'Decisión AMA',
 'ama:mandate':'Mandato AMA','common:events':'Evento del bot',
 'common:portfolio.holdings':'Activo de cartera','common:portfolio.ledger':'Movimiento de cartera',
 'common:portfolio.reservations':'Reserva de cartera',
};
const num=v=>{
 if(typeof v==='number'&&Number.isFinite(v))return v;
 if(typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v)))return Number(v);
 return null;
};
const first=(r,...ks)=>{for(const k of ks){if(r?.[k]!==undefined&&r?.[k]!==null&&r?.[k]!=='')return r[k];}return null;};
const label=k=>LABELS[k]||String(k).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ');
const safe=v=>v===undefined||v===null||v===''?'—':String(v);
const value=(k,v)=>{
 if(v===undefined||v===null||v==='')return '<span class="nx-inspect-missing">No disponible</span>';
 if(typeof v==='boolean')return v?'Sí':'No';
 if(typeof v==='number'&&!Number.isFinite(v))return '<span class="nx-inspect-missing">No disponible</span>';
 if(/(At|Ts|timestamp|date)$/i.test(k)&&typeof v==='string'&&!Number.isNaN(Date.parse(v)))return esc(fmtTs(v));
 return esc(String(v));
};
const money=v=>num(v)===null?'—':fmtUsd(num(v));
const tone=(n)=>num(n)===null?'':num(n)<0?'is-negative':num(n)>0?'is-positive':'';
function fieldValue(k,v,depth=0){
 if(v===null||v===undefined||v==='')return '<span class="nx-inspect-missing">No disponible</span>';
 if(typeof v!=='object')return value(k,v);
 if(depth>4)return '<em>Objeto complejo disponible en la API</em>';
 if(Array.isArray(v)){
   if(!v.length)return '<span class="nx-inspect-missing">Lista vacía (0 registros)</span>';
   return '<div class="nx-inspect-nested">'+v.map((x,i)=>
     '<details class="nx-inspect-fold"><summary>'+esc(label(k))+' '+(i+1)+'</summary>'+
     (x&&typeof x==='object'?fields(x,depth+1):'<p>'+value(k,x)+'</p>')+'</details>').join('')+'</div>';
 }
 return fields(v,depth+1);
}
function fields(record,depth=0){
 if(!record||typeof record!=='object')return '';
 const entries=Object.entries(record).filter(([k,v])=>!SECRET.test(k)&&typeof v!=='function');
 // Mostrar primero lo auténticamente disponible, no una montaña de «No disponible».
 // Todos los campos sin dato siguen accesibles y claramente marcados en el desplegable.
 const known=entries.filter(([,v])=>v!==null&&v!==undefined&&v!=='');
 const missing=entries.filter(([,v])=>v===null||v===undefined||v==='');
 const markup=known.map(([k,v])=>'<div class="nx-inspect-field"><dt>'+esc(label(k))+
      '</dt><dd>'+fieldValue(k,v,depth)+'</dd></div>').join('');
 return '<dl class="nx-inspect-fields">'+markup+'</dl>'+
   (missing.length?'<details class="nx-inspect-absent"><summary>'+missing.length+
   ' campos sin información confirmada</summary><p>'+missing.map(([k])=>esc(label(k))).join(' · ')+'</p></details>':'');
}
const getPath=(obj,path)=>path.split('.').reduce((o,k)=>o?.[k],obj);
export function resolve(state,ref){
 const parts=String(ref||'').split(':');
 if(parts.length!==3)return null;
 const [engine,path,key]=parts;
 if(!/^(idca|spot|grid|ama|common)$/.test(engine)||!/^[a-zA-Z.]+$/.test(path))return null;
 let root,sub=path;
 if(engine==='common'){
   if(path==='events')root=state.common?.activity?.data;
   else{const seg=path.split('.')[0];root=state.common?.[seg]?.data;sub=path.slice(seg.length+1);}
 }else root=state.enginesData?.[engine]?.data;
 const raw=getPath(root,sub);
 if(raw===null||raw===undefined)return null;
 let record;
 if(Array.isArray(raw)){
   if(/^\d+$/.test(key))record=raw[Number(key)];
   else if(key.startsWith('id='))record=raw.find(x=>String(x?.id??x?.orderId)===decodeURIComponent(key.slice(3)));
 }else if(key==='single')record=raw;
 if(!record||typeof record!=='object')return null;
 return {engine,path,record,ref};
}
function summary(record){
 const side=safe(first(record,'side','action','orderSide')).toUpperCase();
 const kind=side==='BUY'?'COMPRA':side==='SELL'?'VENTA':safe(first(record,'type','status','state'));
 const result=first(record,'realizedPnlUsd','unrealizedPnlUsd','pnlUsd','netPnlUsd','pnl');
 const price=first(record,'price','avgFillPrice','buyPrice','sellPrice','avgEntryPrice');
 const amount=first(record,'grossValueUsd','valueUsd','netValueUsd','executedUsd','capitalUsedUsd','plannedUsd');
 return {kind,result,price,amount,
  quantity:first(record,'quantity','qty','buyQty','sellQty','totalQuantity'),
  reason:first(record,'closeReason','triggerReason','reason','exitType','humanReason','naturalMessage','message','msg','text'),
  stamp:first(record,'executedAt','ts','buyFillTs','sellFillTs','startedAt','createdAt','closedAt'),
  mode:first(record,'mode','executionMode'),
  state:first(record,'status','state','executionStatus'),
  pair:first(record,'pair','symbol','asset'),
  id:first(record,'id','orderId','cycleId','mandateId'),
 };
}
function relatedOrders(state,engine,path,record){
 if(engine!=='idca'||(path!=='cycles'&&path!=='history'))return '';
 const id=first(record,'id','cycleId');
 const all=state.enginesData?.idca?.data?.orders;
 if(id===null||!Array.isArray(all))return '';
 const matches=all.filter(o=>o?.cycleId!==undefined&&o.cycleId!==null&&String(o.cycleId)===String(id));
 if(!matches.length)return '<p class="nx-inspect-source">No se han recibido órdenes vinculadas a este ciclo en la lectura actual. Esto no demuestra que no existan.</p>';
 return '<section class="nx-inspect-linked"><h3>Órdenes vinculadas ('+matches.length+')</h3>'+
   matches.map(o=>{
    const side=String(o.side||'').toUpperCase(),isBuy=side==='BUY';
    return '<details class="nx-inspect-fold"><summary><span class="nx-inspect-pill '+(isBuy?'buy':side==='SELL'?'sell':'neutral')+'">'+esc(side||'Operación')+'</span> '+
       esc(String(o.id??'Sin ID'))+' · '+esc(money(first(o,'grossValueUsd','valueUsd')))+'</summary>'+
       fields(o)+'</details>';
   }).join('')+'</section>';
}

const REASONS={
  fail_safe:'Salida de seguridad: el sistema cerró el ciclo siguiendo su protección de emergencia',
  trailing:'Salida por trailing stop: protege el beneficio al retroceder desde un máximo',
  trailing_stop:'Salida por trailing stop: protege el beneficio acumulado',
  trailing_exit_dust_adj:'Salida por trailing: ajustó el pequeño saldo residual al cerrar',
  take_profit:'Venta por objetivo de beneficio alcanzado (take profit)',
  tp:'Venta por objetivo de beneficio',
  break_even:'Salida de protección en punto de equilibrio',
  breakeven_sell:'Venta por break-even para limitar pérdidas o proteger capital',
  time_stop:'Salida por límite máximo de duración',
  mode_transition_simulation_to_live:'Cierre de transición entre simulación y operativa LIVE',
  manual:'Cierre manual registrado',
  final_sell:'Venta final del ciclo',
  base_buy:'Compra de apertura del ciclo',
  safety_buy:'Compra adicional de protección (DCA)',
};
const STATUS_ES={closed:'Cerrado',open:'Abierto',filled:'Ejecutada',partial:'Parcial',partially_filled:'Parcial',
  cancelled:'Cancelada',canceled:'Cancelada',pending:'Pendiente',rejected:'Rechazada',
  reserved:'Reservado, sin orden ejecutada',simulation:'Simulación',live:'LIVE',shadow:'SHADOW'};
const translate=(v,dict)=>v==null||v===''?'—':dict[String(v).toLowerCase()]||String(v).replaceAll('_',' ');
const reasonText=v=>{
 if(v==null||v==='')return 'La API no facilita el motivo de esta operación.';
 const key=String(v).toLowerCase().trim();
 return REASONS[key]||String(v).replaceAll('_',' ');
};
const euroDate=v=>v?fmtTs(v):'—';
const amountOrDash=v=>num(v)===null?'—':fmtUsd(num(v));
const pctText=v=>num(v)===null?'—':signedPct(num(v));
const signedMoney=v=>num(v)===null?'—':signedUsd(num(v));
const item=(k,v)=>'<div class="nx-detail-metric"><span>'+esc(k)+'</span><strong>'+v+'</strong></div>';
const labelUnit=(v,unit)=>num(v)===null?'—':esc(String(v))+(unit?' '+esc(unit):'');
const pill=(v,kind='')=>'<span class="nx-inspect-pill '+esc(kind)+'">'+esc(v)+'</span>';
const perfColor=p=>num(p)===null?'missing':num(p)>0?'positive':num(p)<0?'negative':'neutral';
const dateSort=x=>new Date(x?.ts||x?.executedAt||x?.buyFillTs||x?.sellFillTs||x?.createdAt||0).getTime()||0;
function linked(state,engine,path,rec){
 if(engine!=='idca'||!['cycles','history'].includes(path))return [];
 const all=state.enginesData?.idca?.data?.orders;
 if(!Array.isArray(all))return [];
 return all.filter(o=>o?.cycleId!=null&&String(o.cycleId)===String(rec?.id??rec?.cycleId))
  .slice().sort((a,b)=>dateSort(a)-dateSort(b));
}
const isCycle=path==='cycles'||path==='history'||(path==='cycles'&&['idca','grid','ama'].includes(path));
const statusName=v=>translate(v,STATUS_ES);
function financial(s,record,engine,path,orders){
 const closed=path==='history'||String(s.state||'').toLowerCase()==='closed'||record.closedAt!=null;
 const realized=first(record,'realizedPnlUsd','netPnlUsd','netPnl','pnlNet');
 const unrealized=first(record,'unrealizedPnlUsd','unrealizedPnl');
 const rawGeneral=first(record,'pnlUsd','pnl');
 const pnl=closed?first({a:realized,b:rawGeneral},'a','b'):first({a:unrealized,b:rawGeneral},'a','b');
 const pnlPct=closed?first(record,'realizedPnlPct','realizedPct','pnlPct'):
   first(record,'unrealizedPnlPct','pnlPct');
 const cycle=['history','cycles'].includes(path);
 const fee=first(record,'feesUsd','feeUsd','totalFeesUsd','feeTotalUsd');
 const invested=first(record,'capitalUsedUsd','investedUsd','capitalUsed','capitalInvestedUsd');
 const reserved=first(record,'capitalReservedUsd','capitalReserved');
 const sold=first(record,'sellValueUsd','valueSoldUsd','totalSoldUsd','soldUsd');
 const gross=first(record,'grossValueUsd','valueUsd','netValueUsd');
 const computedOrderGross=orders.length?orders.filter(o=>String(o.side).toUpperCase()==='SELL')
   .filter(o=>num(o.valueUsd??o.grossValueUsd)!==null).reduce((t,o)=>t+num(o.valueUsd??o.grossValueUsd),0):null;
 const stats=[];
 if(cycle){
   stats.push(['Capital invertido',amountOrDash(invested)],['Valor vendido'+(sold===null&&computedOrderGross!==null?' (órdenes visibles)':''),amountOrDash(sold??computedOrderGross)],
     ['N.º compras',labelUnit(first(record,'buyCount','buys'))],
     ['Precio de entrada',amountOrDash(first(record,'avgEntryPrice','avgPrice','entryPrice'))],
     ['Cantidad',labelUnit(first(record,'totalQuantity','quantity','qty'))],
     ['Comisiones',amountOrDash(fee)],
     ['Apertura',esc(euroDate(first(record,'startedAt','openedAt')))],
     ['Cierre',esc(euroDate(first(record,'closedAt','endedAt')))],
     ['Duración',closed&&record.startedAt&&record.closedAt?esc(duration(record.startedAt,record.closedAt)):'—']);
   if(num(reserved)!==null)stats.push(['Capital reservado (no es gasto)',amountOrDash(reserved)]);
 } else {
   stats.push(['Precio',amountOrDash(first(record,'price','avgFillPrice','buyPrice','sellPrice'))],
     ['Cantidad',labelUnit(first(record,'quantity','qty','totalQuantity'))],
     ['Importe',amountOrDash(gross)],
     ['Comisión',amountOrDash(fee)],
     ['Deslizamiento',amountOrDash(first(record,'slippageUsd'))],
     ['Referencia temporal',esc(euroDate(s.stamp))]);
 }
 if(path==='cycles'||engine==='grid'){
   for(const [title,keys] of [['Precio actual',['currentPrice','marketPrice']],['Objetivo de venta',['tpTargetPrice','sellTargetPrice','sellTarget']],['Próxima compra',['nextBuyPrice']]]){
     const x=first(record,...keys);if(num(x)!==null)stats.push([title,amountOrDash(x)]);
   }
 }
 return {closed,cycle,pnl,pnlPct,stats,invested,reserved,sold};
}
function timeline(orders,record){
 const evt=Array.isArray(record?.timeline)?record.timeline:Array.isArray(record?.events)?record.events:[];
 const lines=orders.length?orders.map(o=>({
    ts:first(o,'ts','executedAt','buyFillTs','sellFillTs'),
    action:String(o.side||o.type||'').toUpperCase()==='BUY'?'COMPRA':String(o.side||'').toUpperCase()==='SELL'?'VENTA':translate(o.type||o.side,STATUS_ES),
    desc:reasonText(first(o,'reason','closeReason','triggerReason')),
    total:first(o,'valueUsd','grossValueUsd','netValueUsd'),
    side:String(o.side||'').toUpperCase(),id:o.id,
  })):evt.map(e=>({ts:first(e,'ts','createdAt','at'),action:e.type||e.action||'Evento',
    desc:reasonText(first(e,'message','reason','text')),total:null,side:''}));
 if(!lines.length)return '';
 return '<section class="nx-inspect-timeline"><h3>Cronología del ciclo ('+lines.length+')</h3>'+
 '<div class="nx-inspect-timeline-list">'+lines.map(o=>'<div class="nx-inspect-timeline-row">'+
  '<span class="nx-inspect-timeline-dot '+(o.side==='BUY'?'is-buy':o.side==='SELL'?'is-sell':'')+'"></span>'+
  '<div><b>'+esc(o.action)+'</b><small>'+esc(euroDate(o.ts))+'</small><p>'+esc(o.desc)+'</p></div>'+
  (num(o.total)!==null?'<strong>'+esc(amountOrDash(o.total))+'</strong>':'')+
  '</div>').join('')+'</div></section>';
}
function linkedCards(orders){
 if(!orders.length)return '';
 return '<section class="nx-inspect-linked nx-inspect-linked-important"><h3>Órdenes del ciclo ('+orders.length+')</h3>'+
 orders.map(o=>'<details class="nx-inspect-fold nx-inspect-order">'+
  '<summary>'+pill(String(o.side||'Orden').toUpperCase(),String(o.side||'').toUpperCase()==='BUY'?'buy':'sell')+
  '<span><b>'+esc(amountOrDash(first(o,'valueUsd','grossValueUsd')))+'</b><small>'+
    esc(euroDate(first(o,'ts','executedAt','buyFillTs','sellFillTs')))+' · #'+esc(safe(first(o,'id','orderId')))+'</small></span><span aria-hidden="true">⌄</span></summary>'+
  '<div class="nx-inspect-order-body"><p>'+esc(reasonText(first(o,'reason','type','closeReason')))+'</p>'+
  '<div class="nx-inspect-order-figures">'+item('Precio',esc(amountOrDash(first(o,'price','avgFillPrice'))))+
   item('Cantidad',esc(safe(first(o,'quantity','qty'))))+item('Comisiones',esc(amountOrDash(first(o,'feeUsd','feesUsd'))))+'</div>'+
  '<details class="nx-inspect-all"><summary>Detalles técnicos de esta orden</summary>'+fields(o)+'</details></div></details>').join('')+'</section>';
}
export function showRecordInspector(state,ref){
 const resolved=resolve(state,ref);
 if(!resolved){
   openModal('<div class="nx-inspector" role="dialog" aria-modal="true"><h2>Detalle no disponible</h2>'+
     '<p>La API no ha proporcionado este registro en la lectura actual. No se generan cifras ficticias.</p></div>');
   return;
 }
 const {engine,path,record}=resolved;
 const s=summary(record),orders=linked(state,engine,path,record),f=financial(s,record,engine,path,orders);
 const heading=TITLES[engine+':'+path]||'Detalle de registro';
 const keyKind=String(s.kind||'').toUpperCase();
 const signal=keyKind==='BUY'||keyKind==='COMPRA'?'buy':keyKind==='SELL'||keyKind==='VENTA'?'sell':'neutral';
 const name=signal==='buy'?'COMPRA':signal==='sell'?'VENTA':f.cycle?(f.closed?'CICLO CERRADO':'CICLO ABIERTO'):statusName(s.state||s.kind);
 const pnlPresent=num(f.pnl)!==null;
 const performanceLabel=pnlPresent?(f.closed?'Resultado neto del cierre':'Resultado no realizado'):'Resultado sin verificar';
 const valueNum=pnlPresent?f.pnl:null;
 const heroMain=pnlPresent?signedMoney(valueNum):f.cycle?'—':amountOrDash(first(record,'grossValueUsd','valueUsd','executedUsd','capitalUsedUsd'));
 const heroLabel=pnlPresent?performanceLabel:f.cycle?'Resultado no confirmado':'Importe de la operación';
 const warn=!pnlPresent&&f.cycle?'<p class="nx-inspect-caution">No hay beneficio o pérdida verificable en esta lectura. No se considera resultado cero ni se suma como ganancia.</p>':'';
 const importFlag=record.isImported===true||record.imported===true;
 const pct=pnlPresent&&num(f.pnlPct)!==null?
  '<span class="nx-inspect-percent nx-inspect-'+perfColor(f.pnl)+'">'+esc(pctText(f.pnlPct))+'</span>':'';
 const mode=first(record,'mode','executionMode'),status=first(record,'status','state','executionStatus');
 const labelReason=first(record,'closeReason','reason','triggerReason','exitType','type','humanReason');
 const summaryText=f.cycle?
  (f.closed?'Ciclo finalizado. El beneficio/pérdida mostrado es el resultado registrado en el backend.':
    'Ciclo abierto: los importes pueden variar. Una reserva de capital no equivale a compra ejecutada.'):
   (signal==='buy'?'Orden de compra registrada. El importe no constituye un beneficio.':
    signal==='sell'?'Orden de venta registrada. El importe vendido no equivale al beneficio neto.':
    'Registro operativo: el estado debe verificarse antes de interpretarlo como ejecución.');
 const meta='<span>'+esc(safe(s.pair))+'</span><span>#'+esc(safe(s.id))+'</span>'+
  (mode!=null?pill(statusName(mode),String(mode).toLowerCase()==='live'?'live':'simulation'):'')+
  (status!=null?pill(statusName(status)):'')+
  (importFlag?pill('Importado','imported'):'');
 const figures=f.stats.map(([k,v])=>item(k,v)).join('');
 const body='<div class="nx-inspector nx-inspector-v2" role="dialog" aria-modal="true" aria-labelledby="nx-inspector-title">'+
  '<div class="nx-inspect-head"><span class="nx-inspect-eyebrow">NEXA · '+esc(engine.toUpperCase())+'</span>'+
   '<h2 id="nx-inspector-title">'+esc(heading)+'</h2>'+
   '<div class="nx-inspect-head-meta">'+pill(name,signal)+meta+'</div></div>'+
  '<section class="nx-inspect-hero '+(pnlPresent?'is-'+perfColor(f.pnl):'is-unverified')+'">'+
   '<small>'+esc(heroLabel)+'</small><div class="nx-inspect-result-line"><strong>'+esc(heroMain)+'</strong>'+pct+'</div>'+
   '<p>'+esc(summaryText)+'</p>'+warn+'</section>'+
  '<section class="nx-inspect-main"><h3>Resumen de la operación</h3><div class="nx-inspect-priority nx-inspect-priority-v2">'+figures+'</div></section>'+
  '<section class="nx-inspect-reason nx-inspect-reason-v2"><small>Motivo de ejecución o salida</small>'+
   '<p>'+esc(reasonText(labelReason))+'</p>'+
   (labelReason?'<span class="nx-inspect-code">Código: '+esc(labelReason)+'</span>':'')+'</section>'+
  timeline(orders,record)+linkedCards(orders)+
  '<details class="nx-inspect-all nx-inspect-technical"><summary>Datos técnicos completos · desplegar</summary>'+
   '<p class="nx-inspect-technical-help">Campos originales y normalizados, incluidas estructuras anidadas, sin modificar. No es necesario consultarlos para entender la operación.</p>'+
   fields(record)+'</details>'+
  '<p class="nx-inspect-source">Origen: API de solo lectura de '+esc(engine.toUpperCase())+
  '. Importes y estados sin datos permanecen pendientes de verificación. Abrir esta ficha no ejecuta operaciones.</p></div>';
 openModal(body);
}
