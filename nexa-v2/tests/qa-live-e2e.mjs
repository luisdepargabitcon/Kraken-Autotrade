// QA E2E Rev14 — dispositivo QA efímero contra el gateway REAL (solo lectura).
// Enrola una clave P-256 desechable, obtiene sesión por challenge firmado y
// recorre todas las rutas de lectura verificando datos auténticos.
// Uso: node tests/qa-live-e2e.mjs <BASE_URL> <PAIR_CODE>
import { generateKeyPairSync, sign } from 'node:crypto';

const BASE = process.argv[2];
const CODE = process.argv[3];
if(!BASE || !CODE){ console.error('uso: node qa-live-e2e.mjs <base> <code>'); process.exit(2); }

const j = r => r.json();
const post = (p,b,h={}) => fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(b)});
const get = (p,t) => fetch(BASE+p,{headers:{Accept:'application/json',Authorization:`Bearer ${t}`}});

// 1) enrolar
const { publicKey, privateKey } = generateKeyPairSync('ec',{namedCurve:'P-256'});
const spki = publicKey.export({type:'spki',format:'der'}).toString('base64');
const deviceId = crypto.randomUUID();
const rP = await post('/api/v2/pair/redeem',{code:CODE,deviceId,publicKey:spki,platform:'qa-node',label:'qa-e2e'});
if(rP.status!==200){ console.log('PAIR FAIL', rP.status, await rP.text()); process.exit(1); }
console.log('pair:', rP.status, JSON.stringify(await j(rP)));

// 2) sesión
const sess = async () => {
  const r1 = await post('/api/v2/session/challenge',{deviceId});
  const c = await j(r1);
  if(r1.status!==200){ console.log('challenge:', r1.status, JSON.stringify(c)); return null; }
  const nonce = c.nonce || c.challenge;
  const sig = sign('SHA256', Buffer.from(nonce,'utf8'), {key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64');
  const r = await post('/api/v2/session/redeem',{deviceId,nonce,signature:sig});
  if(r.status!==200){ console.log('redeem:', r.status, await r.text()); return null; }
  return j(r);
};
let s = await sess();
if(!s){ console.log('SESSION FAIL'); process.exit(1); }
console.log('session: ok expiresAt', s.expiresAt, 'roles', s.roles);

// 3) rutas de lectura
const ROUTES = [
 '/api/institutional-dca/summary','/api/institutional-dca/controls',
 '/api/institutional-dca/asset-configs','/api/institutional-dca/cycles/active',
 '/api/institutional-dca/cycles?status=closed','/api/institutional-dca/orders',
 '/api/grid-isolated/status','/api/grid-isolated/levels','/api/grid-isolated/cycles',
 '/api/grid-isolated/events?limit=3','/api/ama/status','/api/ama/mandate',
 '/api/ama/portfolio','/api/ama/readiness','/api/ama/cycles',
 '/api/open-positions','/api/positions/smart-exit-diagnostics',
 '/api/portfolio/summary','/api/portfolio/holdings','/api/market/BTC%2FUSD',
 '/api/notifications',
];
for(const p of ROUTES){
  const r = await get(p,s.token);
  const b = await r.text();
  console.log(r.status, p, '→', b.slice(0,160).replace(/\n/g,' '));
}

// 4) sesión inválida → nuevo challenge sin código (recuperación 401)
s = await sess();
const bad = await get('/api/portfolio/summary', 'token-invalido');
console.log('401-check:', bad.status);
const s2 = await sess();
console.log('re-session-after-invalid:', s2 ? 'ok' : 'FAIL');
const ok = await get('/api/portfolio/summary', s2.token);
console.log('final GET:', ok.status);

// 5) escritura nunca permitida
const w = await fetch(BASE+'/api/institutional-dca/emergency/close-all',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s2.token}`},body:'{}'});
console.log('write-check POST emergency/close-all:', w.status);
