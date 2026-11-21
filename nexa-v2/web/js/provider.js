// NEXA V2 — proveedor de datos DEL PRODUCTO.
// Única fuente: API real del bot (rutas existentes) a través de apiFetch.
// Sin conexión/sesión devuelve estado honesto 'unavailable'/'error' — jamás
// inventa datos. Los fixtures SOLO se usan en tests (ver tests/*.mjs).
import { CONFIG } from './config.js';
import { apiFetch, session } from './auth.js';
import { ROUTES, normEngineStatus, normIdcaSummary, normIdcaCycle, normOrder,
         normGridCycle, normGridStatus, normAmaStatus, normAmaMandate,
         normPortfolioSummary, normMarket, normEvent,
         wrap, unwrap } from './adapters.js';
import { freshness } from './util.js';

function pathOf(route){
  // 'GET /institutional-dca/summary' -> '/institutional-dca/summary'
  return '/' + route.split(' ')[1].replace(/^\/+/,'');
}

async function get(route, {params} = {}){
  let p = pathOf(route);
  if(params) for(const [k,v] of Object.entries(params)) p = p.replace(':'+k, encodeURIComponent(v));
  const url = CONFIG.apiBase + p;
  const t0 = Date.now();
  try{
    const r = await fetch(url, {
      headers: { 'Accept':'application/json',
        ...(session.get()? {'Authorization':`Bearer ${session.get().token}`}:{}) },
    });
    let data=null; try{ data=await r.json(); }catch{}
    data = unwrap(data);
    if(r.status===401) return { data:null, state:'auth_required', status:r.status, latency:Date.now()-t0 };
    if(r.status===403) return { data:null, state:'forbidden', status:r.status, latency:Date.now()-t0 };
    if(!r.ok) return { data:null, state:'error', status:r.status, latency:Date.now()-t0 };
    return { data, state:'ok', status:r.status, latency:Date.now()-t0 };
  }catch(e){
    return { data:null, state:'unreachable', status:0, error:String(e?.message||e), latency:Date.now()-t0 };
  }
}

const st = s => s==='ok'?'ok':(s==='unreachable'?'unavailable':s);
const list = v => Array.isArray(v) ? v : (v?.items || v?.cycles || v?.orders || v?.rows || v?.data || []);

export function createApiProvider(){
  return {
    kind:'api',
    async idca(){
      const [summary, controls, cycles, orders, history, pairs] = await Promise.all([
        get(ROUTES.idca.summary), get(ROUTES.idca.controls),
        get(ROUTES.idca.cycles), get(ROUTES.idca.orders), get(ROUTES.idca.history),
        get(ROUTES.idca.pairs),
      ]);
      const worst = [summary,controls].find(r=>r.state!=='ok');
      const status = wrap(controls.data, normEngineStatus);
      if(status.data){
        // 'controls' no trae modo: el modo real del motor vive en summary.
        if(status.data.mode==null) status.data.mode = summary.data?.mode || summary.data?.schedulerMode || null;
        const cfgs = list(pairs.data);
        if(cfgs.length) status.data.assetPairs = cfgs.map(x=>({pair:x.pair, enabled:x.enabled}));
      }
      return {
        state: worst ? st(worst.state) : 'ok',
        status,
        summary: wrap(summary.data, normIdcaSummary),
        cycles: wrap(list(cycles.data).map(normIdcaCycle).filter(Boolean), x=>x, {ts:Date.now()}),
        orders: wrap(list(orders.data).map(normOrder).filter(Boolean), x=>x, {ts:Date.now()}),
        history: wrap(list(history.data).map(normIdcaCycle).filter(Boolean), x=>x, {ts:Date.now()}),
        latency: Math.max(summary.latency||0, controls.latency||0),
      };
    },
    async spot(){
      const pos = await get(ROUTES.spot.positions);
      const diag = await get(ROUTES.spot.diagnostics);
      return {
        state: pos.state==='ok'?'ok':st(pos.state),
        status: wrap(diag.data, x=>x, {ts:Date.now()}),
        positions: wrap(list(pos.data), x=>x, {ts:Date.now()}),
        diagnostics: diag.data ?? null,
        latency: pos.latency,
      };
    },
    async grid(){
      const [status, levels, cycles, events] = await Promise.all([
        get(ROUTES.grid.status), get(ROUTES.grid.levels),
        get(ROUTES.grid.cycles), get(ROUTES.grid.events),
      ]);
      return {
        state: status.state==='ok'?'ok':st(status.state),
        status: wrap(status.data, normGridStatus),
        levels: wrap(list(levels.data), x=>x, {ts:Date.now()}),
        cycles: wrap(list(cycles.data).map(normGridCycle).filter(Boolean), x=>x, {ts:Date.now()}),
        events: wrap(list(events.data).map(normEvent).filter(Boolean), x=>x, {ts:Date.now()}),
        latency: status.latency,
      };
    },
    async ama(){
      const [status, mandate, tranches, cycles, readiness, portfolio] = await Promise.all([
        get(ROUTES.ama.status), get(ROUTES.ama.mandate),
        get(ROUTES.ama.tranches), get(ROUTES.ama.cycles),
        get(ROUTES.ama.readiness), get(ROUTES.ama.portfolio),
      ]);
      return {
        state: status.state==='ok'?'ok':st(status.state),
        status: wrap(status.data, normAmaStatus),
        mandate: wrap(mandate.data, normAmaMandate, {ts:Date.now()}),
        tranches: wrap(list(tranches.data), x=>x, {ts:Date.now()}),
        cycles: wrap(list(cycles.data), x=>x, {ts:Date.now()}),
        readiness: wrap(readiness.data, x=>x, {ts:Date.now()}),
        portfolio: wrap(portfolio.data, x=>x, {ts:Date.now()}),
        latency: status.latency,
      };
    },
    async market(pair='BTC/USD'){
      const r = await get(ROUTES.common.market, {params:{pair}});
      return { state: st(r.state), market: wrap(r.data, normMarket), latency: r.latency };
    },
    async portfolio(){
      const [summary, holdings] = await Promise.all([
        get(ROUTES.common.portfolio), get(ROUTES.common.holdings),
      ]);
      return {
        state: summary.state==='ok'?'ok':st(summary.state),
        summary: wrap(summary.data, normPortfolioSummary, {ts:Date.now()}),
        holdings: wrap(list(holdings.data), x=>x, {ts:Date.now()}),
        latency: summary.latency,
      };
    },
    async activity(){
      const r = await get(ROUTES.common.notifications);
      return { state: st(r.state), events: wrap(list(r.data).map(normEvent).filter(Boolean), x=>x, {ts:Date.now()}) };
    },
    async fisco(){
      const roles=session.get()?.roles||[];
      if(!roles.includes('fisco:read'))return {state:'forbidden',data:null,
        note:'Este dispositivo no tiene el permiso fiscal independiente.'};
      const r=await get(ROUTES.common.fisco);
      return {state:st(r.state),data:r.data?{summary:r.data}:null,
        note:r.state!=='ok'?'Resumen fiscal no disponible en la API.':undefined};
    },
  };
}

// Utilidad de tests: crea un provider a partir de respuestas mock.
export function createMockProvider(responses){
  const call = k => async () => ({ state:'ok', ...responses[k] });
  const p = {};
  for(const k of Object.keys(responses)) p[k]=call(k);
  p.kind='mock';
  return p;
}
