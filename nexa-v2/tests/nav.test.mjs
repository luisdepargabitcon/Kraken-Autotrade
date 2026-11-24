// NEXA V2 — regresiones del modelo de navegación por profundidad (nav-model.js),
// réplica del prototipo docs/prototipos/NEXA-Controles.html. El módulo es puro
// (sin DOM): se prueba aquí la misma lógica que ejecuta app.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const {
  navRoot, navMove, navUp, sanitizeNav, bottomItems, sectionTabs, engineTabs,
  navView, ROOT_ITEMS, ACTIVITY_CAT,
} = await import(pathToFileURL(join(web, 'js', 'nav-model.js')));

test('la raíz muestra las cinco secciones con sus ids', () => {
  const items = bottomItems(navRoot(), 'pro');
  assert.deepEqual(items.map(x => x.id), ['home', 'market', 'engines', 'portfolio', 'activity']);
  assert.equal(ROOT_ITEMS.length, 5);
});

test('move() sube la profundidad: raíz → sección → motor', () => {
  let nav = navRoot();
  nav = navMove(nav, 2, 'pro');                 // Modos
  assert.deepEqual(nav, { depth: 1, section: 'engines', sub: 'general', inner: null });
  nav = navMove(nav, 2, 'pro');                 // pestaña SPOT (índice 2: General,IDCA,SPOT…)
  assert.deepEqual(nav, { depth: 2, section: 'engines', sub: 'spot', inner: 'panel' });
  nav = navMove(nav, 1, 'pro');                 // sección interna nº1 = Posiciones
  assert.equal(nav.inner, 'positions');
});

test('up() desde un motor vuelve a Modos y desde Modos a la raíz', () => {
  let nav = { depth: 2, section: 'engines', sub: 'idca', inner: 'orders' };
  nav = navUp(nav);
  assert.deepEqual(nav, { depth: 1, section: 'engines', sub: 'general', inner: null });
  nav = navUp(nav);
  assert.deepEqual(nav, navRoot());
  assert.equal(navUp(navRoot()).depth, 0, 'en la raíz up() no baja de 0');
});

test('up() desde otra sección de nivel 1 vuelve a la raíz', () => {
  const nav = navUp({ depth: 1, section: 'portfolio', sub: 'ledger', inner: null });
  assert.deepEqual(nav, navRoot());
});

test('cambiar a Pro conserva la ruta exacta', () => {
  const nav = { depth: 2, section: 'engines', sub: 'idca', inner: 'orders' };
  assert.deepEqual(sanitizeNav(nav, 'pro'), nav);
});

test('Órdenes de Pro al pasar a Básico cae a la primera sección interna, no a la raíz', () => {
  const nav = sanitizeNav({ depth: 2, section: 'engines', sub: 'idca', inner: 'orders' }, 'basic');
  assert.deepEqual(nav, { depth: 2, section: 'engines', sub: 'idca', inner: 'panel' });
});

test('una subpestaña Pro que no existe en Básico cae a la primera del nivel', () => {
  const nav = sanitizeNav({ depth: 1, section: 'market', sub: 'indicators', inner: null }, 'basic');
  assert.equal(nav.depth, 1);
  assert.equal(nav.section, 'market');
  assert.equal(nav.sub, 'price', 'cae a la primera disponible (Precio), conservando la sección');
});

test('Básico oculta Indicadores, Conciliación, Reservas y Órdenes', () => {
  const market = sectionTabs('market', 'basic').map(([id]) => id);
  assert.ok(!market.includes('indicators'));
  assert.deepEqual(sectionTabs('market', 'pro').map(([id]) => id),
    ['price', 'chart', 'levels', 'indicators']);
  const cartera = sectionTabs('portfolio', 'basic').map(([id]) => id);
  assert.ok(!cartera.includes('reservations') && !cartera.includes('audit'));
  assert.deepEqual(cartera, ['summary', 'balances', 'assets', 'ledger']);
  assert.ok(!engineTabs('idca', 'basic').some(([id]) => id === 'orders'));
  assert.ok(engineTabs('idca', 'pro').some(([id, l]) => id === 'orders' && l === 'Órdenes'));
});

test('las secciones internas del motor derivan de los path reales de STREAM', () => {
  // SPOT declara 'orders' en STREAM (Pro): la pestaña existe pero el gateway no
  // expone aún el dato → la vista lo declara como fuente ausente, no «0 órdenes».
  assert.deepEqual(engineTabs('spot', 'pro').map(([id]) => id), ['panel', 'positions', 'trades', 'orders']);
  assert.deepEqual(engineTabs('spot', 'basic').map(([id]) => id), ['panel', 'positions', 'trades']);
  assert.deepEqual(engineTabs('idca', 'pro').map(([id]) => id), ['panel', 'cycles', 'history', 'orders', 'events']);
  assert.deepEqual(engineTabs('grid', 'pro').map(([id]) => id), ['panel', 'cycles', 'events']);
  assert.deepEqual(engineTabs('ama', 'pro').map(([id]) => id), ['panel', 'cycles', 'tranches', 'trace.decisions']);
  // AMA no tiene 'positions' ni 'orders' → no se inventan pestañas vacías.
  assert.ok(!engineTabs('ama', 'pro').some(([id]) => id === 'orders'));
});

test('navView traduce la ruta a la pantalla y los campos de ui existentes', () => {
  assert.deepEqual(navView({ depth: 2, section: 'engines', sub: 'idca', inner: 'orders' }),
    { screen: 'engine', ui: { engineId: 'idca', subtab: 'orders' } });
  assert.deepEqual(navView({ depth: 1, section: 'portfolio', sub: 'audit', inner: null }),
    { screen: 'portfolio', ui: { portfolioTab: 'audit' } });
  assert.deepEqual(navView({ depth: 1, section: 'market', sub: 'levels', inner: null }),
    { screen: 'market', ui: { marketSub: 'levels' } });
  assert.equal(navView(navRoot()).screen, 'dashboard');
});

test('las subpestañas de Actividad mapean a activityFilter.cat', () => {
  assert.equal(ACTIVITY_CAT.recent, 'all');
  assert.equal(ACTIVITY_CAT.executed, 'executed');
  assert.equal(ACTIVITY_CAT.decision, 'decision');
  assert.equal(ACTIVITY_CAT.rejected, 'rejected');
  assert.equal(ACTIVITY_CAT.error, 'error');
  assert.equal(ACTIVITY_CAT.notices, 'technical');
  assert.deepEqual(navView({ depth: 1, section: 'activity', sub: 'notices', inner: null }),
    { screen: 'activity', ui: { activityCat: 'technical' } });
});

test('bottomItems cambia de contenido según el nivel y respeta el modo', () => {
  assert.equal(bottomItems({ depth: 1, section: 'engines', sub: 'general', inner: null }, 'pro').length, 5);
  assert.deepEqual(bottomItems({ depth: 2, section: 'engines', sub: 'spot', inner: 'panel' }, 'pro')
    .map(x => x.label), ['Estado', 'Posiciones', 'Historial', 'Órdenes']);
  assert.deepEqual(bottomItems({ depth: 2, section: 'engines', sub: 'spot', inner: 'panel' }, 'basic')
    .map(x => x.label), ['Estado', 'Posiciones', 'Historial']);
  assert.equal(bottomItems({ depth: 1, section: 'portfolio', sub: 'summary', inner: null }, 'pro').length, 6);
  assert.equal(bottomItems({ depth: 1, section: 'portfolio', sub: 'summary', inner: null }, 'basic').length, 4);
});
