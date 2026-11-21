// NEXA rev9 — real structural UX regression tests, not CSS screenshot snapshots.
// No production data and no back-end calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHomeExperience, renderMarketExperience, renderEngineExperience, renderPortfolioExperience } from '../web/js/experience.js';
import * as Screens from '../web/js/screens.js';

const base={
  mode:'basic',authenticated:false,
  data:{
    market:{state:'auth_required',data:null},
    portfolio:{state:'auth_required',data:{summary:null,holdings:[]}}
  },
  ui:{marketPair:'BTC/USD',engineId:'idca',subtab:'panel'},
  enginesData:{},engineList:[
    {id:'idca',name:'IDCA',desc:'Ciclos'},
    {id:'spot',name:'SPOT / Swing',desc:'Posiciones'},
    {id:'grid',name:'GRID aislado',desc:'Rangos'},
    {id:'ama',name:'AMA',desc:'Macro'}
  ],
  subtabs:[{id:'panel',label:'Panel'},{id:'cycles',label:'Ciclos abiertos'},{id:'history',label:'Historial'}],
  renderEngineSub:()=>'<span>detalle de la API real</span>'
};
const legacy=()=>'<div id="original-detail">Campos y contratos originales</div>';

test('Inicio desconectado: composición tipo cockpit, sin saldos inventados ni 20 No disponible',()=>{
  const out=renderHomeExperience(base,legacy);
  assert.match(out,/nx-wealth-hero/);
  assert.match(out,/Tus motores/);
  assert.match(out,/Vincular mi bot/);
  assert.match(out,/data-nav="engine:idca"/);
  assert.match(out,/data-nav="engine:ama"/);
  assert.doesNotMatch(out,/>No disponible</);
  assert.doesNotMatch(out,/0\.00\s?USD/);
});
test('Mercado desconectado: un solo estado accionable, sin gráficas de precios falsos',()=>{
  const out=renderMarketExperience(base,legacy);
  assert.match(out,/Gráfica pendiente de datos/);
  assert.match(out,/data-ui="marketPair:ETH\/USD"/);
  assert.match(out,/data-app="pair-device"/);
  assert.doesNotMatch(out,/Indicadores completos/);
});
test('Motor no vinculado: Básico y Pro son diseños realmente distintos',()=>{
  const basic=renderEngineExperience(base,legacy);
  const pro=renderEngineExperience({...base,mode:'pro'},legacy);
  assert.match(basic,/Vincula NEXA/);
  assert.doesNotMatch(basic,/nx-engine-subnav/);
  assert.match(pro,/nx-engine-subnav/);
  assert.match(pro,/DATOS PROFESIONALES/);
  assert.doesNotMatch(basic,/Sin ciclos/);
  assert.doesNotMatch(pro,/LIVE/);
});
test('Motor conectado: los controles del panel antiguo siguen en el DOM detrás del detalle',()=>{
  const ctx={...base,authenticated:true,mode:'pro',
    enginesData:{idca:{state:'ok',data:{status:{mode:'simulation'},summary:{activeCyclesCount:2,pnlUsd:120}}}}};
  const out=renderEngineExperience(ctx,legacy);
  assert.match(out,/nx-engine-hero/);
  assert.match(out,/Diagnóstico completo/);
  assert.match(out,/detalle de la API real/);
  assert.match(out,/data-ui="subtab:cycles"/);
});
test('Cartera desconectada: no presenta NAV, saldo cero ni PnL falsos',()=>{
  const out=renderPortfolioExperience(base,legacy);
  assert.match(out,/cartera/i);
  assert.match(out,/Vincula NEXA/);
  assert.doesNotMatch(out,/0\.00\s?USD/);
});
test('Cartera autenticada: cifras de fuente y desglose original en Pro',()=>{
  const ctx={...base,authenticated:true,mode:'pro',
    data:{portfolio:{state:'ok',data:{summary:{
      navUsd:12345.67,realizedPnlUsd:123,unrealizedPnlUsd:-45,exposureUsd:1234},holdings:[{asset:'BTC',valueUsd:111}]}}}};
  const out=renderPortfolioExperience(ctx,legacy);
  assert.match(out,/nx-wealth-hero/);
  assert.match(out,/BTC/);
  assert.match(out,/Balances y desglose completos/);
  assert.match(out,/original-detail/);
});
test('Pantallas públicas de screens.js usan la composición premium Rev11',()=>{
  const out=Screens.renderHome(base);
  assert.match(out,/nxp-basic-balance/);
  const out2=Screens.renderMarket(base);
  assert.match(out2,/nxp-chartbox/);
  const out3=Screens.renderEngine(base);
  assert.match(out3,/nxp-engine-head/);
});
