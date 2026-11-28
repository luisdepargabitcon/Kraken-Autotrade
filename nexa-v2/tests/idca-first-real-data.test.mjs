// INC-019: regression tests of IDCA-first presentation.
// ALL INPUTS ARE SYNTHETIC TEST DATA; not readings from a live bot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {normIdcaCycle,normOrder,normSpotTrade} from '../web/js/adapters.js';
import {idcaHistory,spotHistory,spotPanel} from '../web/js/screens.js';
import {renderEnginePremium} from '../web/js/premium.js';
import {showRecordInspector} from '../web/js/inspector.js';

const legacy=data=>({data,mode:'basic',ui:{subtab:'history',marketPair:'BTC/USD'},authenticated:true});
function commonDoc(){
  const root={innerHTML:'',classList:{remove(){},add(){},contains(){return false}},
    querySelector(){return {focus(){}}},onclick:null};
  const prior=globalThis.document;
  globalThis.document={getElementById:()=>root,activeElement:{isConnected:true,focus(){}},
    addEventListener(){},removeEventListener(){}};
  return {root,restore(){globalThis.document=prior;}};
}
test('Historial IDCA: 27 victorias, 4 pérdidas, 3 neutros, 2 sin PnL, no false zeros',()=>{
 const cycles=[
  ...Array.from({length:27},(_,i)=>({id:i+1,pair:'BTC/USD',mode:'live',realizedPnlUsd:'5.65',realizedPnlPct:'3.92',closeReason:'trailing'})),
  ...Array.from({length:4},(_,i)=>({id:28+i,pair:'ETH/USD',mode:'live',realizedPnlUsd:'-12.32',closeReason:'fail_safe'})),
  ...Array.from({length:3},(_,i)=>({id:32+i,pair:'BTC/USD',mode:'live',realizedPnlUsd:'0'})),
  ...Array.from({length:2},(_,i)=>({id:35+i,pair:'ETH/USD',mode:'simulation'}))
 ].map(normIdcaCycle);
 const html=idcaHistory(legacy({history:cycles}));
 assert.match(html,/Ciclos cerrados/);
 assert.match(html,/Ganadores<\/small><strong>✓ 27/);
 assert.match(html,/Perdedores<\/small><strong>● 4/);
 assert.match(html,/Neutros<\/small><strong>3/);
 assert.match(html,/Sin PnL verificado<\/small><strong>\? 2/);
 assert.match(html,/Ver otros 24 ciclos/);
 assert.match(html,/data-inspect="idca:history:0"/);
 assert.match(html,/\+\$5,65/);
 assert.match(html,/−\$12,32/);
 assert.match(html,/3,92 %/);
 assert.match(html,/Falta PnL verificado en 2 ciclo/);
});
test('Inspector: PnL y motivo claros PRIMERO, historial técnico cerrado, órdenes enlazadas',()=>{
 const ctx=commonDoc();
 try{
  const cy=normIdcaCycle({id:52,pair:'ETH/USD',status:'closed',mode:'live',
    capitalReservedUsd:'1636.37',capitalUsedUsd:'1636.37',
    totalQuantity:'0.86',avgEntryPrice:'1902.75',realizedPnlUsd:'-256.84',
    realizedPnlPct:'-15.70',closeReason:'fail_safe',
    startedAt:'2026-11-20T10:00:00Z',closedAt:'2026-11-20T20:49:00Z'});
  const buy=normOrder({id:820,cycleId:52,side:'buy',grossValueUsd:'1636.37',
    price:'1902.75',quantity:'0.86',feesUsd:'1.49',
    executedAt:'2026-11-20T10:00:00Z',triggerReason:'base_buy'});
  showRecordInspector({enginesData:{idca:{data:{history:[cy],orders:[buy]}}}},'idca:history:0');
  const html=ctx.root.innerHTML;
  assert.match(html,/Resultado neto del cierre/);
  assert.match(html,/−\$256,84/);
  assert.match(html,/−15,70 %/);
  assert.match(html,/Salida de seguridad/);
  assert.match(html,/Capital invertido/);
  assert.match(html,/Cronología del ciclo/);
  assert.match(html,/Órdenes del ciclo/);
  assert.match(html,/Comisiones/);
  assert.ok(html.indexOf('Resumen de la operación') < html.indexOf('Datos técnicos completos'));
  assert.doesNotMatch(html,/<details open class="nx-inspect-all nx-inspect-technical"/);
 }finally{ctx.restore();}
});
test('Sin beneficio confirmado no presenta +0 ni lo suma como resultado cerrado',()=>{
 const ctx=commonDoc();
 try{
  showRecordInspector({enginesData:{idca:{data:{history:[normIdcaCycle({id:51,pair:'BTC/USD',status:'closed',mode:'simulation'})]}}}},'idca:history:0');
  assert.match(ctx.root.innerHTML,/Resultado sin verificar/);
  assert.match(ctx.root.innerHTML,/no se considera resultado cero/i);
 }finally{ctx.restore();}
});
test('Historial SPOT: 403 de pasarela no implica historial vacío',()=>{
 const html=spotHistory(legacy({trades:null,resourceStates:{trades:'forbidden'}}));
 assert.match(html,/pasarela no ha entregado el historial/);
 assert.match(html,/NO significa que el bot no tenga compras ni ventas/);
 assert.doesNotMatch(html,/<table/);
});
test('Historial global: no atribuir trades a SPOT y no sumar ventas sin PnL',()=>{
 const trades=[
   normSpotTrade({id:1,type:'buy',pair:'BTC/USD',price:'100',amount:'1',totalUsd:'100',strategy:'normal_spot'}),
   normSpotTrade({id:2,type:'sell',pair:'BTC/USD',price:'130',amount:'1',totalUsd:'130',realizedPnlUsd:'25.1',strategy:'normal_spot'}),
   normSpotTrade({id:3,type:'sell',pair:'ETH/USD',price:'50',amount:'1',totalUsd:'50',strategy:'unknown'}),
 ];
 const html=spotHistory(legacy({trades,tradeTotal:120,resourceStates:{trades:'ok'}}));
 assert.match(html,/Historial de operaciones/);
 assert.match(html,/registro global/);
 assert.match(html,/Vista parcial: 3 de 120/);
 assert.match(html,/PnL neto de ventas con dato/);
 assert.match(html,/\+\$25,10/);
 assert.match(html,/data-inspect="spot:trades:2"/);
 assert.doesNotMatch(html,/Historial vacío/);
});
test('SPOT: backend sin modo efectivo no se etiqueta como LIVE ni detenido',()=>{
 const html=spotPanel(legacy({status:{},signals:[]}));
 assert.doesNotMatch(html,/>LIVE<\/span>/);
 assert.doesNotMatch(html,/>detenido<\/span>/);
});
test('Básico IDCA: score y ATRP API visibles si están verificados',()=>{
 const d={status:{mode:'live'},summary:{activeCyclesCount:1,capitalUsedUsd:150},
  pairContexts:{'BTC/USD':{pair:'BTC/USD',currentPrice:60078,entryScore:69,confidenceGrade:'C',
    regime:'ranging_neutral',atrpPct:1.64,dipDetectedPct:1.21,requiredDipPct:1.69,
    referencePrice:61000,entryDecision:'watch',hardBlocked:true}},
  cycles:[]};
 const html=renderEnginePremium({authenticated:true,mode:'basic',
  ui:{engineId:'idca',subtab:'panel'},enginesData:{idca:{state:'ok',data:d}},
  subtabs:[],renderEngineSub:()=>'',data:{},deviceEnrolled:true});
 assert.match(html,/Estado de entrada por par/);
 assert.match(html,/BTC\/USD/);
 assert.match(html,/Confianza/);
 assert.match(html,/69 \(C\)/);
 assert.match(html,/ATRP/);
 assert.match(html,/1,64 %/);
 assert.match(html,/Caída desde referencia/);
 assert.match(html,/1,21 % \/ 1,69 %/);
});
