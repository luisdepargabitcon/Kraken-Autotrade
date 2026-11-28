// NEXA — regresión de carga aislada por recurso (data-loader.js, módulo puro).
// Un adaptador que lanza excepción en UN motor no debe vaciar los demás:
// los demás muestran sus datos, el fallido queda 'error' (o 'stale' si había
// lectura válida previa) y el estado global 'error' solo sale si TODO falla.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const { loadSnapshot } = await import(pathToFileURL(join(web, 'js', 'data-loader.js')));

// Provider sano mínimo: cada método devuelve la forma que produce provider.js.
const wrap = data => ({ data, state: 'ok', ts: Date.now() });
function healthyProvider() {
  return {
    idca: async () => ({
      state: 'ok', latency: 3,
      status: wrap({ mode: 'LIVE' }), summary: wrap({ activeCyclesCount: 2 }),
      pairContexts: wrap(null), simWallet: wrap(null), feePresets: wrap(null),
      importableStatus: wrap(null),
      cycles: wrap([{ id: 'c1', pair: 'BTC/USD' }]), orders: wrap([]),
      history: wrap([]), events: wrap([{ id: 'ev-idca', ts: 1, msg: 'tick' }]),
    }),
    spot: async () => ({
      state: 'ok', latency: 4,
      resourceStates: { positions: 'ok', diagnostics: 'ok', trades: 'ok' },
      status: wrap({ mode: 'LIVE' }), positions: wrap([{ id: 'p1', pair: 'BTC/USD' }]),
      trades: wrap([{ id: 't1', ts: 5 }]), tradeTotal: 1, diagnostics: {},
    }),
    grid: async () => ({
      state: 'ok', latency: 2,
      status: wrap({ mode: 'LIVE' }), levels: wrap({ levels: [] }),
      cycles: wrap([{ id: 'g1' }]), events: wrap([{ id: 'ev-grid', ts: 2, msg: 'rango' }]),
      config: wrap({}), monitor: wrap({ events: [], alerts: [] }),
    }),
    ama: async () => ({
      state: 'ok', latency: 2,
      status: wrap({ mode: 'LIVE' }), mandate: wrap(null), tranches: wrap([]),
      cycles: wrap([]), readiness: wrap(null), portfolio: wrap(null),
      trace: wrap({ orders: [], tranches: [], ledger: [], decisions: [] }),
    }),
    market: async (pair) => ({
      state: 'ok', latency: 6,
      market: wrap({ pair, price: 100, candles: [{ o: 1, h: 2, l: 0.5, c: 1.5, v: 3 }] }),
    }),
    portfolio: async () => ({
      state: 'ok', latency: 5,
      resourceStates: { summary: 'ok' },
      summary: wrap({ navUsd: 1000 }), holdings: wrap([]), ledger: wrap([]),
      reservations: wrap([]), budgets: wrap({ items: [] }), inventory: wrap([]),
      exchangeBalances: wrap(null), prices: wrap(null),
    }),
    activity: async () => ({ state: 'ok', events: wrap([{ id: 'n1', ts: 3, msg: 'aviso' }]) }),
    fisco: async () => ({
      state: 'ok',
      data: { summary: { year: 2025 } },
      resourceStates: { summary: 'ok' }, note: undefined,
    }),
  };
}

test('un motor que lanza excepción no vacía a los demás', async () => {
  const p = healthyProvider();
  p.idca = async () => { throw new ReferenceError('num is not defined'); };
  const snap = await loadSnapshot(p, { ui: {} });
  // IDCA aislado como error; SPOT/GRID/AMA sanos con sus datos.
  assert.equal(snap.enginesData.idca.state, 'error');
  assert.equal(snap.enginesData.spot.state, 'ok');
  assert.equal(snap.enginesData.spot.data.positions[0].id, 'p1');
  assert.equal(snap.enginesData.grid.state, 'ok');
  assert.equal(snap.enginesData.grid.data.cycles[0].id, 'g1');
  assert.equal(snap.enginesData.ama.state, 'ok');
  // Los recursos comunes también sobreviven.
  assert.equal(snap.common.portfolio.state, 'ok');
  assert.equal(snap.common.portfolio.data.summary.navUsd, 1000);
  assert.equal(snap.common.market.state, 'ok');
  assert.equal(snap.common.fisco.state, 'ok');
  assert.equal(snap.common.fisco.data.summary.year, 2025);
  // La actividad global sigue fusionando eventos de los motores sanos.
  const feedIds = snap.common.activity.data.events.map(e => e.id);
  assert.ok(feedIds.includes('ev-grid'), 'eventos de grid presentes');
  assert.ok(feedIds.includes('ev-idca') === false, 'idca no aporta eventos al fallar');
  assert.equal(snap.allError, false, 'no es un fallo total');
});

