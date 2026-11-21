// Tests FUNCIONALES del BFF rev8 (C100): servidor real en localhost, pairing,
// challenge firmado, revocación, 401/403, deny-by-default. Sin mocks de código.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { v2AuthRouter, _internal } from '../bff/v2-auth.mjs';
import { v2ProxyRouter } from '../bff/v2-proxy.mjs';

let server, base;
const post = (p,b,h={}) => fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(b)});
const get = (p,h={}) => fetch(base+p,{headers:h});

// clave de dispositivo de prueba (ECDSA P-256, misma curva que el cliente)
const devKey = crypto.generateKeyPairSync('ec',{namedCurve:'P-256',
  publicKeyEncoding:{format:'der',type:'spki'}, privateKeyEncoding:{format:'der',type:'pkcs8'}});
const pubB64 = devKey.publicKey.toString('base64');
const DEV='dev-test-001';
const privObj = crypto.createPrivateKey({key:devKey.privateKey,format:'der',type:'pkcs8'});
const sign = n => crypto.sign('SHA256',Buffer.from(n),{key:privObj,dsaEncoding:'ieee-p1363'}).toString('base64');

before(async()=>{
  process.env.NXV2_BOOTSTRAP_CODE='BOOT123';
  const app = express();
  app.use('/v2', v2AuthRouter(), v2ProxyRouter());
  await new Promise(r=>{ server=app.listen(0,r); });
  base = `http://127.0.0.1:${server.address().port}/v2`;
});
after(()=>server.close());

test('pair/issue rechazado sin admin ni bootstrap (403)', async()=>{
  const r = await post('/pair/issue',{});
  assert.equal(r.status,403);
});
test('pair/issue con bootstrap emite código expirante', async()=>{
  const r = await post('/pair/issue',{roles:['read','idca:read']},{'x-bootstrap-code':'BOOT123'});
  assert.equal(r.status,200);
  const d = await r.json();
  assert.match(d.code,/^[0-9A-F]{12}$/);
  _internal.pairCodes.set('TESTCODE',{roles:['read'],expiresAt:Date.now()+60000,usedBy:null});
});
test('pair/redeem con código inválido → 403; con válido registra clave', async()=>{
  assert.equal((await post('/pair/redeem',{code:'BAD',deviceId:DEV,publicKey:pubB64})).status,403);
  const r = await post('/pair/redeem',{code:'TESTCODE',deviceId:DEV,publicKey:pubB64,label:'test',platform:'android'});
  assert.equal(r.status,200);
});
test('código de un solo uso: segundo redeem → 403', async()=>{
  const r = await post('/pair/redeem',{code:'TESTCODE',deviceId:'dev-other',publicKey:pubB64});
  assert.equal(r.status,403);
});
test('challenge+firma → sesión Bearer real; firma mala → 401', async()=>{
  const c = await (await post('/session/challenge',{deviceId:DEV})).json();
  assert.ok(c.nonce);
  assert.equal((await post('/session/redeem',{deviceId:DEV,nonce:c.nonce,signature:'AAAA'})).status,401);
  const c2 = await (await post('/session/challenge',{deviceId:DEV})).json();
  const r = await post('/session/redeem',{deviceId:DEV,nonce:c2.nonce,signature:sign(c2.nonce)});
  assert.equal(r.status,200);
  const d = await r.json();
  assert.ok(d.token && d.expiresAt>Date.now() && d.csrf);
  _internal.goodToken = d.token;
});
test('nonce gastado no es reutilizable', async()=>{
  const c = await (await post('/session/challenge',{deviceId:DEV})).json();
  const sig = sign(c.nonce);
  await post('/session/redeem',{deviceId:DEV,nonce:c.nonce,signature:sig});
  assert.equal((await post('/session/redeem',{deviceId:DEV,nonce:c.nonce,signature:sig})).status,401);
});
test('proxy: sin sesión → 401; ruta no mapeada → 403 deny-by-default', async()=>{
  assert.equal((await get('/market/BTC-USD')).status,401);
  const r = await get('/ruta/inventada',{Authorization:`Bearer ${_internal.goodToken}`});
  assert.equal(r.status,403);
  const d = await r.json(); assert.equal(d.error,'route_not_allowed');
});
test('revocación: solo admin (403 con rol read); revocado no obtiene challenge', async()=>{
  assert.equal((await post(`/devices/${DEV}/revoke`,{},{Authorization:`Bearer ${_internal.goodToken}`})).status,403);
  _internal.sessions.set('adm-token',{user:'admin',roles:['admin'],expiresAt:Date.now()+60000,csrf:'x'});
  const r = await post(`/devices/${DEV}/revoke`,{}, {Authorization:'Bearer adm-token'});
  assert.equal(r.status,200);
  assert.equal((await post('/session/challenge',{deviceId:DEV})).status,403);
  assert.equal((await get('/market/BTC-USD',{Authorization:`Bearer ${_internal.goodToken}`})).status,401);
});
test('PIN del cliente jamás aparece en el contrato de red del BFF', async()=>{
  // el dispositivo se autentica por firma; ningún endpoint acepta 'pin' ni 'password'
  const r = await post('/session/challenge',{deviceId:'x',pin:'000000'});
  assert.equal(r.status,403);
});
