// NEXA V2 — tests de paridad y contratos (node:test).
// Verifican: cobertura de contratos por fixtures, estados frescura, y que el
// código de la app no contiene llamadas mutables (POST/PUT/PATCH/DELETE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');

const { CONTRACTS, ENGINES, coverageReport, ENGINE_SUBTABS } = await import(pathToFileURL(join(web,'js','contracts.js')));
const fixtures = await import(pathToFileURL(join(root,'tests','fixtures.mjs')));
const { freshness, fmtUsd, NA } = await import(pathToFileURL(join(web,'js','util.js')));

function listJs(dir){
  return readdirSync(dir).flatMap(f=>{
    const p=join(dir,f);
    return statSync(p).isDirectory() ? listJs(p) : (p.endsWith('.js')?[p]:[]);
  });
}

test('contratos: cada motor tiene subpestañas definidas', ()=>{
  for(const e of ENGINES){
    assert.ok(ENGINE_SUBTABS[e.id]?.length>=3, `${e.id} sin subtabs`);
  }
});

test('fixtures: IDCA cubre contratos status/summary/cycle/order/history', ()=>{
  const d = fixtures.DEMO_IDCA;
  for(const sec of ['status','summary']){
    const r = coverageReport(CONTRACTS.idca[sec], d[sec]);
    assert.deepEqual(r.missing, [], `IDCA.${sec} falta: ${r.missing}`);
  }
  const cyc = coverageReport(CONTRACTS.idca.cycle, d.cycles[0]);
  assert.deepEqual(cyc.missing, [], `IDCA.cycle falta: ${cyc.missing}`);
  const ord = coverageReport(CONTRACTS.idca.order, d.orders[0]);
  assert.deepEqual(ord.missing, [], `IDCA.order falta: ${ord.missing}`);
  const his = coverageReport(CONTRACTS.idca.history, d.history[0]);
  assert.deepEqual(his.missing, [], `IDCA.history falta: ${his.missing}`);
});

test('fixtures: SPOT/GRID/AMA cubren contratos principales', ()=>{
  const cases = [
    ['spot.status', CONTRACTS.spot.status, fixtures.DEMO_SPOT.status],
    ['spot.position', CONTRACTS.spot.position, fixtures.DEMO_SPOT.positions[0]],
    ['spot.protection', CONTRACTS.spot.protection, fixtures.DEMO_SPOT.protections[0]],
    ['grid.status', CONTRACTS.grid.status, fixtures.DEMO_GRID.status],
    ['grid.cycle', CONTRACTS.grid.cycle, fixtures.DEMO_GRID.cycles[0]],
    ['ama.status', CONTRACTS.ama.status, fixtures.DEMO_AMA.status],
    ['ama.readiness', CONTRACTS.ama.readiness, fixtures.DEMO_AMA.readiness],
    ['ama.mandate', CONTRACTS.ama.mandate, fixtures.DEMO_AMA.mandate],
  ];
  for(const [name,contract,sample] of cases){
    const r = coverageReport(contract, sample);
    assert.deepEqual(r.missing, [], `${name} falta: ${r.missing}`);
  }
});

test('frescura: fresh/stale/old/unknown', ()=>{
  const now = Date.now();
  assert.equal(freshness(new Date(now-10_000).toISOString()), 'fresh');
  assert.equal(freshness(new Date(now-300_000).toISOString()), 'stale');
  assert.equal(freshness(new Date(now-3600_000).toISOString()), 'old');
  assert.equal(freshness(null), 'unknown');
});

test('formato: null nunca es 0 ni cadena vacía', ()=>{
  assert.equal(fmtUsd(null), NA);
  assert.equal(fmtUsd(undefined), NA);
  assert.equal(fmtUsd(NaN), NA);
  assert.equal(fmtUsd(0), '$0,00');
});

test('seguridad: mutaciones SOLO vía actions/auth autenticadas; sin credenciales', ()=>{
  const mutable = /(fetch\([^)]*method:\s*['"](?:POST|PUT|PATCH|DELETE)|open\(\s*['"](?:POST|PUT|PATCH|DELETE)|axios\.(?:post|put|patch|delete)\()/i;
  const secrets = /(api[_-]?key|secret|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{8,}/i;
  const allowed = new Set(['actions.js','auth.js']); // capa autorizada: requiere sesión+confirmación+idempotencia
  for(const f of listJs(join(web,'js'))){
    const src = readFileSync(f,'utf8');
    const name = f.split(/[\/]/).pop();
    if(!allowed.has(name)) assert.ok(!mutable.test(src), `mutable call fuera de capa autorizada en ${name}`);
    assert.ok(!secrets.test(src), `posible secreto en ${name}`);
  }
  // render/navegación/modo jamás mutan:
  for(const name of ['screens.js','ui.js','util.js','contracts.js','provider.js']){
    assert.ok(!mutable.test(readFileSync(join(web,'js',name),'utf8')), `${name} muta`);
  }
});

test('autenticación: sin PIN fijo; PBKDF2 local + sesión servidor', ()=>{
  const app = readFileSync(join(web,'js','app.js'),'utf8');
  const auth = readFileSync(join(web,'js','auth.js'),'utf8');
  assert.ok(!/2468/.test(app+auth), 'PIN 2468 hardcodeado');
  assert.ok(!/expected\s*[:=]\s*['"]\d+/.test(app+auth), 'PIN esperado hardcodeado');
  assert.ok(/deriveBits|PBKDF2/i.test(auth), 'desbloqueo local debe usar PBKDF2');
  assert.ok(/\/v2\/auth\/login/.test(auth), 'login de sesión servidor requerido');
  assert.ok(!/fetch\([^)]*pin/i.test(app), 'PIN local nunca viaja por fetch');
});

test('grid: ciclos 1:1 BUY→SELL conservan cantidad exacta', ()=>{
  for(const c of fixtures.DEMO_GRID.cycles){
    assert.equal(c.buyQty, c.sellQty, `${c.id} BUY!=SELL`);
  }
});

test('AMA: executed/reserved/submitted/filled diferenciados', ()=>{
  const orders = fixtures.DEMO_AMA.trace.orders;
  const states = new Set(orders.map(o=>o.state));
  assert.ok(states.has('reserved') && states.has('filled'));
  const reserved = orders.find(o=>o.state==='reserved');
  assert.equal(reserved.executed, false);
  assert.equal(reserved.orderId, null);
});
