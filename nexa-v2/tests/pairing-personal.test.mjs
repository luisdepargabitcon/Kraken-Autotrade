// Tests FUNCIONALES del código de vinculación PERSONAL permanente (issue #18).
// Servidor real en localhost, mismo harness que read-only-server.test.mjs.
// Valores de prueba únicamente; ningún secreto real.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createReadOnlyServer} from '../bff/read-only-server.mjs';

const bootstrap='b'.repeat(64);
const ADMIN={'X-Bootstrap-Code':bootstrap};
const keypair=()=>crypto.webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
const pubB64=async key=>Buffer.from(await crypto.webcrypto.subtle.exportKey('spki',key.publicKey)).toString('base64');
function start(app){
  return new Promise(resolve=>{
    const s=app.listen(0,'127.0.0.1',()=>resolve({
      server:s,base:'http://127.0.0.1:'+s.address().port}));
  });
}
const stop=s=>new Promise((resolve,reject)=>s.close(err=>err?reject(err):resolve()));
const POST=(base,p,b,h={})=>fetch(base+p,{
  method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(b)
});
const redeem=async(base,code,key,label='Pixel')=>{
  const publicKey=await pubB64(key);
  return POST(base,'/api/v2/pair/redeem',{code,deviceId:crypto.randomUUID(),publicKey,platform:'android',label});
};

test('código personal: issue protegido, reutilizable, persistente y rotatable',async(t)=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexa-personal-'));
  t.after(async()=>{await rm(dir,{recursive:true,force:true});});
  const options={upstream:'http://127.0.0.1:3020',stateDir:dir,
    bootstrapCode:bootstrap,allowedOrigins:'https://localhost',fetchImpl:async()=>new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})};
  const gate=await createReadOnlyServer(options);
  let {server,base}=await start(gate.app);
  t.after(async()=>{if(server.listening)await stop(server);});

  // issue sin bootstrap → 403; con bootstrap incorrecto → 403
  assert.equal((await POST(base,'/api/v2/pair/personal/issue',{})).status,403);
  assert.equal((await POST(base,'/api/v2/pair/personal/issue',{},{'X-Bootstrap-Code':'weak'})).status,403);
  // roles no permitidos → 400
  assert.equal((await POST(base,'/api/v2/pair/personal/issue',{roles:['admin']},ADMIN)).status,400);

  // issue con bootstrap → código de 24 chars hex mayúsculas
  const issue=await POST(base,'/api/v2/pair/personal/issue',{roles:['read','fisco:read']},ADMIN);
  assert.equal(issue.status,200);
  const {code,roles,note}=await issue.json();
  assert.match(code,/^[0-9A-F]{24}$/);
  assert.deepEqual(roles,['read','fisco:read']);
  assert.equal(note,'shown_once');

  // status: enabled, sin código ni hash en la respuesta
  const status=await fetch(base+'/api/v2/pair/personal/status',{headers:ADMIN});
  assert.equal(status.status,200);
  const st=await status.json();
  assert.equal(st.enabled,true);
  assert.ok(st.createdAt&&st.rotatedAt===null);
  assert.ok(!JSON.stringify(st).includes(code));

  // status sin bootstrap → 403
  assert.equal((await fetch(base+'/api/v2/pair/personal/status')).status,403);

  // redeem con código personal → OK con roles por defecto si no se pidieron
  const k1=await keypair();
  const r1=await redeem(base,code,k1);
  assert.equal(r1.status,200);
  assert.deepEqual((await r1.json()).roles,['read','fisco:read']);

  // SEGUNDO dispositivo con el MISMO código → OK (reutilizable, no se consume)
  const k2=await keypair();
  const r2=await redeem(base,code,k2);
  assert.equal(r2.status,200);

  // código erróneo → mismo 403 que un temporal inválido
  const bad=await redeem(base,'F'.repeat(24),await keypair());
  assert.equal(bad.status,403);
  assert.equal((await bad.json()).error,'pair_code_invalid_or_expired');

  // persistencia: nuevo servidor sobre el mismo stateDir sigue aceptando el código
  await stop(server);server=null;
  const gate2=await createReadOnlyServer(options);
  const again=await start(gate2.app);
  server=again.server;base=again.base;
  const k3=await keypair();
  const r3=await redeem(base,code,k3);
  assert.equal(r3.status,200);

  // devices.json solo guarda el hash, nunca el código en claro
  const disk=JSON.parse(await readFile(path.join(dir,'devices.json'),'utf8'));
  assert.equal(disk.version,1);
  assert.equal(typeof disk.personal.hash,'string');
  assert.equal(disk.personal.hash.length,64);
  assert.ok(!JSON.stringify(disk).includes(code));
  assert.equal(Object.keys(disk.devices).length,3);

  // rotación: nuevo issue → código viejo 403, código nuevo OK
  const issue2=await POST(base,'/api/v2/pair/personal/issue',{},ADMIN);
  assert.equal(issue2.status,200);
  const {code:code2}=await issue2.json();
  assert.notEqual(code2,code);
  const oldTry=await redeem(base,code,await keypair());
  assert.equal(oldTry.status,403);
  const newTry=await redeem(base,code2,await keypair());
  assert.equal(newTry.status,200);
  // roles por defecto cuando no se envía body
  assert.deepEqual((await newTry.json()).roles,['read','fisco:read']);

  // status tras rotación
  const st2=await (await fetch(base+'/api/v2/pair/personal/status',{headers:ADMIN})).json();
  assert.equal(st2.enabled,true);
  assert.ok(st2.rotatedAt);
});

test('los códigos temporales de un solo uso siguen funcionando igual',async(t)=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexa-personal-temp-'));
  t.after(async()=>{await rm(dir,{recursive:true,force:true});});
  const gate=await createReadOnlyServer({upstream:'http://127.0.0.1:3020',stateDir:dir,
    bootstrapCode:bootstrap,allowedOrigins:'https://localhost',
    fetchImpl:async()=>new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})});
  const {server,base}=await start(gate.app);
  t.after(async()=>{await stop(server);});
  const issue=await POST(base,'/api/v2/pair/issue',{roles:['read']},ADMIN);
  assert.equal(issue.status,200);
  const {code}=await issue.json();
  const k=await keypair();
  const publicKey=await pubB64(k);
  const deviceId=crypto.randomUUID();
  const r1=await POST(base,'/api/v2/pair/redeem',{code,deviceId,publicKey,platform:'web'});
  assert.equal(r1.status,200);
  // un solo uso: segundo redeem con otro deviceId → 403
  const r2=await POST(base,'/api/v2/pair/redeem',{code,deviceId:crypto.randomUUID(),publicKey});
  assert.equal(r2.status,403);
  // 409 si el mismo deviceId ya está registrado
  const r3=await POST(base,'/api/v2/pair/redeem',{code:'X'.repeat(24),deviceId,publicKey});
  assert.equal(r3.status,403); // código inválido se evalúa antes que el 409
});
