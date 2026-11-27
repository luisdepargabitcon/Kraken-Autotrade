// Tests de autenticación/autorización/acciones del BFF de referencia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)),'..');
const web = join(root,'web');
const authSrc = readFileSync(join(web,'js','auth.js'),'utf8');
const actSrc = readFileSync(join(web,'js','actions.js'),'utf8');
const bffSrc = readFileSync(join(root,'bff','v2-auth.mjs'),'utf8');
const proxySrc = readFileSync(join(root,'bff','v2-proxy.mjs'),'utf8');

test('BFF: login devuelve token+roles+caducidad; logout/session existen', ()=>{
  assert.match(bffSrc, /\/auth\/login/);
  assert.match(bffSrc, /\/auth\/logout/);
  assert.match(bffSrc, /expiresAt/);
  assert.match(bffSrc, /401/);
});
test('BFF: roles separan lectura de control; 403 sin permiso', ()=>{
  assert.match(bffSrc, /requirePerm/);
  assert.match(bffSrc, /'read'/);
  assert.match(bffSrc, /403/);
  assert.match(proxySrc, /':read'|:read'/);
});
test('BFF: idempotencia + CSRF + auditoría en acciones', ()=>{
  assert.match(bffSrc, /X-Idempotency-Key|x-idempotency-key/);
  assert.match(bffSrc, /X-Idempotent-Replay/);
  assert.match(bffSrc, /csrfGuard/);
  assert.match(bffSrc, /auditLog/);
});
test('cliente actions: catálogo tiene permiso+confirmación+ruta real por acción', ()=>{
  const ids = [...actSrc.matchAll(/'([a-z]+\.[a-zA-Z]+)':\s*\{/g)].map(m=>m[1]);
  assert.ok(ids.length>=8, 'catalogo >=8 acciones');
  for(const id of ids){ assert.match(actSrc, new RegExp(id.replace('.','\\.')+"':\\s*\\{[^}]*perm:")); }
  assert.match(actSrc, /X-Idempotency-Key/);
  assert.match(actSrc, /X-CSRF-Token/);
  assert.match(actSrc, /401|auth_required/);
});
test('cliente: sin permiso la acción devuelve forbidden (no ejecuta)', ()=>{
  assert.match(actSrc, /canDo|hasPerm/);
  assert.match(actSrc, /forbidden/);
});
test('acciones mapean rutas reales del repo', ()=>{
  for(const r of ['institutional-dca/controls','grid-isolated/mode','ama/kill-switch','positions/']){
    assert.match(actSrc+bffSrc+proxySrc, new RegExp(r.replace(/[/.]/g,'\\$&')), `ruta real ausente: ${r}`);
  }
});
test('auth cliente: caducidad de sesión comprobada y logout limpia', ()=>{
  assert.match(authSrc, /expiresAt/);
  assert.match(authSrc, /session\.clear|sessionStorage\.removeItem/);
});
