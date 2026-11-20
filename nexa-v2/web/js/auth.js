// NEXA V2 — autenticación de sesión contra el backend + desbloqueo local opcional.
// Reglas: la sesión la emite el servidor (token + caducidad + roles). El PIN local
// es una segunda capa de desbloqueo elegida por el usuario (hash PBKDF2, nunca
// texto plano ni PIN fijo). Ninguna credencial viaja en el bundle.
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

export async function login(user, pass){
  const r = await apiFetch('/v2/auth/login', {method:'POST', body:{user, pass}});
  if(!r.ok) return { ok:false, status:r.status, error:r.data?.error || 'auth_failed' };
  const d = r.data||{};
  if(!d.token || !d.expiresAt) return { ok:false, error:'invalid_response' };
  session.set({ token:d.token, expiresAt:d.expiresAt, user:d.user||user, roles:d.roles||[], csrf:d.csrf||null });
  return { ok:true };
}
export function logout(){ apiFetch('/v2/auth/logout',{method:'POST'}).catch(()=>{}); session.clear(); }

// ---------- Desbloqueo local (2ª capa, la elige el usuario) ----------
const LOCK_KEY = 'nexa.localunlock';
export const localLock = {
  isSet(){ return !!localStorage.getItem(LOCK_KEY); },
  async setup(pin){
    if(!/^\d{4,8}$/.test(pin)) return false;
    const {salt,hash} = await pbkdf2(pin);
    localStorage.setItem(LOCK_KEY, JSON.stringify({salt,hash}));
    return true;
  },
  async verify(pin){
    const rec = JSON.parse(localStorage.getItem(LOCK_KEY)||'null');
    if(!rec) return true; // sin PIN local configurado
    const {hash} = await pbkdf2(pin, rec.salt);
    return hash === rec.hash;
  },
};
