// NEXA V2 — auth rev8: sesión por challenge firmado (vía pairing.js), PIN local
// 6 dígitos con protección de intentos, y biometría nativa real cuando existe.
// Ningún usuario/contraseña. El desbloqueo local solo habilita el uso de la
// credencial del dispositivo; el servidor decide permisos.
import { CONFIG } from './config.js';

const enc = new TextEncoder();
export async function pbkdf2(text, saltHex){
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(text), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt, iterations:120000}, key, 256);
  return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) };
}
function hexToBytes(h){ return new Uint8Array(h.match(/../g).map(b=>parseInt(b,16))); }
function bytesToHex(b){ return [...b].map(x=>x.toString(16).padStart(2,'0')).join(''); }

// ---------- Sesión de servidor ----------
export const session = {
  get(){
    try{
      const s = JSON.parse(sessionStorage.getItem(CONFIG.sessionKey)||'null');
      if(!s || !s.token || Date.now()>=s.expiresAt) return null;
      return s;
    }catch{ return null; }
  },
  set(s){ sessionStorage.setItem(CONFIG.sessionKey, JSON.stringify(s)); },
  clear(){ sessionStorage.removeItem(CONFIG.sessionKey); },
  hasPerm(perm){
    const s = this.get(); if(!s) return false;
    const r = s.roles||[];
    return r.includes('admin') || r.includes(perm) || r.includes('*');
  },
};

export async function apiFetch(path, {method='GET', body, headers={}} = {}){
  const s = session.get();
  const res = await fetch(CONFIG.apiBase + path, {
    method,
    headers: {
      'Accept':'application/json',
      ...(body!==undefined ? {'Content-Type':'application/json'} : {}),
      ...(s ? {'Authorization':`Bearer ${s.token}`} : {}),
      ...headers,
    },
    body: body!==undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try{ data = await res.json(); }catch{ /* cuerpo no JSON */ }
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}
export function logout(){ apiFetch('/v2/auth/logout',{method:'POST'}).catch(()=>{}); session.clear(); }

// ---------- Desbloqueo local: PIN 6 dígitos + intentos + biometría nativa ----------
const LOCK_KEY='nexa.localunlock', ATTEMPTS_KEY='nexa.pinAttempts';
export const localLock = {
  isSet(){ return !!localStorage.getItem(LOCK_KEY); },
  attempts(){ try{ return JSON.parse(localStorage.getItem(ATTEMPTS_KEY)||'{}'); }catch{ return {}; } },
  lockedUntil(){ return this.attempts().lockUntil||0; },
  registerFail(){
    const a=this.attempts(); a.fails=(a.fails||0)+1;
    if(a.fails>=5){ a.lockUntil=Date.now()+30000*(a.fails-4); } // backoff incremental
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a));
    return a.lockUntil>Date.now() ? a.lockUntil-Date.now() : 0;
  },
  registerOk(){ localStorage.removeItem(ATTEMPTS_KEY); },
  async setup(pin){
    if(!/^\d{4,8}$/.test(pin)) return false;
    const {salt,hash} = await pbkdf2(pin);
    localStorage.setItem(LOCK_KEY, JSON.stringify({salt,hash}));
    return true;
  },
  async verify(pin){
    const rec = JSON.parse(localStorage.getItem(LOCK_KEY)||'null');
    if(!rec) return true;
    const {hash} = await pbkdf2(pin, rec.salt);
    return hash === rec.hash;
  },
};

// ---------- Biometría nativa real ----------
// Android nativo: plugin @aparajita/capacitor-biometric-auth (BiometricPrompt).
// Web: WebAuthn platform authenticator si existe. Nada de prompts HTML falsos.
export const biometric = {
  plugin(){
    return window.Capacitor?.Plugins?.BiometricAuth || null;
  },
  async available(){
    const p = this.plugin();
    if(p){ try{ const r = await p.checkBiometry(); return { ok:!!r.isAvailable, type:r.biometryType||'native' }; }
           catch{ return { ok:false }; } }
    if(window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable){
      try{ return { ok: await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(), type:'platform' }; }
      catch{ /* noop */ }
    }
    return { ok:false };
  },
  // true solo si el sistema confirmó al usuario (o no hay sensor → devuelve 'unsupported').
  async prompt(reason='Desbloquear NEXA'){
    const p = this.plugin();
    if(p){
      try{ await p.authenticate({ reason, cancelTitle:'Usar PIN',
             allowDeviceCredential:false, androidBiometryStrength:2 /*STRONG*/ });
        return 'ok'; }
      catch(e){ return e?.code===16||/cancel/i.test(String(e)) ? 'cancelled' : 'failed'; }
    }
    return 'unsupported';
  },
};
