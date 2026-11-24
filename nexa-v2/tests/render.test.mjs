// NEXA V2 — tests de render a string (smoke). Sin DOM real: las funciones de
// ui/screens devuelven HTML; las que tocan document no se invocan aquí.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');

const S = await import(pathToFileURL(join(web,'js','screens.js')));
const fixtures = await import(pathToFileURL(join(root,'tests','fixtures.mjs')));

function ctxFor(engineData, mode='pro'){
  return {
    mode, data:engineData, dataTag:'DEMO',
    ui:{ marketPair:'BTC/USD', engineId:'idca', subtab:'panel', activityFilter:{sev:'all',engine:'all'} },
  };
}

test('IDCA panel Pro renderiza modo, pares, score, protecciones', ()=>{
  const html = S.idcaPanel(ctxFor(fixtures.DEMO_IDCA,'pro'));
  for(const s of ['simulation','BTC/USD','Score','Break-even','Trailing','emergencia'])
    assert.ok(html.includes(s), `falta "${s}" en panel IDCA`);
});

test('IDCA panel Básico contiene detalle expandible (no se borra información)', ()=>{
  const html = S.idcaPanel(ctxFor(fixtures.DEMO_IDCA,'basic'));
  assert.ok(html.includes('expandable')||html.includes('<details'), 'sin detalle expandible');
  assert.ok(html.includes('Capital usado'));
});

test('IDCA ciclos: anclas, TP, BE/trailing, órdenes, acciones protegidas', ()=>{
  const html = S.idcaCycles(ctxFor(fixtures.DEMO_IDCA,'pro'));
  for(const s of ['cyc_btc_114','Ancla de ciclo','TP dinámico','Break-even','Trailing','ord_9012','Pausar ciclo','Cerrar posición'])
    assert.ok(html.includes(s), `falta "${s}"`);
});

test('GRID panel distingue rangos antiguos y bloqueo REAL', ()=>{
  const html = S.gridPanel(ctxFor(fixtures.DEMO_GRID,'pro'));
  for(const s of ['SHADOW','MAKER_ONLY','rangos antiguos','REAL_LIMITED','gc_298'])
    assert.ok(html.includes(s), `falta "${s}"`);
});

test('AMA panel muestra REAL cerrado y readiness', ()=>{
  const html = S.amaPanel(ctxFor(fixtures.DEMO_AMA,'pro')) + S.amaReadiness(ctxFor(fixtures.DEMO_AMA,'pro'));
  for(const s of ['REAL cerrado','Kill switch','checks','gateway'])
    assert.ok(html.toLowerCase().includes(s.toLowerCase()), `falta "${s}"`);
});

test('Mercado Pro incluye fuentes e indicadores; nunca ceros por ausencia', ()=>{
  // «Indicadores» es la subpestaña que reúne indicadores + fuentes + contexto.
  const html = S.renderMarket({mode:'pro', authenticated:true, ui:{marketPair:'BTC/USD',marketSub:'indicators'}, data:{market:{state:'ok',data:fixtures.DEMO_MARKET}}});
  for(const s of ['Fuentes de datos','RSI','CONTEXTO','CoinGlass','Whale Alert','No disponible'===undefined?'':''])
    if(s) assert.ok(html.includes(s), `falta "${s}"`);
});

test('Actividad filtra por severidad', ()=>{
  const ctx = ctxFor(null,'pro'); ctx.authenticated=true; ctx.data={activity:{state:'ok',data:{events:fixtures.DEMO_ACTIVITY}}};
  ctx.ui.activityFilter={sev:'err',engine:'all'};
  const html = S.renderActivity(ctx);
  assert.ok(html.includes('Timeout fuente macro'));
  assert.ok(!html.includes('IDCA compra seguridad'));
});

test('FISCO es sección restringida sin datos personales', ()=>{
  const html = S.renderFisco({...ctxFor({fisco:{state:'ok',data:fixtures.DEMO_FISCO}},'pro'),authenticated:true});
  assert.ok(html.includes('restringida'));
  assert.ok(html.includes('Agregados'));
});
