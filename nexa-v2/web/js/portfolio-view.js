// NEXA Cartera V3: cartera REAL de exchanges ≠ capital asignado del bot ≠ SHADOW.
// UX profesional navegable, sin sumar saldos parciales como patrimonio global.
import {esc,fmtUsd,fmtNum,fmtTs,signedUsd} from './util.js';
import {SCOPE_SHADOW,scopeSubtitle} from './display-scope.js';

const n=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
const one=(o,...keys)=>{for(const k of keys){const v=o?.[k];if(v!==undefined&&v!==null&&v!=='')return v;}return null;};
const asUSD=v=>n(v)===null?'—':fmtUsd(n(v));
const value=v=>v===null||v===undefined||v===''?'—':esc(String(v));
const label=v=>String(v||'').replace(/_/g,' ');
const attr=s=>esc(String(s??''));
const stat=(k,v,note='')=>'<div class="nxw-stat"><small>'+esc(k)+'</small><strong>'+v+'</strong>'+
 (note?'<span>'+esc(note)+'</span>':'')+'</div>';
const empty=(text,missing=false)=>'<div class="nxw-empty '+(missing?'is-missing':'')+'">'+esc(text)+'</div>';
function listRows(raw,keys){
 if(Array.isArray(raw))return raw;
 if(!raw||typeof raw!=='object')return null;
 for(const k of keys){if(Array.isArray(raw[k]))return raw[k];}
 return null;
}
const canonicalAsset=s=>({
 'XXBT':'BTC','XBT':'BTC','XETH':'ETH','ZEUR':'EUR','ZUSD':'USD',
 'XXRP':'XRP','XXLM':'XLM','XLTC':'LTC','XXDG':'DOGE'
})[String(s||'').toUpperCase()]||String(s||'').toUpperCase();
function numericRow(row,exchangeFallback,assetFallback){
 if(row===null||row===undefined)return null;
 if(typeof row!=='object'){
  const q=n(row);
  return q===null?null:{exchange:exchangeFallback,asset:assetFallback,available:null,locked:null,total:q,priceUsd:null,valueUsd:null,raw:row};
 }
 const asset=one(row,'asset','currency','symbol','code','ticker')||assetFallback||null;
 const exchange=one(row,'exchange','venue','platform','source')||exchangeFallback||null;
 const free=n(one(row,'available','free','availableQty','availableBalance','balanceAvailable'));
 const locked=n(one(row,'locked','hold','reserved','onOrders','inOrders','pending'));
 const total=n(one(row,'total','balance','amount','quantity','qty','balanceTotal'));
 const usdValue=n(one(row,'valueUsd','usdValue','totalUsd','marketValueUsd'));
 const usdPrice=n(one(row,'priceUsd','usdPrice','marketPriceUsd'));
 if(!asset||!exchange||[free,locked,total,usdValue].every(x=>x===null))return null;
 return {asset:canonicalAsset(asset),sourceAsset:String(asset).toUpperCase(),exchange:String(exchange),available:free,locked,total,
  valueUsd:usdValue,priceUsd:usdPrice,raw:row};
}
export function normalizeExchangeBalances(raw){
 // Allowlisted GET /balances/all may contain a unified array, exchange buckets, or
 // nested asset maps. Strict: uncertain shape yields null, never a zero balance.
 if(raw===null||raw===undefined)return {rows:null,shape:'no_response'};
 const top=listRows(raw,['balances','items','rows','assets','holdings']);
 let rows=[],issues=[];
 if(top){rows=top.map(x=>numericRow(x,'Exchange sin verificar',null)).filter(Boolean);}
 else if(Array.isArray(raw)){rows=raw.map(x=>numericRow(x,'Exchange sin verificar',null)).filter(Boolean);}
 else if(typeof raw==='object'){
   const exchanges=raw.exchanges&&typeof raw.exchanges==='object'?raw.exchanges:raw;
   for(const [ex,k] of Object.entries(exchanges)){
     if(['success','timestamp','updatedAt','meta','errors','summary','status','totalUsd'].includes(ex))continue;
     if(!k||typeof k!=='object')continue;
     // Respuesta real: {kraken:{connected,balances:{XXBT:0.1}},revolutx:{connected,balances:{...}}}.
   if(k.connected===false||k.error){issues.push(ex+': '+(k.error?'error de lectura':'no conectado'));continue;}
   if(k.balances&&typeof k.balances==='object'&&!Array.isArray(k.balances)){
     for(const [asset,qty] of Object.entries(k.balances)){
       const x=numericRow(qty,ex,asset);if(x)rows.push(x);
     }
     continue;
   }
   const r=listRows(k,['balances','assets','holdings','items']);
     if(r){for(const entry of r){const x=numericRow(entry,ex,null);if(x)rows.push(x);}continue;}
     for(const [asset,z] of Object.entries(k)){
       if(['available','locked','hold','total','valueUsd','balance','timestamp','state','success','status','message'].includes(asset))continue;
       const x=numericRow(z,ex,asset);if(x)rows.push(x);
     }
   }
 }
 if(!rows.length)return {rows:null,issues,shape:'not_recognized'};
 // Two identical exchange+asset rows are ambiguous; don't sum them silently.
 const seen=new Set();
 for(const r of rows){const key=r.exchange.toLowerCase()+'/'+r.asset.toUpperCase();
  if(seen.has(key))return {rows:null,issues,shape:'duplicate_exchange_asset'};
  seen.add(key);
 }
 return {rows,issues,shape:issues.length?'partial':'ok'};
}
function priceMap(raw){
 const entries=raw&&typeof raw==='object'?(raw.prices||raw.assets||raw):{};
 const result={};
 if(Array.isArray(entries)){
   for(const p of entries){const asset=one(p,'asset','symbol','currency');const price=n(one(p,'priceUsd','usd','price','last'));
     if(asset&&price!==null)result[String(asset).toUpperCase()]=price;}
 }else if(entries&&typeof entries==='object'){
   for(const [k,v] of Object.entries(entries)){
     const fixed=typeof v==='object'&&String(v?.source||'').toLowerCase()==='fixed';
     const p=fixed&&k.toUpperCase()!=='USD'?null:n(typeof v==='object'?one(v,'priceUsd','usd','price','last'):v);
     if(p!==null)result[k.toUpperCase()]=p;
   }
 }
 return result;
}
export function valueExchangeBalances(raw,prices){
 const parsed=normalizeExchangeBalances(raw);
 if(!parsed.rows)return {...parsed,priced:[],totalUsd:null,unpricedCount:null};
 const pm=priceMap(prices),out=parsed.rows.map(row=>{
   const amount=row.total!==null?row.total:(row.available!==null&&row.locked!==null?row.available+row.locked:null);
   const p=row.priceUsd??pm[row.asset]??pm[row.sourceAsset]??null;
   const valueUsd=row.valueUsd??(amount!==null&&p!==null?amount*p:null);
   return {...row,quantity:amount,verifiedPrice:p,marketValueUsd:valueUsd};
 });
 return {rows:parsed.rows,issues:parsed.issues,priced:out,totalUsd:!parsed.issues?.length&&out.length&&out.every(x=>x.marketValueUsd!==null)?
  out.reduce((s,x)=>s+x.marketValueUsd,0):null,
  unpricedCount:out.filter(x=>x.marketValueUsd===null).length,shape:parsed.shape};
}
function portfolioData(ctx){return ctx.data?.portfolio?.data||{};}
function marketBalance(ctx){const p=portfolioData(ctx);
 return valueExchangeBalances(p.exchangeBalances,p.prices);}
