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
  return q===null?null:{exchange:exchangeFallback,asset:canonicalAsset(assetFallback),sourceAsset:String(assetFallback||'').toUpperCase(),available:null,locked:null,total:q,priceUsd:null,valueUsd:null,raw:row};
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
// Campos canónicos del resumen interno del bot (normPortfolioSummary produce
// navUsd/exposureUsd; los nombres antiguos allocatedUsd/deployedUsd se aceptan
// como fallback porque el spread de norm conserva las claves crudas).
const navUsdOf=s=>n(one(s,'navUsd','totalValueUsd'));
const exposureUsdOf=s=>n(one(s,'exposureUsd','deployedUsd','totalDeployedUsd'));
const budgetUsdOf=s=>n(one(s,'allocatedUsd','budgetUsd','allocatedCapitalUsd'));
const realizedUsdOf=s=>n(one(s,'realizedPnlUsd','totalRealizedPnlUsd'));
const unrealizedUsdOf=s=>n(one(s,'unrealizedPnlUsd','totalUnrealizedPnlUsd'));
const holdUsdOf=s=>n(one(s,'holdUsd'));
function rowDetails(type,rows){return (rows||[]).map((r,i)=>
  '<button class="nxw-row" data-inspect="common:portfolio.'+type+':'+i+'">'+
  '<span><b>'+value(one(r,'asset','currency','engine','mode','type','kind','exchange')||'Movimiento')+'</b>'+
  '<small>'+value(one(r,'exchange','venue','createdAt','ts','status','state'))+'</small></span>'+
  '<strong>'+asUSD(one(r,'valueUsd','usdValue','amountUsd','amount'))+'</strong><span aria-hidden="true">›</span></button>').join('');}
