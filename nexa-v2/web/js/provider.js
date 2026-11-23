// NEXA V2 — proveedor de datos DEL PRODUCTO.
// Única fuente: API real del bot (rutas existentes) a través de apiFetch.
// Sin conexión/sesión devuelve estado honesto 'unavailable'/'error' — jamás
// inventa datos. Los fixtures SOLO se usan en tests (ver tests/*.mjs).
import { CONFIG } from './config.js';
import { apiFetch, session } from './auth.js';
import { ROUTES, normEngineStatus, normIdcaSummary, normIdcaCycle, normOrder, normSpotTrade,
         normGridCycle, normGridStatus, normAmaStatus, normAmaMandate,
         normPortfolioSummary, normMarket, normEvent, enrichMarket,
         wrap, unwrap } from './adapters.js';
import { computeIndicators } from './market-candles.js';
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


// La lectura de confluencia consulta velas en el backend por par: cacheada 3 min.
// Nunca ejecutar en bucle a 30 s ni usar esta consulta para enviar órdenes.
let entryCache=null,entryReadAt=0,entryFlight=null;
async function readEntryDiagnostics(){
 const now=Date.now();
 if(entryCache&&now-entryReadAt<180000)return entryCache;
 if(entryFlight)return entryFlight;
 entryFlight=get(ROUTES.idca.entryDiagnostics).then(r=>{
   entryCache=r;entryReadAt=Date.now();return r;
 }).finally(()=>{entryFlight=null;});
 return entryFlight;
}
function entryContexts(raw){
 const pairs=raw?.pairs;
 if(!pairs||typeof pairs!=='object'||Array.isArray(pairs))return null;
 return Object.fromEntries(Object.entries(pairs).map(([pair,x])=>{
   if(!x||typeof x!=='object')return [pair,{pair,unavailable:true}];
   const tb=x.trailingBuy||{};
   return [pair,{
    ...x,pair,regime:x.marketRegime??null,entryScore:num(x.confidenceScore),
    confidenceGrade:x.confidenceGrade??null,
    currentPrice:num(x.currentPrice),
    atrpPct:num(x.atrPct),
    // La API expresa caída positiva desde referencia y distancia requerida positiva.
    dipDetectedPct:num(x.drawdownFromReferencePct),
    requiredDipPct:num(x.requiredDistancePct),
    reference:x.referenceMethod??null,referencePrice:num(x.referencePrice),
    reboundSignal:tb.state??null,trailingBuy:tb,
    entryDecision:x.decisionClass??null,
    scoreBreakdown:x.familyScores||null,
    hardBlocked:x.hardBlocked===true,
    hardBlockers:Array.isArray(x.hardBlockers)?x.hardBlockers:[],
    generatedAt:raw.generatedAt??x.timestamp??null,
   }];
 }));
}
const st = s => s==='ok'?'ok':(s==='unreachable'?'unavailable':s);
const list = v => Array.isArray(v) ? v : (v?.items || v?.cycles || v?.orders || v?.trades || v?.rows || v?.data || []);

