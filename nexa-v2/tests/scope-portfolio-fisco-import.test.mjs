import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location??={search:'',protocol:'https:',pathname:'/'};
globalThis.window??={Capacitor:null};
globalThis.sessionStorage??={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.localStorage??={getItem:()=>null,setItem(){},removeItem(){}};
const {classifyMode,inScope,partitionByScope}=await import('../web/js/display-scope.js');
const {normalizeExchangeBalances,valueExchangeBalances,renderPortfolioView}=await import('../web/js/portfolio-view.js');
const {renderFiscalView}=await import('../web/js/fisco-view.js');
const {makeImportPreview}=await import('../web/js/import-position.js');
const {renderScopedActivity,renderScopedEngine}=await import('../web/js/scoped-pages.js');

test('Las modalidades REAL/SHADOW no dependen de Básico/Pro ni asumen modo desconocido',()=>{
 assert.equal(classifyMode({mode:'LIVE'}),'real');
 assert.equal(classifyMode({mode:'REAL_FULL'}),'real');
 assert.equal(classifyMode({mode:'simulation'}),'shadow');
 assert.equal(classifyMode({mode:'DRY-RUN'}),'shadow');
 assert.equal(classifyMode({mode:'shadow_live'}),'shadow');
 assert.equal(classifyMode({status:'open'}),'unknown');
 assert.equal(inScope({mode:'shadow'},'real'),false);
 assert.equal(inScope({mode:'live'},'shadow'),false);
 assert.equal(inScope({status:'open'},'real'),false);
 const part=partitionByScope([{mode:'live'},{mode:'shadow'},{status:'open'}],'shadow');
 assert.equal(part.visible.length,1);assert.equal(part.other,1);assert.equal(part.unknown,1);
});
const balances={kraken:{connected:true,balances:{XXBT:0.1,ZUSD:300}},revolutx:{connected:true,balances:{ETH:0.5,USDC:200}},
 activeExchange:'kraken',tradingExchange:'kraken'};
const prices={BTC:{price:60000,source:'kraken'},ETH:{price:1800,source:'coingecko'},
 USD:{price:1,source:'fixed'},USDC:{price:1,source:'fixed'}};
test('Saldo REAL Kraken + Revolut X: normalización origen, no doble conteo, stable sin precio no equivale a 1',()=>{
 const parsed=normalizeExchangeBalances(balances);
 assert.equal(parsed.rows.length,4);
 assert.deepEqual(parsed.rows.map(r=>r.exchange),['kraken','kraken','revolutx','revolutx']);
 assert.equal(parsed.rows[0].asset,'BTC');
 const view=valueExchangeBalances(balances,prices);
 assert.equal(view.unpricedCount,1);
 assert.equal(view.totalUsd,null);
 assert.equal(view.priced.find(r=>r.asset==='BTC').marketValueUsd,6000);
 assert.equal(view.priced.find(r=>r.asset==='ETH').marketValueUsd,900);
});
test('Si falla un exchange no se fabrica patrimonio completo',()=>{
 const missing={...balances,revolutx:{connected:true,balances:{},error:'fetch_failed'}};
 const v=valueExchangeBalances(missing,prices);
 assert.equal(v.totalUsd,null);
 assert.equal(v.priced.length,2);
 assert.ok(v.issues.length>0);
});
function context(scope){
 return {authenticated:true,mode:'basic',viewScope:scope,ui:{portfolioTab:'summary',fiscoTab:'summary',engineId:'idca',subtab:'panel'},
 enginesData:{
  idca:{state:'ok',data:{status:{mode:'live'},summary:{mode:'live'},
    cycles:[{id:1,pair:'BTC/USD',mode:'live',status:'active',capitalUsedUsd:450},
    {id:2,pair:'ETH/USD',mode:'simulation',status:'active',capitalUsedUsd:60}],
    orders:[{id:30,mode:'simulation',side:'BUY',pair:'ETH/USD'}],
    history:[{id:3,mode:'live',pair:'BTC/USD',status:'closed'}],
    events:[{id:4,mode:'shadow',msg:'simulation'}],
    simWallet:{totalUsd:2500,freeUsd:2000,usedUsd:500}}},
  spot:{state:'ok',data:{status:{mode:'live'},positions:[],trades:[]}},
  grid:{state:'ok',data:{status:{mode:'shadow'},cycles:[],events:[]}},
  ama:{state:'ok',data:{status:{mode:'observing'},cycles:[],tranches:[],trace:{decisions:[]}}}
 },
 data:{portfolio:{state:'partial',data:{summary:{navUsd:5000,allocatedUsd:3000,realizedPnlUsd:200},exchangeBalances:balances,prices,
 resourceStates:{summary:'ok',exchangeBalances:'ok',prices:'ok',holdings:'forbidden',ledger:'ok',reservations:'ok'}}},
 fisco:{state:'ok',resourceStates:{summary:'ok',operations:'ok',lots:'ok',disposals:'ok',annualReport:'ok',finalizationStatus:'ok'},
 data:{summary:{years:[{year:2026,total_gain_loss_eur:234.5,total_fees_eur:12}]},
 operations:{operations:[{id:8,asset:'BTC',op_type:'trade_sell',total_eur:230}]},
 lots:{lots:[]},disposals:{disposals:[],total_gain_loss_eur:90},
 annualReport:{year:2026,is_safe_for_report:false,critical_errors_count:1,section_a:{ganancias_eur:200}},
 finalizationStatus:{report_can_be_finalized:false,blockers:[{code:'TEST',detail:'Fuente sin conciliar'}]}} },
 activity:{data:{events:[{engine:'idca',mode:'live',msg:'Real'},{engine:'idca',mode:'shadow',msg:'Virtual'},
 {engine:'idca',msg:'Sin modo'}]}}}};
}
test('Cartera SHADOW usa wallet virtual, nunca saldos del exchange',()=>{
 const real=renderPortfolioView(context('real'));
 const shadow=renderPortfolioView(context('shadow'));
 assert.match(real,/VALORACIÓN DE SALDOS DEL EXCHANGE/);
 assert.match(shadow,/SALDO VIRTUAL IDCA/);
 assert.match(shadow,/2500/); // number display source
 assert.doesNotMatch(shadow,/6\.000/); // exchange valuation never carried across
 assert.doesNotMatch(shadow,/Kraken.*ETH/);
});
test('FISCO oculta completamente fiscalidad real dentro de SHADOW',()=>{
 assert.match(renderFiscalView(context('real')),/FISCO \/ AEAT/);
 const hidden=renderFiscalView(context('shadow'));
 assert.match(hidden,/Fiscalidad separada/);
 assert.doesNotMatch(hidden,/234,50|12,00|230,00|2026/);
 const denied=context('real');denied.data.fisco={state:'forbidden'};
 assert.match(renderFiscalView(denied),/fisco:read/);
});
test('Actividad filtrada a modo específico, sin atribuir eventos desconocidos',()=>{
 const real=renderScopedActivity(context('real')),shadow=renderScopedActivity(context('shadow'));
 assert.match(real,/Real/);assert.doesNotMatch(real,/Virtual/);
 assert.match(shadow,/Virtual/);assert.doesNotMatch(shadow,/>Real</);
 assert.match(shadow,/1 eventos no tienen modo/);
});
test('Motores conservan índices originales en fichas y no mezclan los dos modos',()=>{
 const real=renderScopedEngine(context('real')),shadow=renderScopedEngine(context('shadow'));
 assert.match(real,/idca:cycles:0/);assert.doesNotMatch(real,/idca:cycles:1/);
 assert.match(shadow,/idca:cycles:1/);assert.doesNotMatch(shadow,/idca:cycles:0/);
 assert.match(shadow,/todos los controles de ejecución real permanecen bloqueados/);
});
test('Importación IDCA existente es distinta de compra manual, preview valida y no POST',()=>{
 const v={pair:'BTC/USD',exchangeSource:'kraken',quantity:0.1,avgEntryPrice:50000,
 capitalUsedUsd:5000,estimatedFeePct:0.25,sourceType:'manual',
 soloSalida:true,feesOverrideManual:true,isManualCycle:false,warningAcknowledged:false};
 const r=makeImportPreview(v,{pairs:{'BTC/USD':{activeCycleId:44}}});
 assert.equal(r.ok,true);assert.equal(r.estimatedFeeUsd,12.5);
 assert.equal(r.active,true);assert.equal(r.coexistenceOk,false);
 const warning=makeImportPreview({...v,isManualCycle:true,warningAcknowledged:true},{pairs:{'BTC/USD':{activeCycleId:44}}});
 assert.equal(warning.coexistenceOk,true);
 assert.equal(makeImportPreview({...v,quantity:0}).ok,false);
 assert.equal(makeImportPreview({...v,pair:'SOL/USD'}).ok,false);
 const mod=await import('../web/js/import-position.js');
 assert.equal(typeof mod.openImportPositionPreview,'function');
});
