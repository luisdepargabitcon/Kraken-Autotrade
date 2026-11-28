// NEXA — cartera profesional (issue #18 §D): mapeo NAV/exposición, composición
// solo con precios reales, polvo agrupado, conciliación con diferencias y
// separación REAL/SHADOW. Fixtures con la forma real verificada del VPS:
// /balances/all → {kraken:{connected,balances:{XXBT:…}},revolutx:{…}},
// /prices/portfolio → mapa coingecko, /portfolio/* → summary/holdings/ledger.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location??={search:'',protocol:'https:',pathname:'/'};
globalThis.window??={Capacitor:null};
globalThis.sessionStorage??={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.localStorage??={getItem:()=>null,setItem(){},removeItem(){}};
const {renderPortfolioView}=await import('../web/js/portfolio-view.js');

// Saldos reales: kraken (XXBT/XETH/ZUSD) + revolutx (XBT-like ya canonical,
// USDC estable, polvo XXDG). Precios coingecko por activo canónico.
const balances={
 kraken:{connected:true,balances:{XXBT:0.1,XETH:0.5,ZUSD:300}},
 revolutx:{connected:true,balances:{BTC:0.02,USDC:200,XXDG:5000}},
};
const prices={
 BTC:{price:60000,source:'coingecko'},ETH:{price:1800,source:'coingecko'},
 USD:{price:1,source:'fixed'},USDC:{price:1,source:'coingecko'},DOGE:{price:0.0001,source:'coingecko'},
};
// 0,1+0,02 BTC = 7200 · 0,5 ETH = 900 · ZUSD 300 + USDC 200 = 500 · DOGE 5000×0,0001=0,5 (polvo)
// Total cubierto = 8600,5 USD; sin el polvo = 8600 USD.
const summary={navUsd:8000,exposureUsd:4200,allocatedUsd:6000,realizedPnlUsd:120.5,
 unrealizedPnlUsd:-30,holdUsd:250};
const holdings=[
 {asset:'BTC',exchange:'revolutx',total:0.11},{asset:'ETH',exchange:'revolutx',total:0.5},
 {asset:'USD',exchange:'revolutx',total:500},{asset:'DOGE',exchange:'kraken',total:5000},
];
const ledger=[{id:'l1',ts:'2026-11-20T10:00:00Z',type:'buy',asset:'BTC',amountUsd:600,mode:'live'}];
const reservations=[{id:'r1',mode:'idca',amountUsd:500,state:'locked'}];
const budgets={items:[{mode:'idca',exchange:'revolutx',asset:'USD',budgetUsd:4000,usedUsd:2380,status:'active'}]};
const inventory=[{asset:'BTC',exchange:'kraken',quantity:0.1,valueUsd:6000}];

function ctx({scope='real',mode='pro',tab='summary',summaryData=summary,holds=holdings,bal=balances,pr=prices}={}){
 return {authenticated:true,mode,viewScope:scope,
  ui:{portfolioTab:tab,fiscoTab:'summary',engineId:'idca',subtab:'panel'},
  enginesData:{idca:{state:'ok',data:{status:{mode:'live'},summary:{mode:'live'},
   simWallet:{totalUsd:2500,freeUsd:2000,usedUsd:500}}}},
  data:{portfolio:{state:'partial',readAt:Date.now(),data:{
   summary:summaryData,holdings:holds,ledger,reservations,budgets,inventory,
   exchangeBalances:bal,prices:pr,
   resourceStates:{summary:'ok',holdings:'ok',ledger:'ok',reservations:'ok',
    budgets:'ok',inventory:'ok',exchangeBalances:'ok',prices:'ok'}}}}};
}

test('Resumen usa navUsd/exposureUsd del norm, no allocatedUsd/deployedUsd fantasmas',()=>{
 const html=renderPortfolioView(ctx());
 assert.match(html,/NAV informado por el bot/);
 assert.match(html,/Exposición interna/);
 assert.match(html,/8\.?000,00/);   // navUsd
 assert.match(html,/4\.?200,00/);   // exposureUsd
 assert.match(html,/no es saldo del exchange/i);
 assert.match(html,/PnL realizado \(bot\)/);
 assert.match(html,/PnL sin realizar \(bot\)/);
 // El hero de valoración exchange NO se repite en otras pestañas.
 const saldos=renderPortfolioView(ctx({tab:'balances'}));
 assert.doesNotMatch(saldos,/VALORACIÓN DE SALDOS DEL EXCHANGE/);
 assert.match(saldos,/Saldos por exchange y moneda/);
 const activos=renderPortfolioView(ctx({tab:'assets'}));
 assert.doesNotMatch(activos,/VALORACIÓN DE SALDOS DEL EXCHANGE/);
});

test('Composición solo con cobertura completa; polvo agrupado como residual',()=>{
 const html=renderPortfolioView(ctx());
 assert.match(html,/Todos los activos tienen precio · total \$?8\.?600,50/);
 assert.match(html,/nxw-comp-row/);
 assert.match(html,/Activos residuales/);
 assert.match(html,/nxw-dust/);
 // El polvo (0,50 USD) no aparece como barra propia ni suma porcentaje inventado.
 const dustSection=html.split('Activos residuales')[1]||'';
 assert.match(dustSection,/5000|5\.000/); // cantidad DOGE listada dentro del details
});

test('Cobertura parcial: sin porcentajes ni total inventados',()=>{
 const sinDOGE={...prices};delete sinDOGE.DOGE;
 const html=renderPortfolioView(ctx({pr:sinDOGE}));
 assert.match(html,/Cobertura parcial: 4 de 5 activos con precio/);
 assert.match(html,/importe cubierto \$?8\.?600,00/);
 assert.match(html,/Sin precio verificable/);
 assert.match(html,/DOGE/);
});

test('Sin precios no hay composición: mensaje honesto',()=>{
 const html=renderPortfolioView(ctx({pr:null}));
 assert.match(html,/Ninguna posición tiene precio verificable|Cobertura parcial|Composición por activo/);
 assert.doesNotMatch(html,/nxw-comp-fill/);
});

test('Conciliación muestra diferencias bot vs exchange con fuentes',()=>{
 // holdings BTC 0.11 vs exchange BTC 0.12 → dif; NAV 8000 vs 8600,50 → dif −600,50.
 const html=renderPortfolioView(ctx({mode:'pro',tab:'audit'}));
 assert.match(html,/Procedencia y conciliación/);
 assert.match(html,/Diferencia/);
 assert.match(html,/−\$?600,50|\$?-?600,50/);
 assert.match(html,/Cantidades por activo/);
 assert.match(html,/Dif\. \(exch−bot\)/);
 assert.match(html,/BTC/);
 assert.match(html,/Presupuestos e inventario internos/);
 assert.match(html,/\$?4\.?000,00/); // budgetUsd
});

test('Conciliación sin diferencias cuadra las cantidades',()=>{
 const same=[{asset:'BTC',total:0.12},{asset:'ETH',total:0.5},
  {asset:'USD',total:300},{asset:'USDC',total:200},{asset:'DOGE',total:5000}];
 const html=renderPortfolioView(ctx({mode:'pro',tab:'audit',holds:same}));
 assert.match(html,/coinciden entre la cartera interna y los saldos del exchange/);
 assert.doesNotMatch(html,/Dif\. \(exch−bot\)<\/strong><\/div><div class="nxw-diff-row"><span><b>/);
});

test('Sin holdings legibles la conciliación explica qué falta',()=>{
 const html=renderPortfolioView(ctx({mode:'pro',tab:'audit',holds:null}));
 assert.match(html,/no tiene lectura verificable|sin lectura verificable/i);
 assert.doesNotMatch(html,/Dif\. \(exch−bot\)/);
});

test('SHADOW nunca muestra valoración, composición ni conciliación real',()=>{
 const html=renderPortfolioView(ctx({scope:'shadow',tab:'summary'}));
 assert.match(html,/SALDO VIRTUAL IDCA/);
 assert.match(html,/2500|2\.500/);
 assert.doesNotMatch(html,/VALORACIÓN DE SALDOS DEL EXCHANGE/);
 assert.doesNotMatch(html,/Composición por activo/);
 assert.doesNotMatch(html,/nxw-comp-fill/);
 const audit=renderPortfolioView(ctx({scope:'shadow',mode:'pro',tab:'audit'}));
 assert.doesNotMatch(audit,/Procedencia y conciliación<\/h2>/);
 assert.match(audit,/no se muestran saldos, holdings ni presupuestos del exchange/i);
});

test('Básico no alcanza pestañas profesionales',()=>{
 // 'reservations' está vetada en Básico (nav-model BASIC_HIDDEN): la vista cae
 // a la primera pestaña permitida y jamás muestra presupuestos/inventario.
 const html=renderPortfolioView(ctx({mode:'basic',tab:'reservations'}));
 assert.match(html,/Composición por activo|VALORACIÓN DE SALDOS DEL EXCHANGE/);
 assert.doesNotMatch(html,/Presupuestos e inventario internos/);
 assert.doesNotMatch(html,/Reservas y presupuestos internos<\/h2>/);
});
