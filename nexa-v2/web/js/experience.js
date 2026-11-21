// NEXA — experience rev9. Views are rebuilt, not recolored.
// Only renders values returned by the canonical provider; never manufactures balances or trading states.
import { esc, fmtUsd, signedUsd, signedPct, fmtNum, fmtPct, NA, isNum } from './util.js';
import { candleChart, modeBadge } from './ui.js';

const ICON={
  wallet:'<path d="M4 7h16v13H4zM4 7l3-4h10l3 4M16 13h4v4h-4z"/>',
  signal:'<path d="M3 17l6-6 4 4 8-10M17 5h4v4"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  layers:'<path d="M12 3 2 9l10 6 10-6-10-6zm-10 11 10 6 10-6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  shield:'<path d="M12 2 4 6v6c0 6 4 9 8 10 4-1 8-4 8-10V6z"/><path d="m8 12 3 3 5-6"/>'
};
const icon=(name)=>'<svg class="nx-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">'+(ICON[name]||ICON.signal)+'</svg>';
const good = v => v!==null && v!==undefined && v!=='' && Number.isFinite(Number(v));
const money=v=>good(v)?fmtUsd(Number(v)):NA;
const signedMoney=v=>good(v)?signedUsd(Number(v)):NA;
const safeStatus=s=>s===null||s===undefined||s===''?'Sin conexión':String(s);
const stat=(label,value,extra='')=>`<div class="nx-stat"><span>${esc(label)}</span><strong>${value}</strong>${extra?`<small>${esc(extra)}</small>`:''}</div>`;
const engineNames={idca:'IDCA',spot:'SPOT / Swing',grid:'GRID aislado',ama:'AMA'};
const engineIcons={idca:'layers',spot:'signal',grid:'grid',ama:'shield'};
const engineDescriptions={
  idca:'Ciclos · entradas · TP/BE/trailing',
  spot:'Señales · posiciones · protecciones',
  grid:'Niveles · rangos · BUY → SELL',
  ama:'Macro · mandatos · readiness'
};
const validState = state => !state||state==='ok'||state==='fresh'||state==='partial';
const unavailable = (ctx,kind) => ctx.authenticated===false || !validState(ctx.data?.[kind]?.state);

function link(target,label,cls='nx-link'){
  return `<button class="${cls}" data-nav="${esc(target)}">${esc(label)} <span aria-hidden="true">›</span></button>`;
}
function connectNotice(topic='datos del bot'){
  return `<section class="nx-connection" role="status">
    <div class="nx-connection-glyph">${icon('shield')}</div>
    <div><span class="nx-eyebrow">Conexión protegida</span><h2>Vincula NEXA</h2>
      <p>Para consultar ${esc(topic)} hace falta autorizar este dispositivo. No mostramos cifras, posiciones ni estados inventados.</p>
      <div class="nx-actions">
        <button class="nx-btn-primary" data-app="pair-device">Vincular dispositivo <span>↗</span></button>
        <button class="nx-btn-quiet" data-app="settings-api">Configurar servidor</button>
      </div></div>
  </section>`;
}
const engineTile=(e,status,profit)=>{
  const state=status?.status?.mode;
  return `<button class="nx-engine-tile" data-nav="engine:${esc(e.id)}">
    <span class="nx-engine-mark">${icon(engineIcons[e.id]||'signal')}</span>
    <span class="nx-engine-copy"><strong>${esc(e.name)}</strong><small>${esc(engineDescriptions[e.id]||e.desc||'')}</small></span>
    <span class="nx-engine-right"><b class="${good(profit)?(profit>=0?'pos':'neg'):''}">${good(profit)?signedMoney(profit):'—'}</b><small>${esc(state?String(state):'Sin vincular')}</small></span>
    <span class="nx-chevron" aria-hidden="true">›</span>
  </button>`;
};