function rowDetails(type,rows){return (rows||[]).map((r,i)=>
  '<button class="nxw-row" data-inspect="common:portfolio.'+type+':'+i+'">'+
  '<span><b>'+value(one(r,'asset','currency','engine','mode','type','kind','exchange')||'Movimiento')+'</b>'+
  '<small>'+value(one(r,'exchange','venue','createdAt','ts','status','state'))+'</small></span>'+
  '<strong>'+asUSD(one(r,'valueUsd','usdValue','amountUsd','amount'))+'</strong><span aria-hidden="true">›</span></button>').join('');}
function balanceRow(r){
 return '<article class="nxw-balance"><div><b>'+attr(r.asset)+'</b><small>'+attr(r.exchange)+'</small></div>'+
 '<div><strong>'+ (n(r.quantity)!==null?esc(fmtNum(r.quantity,{dec:8})):'—')+'</strong>'+
  '<small>Disponible '+(n(r.available)!==null?esc(fmtNum(r.available,{dec:8})):'—')+
  ' · Bloqueado '+(n(r.locked)!==null?esc(fmtNum(r.locked,{dec:8})):'—')+'</small></div>'+
 '<div class="nxw-balance-value"><strong>'+asUSD(r.marketValueUsd)+'</strong>'+
 '<small>'+(r.marketValueUsd!==null?'Precio valorado con datos API':'Valoración pendiente')+'</small></div></article>';
}
function summaryReal(ctx){
 const p=portfolioData(ctx),s=p.summary||{},bal=marketBalance(ctx);
 const exchangeState=p.resourceStates?.exchangeBalances||'unavailable',priceState=p.resourceStates?.prices||'unavailable';
 const valid=ctx.authenticated&&exchangeState==='ok'&&bal.priced.length>0;
 const exchangeValue=valid?bal.totalUsd:null;
 return '<div class="nxw-hero"><span>VALORACIÓN DE SALDOS DEL EXCHANGE · REAL</span>'+
 '<strong>'+asUSD(exchangeValue)+'</strong>'+
 '<p>'+(exchangeValue!==null?'Valoración indicativa de saldos recibidos por API y cotizaciones de fuente identificada.':
   'No hay valoración TOTAL verificable del exchange. El presupuesto del bot no sustituye este dato.')+'</p>'+
 '<div class="nxw-hero-line">'+
 stat('Saldos',valid?String(bal.priced.length):'—')+
 stat('Activos sin valorar',valid?String(bal.unpricedCount):'—')+
 stat('Estado',value(exchangeState)+' · Precios '+value(priceState))+'</div></div>'+
 '<div class="nxw-kpis">'+
 stat('Presupuesto interno del bot',asUSD(s.allocatedUsd),'NO es saldo del exchange')+
 stat('Capital interno desplegado',asUSD(s.deployedUsd))+
 stat('HOLD (contabilidad)',asUSD(s.holdUsd))+
 stat('PnL realizado (bot)',n(s.realizedPnlUsd)===null?'—':esc(signedUsd(n(s.realizedPnlUsd))))+
 '</div>';
}
function summaryShadow(ctx){
 const idca=ctx.enginesData?.idca?.data||{},wallet=idca.simWallet;
 const source=ctx.enginesData?.idca?.state==='ok'&&wallet&&typeof wallet==='object';
 return '<div class="nxw-hero nxw-hero-shadow"><span>SHADOW · SALDO VIRTUAL IDCA</span>'+
 '<strong>'+(source?asUSD(one(wallet,'totalUsd','balanceUsd','equityUsd')):'—')+'</strong>'+
 '<p>Esta pantalla muestra exclusivamente simulación. No representa dinero depositado, saldo LIVE ni resultados fiscales.</p>'+
 '<div class="nxw-hero-line">'+stat('Virtual disponible',source?asUSD(one(wallet,'freeUsd','availableUsd')):'—')+
 stat('Virtual en ciclos',source?asUSD(one(wallet,'usedUsd','reservedUsd','capitalInCyclesUsd')):'—')+
 stat('Fuente',source?'IDCA /simulation/wallet':'Sin lectura verificable')+'</div></div>';
}
function balancesScreen(ctx,shadow){
 if(shadow)return '<section class="nxw-panel"><h2>Saldos virtuales</h2>'+empty(
  'Solo se muestran saldos de simulación que el backend identifica expresamente. Las cuentas reales del exchange quedan ocultas en SHADOW.',true)+'</section>';
 const p=portfolioData(ctx),r=marketBalance(ctx),state=p.resourceStates?.exchangeBalances;
 return '<section class="nxw-panel"><div class="nxw-section-head"><h2>Saldos por exchange y moneda</h2><span>'+value(state)+'</span></div>'+
 (state==='ok'&&r.priced.length?r.priced.map(balanceRow).join(''):
 empty(state==='ok'?'La respuesta del exchange no contiene balances interpretables ('+r.shape+').':
 'La API no ha facilitado los balances reales en esta lectura. No se representa saldo cero.',true))+
 '</section>';
}
export function renderPortfolioView(ctx){
 const p=portfolioData(ctx),shadow=ctx.viewScope===SCOPE_SHADOW,tab=ctx.ui?.portfolioTab||'summary';
 const tabs=[['summary','Resumen'],['balances','Saldos'],['assets','Activos'],['ledger','Movimientos'],['reservations','Reservas'],['audit','Conciliación']];
 const internal=p.summary||{},holds=p.holdings,ledger=p.ledger,reservations=p.reservations;
 const source=p.resourceStates||{};
 const top='<div class="nxw-title"><span>'+(shadow?'SHADOW / SIMULACIÓN':'CARTERA / REAL')+'</span>'+
 '<h1>Mi cartera</h1><p>'+scopeSubtitle(ctx.viewScope)+'</p></div>'+
 (shadow?summaryShadow(ctx):summaryReal(ctx))+
 '<nav class="nxw-tabs" aria-label="Secciones de cartera">'+tabs.map(([k,t])=>
 '<button data-ui="portfolioTab:'+k+'" aria-current="'+(tab===k?'page':'false')+'" class="'+(tab===k?'on':'')+'">'+t+'</button>').join('')+'</nav>';
 let body='';
 if(tab==='balances')body=balancesScreen(ctx,shadow);
 else if(tab==='assets')body=shadow?
 '<section class="nxw-panel"><h2>Activos simulados</h2>'+empty('No se atribuyen los activos reales a simulación. Abre Motores → IDCA para consultar la cartera virtual disponible.',true)+'</section>':
 '<section class="nxw-panel"><h2>Activos por motor y exchange</h2>'+
 (source.holdings==='ok'&&Array.isArray(holds)?rowDetails('holdings',holds)||empty('La API devolvió cero activos en la cartera interna.'):
 empty('Sin lectura verificable de posiciones desglosadas.',true))+'</section>';
 else if(tab==='ledger')body=shadow?
 '<section class="nxw-panel"><h2>Movimientos simulados</h2>'+empty('No se mezclan movimientos de dinero real con operaciones de simulación.',true)+'</section>':
 '<section class="nxw-panel"><h2>Movimientos del libro interno</h2>'+
 (source.ledger==='ok'&&Array.isArray(ledger)?rowDetails('ledger',ledger)||empty('Sin movimientos comunicados en esta lectura.'):
 empty('El historial de movimientos internos no está disponible; no equivale a vacío.',true))+'</section>';
 else if(tab==='reservations')body=shadow?
 '<section class="nxw-panel"><h2>Capital simulado</h2>'+empty('Las reservas reales no están visibles en el modo Shadow.',true)+'</section>':
 '<section class="nxw-panel"><h2>Reservas y presupuestos internos</h2>'+
 '<p>Una reserva de capital no equivale a una orden ejecutada ni a dinero en el exchange.</p>'+
 (source.reservations==='ok'&&Array.isArray(reservations)?rowDetails('reservations',reservations)||empty('Sin reservas registradas.'):
 empty('Las reservas no se han podido leer.',true))+'</section>';
 else if(tab==='audit')body='<section class="nxw-panel"><h2>Procedencia y conciliación</h2>'+
 '<div class="nxw-provenance">'+[
 ['Saldos exchange',source.exchangeBalances],['Precios',source.prices],['Cartera interna',source.summary],
 ['Holdings',source.holdings],['Movimientos',source.ledger],['Reservas',source.reservations],
 ].map(([k,v])=>'<div><b>'+k+'</b><span>'+value(v||'No consultado')+'</span></div>').join('')+'</div>'+
 '<p>La valoración del exchange y el NAV interno no deben coincidir obligatoriamente. Se necesitan todas las cuentas, monedas, cotizaciones y saldos para validar diferencias. No se fuerzan saldos a cero.</p></section>';
 else body=(shadow?
 '<section class="nxw-panel"><h2>Solo simulación</h2><p>Consulta ciclos y órdenes simulados con filtro Shadow activo. Todas las cuentas de exchange permanecen fuera de esta vista.</p>'+
 '<button data-nav="positions">Posiciones simuladas ↗</button></section>':
 balancesScreen(ctx,false)+
 '<section class="nxw-panel"><h2>Cómo se compone tu cartera</h2><div class="nxw-kpis">'+
 stat('NAV informado por bot',asUSD(internal.navUsd),'Dato interno; no es balance exchange')+
 stat('Exposición interna',asUSD(internal.exposureUsd))+
 stat('Sin realizar',n(internal.unrealizedPnlUsd)===null?'—':esc(signedUsd(n(internal.unrealizedPnlUsd))))+
 '</div></section>');
 return '<div class="nxw-portfolio">'+top+body+'</div>';
}
