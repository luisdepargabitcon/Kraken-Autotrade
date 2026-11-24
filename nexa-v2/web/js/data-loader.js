// NEXA — carga de datos AISLADA POR RECURSO (módulo puro, sin DOM).
// Cada recurso se resuelve de forma independiente: un adaptador que lanza una
// excepción o devuelve un estado de error solo degrada ESE recurso; los demás
// conservan sus datos. Si una recarga falla pero existe una lectura válida
// previa, el recurso se sirve como 'stale' con su readAt original — nunca una
// pantalla vacía por un fallo transitorio.
// 'auth_required'/'forbidden' NO se enmascaran como stale: son estados de
// permiso honestos que la UI ya explica (fisco:read, sesión, etc.).
// El estado global 'error' (allError) solo se activa si TODO falla a la vez.

const GOOD_STATES = new Set(['ok', 'partial']);
// Estados transitorios que pueden enmascararse con la última lectura válida.
const TRANSIENT_STATES = new Set(['unavailable', 'unreachable', 'error']);
const FAILED_STATES = new Set(['error', 'unavailable', 'unreachable']);

// Un recurso nunca rechaza: la excepción se convierte en {ok:false}.
const settle = fn => Promise.resolve().then(fn)
  .then(value => ({ ok: true, value }), error => ({ ok: false, error }));

// Aplana los envoltorios {data,state} del provider a la forma que consumen las
// pantallas (antes vivía en app.js; se mueve aquí para que loadSnapshot sea
// testeable sin DOM).
export function normalizeEngine(r) {
  const d = {};
  for (const [k, v] of Object.entries(r || {})) {
    if (k === 'state' || k === 'latency') continue;
    d[k] = (v && typeof v === 'object' && 'data' in v) ? v.data : v;
  }
  return d;
}

// Resuelve UN recurso contra su última lectura buena (prevGood).
// Devuelve {entry, good}: entry es lo que ven los renderers ({state,data,
// latency,readAt,...}); good es lo que se conserva en lastGood para futuros
// 'stale' (null si ya no hay lectura válida que preservar).
function resolveResource(res, prevGood, mapData) {
  const now = Date.now();
  const wrapGood = (state, data) => ({ state, data, readAt: now });
  if (res.ok) {
    const v = res.value || {};
    const state = typeof v.state === 'string' && v.state ? v.state : 'ok';
    const data = mapData ? mapData(v) : normalizeEngine(v);
    const latency = v.latency;
    if (GOOD_STATES.has(state)) {
      const good = wrapGood(state, data);
      return { entry: { state, data, latency, readAt: now }, good };
    }
    if (TRANSIENT_STATES.has(state) && prevGood && prevGood.data != null) {
      // Fallo transitorio con historial: se muestran los últimos datos válidos.
      return {
        entry: { state: 'stale', data: prevGood.data, latency,
          readAt: prevGood.readAt ?? now, lastError: state },
        good: prevGood,
      };
    }
    // auth_required / forbidden / estados desconocidos: honestos, sin datos
    // inventados; la última lectura buena se conserva para un futuro stale.
    return { entry: { state, data, latency, readAt: now }, good: prevGood || null };
  }
  // Excepción del adaptador (p. ej. ReferenceError en num() — R21).
  if (prevGood && prevGood.data != null) {
    return {
      entry: { state: 'stale', data: prevGood.data,
        readAt: prevGood.readAt ?? now, lastError: 'error' },
      good: prevGood,
    };
  }
  return {
    entry: { state: 'error', data: {}, readAt: now,
      lastError: String(res.error?.message || res.error || 'error') },
    good: null,
  };
}

// Portfolio: el provider devuelve sub-recursos {summary:{data},...}; la forma
// histórica de ctx.data.portfolio.data se conserva tal cual.
const portfolioMap = v => ({
  summary: v.summary?.data ?? null,
  holdings: v.holdings?.data ?? null,
  ledger: v.ledger?.data ?? null,
  reservations: v.reservations?.data ?? null,
  budgets: v.budgets?.data ?? null,
  inventory: v.inventory?.data ?? null,
  exchangeBalances: v.exchangeBalances?.data ?? null,
  prices: v.prices?.data ?? null,
  resourceStates: v.resourceStates || {},
});