export function renderHomeExperience(ctx, legacy){
  const sum=ctx.data?.portfolio?.data?.summary||{};
  const noData=unavailable(ctx,'portfolio') || (!good(sum.navUsd)&&!good(sum.exposureUsd));
  const connected=!noData;
  const nav=good(sum.navUsd)?money(sum.navUsd):NA;
  const engines=ctx.engineList||[];
  const engineTiles=engines.map(e=>{
    const st=ctx.enginesData?.[e.id];
    const profit=(sum.byEngine||[]).find(x=>x.engine===e.id)?.pnlUsd;
    return engineTile(e,connected&&st?.state==='ok'?st.data:null,connected?profit:null);
  }).join('');
  return `<div class="nx-experience nx-home">
    <div class="nx-overline"><span>NEXA / CENTRO DE CONTROL</span><span class="nx-sys-state ${connected?'nx-online':'nx-offline'}">${connected?'Datos conectados':'Pendiente de vinculación'}</span></div>
    <section class="nx-wealth-hero ${connected?'':'nx-wealth-empty'}">
      <div class="nx-hero-decoration" aria-hidden="true"></div>
      <span class="nx-eyebrow">${connected?'Patrimonio total':'Tu patrimonio en una sola vista'}</span>
      <div class="nx-wealth-number">${connected?nav:'Todo tu trading. Un solo lugar.'}</div>
      <p>${connected?'Información agregada desde el backend del bot.': 'SPOT, IDCA, GRID y AMA con acceso privado, datos auténticos y un diseño pensado para decidir rápido.'}</p>
      ${connected?
        `<div class="nx-hero-stats">${stat('Realizado',signedMoney(sum.realizedPnlUsd))}${stat('No realizado',signedMoney(sum.unrealizedPnlUsd))}${stat('Exposición',money(sum.exposureUsd))}</div>`
        :`<div class="nx-actions"><button class="nx-btn-primary" data-app="pair-device">Vincular mi bot <span>↗</span></button><button class="nx-btn-quiet" data-app="settings-api">Servidor seguro</button></div>`}
    </section>
    <div class="nx-section-title"><div><span class="nx-eyebrow">ESTRATEGIAS</span><h2>Tus motores</h2></div><span class="nx-meta">${engines.length} motores</span></div>
    <section class="nx-engine-stack">${engineTiles}</section>
    <div class="nx-shortcuts">${link('market','Mercado y gráficos','nx-shortcut')}${link('portfolio','Cartera y exposición','nx-shortcut')}${link('activity','Monitor y eventos','nx-shortcut')}</div>
    ${ctx.mode==='pro'&&connected?`<details class="nx-detail-vault"><summary>Panel de datos y auditoría completos <span>+</span></summary><div class="nx-detail-content">${legacy(ctx)}</div></details>`:''}
    ${!connected?'<p class="nx-footnote">Estado del servidor aún no verificado. La aplicación no afirma que los motores estén apagados, sin ciclos o en modo LIVE.</p>':''}
  </div>`;
}