export function createApiProvider(){
  return {
    kind:'api',
    async idca(){
      const [summary, controls, cycles, orders, history, pairs, events, entry, simWallet, feePresets, importableStatus] = await Promise.all([
        get(ROUTES.idca.summary), get(ROUTES.idca.controls),
        get(ROUTES.idca.cycles), get(ROUTES.idca.orders), get(ROUTES.idca.history),
        get(ROUTES.idca.pairs), get(ROUTES.idca.events), readEntryDiagnostics(),get(ROUTES.idca.wallet),get(ROUTES.idca.feePresets),get(ROUTES.idca.importableStatus),
      ]);
      const worst = [summary,controls].find(r=>r.state!=='ok');
      const status = wrap(controls.data, normEngineStatus);
      if(status.data){
        // 'controls' no trae modo: el modo real del motor vive en summary.
        if(status.data.mode==null) status.data.mode = summary.data?.mode || summary.data?.schedulerMode || null;
        const cfgs = list(pairs.data);
        if(cfgs.length) status.data.assetPairs = cfgs.map(x=>({pair:x.pair, enabled:x.enabled}));
      }
      const resourceStates={
        summary:st(summary.state),controls:st(controls.state),
        cycles:st(cycles.state),orders:st(orders.state),
        history:st(history.state),pairs:st(pairs.state),entryDiagnostics:st(entry.state),simWallet:st(simWallet.state),feePresets:st(feePresets.state),importableStatus:st(importableStatus.state)
      };
      // Un GET secundario fallido es parcial, no «0 ciclos» ni histórico vacío.
      const partial=!worst && [cycles,orders,history,pairs].some(r=>r.state!=='ok');
      return {
        state: worst ? st(worst.state) : (partial?'partial':'ok'),
        resourceStates,
        status,
        summary: wrap(summary.data, normIdcaSummary),
        pairContexts: wrap(entry.state==='ok'?entryContexts(entry.data):null,x=>x,{ts:Date.now()}),
        simWallet:wrap(simWallet.state==='ok'?simWallet.data:null,x=>x,{ts:Date.now()}),
        feePresets:wrap(feePresets.state==='ok'?feePresets.data:null,x=>x,{ts:Date.now()}),
        importableStatus:wrap(importableStatus.state==='ok'?importableStatus.data:null,x=>x,{ts:Date.now()}),
        cycles: wrap(cycles.state==='ok'?list(cycles.data).map(normIdcaCycle).filter(Boolean):null, x=>x, {ts:Date.now()}),
        orders: wrap(orders.state==='ok'?list(orders.data).map(normOrder).filter(Boolean):null, x=>x, {ts:Date.now()}),
        history: wrap(history.state==='ok'?list(history.data).map(normIdcaCycle).filter(Boolean):null, x=>x, {ts:Date.now()}),
        events: wrap(events.state==='ok'?list(events.data).map(normEvent).filter(Boolean):null, x=>x, {ts:Date.now()}),
        latency: Math.max(summary.latency||0,controls.latency||0,cycles.latency||0,
          history.latency||0,orders.latency||0),
      };
    },
    async spotTradesPage(offset=0){
      // Historial paginado bajo el mismo token: cada página GET tiene 100 registros máx.
      const safe=Number.isSafeInteger(offset)&&offset>=0&&offset<=100000?offset:0;
      const r=await get('GET /trades/closed?limit=100&offset='+safe);
      return {
        state:st(r.state),
        trades:r.state==='ok'?list(r.data).map(normSpotTrade).filter(Boolean):null,
        total:r.state==='ok'&&Number.isInteger(r.data?.total)?r.data.total:null,
      };
    },
    async spot(){
      // El backend original ofrece historial GLOBAL en /trades/closed.
      // No atribuir toda esa actividad a SPOT sin un identificador de estrategia verificable.
      // La pasarela deny-by-default requiere autorizar explícitamente este GET:
      // si es 403, status del historial es forbidden, NO una lista vacía.
      const [pos,diag,trades] = await Promise.all([
        get(ROUTES.spot.positions), get(ROUTES.spot.diagnostics), get(ROUTES.spot.trades),
      ]);
      const tradeList=trades.state==='ok'?list(trades.data):null;
      return {
        state: pos.state==='ok'?(diag.state==='ok'&&trades.state==='ok'?'ok':'partial'):st(pos.state),
        resourceStates:{
          positions:st(pos.state), diagnostics:st(diag.state), trades:st(trades.state),
        },
        status: wrap(diag.state==='ok'?diag.data:null,x=>x,{ts:Date.now()}),
        positions: wrap(pos.state==='ok'?list(pos.data):null,x=>x,{ts:Date.now()}),
        trades: wrap(tradeList===null?null:tradeList.map(normSpotTrade).filter(Boolean),x=>x,{ts:Date.now()}),
        tradeTotal:trades.state==='ok'&&Number.isInteger(trades.data?.total)?trades.data.total:null,
        diagnostics: diag.data ?? null,
        latency: Math.max(pos.latency||0,diag.latency||0,trades.latency||0),
      };
    },
    async grid(){
      const [status, levels, cycles, events, config, audit] = await Promise.all([
        get(ROUTES.grid.status), get(ROUTES.grid.levels),
        get(ROUTES.grid.cycles), get(ROUTES.grid.events),
        get(ROUTES.grid.config), get(ROUTES.grid.monitor),
      ]);
      const a = audit.data || {};
      const cfg = config.data || {};
      return {
        state: status.state==='ok'?'ok':st(status.state),
        status: wrap(status.data, normGridStatus),
        levels: wrap({
          levels: list(levels.data),
          rangeVersionId: status.data?.activeRangeVersionId,
          rangeStatus: status.data?.activeRangeStatus,
          currentRange: a.range ? {low:a.range.low??a.range.lowerBound, high:a.range.high??a.range.upperBound, openedAt:a.range.openedAt??a.range.createdAt} : null,
          previousRanges: Array.isArray(a.rangeHistory) ? a.rangeHistory : [],
        }, x=>x, {ts:Date.now()}),
        cycles: wrap(list(cycles.data).map(normGridCycle).filter(Boolean), x=>x, {ts:Date.now()}),
        events: wrap(list(events.data).map(normEvent).filter(Boolean), x=>x, {ts:Date.now()}),
        config: wrap({...cfg, policy:cfg.executionPolicy??cfg.policy, makerTaker:cfg.executionPolicy??cfg.makerTaker}, x=>x, {ts:Date.now()}),
        monitor: wrap({
          ...a,
          capitalLockedUsd: a.wallet?.reservedUsd ?? null,
          capitalReleasedUsd: a.wallet?.freeUsd ?? null,
          walletTotalUsd: a.wallet?.totalUsd ?? null,
          events: list(a.events?.length?a.events:events.data).map(normEvent).filter(Boolean),
          alerts: list(a.decisions).map(normEvent).filter(Boolean),
        }, x=>x, {ts:Date.now()}),
        latency: status.latency,
      };
    },
    async ama(){
      const [status, mandate, tranches, cycles, readiness, portfolio, events, ledger] = await Promise.all([
        get(ROUTES.ama.status), get(ROUTES.ama.mandate),
        get(ROUTES.ama.tranches), get(ROUTES.ama.cycles),
        get(ROUTES.ama.readiness), get(ROUTES.ama.portfolio),
        get(ROUTES.ama.events), get(ROUTES.ama.ledger),
      ]);
      return {
        state: status.state==='ok'?'ok':st(status.state),
        status: wrap(status.data, normAmaStatus),
        mandate: wrap(mandate.data, normAmaMandate, {ts:Date.now()}),
        tranches: wrap(list(tranches.data), x=>x, {ts:Date.now()}),
        cycles: wrap(list(cycles.data), x=>x, {ts:Date.now()}),
        readiness: wrap(readiness.data, x=>x, {ts:Date.now()}),
        portfolio: wrap(portfolio.data, x=>x, {ts:Date.now()}),
        trace: wrap({
          orders: [],
          tranches: list(tranches.data),
          ledger: list(ledger.data),
          decisions: list(events.data).map(normEvent).filter(Boolean).map(e=>({...e, text:e.msg||e.type||'Evento AMA'})),
        }, x=>x, {ts:Date.now()}),
        latency: status.latency,
      };
    },
    async market(pair='BTC/USD',timeframe='15'){
      // Una fuente de mercado: MarketDataService del bot, mediante el gateway autenticado.
      // Contexto de decisión IDCA y libro de ejecución AMA siguen identificados.
      const [r,mv,entry] = await Promise.all([
        get(ROUTES.common.market+'?candles=1&timeframe='+encodeURIComponent(timeframe),{params:{pair}}),
        get(ROUTES.ama.marketView),
        readEntryDiagnostics()]);
      const ctxs=entry.state==='ok'?entryContexts(entry.data):null;
      const sources=[
        {name:'API /market/'+pair,state:st(r.state)},
        {name:'AMA market-view',state:st(mv.state)},
        {name:'IDCA entry-diagnostics',state:st(entry.state)},
        {name:'Market Data del bot · '+timeframe+'m',state:st(r.state)}];
      const market=wrap(r.data,raw=>{
        const m=enrichMarket(normMarket(raw),{marketView:mv.data,entryCtx:ctxs?.[pair],sources});
        m.candlesSource=m.candlesSource||'bot-market-data';
        if(Array.isArray(m.candles)&&m.candles.length>1){
          const ind=computeIndicators(m.candles);
          if(ind)m.indicators={...(m.indicators||{}),...ind};
        }else{m.candlesError='Velas no disponibles desde Market Data del bot';}
        return m;
      });
      return { state: r.state==='ok'&&(!Array.isArray(market.data?.candles)||market.data.candles.length<2)?'partial':st(r.state), market, latency: r.latency };
    },
    async portfolio(){
      // Saldos EXCHANGE y contabilidad BOT son fuentes diferentes.
      const [summary,holdings,ledger,reservations,budgets,inventory,balances,prices]=await Promise.all([
        get(ROUTES.common.portfolio),get(ROUTES.common.holdings),
        get(ROUTES.common.ledger),get(ROUTES.common.reservations),
        get(ROUTES.common.budgets),get(ROUTES.common.inventory),
        get(ROUTES.common.balances),get(ROUTES.common.prices)]);
      const reads={summary,holdings,ledger,reservations,budgets,inventory,exchangeBalances:balances,prices};
      const resourceStates=Object.fromEntries(Object.entries(reads).map(([k,v])=>[k,st(v.state)]));
      const all=Object.values(reads),ok=all.filter(x=>x.state==='ok').length;
      return {
        state:ok===0?st(summary.state):ok===all.length?'ok':'partial',
        resourceStates,
        summary:wrap(summary.state==='ok'?summary.data:null,normPortfolioSummary,{ts:Date.now()}),
        holdings:wrap(holdings.state==='ok'?list(holdings.data):null,x=>x,{ts:Date.now()}),
        ledger:wrap(ledger.state==='ok'?list(ledger.data):null,x=>x,{ts:Date.now()}),
        reservations:wrap(reservations.state==='ok'?list(reservations.data):null,x=>x,{ts:Date.now()}),
        budgets:wrap(budgets.state==='ok'?{items:list(budgets.data)}:null,x=>x,{ts:Date.now()}),
        inventory:wrap(inventory.state==='ok'?list(inventory.data):null,x=>x,{ts:Date.now()}),
        exchangeBalances:wrap(balances.state==='ok'?balances.data:null,x=>x,{ts:Date.now()}),
        prices:wrap(prices.state==='ok'?prices.data:null,x=>x,{ts:Date.now()}),
        latency:Math.max(...all.map(x=>x.latency||0))
      };
    },
    async activity(){
      const r = await get(ROUTES.common.notifications);
      return { state: st(r.state), events: wrap(list(r.data).map(normEvent).filter(Boolean), x=>x, {ts:Date.now()}) };
    },
    async fisco(){
      // Seguridad: rol separado, GET exclusivo, sin credenciales fiscales en APK.
      const roles=session.get()?.roles||[];
      if(!roles.includes('fisco:read')&&!roles.includes('admin')&&!roles.includes('*'))
        return {state:'forbidden',data:null,resourceStates:null,note:'Falta permiso fisco:read.'};
      const keys=['summary','operations','lots','disposals','annualReport','finalizationStatus','meta'];
      const routes=[ROUTES.common.fisco,
        'GET /fisco/operations?page=1&pageSize=100','GET /fisco/lots',
        'GET /fisco/disposals','GET /fisco/annual-report',
        'GET /fisco/finalization-status','GET /fisco/meta'];
      const results=await Promise.all(routes.map(route=>get(route)));
      const resourceStates=Object.fromEntries(results.map((r,i)=>[keys[i],st(r.state)]));
      const data=Object.fromEntries(results.map((r,i)=>[keys[i],r.state==='ok'?r.data:null]));
      const ok=results.filter(r=>r.state==='ok').length;
      return {state:ok===0?st(results[0].state):ok===results.length?'ok':'partial',
        data,resourceStates,note:ok===0?'Informe fiscal no disponible.':undefined};
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