// Mercado: ctx.data.marketPairs[pair] = {state,data,readAt}.
const marketMap = v => v.market?.data ?? null;

// Actividad: el feed global se construye DESPUÉS con los eventos de cada motor
// (ver más abajo); aquí solo se resuelve la fuente de notificaciones.
const activityMap = v => ({ events: Array.isArray(v.events?.data) ? v.events.data : null });

// FISCO: contable del bot completo (scope-neutral: fiscalidad de todo el bot,
// no de un motor). El proveedor ya exige el rol fisco:read y devuelve
// 'forbidden' sin él — ese estado nunca se enmascara como stale. Su forma es
// {state, data, note, resourceStates}: note/resourceStates van en el nivel de
// ctx.data.fisco, no dentro de data, así que necesita su propio resolvedor.
function resolveFisco(res, prevGood) {
  const now = Date.now();
  const mapped = v => ({
    data: v.data ?? null, note: v.note,
    resourceStates: v.resourceStates || {},
  });
  const fromGood = g => ({
    state: 'stale', data: g.data, note: g.note,
    resourceStates: g.resourceStates || {}, readAt: g.readAt ?? now,
  });
  if (res.ok) {
    const v = res.value || {};
    const state = typeof v.state === 'string' && v.state ? v.state : 'ok';
    const m = mapped(v);
    if (GOOD_STATES.has(state)) {
      const good = { state, ...m, readAt: now };
      return { entry: { state, ...m, readAt: now }, good };
    }
    if (TRANSIENT_STATES.has(state) && prevGood && prevGood.data != null) {
      return { entry: { ...fromGood(prevGood), lastError: state }, good: prevGood };
    }
    return { entry: { state, ...m, readAt: now }, good: prevGood || null };
  }
  if (prevGood && prevGood.data != null) {
    return { entry: { ...fromGood(prevGood), lastError: 'error' }, good: prevGood };
  }
  return {
    entry: { state: 'error', data: null, note: undefined, resourceStates: {},
      readAt: now, lastError: String(res.error?.message || res.error || 'error') },
    good: null,
  };
}