test('recarga fallida con datos previos sirve stale, nunca pantalla vacía', async () => {
  const p = healthyProvider();
  const first = await loadSnapshot(p, { ui: {} });
  assert.equal(first.enginesData.spot.state, 'ok');
  const firstReadAt = first.enginesData.spot.readAt;
  assert.ok(Number.isFinite(firstReadAt));

  // Segunda carga: SPOT devuelve estado transitorio y GRID lanza excepción.
  p.spot = async () => ({ state: 'unreachable', latency: 9 });
  p.grid = async () => { throw new Error('boom'); };
  const second = await loadSnapshot(p, {
    ui: {}, prevLastGood: first.lastGood,
    spotExtraTrades: [], spotPageOffset: 100,
  });
  // Ambos conservan la última lectura válida marcada como stale con su readAt.
  assert.equal(second.enginesData.spot.state, 'stale');
  assert.equal(second.enginesData.spot.data.positions[0].id, 'p1');
  assert.equal(second.enginesData.spot.readAt, firstReadAt);
  assert.equal(second.enginesData.spot.lastError, 'unreachable');
  assert.equal(second.enginesData.grid.state, 'stale');
  assert.equal(second.enginesData.grid.data.cycles[0].id, 'g1');
  // IDCA/AMA siguen frescos.
  assert.equal(second.enginesData.idca.state, 'ok');
  assert.equal(second.enginesData.ama.state, 'ok');
  assert.equal(second.allError, false);
});

test('auth_required y forbidden no se enmascaran como stale', async () => {
  const p = healthyProvider();
  const first = await loadSnapshot(p, { ui: {} });
  p.idca = async () => ({ state: 'auth_required', latency: 1 });
  p.fisco = async () => ({ state: 'forbidden', data: null, resourceStates: null, note: 'Falta permiso fisco:read.' });
  const second = await loadSnapshot(p, { ui: {}, prevLastGood: first.lastGood });
  assert.equal(second.enginesData.idca.state, 'auth_required',
    'un 401 debe seguir pidiendo sesión, no disfrazarse de datos viejos');
  assert.equal(second.common.fisco.state, 'forbidden');
  assert.equal(second.common.fisco.data, null);
  // La última lectura buena se conserva para cuando vuelva la autorización.
  assert.equal(second.lastGood['engine:idca'].data.cycles[0].id, 'c1');
  assert.equal(second.lastGood['common:fisco'].data.summary.year, 2025);
});

test('si TODO falla a la vez, allError es true (reset global)', async () => {
  const p = healthyProvider();
  for (const k of ['idca', 'spot', 'grid', 'ama', 'market', 'portfolio', 'activity', 'fisco']) {
    p[k] = async () => { throw new Error('backend caído'); };
  }
  const snap = await loadSnapshot(p, { ui: {} });
  assert.equal(snap.allError, true);
  assert.equal(snap.enginesData.spot.state, 'error');
  assert.equal(snap.common.portfolio.state, 'error');
  assert.equal(snap.common.fisco.state, 'error');
});

test('primera carga sin historial: error honesto, sin datos inventados', async () => {
  const p = healthyProvider();
  p.ama = async () => ({ state: 'unavailable', latency: 1 });
  const snap = await loadSnapshot(p, { ui: {} });
  assert.equal(snap.enginesData.ama.state, 'unavailable');
  assert.equal(snap.allError, false, 'un solo recurso caído no es fallo total');
  assert.equal(snap.enginesData.spot.state, 'ok');
});
