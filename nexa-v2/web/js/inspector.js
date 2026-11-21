// NEXA V2 — ficha universal de inspección. SOLO LECTURA: no emite órdenes ni muta el estado.
// La referencia data-inspect apunta a un registro del read-model real de la sesión activa.
// Datos desconocidos = "—"; jamás inferir 0 ni rellenar precios/resultado.
import { openModal } from './ui.js';
import { esc, fmtUsd, fmtTs } from './util.js';

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
 return '<dl class="nx-inspect-fields">'+Object.entries(record)
   .filter(([k,v])=>!SECRET.test(k)&&typeof v!=='function')
   .map(([k,v])=>'<div class="nx-inspect-field"><dt>'+esc(label(k))+
      '</dt><dd>'+fieldValue(k,v,depth)+'</dd></div>').join('')+'</dl>';
}
const getPath=(obj,path)=>path.split('.').reduce((o,k)=>o?.[k],obj);
function resolve(state,ref){
 const parts=String(ref||'').split(':');
 if(parts.length!==3)return null;
 const [engine,path,key]=parts;
 if(!/^(idca|spot|grid|ama|common)$/.test(engine)||!/^[a-zA-Z.]+$/.test(path))return null;
 const root=engine==='common'?state.common?.activity?.data:state.enginesData?.[engine]?.data;
 const raw=getPath(root,path);
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
  reason:first(record,'closeReason','triggerReason','reason','exitType','humanReason'),
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
export function showRecordInspector(state,ref){
 const found=resolve(state,ref);
 if(!found){
   openModal('<div class="nx-inspector" role="dialog" aria-modal="true"><h2>Detalle no disponible</h2><p>Este registro no está presente en la lectura actual de la API. No se genera información ficticia.</p></div>');
   return;
 }
 const {engine,path,record}=found,s=summary(record),heading=TITLES[engine+':'+path]||'Detalle de operación';
 const hasPnl=num(s.result)!==null;
 const mainStat=hasPnl?money(s.result):money(s.amount);
 const mainLabel=hasPnl?'Resultado (USD)':(num(s.amount)!==null?'Importe (USD)':'Detalle de registro');
 const pill=/^BUY$/i.test(s.kind)?'buy':/^SELL$/i.test(s.kind)?'sell':'neutral';
 const body='<div class="nx-inspector" role="dialog" aria-modal="true" aria-labelledby="nx-inspector-title">'+
  '<div class="nx-inspect-head"><span class="nx-inspect-eyebrow">'+esc(engine.toUpperCase())+' · '+esc(path)+'</span>'+
  '<h2 id="nx-inspector-title">'+esc(heading)+'</h2>'+
  '<div class="nx-inspect-head-meta"><span class="nx-inspect-pill '+pill+'">'+esc(s.kind)+'</span>'+
    '<span>'+esc(safe(s.pair))+'</span><span> #'+esc(safe(s.id))+'</span></div></div>'+
  '<div class="nx-inspect-hero '+tone(hasPnl?s.result:s.amount)+'"><small>'+mainLabel+'</small>'+
   '<strong>'+esc(mainStat)+'</strong>'+
   (hasPnl?'<small>Importe: '+esc(money(s.amount))+'</small>':'')+'</div>'+
  '<div class="nx-inspect-priority">'+
   '<div><small>Precio</small><b>'+esc(money(s.price))+'</b></div>'+
   '<div><small>Cantidad</small><b>'+esc(safe(s.quantity))+'</b></div>'+
   '<div><small>Estado</small><b>'+esc(safe(s.state))+'</b></div>'+
   '<div><small>Modo</small><b>'+esc(safe(s.mode))+'</b></div></div>'+
  '<div class="nx-inspect-reason"><small>Motivo / señal de ejecución o salida</small><p>'+esc(safe(s.reason))+'</p></div>'+
  '<div class="nx-inspect-stamp">Fecha de referencia: '+(s.stamp?esc(fmtTs(s.stamp)):'No disponible')+'</div>'+
  '<details open class="nx-inspect-all"><summary>Todos los datos disponibles del registro</summary>'+fields(record)+'</details>'+relatedOrders(state,engine,path,record)+
  '<p class="nx-inspect-source">Fuente: lectura de API del motor '+esc(engine.toUpperCase())+
  '. Los campos ausentes se muestran como «No disponible». Abrir esta ficha no ejecuta ninguna operación.</p></div>';
 openModal(body);
}
