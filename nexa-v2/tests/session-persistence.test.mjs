// NEXA — regresión: código de pareado solo primera vez; sesión renovable sin re-vincular.
// No requiere VPS, no realiza órdenes ni guarda secretos.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../web/js/app.js',import.meta.url),'utf8');
const ux=readFileSync(new URL('../web/js/premium.js',import.meta.url),'utf8');
const start=app.indexOf('async function ensureDeviceSession(force=false){');
const end=app.indexOf('async function afterUnlock(){',start);
assert.ok(start>0 && end>start,'Se requiere función de renovación antes del desbloqueo');
const implementations=app.slice(start,end);

function harness({online=true,linked=true,token=null,request,load=async()=>{}}={}){
 const state={unlocked:true,deviceEnrolled:linked,online,repairRequired:false};
 let current=token, calls=0,renders=0,loads=0;
 const session={
   get(){return current && current.expiresAt>Date.now()?current:null},
   set(s){current=s},
   clear(){current=null}
 };
 const obtainSession=async()=>{calls++;return request ? request() :
   {ok:true,token:'signed-session-'+calls,expiresAt:Date.now()+30*60*1000,roles:['read']};};
 const render=()=>{renders++};
 const loadData=async()=>{loads++;await load()};
 const fn=new Function('state','session','obtainSession','loadData','render',
   'let renewPromise=null;\n'+implementations+
   '\nreturn {ensureDeviceSession,refreshVisibleData};');
 const actions=fn(state,session,obtainSession,loadData,render);
 return {state,session,actions, get calls(){return calls},get renders(){return renders},
   get loads(){return loads}};
}
test('Primer desbloqueo registrado obtiene sesión sin solicitar código de pareado',async()=>{
 const h=harness();
 assert.equal(await h.actions.ensureDeviceSession(),true);
 assert.equal(h.calls,1);
 assert.deepEqual(h.session.get().roles,['read']);
 assert.equal(h.state.deviceEnrolled,true);
 assert.ok(!implementations.includes('redeemPairCode'));
 assert.ok(!implementations.includes('openPairOverlay'));
});
test('Sesión en vigor no renueva ni consume código innecesariamente',async()=>{
 const token={token:'active',expiresAt:Date.now()+15*60*1000,roles:['read']};
 const h=harness({token});
 assert.equal(await h.actions.ensureDeviceSession(),true);
 assert.equal(h.calls,0);
});
test('Sesión próxima a caducar se renueva antes de llegar a 30 minutos',async()=>{
 const token={token:'short',expiresAt:Date.now()+90_000,roles:['read']};
 const h=harness({token});
 assert.equal(await h.actions.ensureDeviceSession(),true);
 assert.equal(h.calls,1);
 assert.notEqual(h.session.get().token,'short');
});
test('Sesión caducada se regenera con identidad persistente, sin código temporal',async()=>{
 const h=harness({token:{token:'expired',expiresAt:Date.now()-1000,roles:['read']}});
 assert.equal(await h.actions.ensureDeviceSession(),true);
 assert.equal(h.calls,1);
 assert.equal(h.state.deviceEnrolled,true);
});
test('Caída de Internet no borra la vinculación; reintento posterior funciona',async()=>{
 const h=harness({request:()=>{throw new Error('network unavailable')}});
 assert.equal(await h.actions.ensureDeviceSession(),false);
 assert.equal(h.state.deviceEnrolled,true);
 assert.equal(h.state.repairRequired,false);
 assert.equal(h.session.get(),null);
 assert.equal(h.calls,1);
 const h2=harness({online:false,request:()=>({ok:true,token:'new',expiresAt:Date.now()+30*60*1000,roles:['read']})});
 assert.equal(await h2.actions.ensureDeviceSession(),false);
 assert.equal(h2.calls,0);
 h2.state.online=true;
 assert.equal(await h2.actions.ensureDeviceSession(),true);
 assert.equal(h2.calls,1);
});
test('Una revocación explícita exige volver a vincular; simple desconexión no',async()=>{
 const h=harness({request:()=>({ok:false,status:403,error:'device_unknown_or_revoked'})});
 assert.equal(await h.actions.ensureDeviceSession(),false);
 assert.equal(h.state.repairRequired,true);
 const h2=harness({request:()=>({ok:false,status:502,error:'upstream_unreachable'})});
 assert.equal(await h2.actions.ensureDeviceSession(),false);
 assert.equal(h2.state.repairRequired,false);
});
test('Renovaciones concurrentes hacen un único challenge firmado',async()=>{
 const h=harness({request:async()=>{
   await Promise.resolve();
   return {ok:true,token:'onlyone',expiresAt:Date.now()+30*60*1000,roles:['read']};
 }});
 const results=await Promise.all(Array.from({length:5},()=>h.actions.ensureDeviceSession()));
 assert.deepEqual(results,[true,true,true,true,true]);
 assert.equal(h.calls,1);
});
test('La pantalla conserva identidad, ofrece Reintentar y no pide un nuevo código',()=>{
 assert.ok(app.includes('Conexión pendiente'));
 assert.ok(app.includes('Reintentar conexión ↻'));
 assert.ok(app.includes('await refreshVisibleData(true)'));
 assert.ok(app.includes('state.deviceEnrolled=await device.isEnrolled()'));
 assert.ok(app.includes("state.refreshTimer=setInterval"));
 assert.ok(app.includes('visibilitychange'));
 assert.ok(ux.includes('Este dispositivo sigue vinculado'));
 assert.ok(ux.includes("ctx.deviceEnrolled?'refresh':'pair-device'"));
});
