// NEXA V2 — BFF de referencia (aislado, sin tocar el backend operativo).
// Express middleware: sesiones Bearer + roles + caducidad + idempotencia +
// auditoría de acciones. Desplegar junto al bot tras autorización (ver
// docs/transformacion-nexa-v2/seguimiento/DESPLIEGUE.md).
// Nunca contiene credenciales de exchange; los usuarios se provisionan por env.
import crypto from 'node:crypto';
import express from 'express';

const SESSION_TTL_MS = Number(process.env.NXV2_SESSION_TTL || 8*60*60*1000); // 8h
// Usuarios provisionados vía env NXV2_USERS='{"user":{"pass":"...","roles":["admin","idca:control"]}}'
const USERS = JSON.parse(process.env.NXV2_USERS || '{}');

const sessions = new Map();   // token -> {user, roles, expiresAt, csrf}
const idempotency = new Map();// key -> {status, body, ts}
const auditLog = [];          // {ts,user,action,method,path,status,idem}
export const _internal = { sessions, idempotency, auditLog, USERS };

function sha(s){ return crypto.createHash('sha256').update(s).digest('hex'); }

export function v2AuthRouter(){
  const r = express.Router();
  r.use(express.json({limit:'64kb'}));

  r.post('/auth/login', (req,res)=>{
    const {user,pass} = req.body||{};
    const rec = USERS[user];
    if(!rec || sha(String(pass||''))!==sha(rec.pass) && String(pass)!==rec.pass)
      return res.status(401).json({error:'invalid_credentials'});
    const token = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now()+SESSION_TTL_MS;
    sessions.set(token,{user,roles:rec.roles||[],expiresAt,csrf});
    audit('login',user,'POST','/auth/login',200,null);
    res.json({token,expiresAt,user,roles:rec.roles||[],csrf});
  });
  r.post('/auth/logout', authRequired, (req,res)=>{
    sessions.delete(req.sess.token);
    audit('logout',req.sess.user,'POST','/auth/logout',200,null);
    res.json({ok:true});
  });
  r.get('/auth/session', authRequired, (req,res)=>{
    res.json({user:req.sess.user,roles:req.sess.roles,expiresAt:req.sess.expiresAt});
  });
  return r;
}

export function authRequired(req,res,next){
  const h = req.headers.authorization||'';
  const token = h.startsWith('Bearer ')?h.slice(7):null;
  const s = token && sessions.get(token);
  if(!s || Date.now()>=s.expiresAt){ if(s) sessions.delete(token);
    return res.status(401).json({error:'auth_required'}); }
  req.sess = {token,...s}; next();
}

// requirePerm('idca:control') — GET de lectura permite 'read' o rol admin.
export function requirePerm(perm){
  return (req,res,next)=>{
    const r = req.sess?.roles||[];
    const ok = r.includes('admin')||r.includes('*')||r.includes(perm)
      ||(req.method==='GET'&&(r.includes('read')||r.includes(perm.replace(':control',':read'))));
    if(!ok){ audit('forbidden',req.sess?.user,req.method,req.path,403,perm);
      return res.status(403).json({error:'forbidden',perm}); }
    next();
  };
}

// Idempotencia: misma X-Idempotency-Key devuelve la respuesta ya registrada.
export function idempotent(handler){
  return async (req,res)=>{
    const key = req.headers['x-idempotency-key'];
    if(!key) return res.status(400).json({error:'idempotency_key_required'});
    if(idempotency.has(key)){ const c = idempotency.get(key);
      return res.status(c.status).set('X-Idempotent-Replay','1').json(c.body); }
    const out = await handler(req);
    idempotency.set(key,{status:out.status||200,body:out.body,ts:Date.now()});
    audit('action',req.sess?.user,req.method,req.path,out.status||200,key);
    res.status(out.status||200).json(out.body);
  };
}

function audit(kind,user,method,path,status,idem){
  auditLog.push({ts:new Date().toISOString(),kind,user,method,path,status,idem});
  if(auditLog.length>10000) auditLog.shift();
}

// CSRF: mutaciones exigen X-CSRF-Token coincidente con la sesión (defensa en profundidad).
export function csrfGuard(req,res,next){
  if(['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  if(req.headers['x-csrf-token']!==req.sess?.csrf)
    return res.status(403).json({error:'csrf'});
  next();
}