function balanceRow(r){
 return '<article class="nxw-balance"><div><b>'+attr(r.asset)+'</b><small>'+attr(r.exchange)+'</small></div>'+
 '<div><strong>'+ (n(r.quantity)!==null?esc(fmtNum(r.quantity,{dec:8})):'—')+'</strong>'+
  '<small>Disponible '+(n(r.available)!==null?esc(fmtNum(r.available,{dec:8})):'—')+
  ' · Bloqueado '+(n(r.locked)!==null?esc(fmtNum(n(r.locked),{dec:8})):'—')+'</small></div>'+
 '<div class="nxw-balance-value"><strong>'+asUSD(r.marketValueUsd)+'</strong>'+
 '<small>'+(r.marketValueUsd!==null?'Precio valorado con datos API':'Valoración pendiente')+'</small></div></article>';
}
// ---------- Composición por activo (solo con precios reales) ----------
const DUST_USD=1; // por debajo de 1 USD se agrupa como "Activos residuales"
function compositionPanel(ctx){
 const p=portfolioData(ctx),bal=marketBalance(ctx);
 const priceState=p.resourceStates?.prices||'unavailable';
 const rows=bal.priced||[];
 const head='<div class="nxw-section-head"><h2>Composición por activo</h2>'+
  '<span>Fuente: /balances/all + /prices/portfolio · '+value(priceState)+'</span></div>';
 if(!rows.length)
  return '<section class="nxw-panel">'+head+empty(
   'Sin saldos de exchange interpretables en esta lectura; no se dibuja composición.',true)+'</section>';
 const valued=rows.filter(r=>r.marketValueUsd!==null);
 const unpriced=rows.filter(r=>r.marketValueUsd===null);
 const byAsset=new Map();
 for(const r of valued){
  const k=r.asset,cur=byAsset.get(k)||{asset:k,value:0,rows:[]};
  cur.value+=r.marketValueUsd;cur.rows.push(r);byAsset.set(k,cur);
 }
 const covered=valued.reduce((s,r)=>s+r.marketValueUsd,0);
 const totalAssets=new Set(rows.map(r=>r.asset)).size;
 const pricedAssets=byAsset.size;
 const partial=unpriced.length>0||!!bal.issues?.length;
 const note=valued.length===0?
  'Ninguna posición tiene precio verificable; no se calculan porcentajes.':
  (partial
   ?'Cobertura parcial: '+pricedAssets+' de '+totalAssets+' activos con precio · importe cubierto '+asUSD(covered)+
     (bal.issues?.length?' · exchange con lectura incompleta ('+bal.issues.join('; ')+')':' · '+unpriced.length+' activo(s) sin precio')
   :'Todos los activos tienen precio · total '+asUSD(covered));
 let inner='<p class="nxw-comp-note">'+esc(note)+'</p>';
 if(valued.length){
  // Polvo: valor < 1 USD se agrupa; sus miembros quedan accesibles en <details>.
  const main=[],dust=[];
  for(const e of byAsset.values())(e.value<DUST_USD?dust:main).push(e);
  main.sort((a,b)=>b.value-a.value);dust.sort((a,b)=>a.value-b.value);
  const bars=[];
  for(const e of main)bars.push(compRow(e.asset,e.value,covered));
  if(dust.length){
   const dustValue=dust.reduce((s,e)=>s+e.value,0);
   const members=dust.flatMap(e=>e.rows);
   bars.push(compRow('Activos residuales',dustValue,covered));
   inner+='<div class="nxw-comp">'+bars.join('')+'</div>'+
    '<details class="nxw-dust"><summary>'+members.length+' posición(es) residual(es) · '+asUSD(dustValue)+' · valor individual &lt; '+asUSD(DUST_USD)+'</summary>'+
    members.map(r=>'<div class="nxw-dust-row"><span>'+attr(r.asset)+' · '+attr(r.exchange)+'</span>'+
     '<span>'+esc(fmtNum(r.quantity,{dec:8}))+'</span><strong>'+asUSD(r.marketValueUsd)+'</strong></div>').join('')+'</details>';
  }else inner+='<div class="nxw-comp">'+bars.join('')+'</div>';
 }
 if(unpriced.length)
  inner+='<div class="nxw-unpriced"><small>Sin precio verificable ('+unpriced.length+'):</small> '+
   unpriced.map(r=>attr(r.asset)+' · '+attr(r.exchange)+' · '+
    (n(r.quantity)!==null?esc(fmtNum(r.quantity,{dec:8})):'—')).join('<br>')+'</div>';
 return '<section class="nxw-panel">'+head+inner+'</section>';
}
function compRow(asset,valueUsd,covered){
 const pct=covered>0?valueUsd/covered*100:null;
 return '<div class="nxw-comp-row"><div class="nxw-comp-label"><b>'+attr(asset)+'</b>'+
  '<small>'+asUSD(valueUsd)+(pct!==null?' · '+esc(pct.toFixed(1))+' %':'')+'</small></div>'+
  '<div class="nxw-comp-track">'+(pct!==null?'<div class="nxw-comp-fill" style="width:'+Math.min(100,Math.max(pct,0)).toFixed(2)+'%"></div>':'')+'</div></div>';
}
// ---------- Resumen REAL: KPIs internos del bot + nota de alcance ----------
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
 stat('NAV informado por el bot',asUSD(navUsdOf(s)),'Contabilidad interna · no es saldo del exchange')+
 stat('Exposición interna',asUSD(exposureUsdOf(s)))+
 stat('Presupuesto interno asignado',asUSD(budgetUsdOf(s)),'NO es saldo del exchange')+
 stat('HOLD (contabilidad)',asUSD(holdUsdOf(s)))+
 stat('PnL realizado (bot)',realizedUsdOf(s)===null?'—':esc(signedUsd(realizedUsdOf(s))),'Fuente: /portfolio/summary')+
 stat('PnL sin realizar (bot)',unrealizedUsdOf(s)===null?'—':esc(signedUsd(unrealizedUsdOf(s))),'Fuente: /portfolio/summary')+
 '</div>';
}
function summaryShadow(ctx){
 const idca=ctx.enginesData?.idca?.data||{},wallet=idca.simWallet;
 const source=['ok','partial','stale'].includes(ctx.enginesData?.idca?.state)&&wallet&&typeof wallet==='object';
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
// ---------- Conciliación: diferencias bot vs exchange ----------
// Cantidad por activo canónico desde holdings del bot (suma todas las fuentes).
function holdingsQtyByAsset(holds){
 const m=new Map();
 for(const raw of holds||[]){
  if(!raw||typeof raw!=='object')continue;
  const asset=one(raw,'asset','currency','symbol','code','ticker');
  if(!asset)continue;
  const t=n(one(raw,'total','quantity','qty','balance','amount','balanceTotal'));
  const free=n(one(raw,'available','free','availableQty','availableBalance'));
  const locked=n(one(raw,'locked','hold','reserved','onOrders','inOrders','pending'));
  const qty=t??(free!==null&&locked!==null?free+locked:(free??locked));
  if(qty===null)continue;
  const k=canonicalAsset(asset);
  m.set(k,(m.get(k)||0)+qty);
 }
 return m;
}
// Cantidad por activo canónico desde los saldos del exchange ya valorados.
function exchangeQtyByAsset(priced){
 const m=new Map();
 for(const r of priced||[]){
  if(n(r.quantity)===null)continue;
  const k=canonicalAsset(r.asset);
  m.set(k,(m.get(k)||0)+n(r.quantity));
 }
 return m;
}
function qtyDiffRows(botQty,exchQty){
 const keys=new Set([...botQty.keys(),...exchQty.keys()]);
 const rows=[];
 for(const k of keys){
  const b=botQty.get(k)??null,x=exchQty.get(k)??null;
  if(b===null&&x===null)continue;
  const diff=(x??0)-(b??0);
  if(Math.abs(diff)<=Math.max(1e-9,Math.abs(x??0)*1e-9)&&b!==null&&x!==null)continue;
  rows.push({asset:k,bot:b,exch:x,diff});
 }
 return rows.sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));
}
function auditScreen(ctx){
 const p=portfolioData(ctx),s=p.summary||{},bal=marketBalance(ctx),source=p.resourceStates||{};
 const readAt=ctx.data?.portfolio?.readAt;
 const botNav=navUsdOf(s),exchUsd=bal.totalUsd;
 const botQty=(source.holdings==='ok'&&Array.isArray(p.holdings))?holdingsQtyByAsset(p.holdings):null;
 const exchQty=(source.exchangeBalances==='ok'&&bal.priced.length)?exchangeQtyByAsset(bal.priced):null;
 const diffs=(botQty&&exchQty)?qtyDiffRows(botQty,exchQty):null;
 let diffHtml='';
 if(botNav!==null&&exchUsd!==null){
  diffHtml+='<div class="nxw-diff"><div class="nxw-diff-row nxw-diff-head">'+
   '<span><b>Magnitud</b></span><strong>Bot (NAV)</strong><strong>Exchange</strong><strong>Diferencia</strong></div>'+
   '<div class="nxw-diff-row"><span><b>Valoración total</b><small>GET /portfolio/summary vs /balances/all + /prices/portfolio</small></span>'+
   '<strong>'+asUSD(botNav)+'</strong><strong>'+asUSD(exchUsd)+'</strong>'+
   '<strong>'+esc(signedUsd(botNav-exchUsd))+'</strong></div>'+
   '<p class="nxw-comp-note">NAV interno y valoración de saldos miden cosas distintas (contabilidad del bot vs precios de mercado); la diferencia no es necesariamente un error, pero queda explícita con ambas fuentes.</p></div>';
 }else{
  diffHtml+='<p class="nxw-comp-note">'+
   (botNav===null?'El resumen interno no informa NAV en esta lectura. ':
    'La valoración del exchange es parcial o no disponible ('+(source.exchangeBalances||'sin lectura')+' · precios '+value(source.prices)+'), así que no hay total comparable. ')+
   'No se fuerza una comparación con datos incompletos.</p>';
 }
 if(diffs){
  diffHtml+='<h3 class="nxw-subhead">Cantidades por activo: cartera interna vs exchange</h3>'+
   (diffs.length?
    '<div class="nxw-diff">'+
    '<div class="nxw-diff-row nxw-diff-head"><span><b>Activo</b></span>'+
     '<strong>Exchange</strong><strong>Bot</strong><strong>Dif. (exch−bot)</strong></div>'+
    diffs.map(d=>
     '<div class="nxw-diff-row"><span><b>'+attr(d.asset)+'</b></span>'+
     '<strong>'+(d.exch===null?'—':esc(fmtNum(d.exch,{dec:8})))+'</strong>'+
     '<strong>'+(d.bot===null?'—':esc(fmtNum(d.bot,{dec:8})))+'</strong>'+
     '<strong>'+esc(fmtNum(d.diff,{dec:8}))+'</strong></div>').join('')+'</div>'+
    '<p class="nxw-comp-note">«Exchange» = cantidad agregada desde /balances/all; «Bot» = cantidad agregada desde /portfolio/holdings. Diferencia en unidades del propio activo; «—» indica que la fuente no reporta ese activo.</p>':
    '<p class="nxw-comp-note">Las cantidades por activo coinciden entre la cartera interna y los saldos del exchange en esta lectura.</p>');
 }else{
  const missing=[];
  if(!(source.holdings==='ok'&&Array.isArray(p.holdings)))missing.push('la cartera interna (holdings) no tiene lectura verificable');
  if(!(source.exchangeBalances==='ok'&&bal.priced.length))missing.push('los saldos del exchange no tienen lectura verificable');
  diffHtml+='<p class="nxw-comp-note">Sin comparación de cantidades: '+
   (missing.length?missing.join(' y ')+'. ':
    'ninguna de las dos fuentes aportó cantidades interpretables. ')+
   'Falta esa fuente para conciliar; no se muestran diferencias inventadas.</p>';
 }
 // Presupuestos e inventario internos: solo en Pro (esta pestaña ya es Pro).
 let budgetHtml='';
 const budgets=p.budgets,inventory=p.inventory;
 const budgetItems=listRows(budgets,['items','budgets','rows','data']);
 const invItems=listRows(inventory,['items','rows','data']);
 if((source.budgets==='ok'&&budgetItems)||(source.inventory==='ok'&&invItems)){
  budgetHtml='<h3 class="nxw-subhead">Presupuestos e inventario internos</h3><p class="nxw-comp-note">'+
   'Presupuesto asignado por el bot ≠ saldo del exchange. El inventario es contabilidad interna.</p>';
  if(source.budgets==='ok'&&budgetItems)
   budgetHtml+='<div class="nxw-budget">'+budgetItems.map((b,i)=>{
    const name=one(b,'mode','engine','strategy')||'Presupuesto';
    const asset=one(b,'asset','currency','symbol');
    const exch=one(b,'exchange','venue');
    const used=n(one(b,'usedUsd','used','deployedUsd')),budget=n(one(b,'budgetUsd','allocatedUsd','amountUsd'));
    const stt=one(b,'status','state');
    return '<div class="nxw-budget-row"><span><b>'+value(name)+(asset?' · '+value(asset):'')+'</b>'+
     '<small>'+value(exch||'exchange no especificado')+(stt?' · '+value(label(stt)):'')+'</small></span>'+
     '<strong>'+asUSD(used)+'</strong><small>de '+asUSD(budget)+'</small></div>';
   }).join('')+'</div>';
  else if(source.budgets!=='ok')budgetHtml+='<p class="nxw-comp-note">Presupuestos: sin lectura verificable ('+value(source.budgets)+').</p>';
  if(source.inventory==='ok'&&invItems)
   budgetHtml+='<div class="nxw-budget"><h4 class="nxw-subhead">Inventario interno</h4>'+
    invItems.map((r,i)=>'<button class="nxw-row" data-inspect="common:portfolio.inventory:'+i+'">'+
     '<span><b>'+value(one(r,'asset','currency','engine','mode','type','kind')||'Entrada')+'</b>'+
     '<small>'+value(one(r,'exchange','venue','createdAt','ts','status','state'))+'</small></span>'+
     '<strong>'+asUSD(one(r,'valueUsd','usdValue','amountUsd','amount','quantity'))+'</strong><span aria-hidden="true">›</span></button>').join('')+'</div>';
  else if(source.inventory!=='ok')budgetHtml+='<p class="nxw-comp-note">Inventario: sin lectura verificable ('+value(source.inventory)+').</p>';
 }
 return '<section class="nxw-panel"><div class="nxw-section-head"><h2>Procedencia y conciliación</h2>'+
 '<span>'+(readAt?'Lectura cartera '+esc(fmtTs(readAt)):'Sin marca de lectura')+'</span></div>'+
 '<div class="nxw-provenance">'+[
 ['Saldos exchange',source.exchangeBalances],['Precios',source.prices],['Cartera interna',source.summary],
 ['Holdings',source.holdings],['Movimientos',source.ledger],['Reservas',source.reservations],
 ['Presupuestos',source.budgets],['Inventario',source.inventory],
 ].map(([k,v])=>'<div><b>'+k+'</b><span>'+value(v||'No consultado')+'</span></div>').join('')+'</div>'+
 diffHtml+budgetHtml+
 '<p>La valoración del exchange y el NAV interno no deben coincidir obligatoriamente: proceden de fuentes distintas y miden cosas diferentes. No se fuerzan saldos a cero ni se inventan diferencias.</p></section>';
}
export function renderPortfolioView(ctx){
 const p=portfolioData(ctx),shadow=ctx.viewScope===SCOPE_SHADOW,tab=ctx.mode==='basic'&&!['summary','balances','assets','ledger'].includes(ctx.ui?.portfolioTab)?'summary':ctx.ui?.portfolioTab||'summary';
 const holds=p.holdings,ledger=p.ledger,reservations=p.reservations;
 const source=p.resourceStates||{};
 // Las secciones se navegan desde la barra inferior (portfolio depth1); la
 // tira interior duplicaba esa navegación y se retira. El hero-resumen solo
 // aparece en la pestaña Resumen: cada pestaña tiene contenido propio.
 const top='<div class="nxw-title"><span>'+(shadow?'SHADOW / SIMULACIÓN':'CARTERA / REAL')+'</span>'+
 '<h1>Mi cartera</h1><p>'+scopeSubtitle(ctx.viewScope)+'</p></div>';
 let body='';
 if(tab==='summary')body=(shadow?summaryShadow(ctx):summaryReal(ctx))+(shadow?
 '<section class="nxw-panel"><h2>Solo simulación</h2><p>Consulta ciclos y órdenes simulados con filtro Shadow activo. Todas las cuentas de exchange permanecen fuera de esta vista.</p>'+
 '<button data-nav="positions">Posiciones simuladas ↗</button></section>':
 compositionPanel(ctx));
 else if(tab==='balances')body=balancesScreen(ctx,shadow);
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
 else if(tab==='audit')body=shadow?
 '<section class="nxw-panel"><h2>Conciliación no aplicable en SHADOW</h2>'+empty(
  'En SHADOW no se muestran saldos, holdings ni presupuestos del exchange: la conciliación real queda fuera de la simulación.',true)+'</section>':
 auditScreen(ctx);
 else body='<section class="nxw-panel"><h2>Sección no disponible</h2>'+empty('Esta pestaña no existe en el modo actual.',true)+'</section>';
 return '<div class="nxw-portfolio">'+top+body+'</div>';
}
