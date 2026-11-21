// NEXA — global cross-engine overview and IDCA management.
// Synthetic input only. No VPS and no live trading access.
import test from 'node:test';
import assert from 'node:assert/strict';

// config/auth are browser-capable modules: seed minimal DOM globals before import.
globalThis.location??={search:'',protocol:'https:',pathname:'/'};
globalThis.window??={Capacitor:null};
const mem=new Map();
globalThis.localStorage??={
  getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)
};
globalThis.sessionStorage??={
  getItem:k=>mem.get('s:'+k)??null,setItem:(k,v)=>mem.set('s:'+k,String(v)),removeItem:k=>mem.delete('s:'+k)
};
const {collectPositions,renderDashboard,renderPositions,renderAsset,renderCycleManager}=await import('../web/js/dashboard.js');
const {ACTIONS}=await import('../web/js/actions.js');

const connected={
 authenticated:true,ui:{marketPair:'BTC/USD',positionFilter:'all',engineId:'idca',cycleId:'55'},
 data:{marketPairs:{},portfolio:{state:'ok',data:{summary:{navUsd:5000}}},
  activity:{state:'ok',data:{events:[{engine:'idca',msg:'Compra abierta'}]}}},
 enginesData:{
  idca:{state:'ok',data:{cycles:[{id:55,pair:'BTC/USD',status:'active',mode:'live',
    capitalUsedUsd:620,unrealizedPnlUsd:-8.48,avgEntryPrice:61055,tpTargetPrice:63600}],
    orders:[{id:1,pair:'BTC/USD',cycleId:55,side:'BUY',valueUsd:200}],
    history:[{id:54,pair:'ETH/USD',status:'closed',realizedPnlUsd:5.65}]}},
  spot:{state:'ok',data:{positions:[{id:9,pair:'ETH/USD',qty:0.1,avgPrice:1700}],
    trades:[{id:18,pair:'BTC/USD',side:'SELL',strategy:'unknown',realizedPnlUsd:3}]}},
  grid:{state:'ok',data:{cycles:[{id:1,pair:'BTC/USD',status:'open',buyQty:0.04,capitalUsedUsd:30},
    {id:2,pair:'ETH/USD',status:'closed',buyQty:1}]}},
  ama:{state:'ok',data:{cycles:[{id:3,pair:'BTC/USD',reservedUsd:2000,status:'open'},
    {id:4,pair:'ETH/USD',filledQty:0.2,capitalUsedUsd:50,status:'active'}]}}
 }
};
test('Home: cotizaciones BTC ETH, acceso a posiciones consolidadas y actividad',()=>{
 const html=renderDashboard(connected);
 assert.match(html,/Tu bot, de un vistazo/);
 assert.match(html,/data-asset="BTC\/USD"/);
 assert.match(html,/data-asset="ETH\/USD"/);
 assert.match(html,/Posiciones abiertas/);
 assert.match(html,/data-nav="positions"/);
 assert.match(html,/Compra abierta/);
 assert.doesNotMatch(html,/2\.000,00.*AMA/);
});
test('Posiciones: captura orígenes IDCA SPOT GRID AMA, sin contar reservas AMA',()=>{
 const s=collectPositions(connected);
 assert.equal(s.entries.length,4);
 assert.deepEqual(s.entries.map(x=>x.engine),['idca','spot','grid','ama']);
 assert.equal(s.entries.find(x=>x.engine==='ama').id,4);
 assert.ok(!s.entries.some(x=>x.id===3));
 const html=renderPositions(connected);
 assert.match(html,/data-manage-cycle="55"/);
 assert.match(html,/data-ui="positionFilter:idca"/);
 assert.match(html,/Capital/);
});
test('Inicio sin conexión: no atribuir ganancias ni saldos no verificados',()=>{
 const disconnected={...connected,authenticated:false,data:{marketPairs:{},portfolio:{state:'unavailable',data:{summary:null}}},enginesData:{}};
 const html=renderDashboard(disconnected);
 assert.match(html,/visión parcial|Visión parcial/i);
 assert.match(html,/No confirmado|—/);
 assert.match(html,/BTC/);
 assert.doesNotMatch(html,/\$5\.000/);
});
test('Activo BTC: operaciones y fichas detalladas de origen no atribuido',()=>{
 const html=renderAsset(connected);
 assert.match(html,/BTC\/USD/);
 assert.match(html,/Orden IDCA|COMPRA/);
 assert.match(html,/Operación global/);
 assert.match(html,/data-inspect="spot:trades:0"/);
 assert.match(html,/Indicadores completos/);
 assert.match(html,/Correlación BTC/);
 assert.match(html,/No hay datos suficientes|rendimientos sincronizados/);
});
test('IDCA: acciones visibles en ciclo abierto y ocultas en cerrado',()=>{
 const html=renderCycleManager(connected);
 assert.match(html,/data-inspect="idca:cycles:0"/);
 assert.match(html,/data-manual-buy="55"/);
 assert.match(html,/Pausar/);
 assert.doesNotMatch(html,/Eliminar ciclo manual/);
 const done=structuredClone(connected);
 done.enginesData.idca.data.cycles[0].status='closed';
 const closed=renderCycleManager(done);
 assert.match(closed,/Ciclo cerrado/);
 assert.doesNotMatch(closed,/data-manual-buy=/);
});
test('Contratos IDCA auditados: soloSalida, TimeStop y compra externa',()=>{
 const solo=ACTIONS['idca.soloSalida'].req({cycleId:55,soloSalida:true});
 assert.deepEqual(solo,['PATCH','/institutional-dca/cycles/55/solo-salida',{soloSalida:true}]);
 const ts=ACTIONS['idca.timeStop'].req({cycleId:55,disabled:true});
 assert.deepEqual(ts,['PATCH','/institutional-dca/cycles/55/time-stop',{disabled:true}]);
 const b=ACTIONS['idca.manualBuy'].req({cycleId:55,pair:'BTC/USD',price:60000,
  quantity:0.001,notionalUsd:60,feesUsd:0.06,exchange:'kraken',
  executedAt:'2026-11-21T12:00:00.000Z'});
 assert.equal(b[0],'POST');
 for(const key of ['pair','price','quantity','notionalUsd','feesUsd','executedAt','exchange'])
  assert.ok(b[2][key]!==undefined,key);
 assert.equal(b[2].continueAutomaticManagement,false);
});
