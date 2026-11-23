import test from 'node:test';
import assert from 'node:assert/strict';
import {normOrder,normIdcaCycle,normIdcaSummary} from '../web/js/adapters.js';
import {idcaOrders,idcaHistory,idcaConfig} from '../web/js/screens.js';
import {renderPortfolioPremium,renderFiscoPremium} from '../web/js/premium.js';

const ctx=data=>({data,mode:'pro',ui:{marketPair:'BTC/USD'},authenticated:true,deviceEnrolled:true});
test('IDCA: importes brutos y comisiones del backend no se pierden al adaptar',()=>{
 const order=normOrder({id:827,cycleId:54,side:'sell',orderType:'final_sell',
   executedAt:'2026-11-21T08:02:00Z',grossValueUsd:'182.45',
   netValueUsd:'181.90',feesUsd:'0.55',quantity:'0.0024',price:'76020.83',
   triggerReason:'target_reached'});
 assert.equal(order.valueUsd,182.45);
 assert.equal(order.grossValueUsd,182.45);
 assert.equal(order.netValueUsd,181.90);
 assert.equal(order.feeUsd,.55);
 assert.equal(order.side,'SELL');
 assert.equal(order.type,'final_sell');
 assert.equal(order.quantity,.0024);
 assert.equal(order.reason,'target_reached');
});
test('IDCA: totales no son cero si existen órdenes; móviles sin tabla truncada',()=>{
 const orders=[
  normOrder({side:'BUY',id:1,cycleId:54,grossValueUsd:'100',feesUsd:'0.1'}),
  normOrder({side:'sell',id:2,cycleId:54,grossValueUsd:'130',feesUsd:'0.2'})
 ];
 const html=idcaOrders(ctx({orders}));
 assert.match(html,/Compras registradas/);
 assert.match(html,/Ventas registradas/);
 assert.match(html,/nx-idca-trade-list/);
 assert.doesNotMatch(html,/<table/);
 assert.doesNotMatch(html,/Importe sin verificar/);
 assert.match(html,/final|Venta/);
});
test('IDCA: órdenes sin importe nunca suman un falso cero',()=>{
 const html=idcaOrders(ctx({orders:[normOrder({id:4,side:'buy',price:'250',quantity:'0.2'})]}));
 assert.match(html,/falta lado o importe bruto confirmado/);
 assert.match(html,/—/);
 assert.doesNotMatch(html,/Compras registradas<\/span><strong>\$0/);
});
test('IDCA: historial conserva PnL, fechas, capital y motivo de cierre',()=>{
 const c=normIdcaCycle({id:33,pair:'BTC/USD',mode:'live',
   startedAt:'2026-07-07T16:54:00Z',closedAt:'2026-07-08T16:54:00Z',
   capitalUsedUsd:'1000',realizedPnlUsd:'25.4',buyCount:3,closeReason:'trailing'});
 assert.equal(c.capitalUsedUsd,1000);
 assert.equal(c.realizedPnlUsd,25.4);
 assert.equal(c.buyCount,3);
 const html=idcaHistory(ctx({history:[c]}));
 assert.match(html,/trailing/);
 assert.match(html,/PnL neto/);
 assert.match(html,/nx-idca-history-row/);
});
test('IDCA: historial sin PnL confirmado no se cuenta como ganancia neutra',()=>{
 const html=idcaHistory(ctx({history:[normIdcaCycle({id:1,status:'closed',pair:'ETH/USD'})]}));
 assert.match(html,/Neutros \/ sin PnL confirmado/);
 assert.match(html,/Falta PnL verificado/);
});
test('IDCA: la lista larga conserva todos los ciclos con Ver más',()=>{
 const items=Array.from({length:30},(_,i)=>normIdcaCycle({
   id:i+1,pair:'ETH/USD',realizedPnlUsd:String(i+1),closeReason:'take_profit'
 }));
 const html=idcaHistory(ctx({history:items}));
 assert.match(html,/Ver otros 18 ciclos/);
 assert.match(html,/#30/);
});
test('IDCA: configuración ausente no dibuja columnas sin datos',()=>{
 const html=idcaConfig(ctx({configParams:[]}));
 assert.match(html,/no ha facilitado parámetros/);
 assert.doesNotMatch(html,/<table/);
});
test('IDCA: parámetros disponibles son desplegables con guardado y efectivo',()=>{
 const html=idcaConfig(ctx({configParams:[{key:'maxCycleCount',stored:5,effective:3,
  group:'riesgo',scope:'global',reason:'override'}]}));
 assert.match(html,/nx-idca-param/);
 assert.match(html,/maxCycleCount/);
 assert.match(html,/Guardado/);
 assert.match(html,/Efectivo/);
 assert.doesNotMatch(html,/<table/);
});
test('IDCA: resumen usa tipos numéricos en valores USD y no inventa ceros',()=>{
 const x=normIdcaSummary({capitalUsedUsd:'300',capitalFreeUsd:'700',
  activeCyclesCount:'2',realizedPnlUsd:'-12.5'});
 assert.equal(x.capitalUsedUsd,300);
 assert.equal(x.activeCyclesCount,2);
 assert.equal(x.realizedPnlUsd,-12.5);
 assert.equal(normIdcaSummary({}).capitalUsedUsd,null);
});
test('Cartera: NAV interno sin conciliación nunca se vende como patrimonio',()=>{
 const html=renderPortfolioPremium({...ctx({}),mode:'basic',
  data:{portfolio:{state:'ok',data:{summary:{navUsd:5000,holdUsd:null},holdings:[]}}}});
 assert.match(html,/Lectura sin conciliación completa/);
 assert.match(html,/no es saldo del exchange/);
 assert.doesNotMatch(html,/Patrimonio consolidado|Mi patrimonio/);
});
test('Cartera: saldos de exchange conciliados sí producen patrimonio real',()=>{
 const html=renderPortfolioPremium({...ctx({}),mode:'basic',
   data:{portfolio:{state:'ok',data:{summary:{navUsd:5000},
     resourceStates:{exchangeBalances:'ok',prices:'ok'},
     exchangeBalances:[{exchange:'kraken',asset:'USD',total:1265.55,valueUsd:1265.55},
       {exchange:'revolutx',asset:'ETH',total:0.01,valueUsd:17.13}],
     prices:[{asset:'ETH',priceUsd:1713}],
     holdings:[{asset:'BTC',currentValueUsd:2400},{asset:'ETH',currentValueUsd:2600}]}}}});
 assert.match(html,/Patrimonio en exchanges/);
 assert.match(html,/1\.?282|1282/, 'la suma real de saldos no aparece');
 assert.match(html,/BTC/);
 assert.match(html,/ETH/);
 assert.match(html,/nxp-allocation/);
});
test('FISCO: acceso prohibido no muestra Reintentar como si concediera permiso',()=>{
 const html=renderFiscoPremium({...ctx({}),mode:'basic',data:{fisco:{state:'forbidden',data:null}}});
 assert.match(html,/Falta autorización fiscal/);
 assert.match(html,/fisco:read/);
 assert.doesNotMatch(html,/data-app="refresh"/);
});
