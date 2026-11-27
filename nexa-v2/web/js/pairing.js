// NEXA V2 — identidad de dispositivo + vinculación + sesión por desafío firmado.
// Sin usuario/contraseña: el dispositivo genera una clave ECDSA P-256 no
// exportable (IndexedDB), el backend la registra vía código de vinculación y
// luego emite sesiones tras un challenge firmado. El PIN/biometría local solo
// autoriza el uso de la clave en este dispositivo.
import { CONFIG } from './config.js';
import { apiFetch } from './auth.js';

const DB='nexa-device', STORE='keys';
function db(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB,1);
  r.onupgradeneeded=()=>r.result.createObjectStore(STORE);
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function idbGet(k){ const d=await db(); return new Promise(res=>{ const t=d.transaction(STORE).objectStore(STORE).get(k); t.onsuccess=()=>res(t.result); t.onerror=()=>res(null); }); }
async function idbSet(k,v){ const d=await db(); return new Promise(res=>{ const t=d.transaction(STORE,'readwrite').objectStore(STORE).put(v,k); t.onsuccess=()=>res(true); t.onerror=()=>res(false); }); }
async function idbDel(k){ const d=await db(); return new Promise(res=>{ d.transaction(STORE,'readwrite').objectStore(STORE).delete(k); res(true); }); }

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));

export const device = {
  get id(){
    let id = localStorage.getItem('nexa.deviceId');
    if(!id){ id = crypto.randomUUID(); localStorage.setItem('nexa.deviceId', id); }
    return id;
  },
  async isEnrolled(){ return !!(await idbGet('priv')); },
  async label(){ return localStorage.getItem('nexa.deviceLabel') || null; },
};

export async function enrollDevice(){
  const pair = await crypto.subtle.generateKey(
    {name:'ECDSA', namedCurve:'P-256'}, false, ['sign','verify']);
  const pubSpki = await crypto.subtle.exportKey('spki', pair.publicKey);
  await idbSet('priv', pair.privateKey);
  await idbSet('pub', pair.publicKey);
  return b64(pubSpki);
}

// Canjea el código de vinculación emitido por el administrador (personal
// reutilizable o temporal de un solo uso; el formato y el flujo son idénticos).
export async function redeemPairCode(code, label=''){
  // No perder una credencial anterior si el servidor rechaza el código o falla la red.
  const previousPriv=await idbGet('priv');
  const previousPub=await idbGet('pub');
  const restore=async()=>{
    if(previousPriv)await idbSet('priv',previousPriv); else await idbDel('priv');
    if(previousPub)await idbSet('pub',previousPub); else await idbDel('pub');
  };
  const publicKey=await enrollDevice();
  let r;
  try{
    r=await apiFetch('/v2/pair/redeem', {method:'POST', timeoutMs:12000, body:{
      code:String(code||'').trim(), deviceId:device.id, publicKey,
      platform:window.Capacitor?.isNativePlatform?.()?'android':'web',label,
    }});
  }catch(err){await restore();throw err;}
  if(!r.ok){
    await restore();
    return {ok:false,status:r.status,error:r.data?.error||'pair_failed'};
  }
  if(label)localStorage.setItem('nexa.deviceLabel',label);
  return {ok:true,roles:r.data?.roles||[]};
}

async function signChallenge(nonce){
  const priv = await idbGet('priv');
  if(!priv) return null;
  const sig = await crypto.subtle.sign(
    {name:'ECDSA', hash:{name:'SHA-256'}}, priv, new TextEncoder().encode(nonce));
  return b64(sig);
}

// Sesión real por challenge+firma — nada viaja en claro, la clave nunca sale.
export async function obtainSession(){
  const r1 = await apiFetch('/v2/session/challenge', {method:'POST', timeoutMs:12000, body:{deviceId:device.id}});
  if(!r1.ok) return { ok:false, status:r1.status, error:r1.data?.error||'challenge_failed' };
  const nonce = r1.data?.nonce;
  const sig = nonce ? await signChallenge(nonce) : null;
  if(!sig) return { ok:false, error:'key_missing' };
  const r2 = await apiFetch('/v2/session/redeem', {method:'POST', timeoutMs:12000, body:{
    deviceId: device.id, nonce, signature: sig }});
  if(!r2.ok) return { ok:false, status:r2.status, error:r2.data?.error||'redeem_failed' };
  return { ok:true, token:r2.data.token, expiresAt:r2.data.expiresAt,
           roles:r2.data.roles||[], csrf:r2.data.csrf||null, user:'device:'+device.id.slice(0,8) };
}

export async function unpair(){ await idbDel('priv'); await idbDel('pub');
  localStorage.removeItem('nexa.deviceLabel'); }
