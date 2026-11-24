import test from 'node:test';
import assert from 'node:assert/strict';
import {renderHomePremium,renderMarketPremium,renderEnginePremium,renderPortfolioPremium,renderActivityPremium} from '../web/js/premium.js';
import * as Screens from '../web/js/screens.js';

const engines=[{id:'idca',name:'IDCA'},{id:'spot',name:'SPOT / Swing'},
{id:'grid',name:'GRID aislado'},{id:'ama',name:'AMA'}];
const subtabs=[{id:'panel',label:'Panel'},{id:'cycles',label:'Ciclos abiertos'},
{id:'history',label:'Historial'},{id:'orders',label:'Órdenes'}];
const offline={
 authenticated:false,mode:'basic',engineList:engines,ui:{engineId:'idca',subtab:'panel',marketPair:'BTC/USD'},
 subtabs,renderEngineSub:()=>'<section data-origin="legacy">Acciones e históricos</section>',
 data:{portfolio:{state:'auth_required',data:{}},market:{state:'auth_required',data:null},
 activity:{state:'auth_required',data:{events:[]}}},enginesData:{}
};
const ready={
 ...offline,authenticated:true,
 data:{portfolio:{state:'ok',data:{summary:{
 navUsd:12450,exposureUsd:3000,realizedPnlUsd:300,unrealizedPnlUsd:-25,
 byEngine:[{engine:'idca',pnlUsd:200,exposureUsd:3000}],byAsset:[{asset:'BTC',valueUsd:12450}]},holdings:[]}},
 market:{state:'ok',data:{pair:'BTC/USD',price:78500,change24h:-2.5,source:'Exchange',
 candles:[{o:76000,h:78500,l:75500,c:77000,t:1},{o:77000,h:79200,l:76600,c:78500,t:2}],indicators:{rsi:44,adx:17}}},
 activity:{state:'ok',data:{events:[{type:'tick',message:'actualizado',ts:'2026-11-21T04:00:00Z'}]}}},
 enginesData:{
  idca:{state:'ok',data:{status:{mode:'simulation'},summary:{activeCyclesCount:1,capitalUsedUsd:1200,realizedPnlUsd:200},
   cycles:[{id:51,pair:'BTC/USD',avgEntryPrice:78000,currentPrice:78500,tpTargetPrice:79900,cycleAnchorPrice:76900,capitalUsedUsd:1200}]}},
  spot:{state:'ok',data:{status:{mode:'dry-run',strategy:'Trend'},positions:[{pair:'ETH/USD',avgPrice:1900,currentPrice:1930,quantity:0.2,pnlUsd:6}]}},
  grid:{state:'ok',data:{status:{mode:'SHADOW',activeCyclesCount:1,capitalBudgetUsd:1000},
    levels:{levels:[{price:78000,side:'BUY'},{price:79000,side:'SELL'}],previousRanges:[{id:'legacy1'}]},
    cycles:[{id:2,buyPrice:78000,sellTargetPrice:79000,status:'open'}]}},
  ama:{state:'ok',data:{status:{mode:'LAB'},readiness:{readyCount:2,totalCount:3},
    portfolio:{budgetUsd:2000,reservedUsd:400,freeUsd:1600},mandate:{id:'m1',status:'draft',explanation:'Esperar'}}}
 }
};
function html(ctx,fn){return fn(ctx,()=>'<section data-origin="legacy">Datos íntegros</section>');}