export function renderMarketExperience(ctx, legacy){
  const m=ctx.data?.market?.data||{},pair=ctx.ui?.marketPair||'BTC/USD';
  const missing=unavailable(ctx,'market') || (!m?.tickers&&!m?.price&&!m?.candles);
  const tick=m.tickers?.[pair] || (m.pair===pair?m:{});
  const candles=m.candles?.[pair] || (m.pair===pair?m.candles:null);
  const ind=m.indicators?.[pair] || (m.pair===pair?m.indicators:{}) || {};
  const pairs=['BTC/USD','ETH/USD'];
  return `<div class="nx-experience nx-market">
    <div class="nx-section-title"><div><span class="nx-eyebrow">MERCADOS</span><h2>Visión de mercado</h2></div>${!missing?'<span class="nx-meta">Datos del proveedor</span>':''}</div>
    <div class="nx-pair-switch" role="group" aria-label="Seleccionar par">
      ${pairs.map(p=>`<button class="${p===pair?'active':''}" data-ui="marketPair:${p}">${esc(p)}</button>`).join('')}
    </div>
    ${missing?`<div class="nx-chart-shell nx-no-chart"><div class="nx-chart-title">Velas e indicadores · 15m</div>
      <div class="nx-chart-empty">${icon('signal')}<strong>Gráfica pendiente de datos</strong><span>Conecta el servidor para recibir OHLCV, precio y tendencias reales.</span></div></div>
      ${connectNotice('precios, velas, spreads y análisis técnicos')}`:
      `<section class="nx-market-head"><span class="nx-eyebrow">PRECIO ACTUAL · ${esc(pair)}</span><h2>${money(tick.price)} ${good(tick.change24hPct)?`<small class="${tick.change24hPct>=0?'pos':'neg'}">${signedPct(tick.change24hPct)}</small>`:''}</h2>
        <div class="nx-micro-stats">${stat('Compra BID',money(tick.bid))}${stat('Venta ASK',money(tick.ask))}${stat('Spread',money(tick.spread))}</div></section>
        <section class="nx-chart-shell"><div class="nx-chart-title">Velas de ${esc(pair)} <span>15 minutos</span></div>
          ${Array.isArray(candles)&&candles.length>=2?candleChart(candles,{hh:250}):'<div class="nx-chart-empty">Sin velas actuales verificadas</div>'}
        </section>
        <div class="nx-section-title"><div><span class="nx-eyebrow">ANÁLISIS</span><h2>Indicadores clave</h2></div></div>
        <section class="nx-metric-strip">${stat('RSI (14)',good(ind.rsi)?fmtNum(ind.rsi,{dec:1}):NA)}${stat('ATR %',good(ind.atrpPct)?fmtPct(ind.atrpPct):NA)}${stat('ADX',good(ind.adx)?fmtNum(ind.adx,{dec:1}):NA)}${stat('Régimen',ind.regime?esc(ind.regime):NA)}</section>
        <details class="nx-detail-vault" ${ctx.mode==='pro'?'open':''}><summary>Indicadores y fuentes · análisis completo <span>+</span></summary><div class="nx-detail-content">${legacy(ctx)}</div></details>`}
  </div>`;
}

export function renderEngineExperience(ctx, legacy){
  const id=ctx.ui?.engineId||'idca';
  const entry=ctx.enginesData?.[id];
  const d=entry?.data||{},st=d.status||{},sum=d.summary||{};
  const notReady=ctx.authenticated===false || !entry || !validState(entry.state);
  const subtab=ctx.ui?.subtab||'panel';
  const tabs=(ctx.subtabs||[]);
  const title=engineNames[id]||id.toUpperCase();
  const subNav=`<div class="nx-engine-subnav" role="navigation" aria-label="Secciones de ${esc(title)}">${tabs.map(t=>`<button data-ui="subtab:${esc(t.id)}" class="${subtab===t.id?'active':''}">${esc(t.label)}</button>`).join('')}</div>`;
  if(notReady){
    return `<div class="nx-experience nx-engine-screen"><div class="nx-engine-intro"><span class="nx-eyebrow">MOTORES / ${esc(title)}</span><h1>${esc(title)}</h1><p>${esc(engineDescriptions[id]||'Estrategia del bot')}</p></div>
      ${ctx.mode==='pro'?subNav:''}
      ${connectNotice('el estado y las operaciones del motor '+title)}
      ${ctx.mode==='pro'?'<div class="nx-feature-preview"><span class="nx-eyebrow">DATOS PROFESIONALES</span><p>La vista Pro conservará posiciones, ciclos, protecciones, scoring, configuración efectiva, alertas, órdenes y el histórico íntegro cuando el backend responda.</p></div>':''}
    </div>`;
  }
  if(subtab!=='panel')return `<div class="nx-experience nx-engine-screen"><div class="nx-engine-intro"><span class="nx-eyebrow">MOTORES / ${esc(title)}</span><h1>${esc(title)}</h1></div>${subNav}<div class="nx-legacy-detail">${ctx.renderEngineSub(id,subtab)}</div></div>`;
  const cycleCount=id==='idca'?sum.activeCyclesCount:id==='grid'?d.cycles?.length:null;
  const pnl=sum.realizedPnlUsd??sum.pnlUsd??d.pnlUsd;
  return `<div class="nx-experience nx-engine-screen">
    <div class="nx-engine-intro"><span class="nx-eyebrow">GESTIÓN DE ESTRATEGIA / ${esc(title)}</span>
      <div class="nx-engine-intro-row"><h1>${esc(title)}</h1>${st.mode?modeBadge(st.mode):'<span class="nx-sys-state nx-offline">Estado no identificado</span>'}</div>
      <p>${esc(engineDescriptions[id]||'')}</p></div>
    ${subNav}
    <section class="nx-engine-hero"><div><span class="nx-eyebrow">ESTADO Y CAPITAL</span>
      <h2>${safeStatus(st.mode)}</h2><p>Información recibida del bot. Cambiar de Básico a Pro nunca altera la ejecución.</p></div>
      <div class="nx-engine-hero-stats">${stat('PnL',signedMoney(pnl))}${stat('Ciclos abiertos',good(cycleCount)?String(cycleCount):NA)}${stat('Último tick',st.lastTickAt?esc(st.lastTickAt):NA)}</div>
    </section>
    <div class="nx-section-title"><div><span class="nx-eyebrow">DETALLE</span><h2>Explorar ${esc(title)}</h2></div></div>
    <div class="nx-quick-grid">${tabs.filter(t=>t.id!=='panel').slice(0,4).map(t=>`<button data-ui="subtab:${esc(t.id)}">${esc(t.label)} <span>↗</span></button>`).join('')}</div>
    <details class="nx-detail-vault" ${ctx.mode==='pro'?'open':''}><summary>${ctx.mode==='pro'?'Diagnóstico completo · vista Pro':'Ver todos los datos y controles'} <span>+</span></summary><div class="nx-detail-content">${ctx.renderEngineSub(id,'panel')}</div></details>
  </div>`;
}

