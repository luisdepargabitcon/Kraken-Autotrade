// NEXA — Gateway de PRIMERA CONEXIÓN, exclusivamente LECTURA.
// Intencionadamente separado de v2-proxy.mjs y acciones de trading.
// Ningún método de escritura alcanza el backend. VPS: ejecutar solo tras auditoría/QA.
import express from 'express';
import crypto from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const READ_ROUTES = [
  /^\/api\/health$/,
  /^\/api\/institutional-dca\/(?:controls|config|config\/effective|asset-configs|summary|cycles|cycles\/active|orders|events|performance|exchange-fee-presets|simulation\/wallet|price-context|market-data-health)$/,
  /^\/api\/institutional-dca\/cycles\/[0-9]+$/,
  /^\/api\/institutional-dca\/asset-configs\/[A-Z0-9._%-]+$/,
  /^\/api\/institutional-dca\/(?:price-context|market-data-health)\/[A-Z0-9._%-]+$/,
  /^\/api\/grid-isolated\/(?:status|config|levels|cycles|events|pump-dump-state|unlock-status|monitor\/audit|reconciliation)$/,
  /^\/api\/ama\/(?:status|market-view|mandate|policy\/active|tranche-plan\/current|cycles|portfolio|readiness|scheduler\/state|events|ledger)$/,
  /^\/api\/ama\/cycles\/[0-9]+$/,
  /^\/api\/open-positions$/,
  /^\/api\/positions\/smart-exit-diagnostics$/,
  /^\/api\/portfolio\/(?:summary|holdings|ledger|reservations|inventory|budgets|health|snapshots)$/,
  /^\/api\/balances\/all$/,
  /^\/api\/prices\/portfolio$/,
  /^\/api\/market\/[A-Z0-9._%-]+$/,
  /^\/api\/notifications$/,
  /^\/api\/fisco\/(?:summary|meta|lots|disposals|operations|annual-report|finalization-status|control-status)$/
];
const FISCO = /^\/api\/fisco\//;
const MAX_REQUEST_BYTES = 16384;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEVICE_TTL = 60 * 1000;
const SESSION_TTL = 30 * 60 * 1000;
const PAIR_TTL = 10 * 60 * 1000;
const LIMIT = 40;

