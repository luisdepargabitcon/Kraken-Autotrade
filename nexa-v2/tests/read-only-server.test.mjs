import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createReadOnlyServer} from '../bff/read-only-server.mjs';

const bootstrap='a'.repeat(64);
const keypair=()=>crypto.webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
const b64=v=>Buffer.from(v).toString('base64');
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
async function enroll(base,key,roles=['read']){
  const issue=await POST(base,'/api/v2/pair/issue',{roles},{'X-Bootstrap-Code':bootstrap});
  assert.equal(issue.status,200);
  const {code}=await issue.json();
  const publicKey=b64(await crypto.webcrypto.subtle.exportKey('spki',key.publicKey));
  const deviceId=crypto.randomUUID();
  const redeemed=await POST(base,'/api/v2/pair/redeem',{
    deviceId,publicKey,code,platform:'android',label:'Test Pixel 9'});
  assert.equal(redeemed.status,200);
  const replay=await POST(base,'/api/v2/pair/redeem',{deviceId,publicKey,code});
  assert.equal(replay.status,403);
  return {deviceId};
}
async function session(base,key,deviceId){
  const chall=await POST(base,'/api/v2/session/challenge',{deviceId});
  assert.equal(chall.status,200);
  const {nonce}=await chall.json();
  const signature=b64(await crypto.webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},
    key.privateKey,new TextEncoder().encode(nonce)));
  const redeem=await POST(base,'/api/v2/session/redeem',{deviceId,nonce,signature});
  assert.equal(redeem.status,200);
  const {token,roles}=await redeem.json();
  assert.ok(token.length>32);
  assert.deepEqual(roles,['read']);
  return {'Authorization':'Bearer '+token};
}
test('No commands ever reach the upstream, device proof persists, FISCO is isolated',async(t)=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexa-ro-'));
  t.after(async()=>{await rm(dir,{recursive:true,force:true});});
  const upstreamCalls=[];
  const fakeFetch=async(u,init)=>{
    upstreamCalls.push({url:u.href,method:init.method});
    return new Response(JSON.stringify({mode:'simulation',summary:{activeCyclesCount:1}}),{
      status:200,headers:{'Content-Type':'application/json'}});
  };
  const options={upstream:'http://127.0.0.1:3020',stateDir:dir,
    bootstrapCode:bootstrap,allowedOrigins:'https://localhost',fetchImpl:fakeFetch};
  const gate=await createReadOnlyServer(options);
  let {server,base}=await start(gate.app);
  t.after(async()=>{if(server.listening)await stop(server);});
  const noSession=await fetch(base+'/api/institutional-dca/summary');
  assert.equal(noSession.status,401);
  const badWrite=await POST(base,'/api/institutional-dca/emergency/close-all',{confirm:true});
  assert.equal(badWrite.status,405);
  const badBootstrap=await POST(base,'/api/v2/pair/issue',{roles:['read']},{'X-Bootstrap-Code':'weak'});
  assert.equal(badBootstrap.status,403);
  const badRoles=await POST(base,'/api/v2/pair/issue',{roles:['admin']},{'X-Bootstrap-Code':bootstrap});
  assert.equal(badRoles.status,400);
  const key=await keypair();
  const {deviceId}=await enroll(base,key);
  const headers=await session(base,key,deviceId);
  const result=await fetch(base+'/api/institutional-dca/summary',{headers});
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{mode:'simulation',summary:{activeCyclesCount:1}});
  const market=await fetch(base+'/api/market/BTC%2FUSD',{headers});
  assert.equal(market.status,200);
  assert.ok(upstreamCalls.at(-1).url.includes('/api/market/BTC%2FUSD'));
  const fisco=await fetch(base+'/api/fisco/summary',{headers});
  assert.equal(fisco.status,403);
  const forbiddenGet=await fetch(base+'/api/config/api',{headers});
  assert.equal(forbiddenGet.status,403);
  const forbiddenPost=await POST(base,'/api/positions/BTC_USD/close',{},headers);
  assert.equal(forbiddenPost.status,405);
  const originForbidden=await fetch(base+'/api/portfolio/summary',{headers:{...headers,Origin:'https://evil.invalid'}});
  assert.equal(originForbidden.status,403);
  const allowedCors=await fetch(base+'/api/portfolio/summary',{headers:{...headers,Origin:'https://localhost'}});
  assert.equal(allowedCors.status,200);
  assert.equal(allowedCors.headers.get('Access-Control-Allow-Origin'),'https://localhost');
  assert.ok(upstreamCalls.every(x=>x.method==='GET'));
  assert.equal(upstreamCalls.length,3);
  await stop(server);
  const restarted=await createReadOnlyServer(options);
  const again=await start(restarted.app);
  server=again.server;base=again.base;
  const afterRestart=await session(base,key,deviceId);
  const persisted=await fetch(base+'/api/grid-isolated/status',{headers:afterRestart});
  assert.equal(persisted.status,200);
  assert.equal(upstreamCalls.length,4);
});
test('URL and storage fail-closed',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexa-ro-reject-'));
  try{
    await assert.rejects(()=>createReadOnlyServer({upstream:'https://evil.example',stateDir:dir}),
      /NXV2_UPSTREAM/);
    await assert.rejects(()=>createReadOnlyServer({upstream:'http://169.254.0.1:80',stateDir:dir}),
      /NXV2_UPSTREAM/);
    await assert.rejects(()=>createReadOnlyServer({upstream:'http://127.0.0.1:3020',stateDir:'./data'}),
      /NXV2_STATE_DIR/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