export function renderPortfolioExperience(ctx,legacy){
  const s=ctx.data?.portfolio?.data?.summary||{};
  const missing=unavailable(ctx,'portfolio') || (!good(s.navUsd)&&!good(s.exposureUsd));
  const byAsset=ctx.data?.portfolio?.data?.holdings||[];
  return `<div class="nx-experience nx-portfolio">
    <div class="nx-section-title"><div><span class="nx-eyebrow">PATRIMONIO</span><h2>Mi cartera</h2></div><span class="nx-meta">Kraken · Revolut X</span></div>
    ${missing?`${connectNotice('balances, posiciones y PnL de tu cartera')}<div class="nx-feature-preview"><span class="nx-eyebrow">PRIVACIDAD</span><p>Los balances y resultados no se sustituyen por ceros. Tu cartera aparece cuando se verifica la conexión.</p></div>`:
      `<section class="nx-wealth-hero"><span class="nx-eyebrow">VALOR DE CARTERA</span><div class="nx-wealth-number">${money(s.navUsd)}</div>
        <div class="nx-hero-stats">${stat('PnL realizado',signedMoney(s.realizedPnlUsd))}${stat('PnL no realizado',signedMoney(s.unrealizedPnlUsd))}${stat('Exposición',money(s.exposureUsd))}</div></section>
      <div class="nx-shortcuts">${link('engines','Estrategias','nx-shortcut')}${link('fisco','Fiscalidad / AEAT','nx-shortcut')}</div>
      ${Array.isArray(byAsset)&&byAsset.length?`<div class="nx-section-title"><h2>Distribución de activos</h2></div>
        <div class="nx-asset-list">${byAsset.slice(0,12).map(a=>`<div><b>${esc(a.asset||a.symbol||a.currency||'Activo')}</b><span>${money(a.valueUsd??a.value)}</span></div>`).join('')}</div>`:''}
      <details class="nx-detail-vault" ${ctx.mode==='pro'?'open':''}><summary>Balances y desglose completos <span>+</span></summary><div class="nx-detail-content">${legacy(ctx)}</div></details>`}
  </div>`;
}
