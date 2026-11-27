// NEXA V2 — proxy BFF: reenvía rutas auténticas del bot tras auth+permiso.
// Mapa permiso→prefijo. En despliegue real el proxy reenvía a BOT_UPSTREAM.
import { authRequired, requirePerm, csrfGuard, idempotent } from './v2-auth.mjs';
import express from 'express';

const UPSTREAM = process.env.BOT_UPSTREAM || 'http://127.0.0.1:3000';
// Prefijo de ruta del bot → permiso mínimo (mutación) / lectura
export const PERM_MAP = [
  ['/institutional-dca/', 'idca'],
  ['/grid-isolated/',      'grid'],
  ['/ama/',                'ama'],
  ['/positions/',          'spot'],
  ['/open-positions',      'spot:read'],
  ['/portfolio/',          'portfolio'],
  ['/fisco/',              'fisco'],
  ['/market/',             'read'],
  ['/balances',            'read'],
  ['/prices/',             'read'],
  ['/notifications',       'read'],
];
export function permFor(path, method){
  for(const [pfx,perm] of PERM_MAP){
    if(path.startsWith(pfx)){
      if(perm.endsWith(':read')) return perm;
      return method==='GET' ? perm+':read' : perm+':control';
    }
  }
  return null; // DENY-by-default: rutas no listadas requieren entrada explícita en PERM_MAP
}

export function v2ProxyRouter(){
  const r = express.Router();
  r.use(authRequired, csrfGuard);
  r.use(async (req,res)=>{
    const perm = permFor(req.path, req.method);
    if(!perm) return res.status(403).json({error:'route_not_allowed', path:req.path});
    requirePerm(perm)(req,res,async()=>{
      try{
        const u = new URL(req.originalUrl.replace(/^\/v2/, ''), UPSTREAM);
        const headers = {'Accept':'application/json'};
        const init = {method:req.method, headers};
        if(!['GET','HEAD'].includes(req.method)){
          headers['Content-Type']='application/json';
          headers['X-Idempotency-Key']=req.headers['x-idempotency-key']||'';
          init.body = JSON.stringify(req.body||{});
        }
        const up = await fetch(u, init);
        const data = await up.text();
        res.status(up.status).type('application/json').send(data);
      }catch(e){ res.status(502).json({error:'upstream_unreachable'}); }
    });
  });
  return r;
}