test('Básico es cartera y motores, no un terminal de trading con columnas',()=>{
 const s=renderHomePremium(offline);
 assert.match(s,/nxp-mode-basic/);
 assert.match(s,/nxp-basic-balance/);
 assert.match(s,/Conectar mi bot/);
 assert.equal((s.match(/class="nxp-engine-row"/g)||[]).length,4);
 assert.doesNotMatch(s,/nxp-terminal-grid/);
 assert.doesNotMatch(s,/No disponible/);
});
test('Pro tiene estructura de trading con terminal, gráficos, riesgo y herramientas',()=>{
 const s=renderHomePremium({...ready,mode:'pro'});
 assert.match(s,/nxp-mode-pro/);
 assert.match(s,/nxp-terminal-grid/);
 assert.match(s,/nxp-chartbox/);
 assert.match(s,/Riesgo y protección/);
 assert.match(s,/Actividad del bot/);
 assert.doesNotMatch(s,/Conectar mi bot/);
});
test('Mercado cambia de composición: cada subpestaña tiene una sola responsabilidad',()=>{
 const basic=renderMarketPremium(ready);
 const pro=renderMarketPremium({...ready,mode:'pro'});
 const proChart=renderMarketPremium({...ready,mode:'pro',ui:{...ready.ui,marketSub:'chart'}});
 const proInd=renderMarketPremium({...ready,mode:'pro',ui:{...ready.ui,marketSub:'indicators'}});
 const proLevels=renderMarketPremium({...ready,mode:'pro',ui:{...ready.ui,marketSub:'levels'}});
 // Precio: solo cotización — sin gráfica ni contexto de decisión.
 assert.match(basic,/nxp-market-price/);
 assert.match(pro,/nxp-market-terminal/);
 assert.doesNotMatch(pro,/nxp-chart-interactive/);
 assert.doesNotMatch(pro,/CONTEXTO/);
 // Gráfico: velas + timeframe; el ticker sigue visible arriba.
 assert.match(proChart,/nxp-chart-interactive/);
 assert.match(proChart,/data-candle-tip/);
 assert.match(proChart,/nxp-quote/);
 // Niveles: panel propio con la nota de que el derivado no es una orden.
 assert.match(proLevels,/Niveles etiquetados/);
 assert.match(proLevels,/nunca una orden/);
 // Indicadores: indicadores + fuentes + contexto IDCA/AMA.
 assert.match(proInd,/RSI 14/);
 assert.match(proInd,/Fuentes de datos/);
 assert.match(proInd,/CONTEXTO/);
 assert.match(pro,/data-ui="marketPair:ETH\/USD"/);
});
test('Mercado desconectado no inventa precios o gráficos de datos reales',()=>{
 const s=renderMarketPremium(offline);
 assert.match(s,/Conectar NEXA/);
 assert.doesNotMatch(s,/\$[0-9][0-9,.]*/);
 const sc=renderMarketPremium({...offline,ui:{...offline.ui,marketSub:'chart'}});
 assert.match(sc,/Esperando el mercado/);
});
test('Cada motor Pro utiliza visualización propia según su semántica',()=>{
 const idca=renderEnginePremium({...ready,mode:'pro'});
 const grid=renderEnginePremium({...ready,mode:'pro',ui:{...ready.ui,engineId:'grid'}});
 const spot=renderEnginePremium({...ready,mode:'pro',ui:{...ready.ui,engineId:'spot'}});
 const ama=renderEnginePremium({...ready,mode:'pro',ui:{...ready.ui,engineId:'ama'}});
 assert.match(idca,/nxp-price-track/);
 assert.match(grid,/nxp-grid-map/);
 assert.match(spot,/nxp-position/);
 assert.match(ama,/nxp-readiness/);
 for(const v of [idca,grid,spot,ama]){
   assert.match(v,/nxp-mode-pro/);
   assert.match(v,/Auditoría integral y controles originales/);
   assert.match(v,/data-origin="legacy"/);
 }
});
test('El motor Básico no es la misma pantalla Pro recoloreada',()=>{
 const a=renderEnginePremium(ready),b=renderEnginePremium({...ready,mode:'pro'});
 assert.match(a,/nxp-simple-card/);
 assert.match(b,/nxp-pro-workspace/);
 assert.doesNotMatch(a,/nxp-terminal-grid/);
 assert.doesNotMatch(a,/nxp-engine-tabs/);
});
test('Motor sin sesión no indica LIVE, 0 ciclos o apagado',()=>{
 const a=renderEnginePremium(offline),b=renderEnginePremium({...offline,mode:'pro'});
 assert.match(a,/Conecta tu móvil/);
 assert.match(b,/Sin lectura verificada/);
 assert.doesNotMatch(a,/Sin ciclos|LIVE|detenido/);
 assert.doesNotMatch(b,/Sin ciclos|LIVE|detenido/);
});
test('Cartera Básico representa patrimonio y Pro exposición por activo/motor',()=>{
 const a=html(ready,renderPortfolioPremium),b=html({...ready,mode:'pro'},renderPortfolioPremium);
 assert.match(a,/nxp-basic-balance/);
 assert.match(b,/nxp-command-strip/);
 assert.match(b,/Distribución por activos/);
 assert.match(b,/Exposición por motor/);
 assert.match(b,/Balances, reservas e históricos íntegros/);
 assert.match(b,/data-origin="legacy"/);
});
test('Actividad usa eventos normalizados, no considera el objeto como array',()=>{
 const a=html(ready,renderActivityPremium);
 const b=Screens.renderActivity(ready);
 assert.match(a,/Actividad reciente/);
 assert.match(a,/actualizado/);
 assert.match(b,/Actividad reciente/);
});
test('Pantallas públicas de NEXA usan realmente premium.js',()=>{
 assert.match(Screens.renderHome(offline),/nxp-basic-balance/);
 assert.match(Screens.renderMarket({...offline,mode:'pro'}),/nxp-market-terminal/);
 assert.match(Screens.renderEngine({...offline,mode:'pro'}),/nxp-engine-layout/);
 assert.match(Screens.renderPortfolio(offline),/nxp-mode-basic/);
});
test('Sin conectividad no envía órdenes, navegación por datos no incluye POST',()=>{
 const all=[renderHomePremium(offline),renderMarketPremium(offline),renderEnginePremium(offline),
  html(offline,renderPortfolioPremium)].join('');
 assert.doesNotMatch(all,/data-action="idca\.emergencyClose"/);
 assert.match(all,/data-app="pair-device"/);
});
