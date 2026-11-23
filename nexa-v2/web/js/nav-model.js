// NEXA — modelo de navegación por profundidad (depth 0/1/2), réplica del
// prototipo docs/prototipos/NEXA-Controles.html. Módulo puro: sin DOM, sin
// estado global, consumido por app.js, tests y el harness QA.
// depth 0 = menú raíz (Inicio); depth 1 = subpestañas de la sección;
// depth 2 = secciones internas del motor elegido en Modos.
import { STREAM } from './scoped-pages.js';

export const ROOT_ITEMS = [
  { id: 'home', label: 'Inicio' },
  { id: 'market', label: 'Mercado' },
  { id: 'engines', label: 'Modos' },
  { id: 'portfolio', label: 'Cartera' },
  { id: 'activity', label: 'Actividad' },
];

// Subpestañas de cada sección (textos del prototipo). Los ids de Cartera son
// los mismos que allTabs de portfolio-view.js; los de Actividad se traducen al
// filtro ui.activityFilter.cat mediante ACTIVITY_CAT.
export const SECTION_TABS = {
  home: [['summary', 'Resumen'], ['positions', 'Posiciones'], ['connection', 'Conexión']],
  market: [['price', 'Precio'], ['chart', 'Gráfico'], ['levels', 'Niveles'], ['indicators', 'Indicadores']],
  engines: [['general', 'General'], ['idca', 'IDCA'], ['spot', 'SPOT'], ['grid', 'GRID'], ['ama', 'AMA']],
  portfolio: [['summary', 'Resumen'], ['balances', 'Saldos'], ['assets', 'Activos'],
    ['ledger', 'Movimientos'], ['reservations', 'Reservas'], ['audit', 'Conciliación']],
  activity: [['recent', 'Recientes'], ['executed', 'Ejecuciones'], ['decision', 'Decisiones'], ['notices', 'Avisos']],
};

// En Básico se ocultan estas subpestañas (Indicadores, Conciliación, Reservas;
// Órdenes se filtra a nivel de motor, no por id de sección).
const BASIC_HIDDEN = new Set(['indicators', 'reservations', 'audit']);
export const ACTIVITY_CAT = { recent: 'all', executed: 'executed', decision: 'decision', notices: 'technical' };

export function sectionTabs(section, mode) {
  const tabs = SECTION_TABS[section] || [];
  return mode === 'pro' ? tabs : tabs.filter(([id]) => !BASIC_HIDDEN.has(id));
}

// Secciones internas de un motor a partir de los path reales de STREAM
// (scoped-pages). Estado=panel siempre; Posiciones=cycles|positions;
// Historial=history|trades y, si el motor solo expone un log de eventos/
// decisiones, ese log; Órdenes solo existe en Pro y donde el bot la entrega.
export function engineTabs(engineId, mode) {
  const paths = STREAM.filter(([e]) => e === engineId).map(([, p]) => p);
  const tabs = [['panel', 'Estado']];
  const pos = paths.find(p => p === 'cycles' || p === 'positions');
  if (pos) tabs.push([pos, 'Posiciones']);
  const hist = paths.find(p => p === 'history' || p === 'trades')
    || paths.find(p => p === 'events' || p === 'trace.decisions');
  if (hist) tabs.push([hist, 'Historial']);
  if (mode === 'pro' && paths.includes('orders')) tabs.push(['orders', 'Órdenes']);
  return tabs;
}

export const navRoot = () => ({ depth: 0, section: 'home', sub: 'summary', inner: null });

// Ítems de la barra inferior según el nivel (como el prototipo: la misma barra
// cambia de contenido). Devuelve [{id,label,icon?}].
export function bottomItems(nav, mode) {
  if (!nav || nav.depth === 0) return ROOT_ITEMS.map(x => ({ ...x }));
  if (nav.depth === 1) return sectionTabs(nav.section, mode).map(([id, label]) => ({ id, label }));
  return engineTabs(nav.sub, mode).map(([id, label]) => ({ id, label }));
}

const firstTab = (section, mode) => (sectionTabs(section, mode)[0] || [null])[0];

// move(i): igual que el prototipo. En depth 0 entra en la sección i-ésima con
// su primera subpestaña; en depth 1 elige subpestaña (un motor abre depth 2);
// en depth 2 elige la sección interna.
export function navMove(nav, i, mode) {
  if (!nav.depth) {
    const s = ROOT_ITEMS[i];
    return s ? { depth: 1, section: s.id, sub: firstTab(s.id, mode), inner: null } : { ...nav };
  }
  if (nav.depth === 1) {
    const t = sectionTabs(nav.section, mode)[i];
    if (!t) return { ...nav };
    const n = { ...nav, sub: t[0] };
    if (nav.section === 'engines' && n.sub !== 'general') { n.depth = 2; n.inner = 'panel'; }
    return n;
  }
  const t = engineTabs(nav.sub, mode)[i];
  return t ? { ...nav, inner: t[0] } : { ...nav };
}

// up(): sube exactamente un nivel. Desde un motor vuelve a Modos (sub=general
// como en el prototipo); desde cualquier sección vuelve a la raíz (Inicio).
export function navUp(nav) {
  const depth = Math.max(0, (nav.depth || 0) - 1);
  if (depth === 0) return navRoot();
  const n = { ...nav, depth, inner: depth < 2 ? null : nav.inner };
  if (nav.section === 'engines') n.sub = 'general';
  return n;
}

// Asegura que sub/inner existen para el modo actual (p. ej. Órdenes al pasar a
// Básico cae a la primera sección interna disponible, no a la raíz). Se aplica
// también al cambiar REAL↔SHADOW: conserva la ruta.
export function sanitizeNav(nav, mode) {
  const n = { ...nav };
  if (n.depth === 0) return navRoot();
  const tabs = sectionTabs(n.section, mode);
  if (!tabs.some(([id]) => id === n.sub)) n.sub = firstTab(n.section, mode);
  if (n.depth === 2) {
    if (n.section !== 'engines' || n.sub === 'general') { n.depth = 1; n.inner = null; }
    else {
      const inner = engineTabs(n.sub, mode);
      if (!inner.some(([id]) => id === n.inner)) n.inner = inner[0][0];
    }
  } else n.inner = null;
  return n;
}

// Traduce el estado de navegación a la pantalla y campos de ui que ya existen.
// screen coincide con el identificador de render de app.js.
export function navView(nav) {
  if (!nav || nav.depth === 0) return { screen: 'dashboard', ui: {} };
  const { section, sub, inner } = nav;
  if (section === 'home') {
    if (sub === 'positions') return { screen: 'positions', ui: {} };
    if (sub === 'connection') return { screen: 'settings', ui: {} };
    return { screen: 'dashboard', ui: {} };
  }
  if (section === 'market') return { screen: 'market', ui: { marketSub: sub } };
  if (section === 'engines') {
    if (nav.depth === 2 && sub !== 'general')
      return { screen: 'engine', ui: { engineId: sub, subtab: inner || 'panel' } };
    return { screen: 'modes', ui: {} };
  }
  if (section === 'portfolio') return { screen: 'portfolio', ui: { portfolioTab: sub } };
  if (section === 'activity') return { screen: 'activity', ui: { activityCat: ACTIVITY_CAT[sub] || 'all' } };
  return { screen: 'dashboard', ui: {} };
}