// Une el feed de notificaciones con los eventos reales de cada motor, sin
// duplicados (misma lógica que tenía app.js). Los trades de /trades/closed son
// globales y NO se mezclan: siguen en «Historial SPOT».
function buildActivityFeed(activityEvents, enginesData) {
  const feed = [...(activityEvents || [])];
  const seen = new Set(feed.map(e => `${e.engine || 'bot'}:${e.id ?? e.ts}`));
  const engMode = id => {
    const d = enginesData?.[id]?.data || {};
    return d.status?.mode || d.status?.executionMode ||
      d.summary?.mode || d.summary?.executionMode || null;
  };
  const push = (arr, engine) => {
    for (const e of arr || []) {
      const k = `${engine}:${e.id ?? e.ts ?? e.msg}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const mode = e.mode ?? e.executionMode ?? engMode(engine);
      feed.push({ ...e, engine: engine || e.engine, ...(mode ? { mode } : {}) });
    }
  };
  const gd = enginesData.grid?.data, ad = enginesData.ama?.data, id = enginesData.idca?.data;
  push(gd?.events, 'grid'); push(gd?.monitor?.events, 'grid'); push(gd?.monitor?.alerts, 'grid');
  push(ad?.trace?.decisions, 'ama'); push(ad?.trace?.events, 'ama'); push(id?.events, 'idca');
  // Eventos del feed sin modo propio heredan el de su motor cuando el backend
  // no lo etiqueta: así el filtro REAL/SHADOW no los pierde.
  for (const e of feed) {
    if (e.mode == null && e.executionMode == null) {
      const m = engMode(e.engine);
      if (m) e.mode = m;
    }
  }
  feed.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
  return feed;
}

// Mezcla las páginas históricas SPOT ya leídas por el usuario si el GET del
// historial sigue autorizado; si no, se limpian (idéntico al comportamiento
// previo en app.js). spotExtraTrades se muta; spotPageOffset se devuelve.
function mergeSpotHistory(sd, spotExtraTrades, spotPageOffset) {
  if (!Array.isArray(spotExtraTrades)) return spotPageOffset;
  if (sd.resourceStates?.trades === 'ok' && Array.isArray(sd.trades) && spotExtraTrades.length) {
    const key = o => String(o.id ?? o.tradeId ?? '') + '|' + String(o.ts ?? '');
    const seen = new Set(sd.trades.map(key));
    for (const t of spotExtraTrades) {
      const k = key(t);
      if (!seen.has(k)) { seen.add(k); sd.trades.push(t); }
    }
  } else if (sd.resourceStates?.trades !== 'ok') {
    spotExtraTrades.length = 0;
    return 100;
  }
  return spotPageOffset;
}

// Ejecuta las ~9 lecturas en paralelo, cada una blindada. Devuelve el mismo
// contrato que antes consumían los renderers ({enginesData, common}) más
// lastGood (para 'stale'), allError (fallo total) y spotPageOffset.
// prevLastGood: mapa de lecturas válidas de la carga anterior (state.lastGood).
export async function loadSnapshot(provider, {
  ui = {}, prevLastGood = null,
  spotExtraTrades = null, spotPageOffset = 100,
} = {}) {
  const tf = ui.marketTf || '15';
  const jobs = [
    ['engine:idca', () => provider.idca()],
    ['engine:spot', () => provider.spot()],
    ['engine:grid', () => provider.grid()],
    ['engine:ama', () => provider.ama()],
    ['market:BTC/USD', () => provider.market('BTC/USD', tf)],
    ['market:ETH/USD', () => provider.market('ETH/USD', tf)],
    ['common:portfolio', () => provider.portfolio()],
    ['common:activity', () => provider.activity()],
    ['common:fisco', () => provider.fisco()],
  ];
  const settled = await Promise.all(jobs.map(async ([key, fn]) => [key, await settle(fn)]));
  const byKey = Object.fromEntries(settled);
  const lastGood = { ...(prevLastGood || {}) };
  const allEntries = [];
  const take = (key, mapData) => {
    const { entry, good } = resolveResource(byKey[key], lastGood[key], mapData);
    if (good) lastGood[key] = good; else delete lastGood[key];
    allEntries.push(entry);
    return entry;
  };

  // Motores.
  const enginesData = {};
  for (const id of ['idca', 'spot', 'grid', 'ama']) {
    enginesData[id] = take(`engine:${id}`);
  }

  // Historial SPOT paginado por el usuario (misma norma que antes).
  const newOffset = mergeSpotHistory(enginesData.spot.data || {}, spotExtraTrades, spotPageOffset);

  // Mercados por par.
  const marketPairs = {};
  for (const pair of ['BTC/USD', 'ETH/USD']) {
    const entry = take(`market:${pair}`, marketMap);
    marketPairs[pair] = { state: entry.state, data: entry.data, readAt: entry.readAt };
  }

  // Cartera.
  const portfolio = take('common:portfolio', portfolioMap);

  // Actividad: resuelve la fuente y luego fusiona eventos de los motores.
  const act = take('common:activity', activityMap);
  const feed = buildActivityFeed(act.data?.events ?? null, enginesData);
  const activity = {
    state: act.state, data: { events: feed },
    latency: act.latency, readAt: act.readAt,
  };

  // FISCO (contable, scope-neutral: fiscalidad del bot completo).
  const fis = resolveFisco(byKey['common:fisco'], lastGood['common:fisco']);
  if (fis.good) lastGood['common:fisco'] = fis.good; else delete lastGood['common:fisco'];
  allEntries.push(fis.entry);
  const fisco = { ...fis.entry };

  const allError = allEntries.length > 0 &&
    allEntries.every(e => FAILED_STATES.has(e.state));

  return {
    enginesData,
    common: {
      marketPairs,
      market: marketPairs[ui.marketPair] || marketPairs['BTC/USD'],
      portfolio,
      activity,
      fisco,
    },
    lastGood,
    allError,
    spotPageOffset: newOffset,
  };
}
