// NEXA V2 — capa de datos. DOS proveedores:
//  - demo: fixtures locales etiquetados DEMO (por defecto en la APK).
//  - live: SOLO GET de lectura contra una API configurable; nunca POST.
// Ambos devuelven read-models con provenance {source, ts, state}.
import { provenance } from './util.js';
import {
  DEMO_MARKET, DEMO_IDCA, DEMO_SPOT, DEMO_GRID, DEMO_AMA,
  DEMO_PORTFOLIO, DEMO_FISCO, DEMO_ACTIVITY, DEMO_SETTINGS, DEMO_META,
} from './fixtures.js';

export const DATA_MODE = { DEMO:'demo', LIVE:'live' };

export function createDemoProvider(){
  const P = prov => ({ ok:true, state:'demo', ts:new Date().toISOString(), data:prov });
  return {
    mode: DATA_MODE.DEMO, label:'Datos DEMO (fixtures locales)',
    async market(){ return P({ tickers:DEMO_MARKET.tickers, candles:DEMO_MARKET.candles,
      indicators:DEMO_MARKET.indicators, sources:DEMO_MARKET.externalSources }); },
    async engine(id){
      const map={ idca:DEMO_IDCA, spot:DEMO_SPOT, grid:DEMO_GRID, ama:DEMO_AMA };
      return P(map[id] ?? null);
    },
    async portfolio(){ return P(DEMO_PORTFOLIO); },
    async fisco(){ return P(DEMO_FISCO); },
    async activity(){ return P(DEMO_ACTIVITY); },
    async settings(){ return P(DEMO_SETTINGS); },
    meta: DEMO_META,
  };
}

// Endpoints de lectura permitidos en modo live (lista blanca — solo GET).
// Mapean read-models del panel existente (no inventan endpoints nuevos).
const LIVE_ENDPOINTS = {
  'idca.status': '/api/institutional-dca/controls',
  'idca.summary': '/api/institutional-dca/summary',
  'idca.cycles': '/api/institutional-dca/cycles',
  'idca.config': '/api/institutional-dca/config',
  'idca.hybrid': '/api/idca/hybrid/status',
  'spot.status': '/api/trading/status',
  'spot.config': '/api/config/active',
  'grid.status': '/api/grid-isolated/status',
  'grid.cycles': '/api/grid-isolated/cycles',
  'grid.levels': '/api/grid-isolated/levels',
  'ama.status': '/api/ama/status',
  'ama.readiness': '/api/ama/readiness',
  'ama.portfolio': '/api/ama/portfolio',
  'ama.mandate': '/api/ama/mandate',
  'portfolio.summary': '/api/portfolio/summary',
  'portfolio.balances': '/api/balances/all',
  'activity.events': '/api/events',
};

export function createLiveProvider(baseUrl){
  const base = (baseUrl||'').replace(/\/+$/,'');
  async function get(path){
    if(!base) return { ok:false, state:'unavailable', error:'sin API configurada' };
    const t0 = Date.now();
    try{
      const res = await fetch(base+path, { method:'GET', headers:{ 'Accept':'application/json' }, credentials:'omit' });
      const latencyMs = Date.now()-t0;
      if(!res.ok) return { ok:false, state:'error', error:`HTTP ${res.status}`, latencyMs, ts:new Date().toISOString() };
      const data = await res.json();
      return { ok:true, state:'fresh', data, latencyMs, ts:new Date().toISOString(), source:base+path };
    }catch(e){
      return { ok:false, state:'offline', error:String(e&&e.message||e), latencyMs:Date.now()-t0, ts:new Date().toISOString() };
    }
  }
  return {
    mode: DATA_MODE.LIVE, label:`API lectura · ${base||'no configurada'}`,
    raw: get, endpoints: LIVE_ENDPOINTS,
    async market(){ return get(LIVE_ENDPOINTS['spot.status']); },
    async engine(id){
      const per = {
        idca: async()=>({ status:(await get(LIVE_ENDPOINTS['idca.status'])).data,
          summary:(await get(LIVE_ENDPOINTS['idca.summary'])).data,
          cycles:(await get(LIVE_ENDPOINTS['idca.cycles'])).data,
          config:(await get(LIVE_ENDPOINTS['idca.config'])).data,
          hybrid:(await get(LIVE_ENDPOINTS['idca.hybrid'])).data }),
        spot: async()=>({ status:(await get(LIVE_ENDPOINTS['spot.status'])).data,
          config:(await get(LIVE_ENDPOINTS['spot.config'])).data }),
        grid: async()=>({ status:(await get(LIVE_ENDPOINTS['grid.status'])).data,
          cycles:(await get(LIVE_ENDPOINTS['grid.cycles'])).data,
          levels:(await get(LIVE_ENDPOINTS['grid.levels'])).data }),
        ama: async()=>({ status:(await get(LIVE_ENDPOINTS['ama.status'])).data,
          readiness:(await get(LIVE_ENDPOINTS['ama.readiness'])).data,
          portfolio:(await get(LIVE_ENDPOINTS['ama.portfolio'])).data,
          mandate:(await get(LIVE_ENDPOINTS['ama.mandate'])).data }),
      };
      const fn = per[id];
      if(!fn) return { ok:false, state:'unavailable', error:'motor desconocido' };
      try{
        const data = await fn();
        const anyErr = Object.values(data).some(v=>v && v.ok===false);
        return { ok:!anyErr, state:anyErr?'partial':'fresh', data, ts:new Date().toISOString(), source:base };
      }catch(e){ return { ok:false, state:'error', error:String(e&&e.message||e) }; }
    },
    async portfolio(){
      const [s,b] = await Promise.all([get(LIVE_ENDPOINTS['portfolio.summary']), get(LIVE_ENDPOINTS['portfolio.balances'])]);
      return { ok:s.ok&&b.ok, state:(s.ok&&b.ok)?'fresh':'partial', data:{summary:s.data, balances:b.data}, ts:new Date().toISOString() };
    },
    async fisco(){ return { ok:false, state:'unavailable', error:'FISCO restringido — sin agregado público en V2' }; },
    async activity(){ return get(LIVE_ENDPOINTS['activity.events']); },
    async settings(){ return get(LIVE_ENDPOINTS['spot.config']); },
    meta:{ tag:'LIVE', note:'Lectura GET contra API configurada. Sin POST.', observedAt:new Date().toISOString() },
  };
}
