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
const pairCodes = new Map();  // code -> {roles, expiresAt, usedBy}
const devices = new Map();    // deviceId -> {publicKeyB64, roles, label, platform, revoked}
const challenges = new Map(); // nonce -> {deviceId, expiresAt}
export const _internal = { sessions, idempotency, auditLog, USERS, pairCodes, devices, challenges };

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
  // --- Vinculación de dispositivo (passwordless) ---
  // Emite código de un solo uso. Requiere sesión admin O bootstrap env NXV2_BOOTSTRAP_CODE.
  r.post('/pair/issue', (req,res)=>{
    const boot = req.headers['x-bootstrap-code'];
    const isAdmin = req.sess?.roles?.includes('admin');
    if(!isAdmin && (!process.env.NXV2_BOOTSTRAP_CODE || boot!==process.env.NXV2_BOOTSTRAP_CODE))
      return res.status(403).json({error:'forbidden'});
    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    pairCodes.set(code,{roles:req.body?.roles||['read'],expiresAt:Date.now()+10*60*1000,usedBy:null});
    audit('pair_issue',req.sess?.user||'bootstrap','POST','/pair/issue',200,null);
    res.json({code, expiresIn:600});
  });
  // El dispositivo canjea el código y registra su clave pública.
  r.post('/pair/redeem', (req,res)=>{
    const {code,deviceId,publicKey,platform,label} = req.body||{};
    const rec = code && pairCodes.get(String(code).toUpperCase());
    if(!rec || rec.usedBy || Date.now()>=rec.expiresAt)
      return res.status(403).json({error:'invalid_or_expired_code'});
    if(!deviceId || !publicKey) return res.status(400).json({error:'device_and_key_required'});
    try{ crypto.createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'}); }
    catch{ return res.status(400).json({error:'invalid_public_key'}); }
    rec.usedBy = deviceId;
    devices.set(deviceId,{publicKeyB64:publicKey,roles:rec.roles,label:label||'',platform:platform||'web',revoked:false});
    audit('pair_redeem',deviceId,'POST','/pair/redeem',200,null);
    res.json({ok:true, roles:rec.roles});
  });
  // Desafío firmado → sesión. La clave privada nunca sale del dispositivo.
  r.post('/session/challenge', (req,res)=>{
    const {deviceId} = req.body||{};
    const dev = deviceId && devices.get(deviceId);
    if(!dev || dev.revoked) return res.status(403).json({error:'device_unknown_or_revoked'});
    const nonce = crypto.randomBytes(32).toString('hex');
    challenges.set(nonce,{deviceId,expiresAt:Date.now()+60*1000});
    res.json({nonce, expiresIn:60});
  });
  r.post('/session/redeem', (req,res)=>{
    const {deviceId,nonce,signature} = req.body||{};
    const ch = nonce && challenges.get(nonce);
    const dev = deviceId && devices.get(deviceId);
    challenges.delete(nonce);
    if(!ch || ch.deviceId!==deviceId || Date.now()>=ch.expiresAt || !dev || dev.revoked)
      return res.status(401).json({error:'challenge_invalid'});
    let ok=false;
    try{ ok = crypto.verify('SHA256', Buffer.from(String(nonce)),
        {key:crypto.createPublicKey({key:Buffer.from(dev.publicKeyB64,'base64'),format:'der',type:'spki'}),dsaEncoding:'ieee-p1363'},
        Buffer.from(String(signature||''),'base64')); }
    catch{ ok=false; }
    if(!ok) return res.status(401).json({error:'signature_invalid'});
    const token = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now()+SESSION_TTL_MS;
    sessions.set(token,{user:'device:'+deviceId.slice(0,8),deviceId,roles:dev.roles,expiresAt,csrf});
    audit('session_redeem',deviceId,'POST','/session/redeem',200,null);
    res.json({token,expiresAt,roles:dev.roles,csrf});
  });
  r.get('/devices', authRequired, requirePerm('admin'), (req,res)=>{
    res.json([...devices.entries()].map(([id,d])=>({id,label:d.label,platform:d.platform,roles:d.roles,revoked:d.revoked})));
  });
  r.post('/devices/:id/revoke', authRequired, requirePerm('admin'), (req,res)=>{
    const d = devices.get(req.params.id);
    if(!d) return res.status(404).json({error:'not_found'});
    d.revoked = true;
    for(const [t,s] of sessions) if(s.deviceId===req.params.id) sessions.delete(t);
    audit('device_revoke',req.sess.user,'POST','/devices/revoke',200,req.params.id);
    res.json({ok:true});
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