function isReadPath(v){
  if(typeof v!=='string' || v.length>400 || v.includes('\\') || /%2f|%5c|%00/i.test(v)) {
    // Market pair uses encoded "/" as a SINGLE segment; only that case is accepted.
    if(!/^\/api\/market\/[A-Z0-9._-]+%2F[A-Z0-9._-]+$/i.test(v||''))return false;
  }
  if(v.includes('..') || v.includes('//') || /%2e/i.test(v))return false;
  return READ_ROUTES.some(r=>r.test(v));
}
function secureEqual(a,b){
  const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));
  return aa.length===bb.length && aa.length>0 && crypto.timingSafeEqual(aa,bb);
}
function getToken(req){
  const h=req.get('Authorization')||'';
  return /^Bearer [A-Za-z0-9_-]{30,256}$/.test(h)?h.slice(7):null;
}
function isUuid(s){return typeof s==='string' && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(s);}
function rateLimited(map,key,now,limit=LIMIT,period=60000){
  const item=map.get(key);
  const cur=!item||now-item.since>period?{count:1,since:now}:{count:item.count+1,since:item.since};
  map.set(key,cur);
  if(map.size>15000){for(const [k,v]of map)if(now-v.since>period)map.delete(k);}
  return cur.count>limit;
}
function validateUpstream(s){
  const u=new URL(s);
  if(u.protocol!=='http:' || u.username || u.password || u.pathname!=='/' || u.search || u.hash ||
      !['127.0.0.1','[::1]','localhost'].includes(u.hostname)) {
    throw new Error('NXV2_UPSTREAM debe ser http://127.0.0.1:PUERTO, sin rutas ni credenciales');
  }
  return u.origin;
}
const ALLOWED_ROLES=new Set(['read','fisco:read']);
async function readState(filename){
  try{
    const st=await fs.stat(filename);
    if(process.platform!=='win32' && (st.mode & 0o077)!==0)throw new Error('El archivo de dispositivos debe ser privado (0600)');
    const j=JSON.parse(await fs.readFile(filename,'utf8'));
    return new Map(Object.entries(j.devices||{}));
  }catch(e){if(e.code==='ENOENT')return new Map();throw e;}
}
export async function createReadOnlyServer({
  upstream=process.env.NXV2_UPSTREAM,
  stateDir=process.env.NXV2_STATE_DIR,
  bootstrapCode=process.env.NXV2_BOOTSTRAP_CODE,
  allowedOrigins=process.env.NXV2_CORS_ORIGINS||'https://localhost',
  fetchImpl=globalThis.fetch
}={}){
  if(!upstream)throw new Error('NXV2_UPSTREAM obligatorio');
  const upstreamOrigin=validateUpstream(upstream);
  if(!stateDir || !path.isAbsolute(stateDir))throw new Error('NXV2_STATE_DIR absoluto y obligatorio');
  await fs.mkdir(stateDir,{recursive:true,mode:0o700});
  const dirStat=await fs.stat(stateDir);
  if(process.platform!=='win32' && (dirStat.mode&0o077)!==0)throw new Error('NXV2_STATE_DIR debe tener permisos 0700');
  const filename=path.join(stateDir,'devices.json');
  const devices=await readState(filename);
  const pairCodes=new Map(),sessions=new Map(),challenges=new Map(),attempts=new Map();
  let saves=Promise.resolve();
  function persist(){
    const content=JSON.stringify({version:1,devices:Object.fromEntries(devices)},null,2);
    saves=saves.then(async()=>{
      const tmp=filename+'.'+crypto.randomBytes(5).toString('hex')+'.tmp';
      try{await fs.writeFile(tmp,content,{mode:0o600,flag:'wx'});await fs.rename(tmp,filename);}
      finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
    });
    return saves;
  }
  const app=express();
  app.disable('x-powered-by');
  app.set('trust proxy',false);
  app.use((req,res,next)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
      'Cross-Origin-Resource-Policy':'same-site'});
    const origin=req.get('Origin');
    const allow=new Set(String(allowedOrigins).split(',').map(x=>x.trim()).filter(Boolean));
    if(origin){
      if(!allow.has(origin))return res.status(403).json({error:'origin_forbidden'});
      res.set('Access-Control-Allow-Origin',origin);
      res.set('Vary','Origin');
      res.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');
      res.set('Access-Control-Allow-Headers','Content-Type,Authorization,X-Bootstrap-Code');
      res.set('Access-Control-Max-Age','300');
    }
    if(req.method==='OPTIONS')return res.status(204).end();
    next();
  });
  app.use(express.json({limit:MAX_REQUEST_BYTES,strict:true}));
  function rate(req,res,next){
    const key=String(req.socket.remoteAddress||'unknown')+':'+req.path;
    if(rateLimited(attempts,key,Date.now(),20))return res.status(429).json({error:'too_many_requests'});
    next();
  }
  function auth(req,res,next){
    const tok=getToken(req),s=tok&&sessions.get(tok);
    if(!s || s.expiresAt<=Date.now() || devices.get(s.deviceId)?.revoked){
      if(tok)sessions.delete(tok);
      return res.status(401).json({error:'auth_required'});
    }
    req.nexaSession=s;
    next();
  }
  // Issue is deliberately protected by a high-entropy secret and MUST be blocked by public nginx.
  // Only the VPS local admin should request it over loopback (curl 127.0.0.1:3101).
  app.post('/api/v2/pair/issue',rate,(req,res)=>{
    if(!bootstrapCode || String(bootstrapCode).length<32 || !secureEqual(req.get('X-Bootstrap-Code'),bootstrapCode))
      return res.status(403).json({error:'forbidden'});
    const roles=req.body?.roles??['read'];
    if(!Array.isArray(roles)||!roles.length||roles.some(x=>!ALLOWED_ROLES.has(x)))
      return res.status(400).json({error:'only_read_roles_allowed'});
    const code=crypto.randomBytes(12).toString('hex').toUpperCase();
    pairCodes.set(code,{expiresAt:Date.now()+PAIR_TTL,roles,used:false});
    res.json({code,expiresIn:PAIR_TTL/1000});
  });
  app.post('/api/v2/pair/redeem',rate,async(req,res)=>{
    const {code,deviceId,publicKey,label,platform}=req.body||{};
    const rec=code&&pairCodes.get(String(code).toUpperCase());
    if(!rec||rec.used||rec.expiresAt<=Date.now())
      return res.status(403).json({error:'pair_code_invalid_or_expired'});
    if(!isUuid(deviceId)||typeof publicKey!=='string'||publicKey.length>512)
      return res.status(400).json({error:'invalid_device'});
    let key;
    try{
      key=crypto.createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'});
      if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')
        throw new Error('not P-256');
    }catch{return res.status(400).json({error:'invalid_public_key'});}
    if(devices.has(deviceId)&&!devices.get(deviceId).revoked)
      return res.status(409).json({error:'device_already_registered'});
    rec.used=true;pairCodes.delete(String(code).toUpperCase());
    devices.set(deviceId,{publicKeyB64:publicKey,roles:rec.roles,label:String(label||'').slice(0,80),
      platform:String(platform||'android').slice(0,20),revoked:false,createdAt:new Date().toISOString()});
    try{await persist();}catch(e){
      devices.delete(deviceId);return res.status(503).json({error:'persistence_failed'});
    }
    res.status(200).json({ok:true,roles:rec.roles});
  });
  app.post('/api/v2/session/challenge',rate,(req,res)=>{
    const id=req.body?.deviceId,dev=isUuid(id)&&devices.get(id);
    if(!dev||dev.revoked)return res.status(403).json({error:'device_unknown_or_revoked'});
    const nonce=crypto.randomBytes(32).toString('hex');
    challenges.set(nonce,{deviceId:id,expiresAt:Date.now()+DEVICE_TTL});
    res.json({nonce,expiresIn:DEVICE_TTL/1000});
  });
  app.post('/api/v2/session/redeem',rate,(req,res)=>{
    const {deviceId,nonce,signature}=req.body||{};
    const ch=challenges.get(nonce);challenges.delete(nonce);
    const dev=isUuid(deviceId)&&devices.get(deviceId);
    if(!ch||ch.deviceId!==deviceId||ch.expiresAt<=Date.now()||!dev||dev.revoked)
      return res.status(401).json({error:'challenge_invalid'});
    let valid=false;
    try{
      valid=crypto.verify('sha256',Buffer.from(String(nonce)),{
        key:crypto.createPublicKey({key:Buffer.from(dev.publicKeyB64,'base64'),format:'der',type:'spki'}),
        dsaEncoding:'ieee-p1363'},Buffer.from(String(signature||''),'base64'));
    }catch{}
    if(!valid)return res.status(401).json({error:'signature_invalid'});
    const token=crypto.randomBytes(32).toString('base64url');
    const expiresAt=Date.now()+SESSION_TTL;
    sessions.set(token,{deviceId,roles:dev.roles,expiresAt});
    res.json({token,expiresAt,roles:dev.roles,csrf:null});
  });
  app.get('/api/v2/auth/session',auth,(req,res)=>{
    res.json({user:'device:'+req.nexaSession.deviceId.slice(0,8),
      roles:req.nexaSession.roles,expiresAt:req.nexaSession.expiresAt});
  });
  app.post('/api/v2/auth/logout',auth,(req,res)=>{
    sessions.delete(getToken(req));
    res.json({ok:true});
  });
  // Explicitly block every write action to trading routes, regardless of any UI mistakes.
  app.all('/api/*',async(req,res)=>{
    if(req.method!=='GET')return res.status(405).json({error:'read_only',message:'No se permiten operaciones ni cambios de trading'});
    const token=getToken(req),session=token&&sessions.get(token);
    if(!session||session.expiresAt<=Date.now()||devices.get(session.deviceId)?.revoked)
      return res.status(401).json({error:'auth_required'});
    const relative=new URL(req.originalUrl,'http://localhost');
    const requested=relative.pathname;
    if(!isReadPath(requested))return res.status(403).json({error:'route_not_allowed'});
    if(FISCO.test(requested)&&!session.roles.includes('fisco:read'))
      return res.status(403).json({error:'fisco_read_permission_required'});
    if(relative.search.length>1024)return res.status(400).json({error:'query_too_long'});
    try{
      const remote=new URL(relative.pathname+relative.search,upstreamOrigin);
      const up=await fetchImpl(remote,{method:'GET',redirect:'manual',headers:{'Accept':'application/json'},
        signal:AbortSignal.timeout(9000)});
      if(up.status>=300 && up.status<400)return res.status(502).json({error:'upstream_redirect_blocked'});
      const typ=up.headers.get('content-type')||'';
      if(!/application\/json|text\/json/.test(typ)){
        return res.status(502).json({error:'non_json_upstream'});
      }
      if(Number(up.headers.get('content-length')||0)>MAX_RESPONSE_BYTES)
        return res.status(502).json({error:'payload_too_large'});
      const reader=up.body.getReader();let size=0;const chunks=[];
      while(true){
        const {done,value}=await reader.read();if(done)break;
        size+=value.length;
        if(size>MAX_RESPONSE_BYTES){await reader.cancel();return res.status(502).json({error:'payload_too_large'});}
        chunks.push(value);
      }
      res.status(up.status).type('application/json').send(Buffer.concat(chunks.map(x=>Buffer.from(x))));
    }catch{return res.status(502).json({error:'upstream_unreachable'});}
  });
  app.use((_req,res)=>res.status(404).json({error:'not_found'}));
  return {app,devices,readRoutes:READ_ROUTES,persist};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+path.resolve(process.argv[1])).href){
  try{
    const {app}=await createReadOnlyServer();
    const port=Number(process.env.NXV2_PORT||3101);
    if(!(port>0 && port<65536))throw new Error('Invalid NXV2_PORT');
    app.listen(port,'127.0.0.1',()=>console.log('NEXA read-only BFF on 127.0.0.1:'+port));
  }catch(e){console.error('NEXA read-only BFF startup blocked: '+e.message);process.exitCode=1;}
}
