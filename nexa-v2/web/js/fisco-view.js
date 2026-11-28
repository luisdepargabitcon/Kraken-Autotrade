// NEXA FISCO: reflect only real protected GET responses; never estimate tax due or AEAT amounts.
import {esc,fmtNum,fmtTs} from './util.js';
const n=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
const v=x=>x==null||x===''?'—':esc(String(x));
const eur=x=>n(x)===null?'—':new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(n(x));
const one=(o,...ks)=>{for(const k of ks){const x=o?.[k];if(x!==undefined&&x!==null&&x!=='')return x;}return null;};
const box=(name,value)=>'<div class="nxf-stat"><small>'+esc(name)+'</small><strong>'+value+'</strong></div>';
const empty=txt=>'<div class="nxf-empty">'+esc(txt)+'</div>';
const scopeState=(ctx,k)=>ctx.data?.fisco?.resourceStates?.[k]||'unavailable';
const safeList=(ctx,k,listKey)=>scopeState(ctx,k)==='ok'&&Array.isArray(ctx.data?.fisco?.data?.[k]?.[listKey])?
 ctx.data.fisco.data[k][listKey]:null;
const row=(x,i,path,headline,detail,value)=>'<button type="button" class="nxf-row" data-inspect="common:fisco.'+path+':'+i+'">'+
 '<span><b>'+v(headline)+'</b><small>'+v(detail)+'</small></span><strong>'+value+'</strong><span>›</span></button>';
export function renderFiscalView(ctx){
 if(ctx.viewScope==='shadow')return '<div class="nxf-root"><div class="nxf-intro"><span>SHADOW / SIMULACIÓN</span><h1>Fiscalidad separada</h1>'+
 '<p>Los saldos, operaciones y resultados fiscales REALES están ocultos en este entorno. Shadow no genera declaraciones ni obligaciones fiscales simuladas.</p></div>'+
 empty('Cambia a REAL para consultar FISCO con el permiso independiente fisco:read.')+'</div>';
 if(ctx.data?.fisco?.state==='forbidden')return '<div class="nxf-root"><div class="nxf-intro">'+
 '<span>FISCALIDAD PRIVADA</span><h1>FISCO / AEAT</h1><p>El dispositivo puede estar vinculado, pero no tiene la autorización independiente fisco:read. Reintentar no concede permisos.</p>'+
 '<p>Para activarlo hay que vincular el dispositivo con un código de emisión que incluya el rol fisco:read.</p></div>'+
 empty('Acceso fiscal restringido. No se muestran importes ni datos personales.')+'</div>';
 const a=ctx.data?.fisco?.data||{},state=ctx.data?.fisco?.state||'unavailable';
 const tab=ctx.ui?.fiscoTab||'summary';
 const overview=a.summary||{},years=Array.isArray(overview.years)?overview.years:[];
 const annual=a.annualReport||{},ops=safeList(ctx,'operations','operations'),lots=safeList(ctx,'lots','lots'),
  disposals=safeList(ctx,'disposals','disposals');
 // /fisco/meta y /fisco/control-status son GET reales permitidos por el BFF:
 // se muestran solo los campos que la respuesta trae; el resto queda «—».
 const meta=a.meta||{},control=a.controlStatus||{};
 const metaSync=one(meta,'lastSync','last_sync','syncedAt','updatedAt')??annual.last_sync??null;
 const reportSafe=annual.is_safe_for_report===true;
 const tabs=[['summary','Resumen'],['operations','Operaciones'],['lots','Lotes FIFO'],['disposals','Ventas'],['annual','Informe anual'],['validation','Validación']];
 let html='<div class="nxf-root"><div class="nxf-intro"><span>FISCALIDAD PRIVADA · REAL</span><h1>FISCO / AEAT</h1>'+
 '<p>Datos procedentes del backend autorizado. La app no calcula impuestos de ejemplo ni modifica los registros.</p></div>'+
 '<div class="nxf-sources"><span>Acceso '+v(state)+'</span><span>Última sincronización '+v(metaSync?fmtTs(metaSync):null)+'</span>'+
 '<span>'+ (reportSafe?'Informe con controles favorables':'Validación de informe pendiente o no apta')+'</span></div>'+
 '<nav class="nxf-tabs" aria-label="Secciones fiscales">'+tabs.map(([k,title])=>
 '<button data-ui="fiscoTab:'+k+'" class="'+(k===tab?'on':'')+'" aria-current="'+(k===tab?'page':'false')+'">'+title+'</button>').join('')+'</nav>';
 if(tab==='summary'){
   const current=years[0],count=Number.isInteger(a.operations?.total)?a.operations.total:ops?.length;
   html+='<div class="nxf-kpis">'+
    box('Último ejercicio documentado',v(current?.year??annual.year))+
    box('Ganancias/pérdidas del ejercicio',eur(one(current,'total_gain_loss_eur')))+
    box('Comisiones del ejercicio',eur(one(current,'total_fees_eur')))+
    box('Operaciones consultadas',count==null?'—':String(count))+'</div>'+
    '<section class="nxf-panel"><h2>Ejercicios disponibles</h2>'+
    (years.length?years.map(y=>'<div class="nxf-year"><b>'+v(y.year)+'</b><span>Ganancia/pérdida: '+eur(y.total_gain_loss_eur)+'</span>'+
     '<small>Comisiones: '+eur(y.total_fees_eur)+'</small></div>').join(''):
     empty('La API no ha devuelto un resumen fiscal anual verificable.'))+'</section>'+
    // Procedencia real de /fisco/meta: años cubiertos, exchanges y totales que
    // publica el backend. Cada campo ausente se muestra como «—», nunca estimado.
    '<section class="nxf-panel"><h2>Fuente y sincronización</h2><div class="nxf-kpis">'+
     box('Años con datos',Array.isArray(meta.availableYears)&&meta.availableYears.length?meta.availableYears.join(', '):'—')+
     box('Operaciones totales',n(meta.totalOperations)===null?'—':String(meta.totalOperations))+
     box('Exchanges',Array.isArray(meta.exchanges)&&meta.exchanges.length?meta.exchanges.join(', '):'—')+
     box('Última sincronización',metaSync?fmtTs(metaSync):'—')+'</div>'+
     '<p class="nxf-note">Metadatos devueltos por GET /fisco/meta. Si el endpoint no está disponible, los campos quedan sin dato.</p></section>';
 }else if(tab==='operations'){
   html+='<section class="nxf-panel"><h2>Operaciones registradas</h2>'+
    (ops?ops.slice(0,100).map((o,i)=>row(o,i,'operations.operations',
      [o.asset,o.op_type].filter(Boolean).join(' · '),[o.exchange,o.executed_at?fmtTs(o.executed_at):null].filter(Boolean).join(' · '),eur(o.total_eur))).join('')||
      empty('La lectura comunicó cero operaciones en esta página.'):
    empty('Operaciones no disponibles: '+scopeState(ctx,'operations')+'. No se asume que el historial esté vacío.'))+
    '<p>Listado de la página recibida. No se afirma que incluya todas las operaciones anteriores.</p></section>';
 }else if(tab==='lots'){
   html+='<section class="nxf-panel"><h2>Lotes de adquisición · FIFO</h2>'+
    (lots?lots.slice(0,100).map((o,i)=>row(o,i,'lots.lots',
     [o.asset,o.exchange].filter(Boolean).join(' · '),o.acquired_at?fmtTs(o.acquired_at):null,
     eur(one(o,'cost_eur','cost_basis_eur')))).join('')||empty('La API devolvió cero lotes.'):
     empty('Lotes FIFO no disponibles: '+scopeState(ctx,'lots')))+'</section>';
 }else if(tab==='disposals'){
   html+='<section class="nxf-panel"><h2>Ventas / disposiciones</h2>'+
    '<div class="nxf-kpis">'+box('Resultado FIFO',scopeState(ctx,'disposals')==='ok'?eur(a.disposals.total_gain_loss_eur):'—')+'</div>'+
    (disposals?disposals.slice(0,100).map((o,i)=>row(o,i,'disposals.disposals',
     [o.asset,o.exchange].filter(Boolean).join(' · '),o.disposed_at?fmtTs(o.disposed_at):null,
     eur(o.gain_loss_eur))).join('')||empty('Cero disposiciones en esta lectura.'):
     empty('Las disposiciones fiscales no han sido comunicadas.'))+'</section>';
 }else if(tab==='annual'){
   const section=annual.section_a||{};
   html+='<section class="nxf-panel"><h2>Informe anual · '+v(annual.year)+'</h2>'+
    '<div class="nxf-kpis">'+box('Ganancias',eur(section.ganancias_eur))+
     box('Pérdidas',eur(section.perdidas_eur))+
     box('Resultado anual',eur(section.total_eur??section.total))+
     box('Operaciones pendientes de valoración',v(annual.counters?.pending_valuation))+'</div>'+
    (scopeState(ctx,'annualReport')==='ok'?'<p class="nxf-note">Secciones A/B/C/D, notas de comisiones y validación completas disponibles en la respuesta técnica. No equivale a una declaración presentada.</p>'+
    '<details class="nxf-technical"><summary>Secciones y procedencia completas</summary><pre>'+esc(JSON.stringify({
      section_a:annual.section_a,section_b:annual.section_b,section_c:annual.section_c,section_d:annual.section_d,
      nota_comisiones:annual.nota_comisiones,committed_run:annual.committed_run},null,2))+'</pre></details>':
    empty('Informe anual no accesible: '+scopeState(ctx,'annualReport')))+'</section>';
 }else if(tab==='validation'){
   const fin=a.finalizationStatus||{};
   const blockers=Array.isArray(fin.blockers)?fin.blockers:[], warnings=Array.isArray(fin.warnings)?fin.warnings:[];
   html+='<section class="nxf-panel"><h2>Validación y cierre fiscal</h2>'+
    '<div class="nxf-kpis">'+box('Informe apto',reportSafe?'Sí':'No verificado / no apto')+
    box('Cierre fiscal',fin.report_can_be_finalized===true?'Apto':fin.report_can_be_finalized===false?'Bloqueado':'—')+
    box('Errores críticos',v(annual.critical_errors_count))+
    box('Bloqueos',scopeState(ctx,'finalizationStatus')==='ok'?String(blockers.length):'—')+
    box('Estado de control',scopeState(ctx,'controlStatus')==='ok'?v(one(control,'status','state','control_status')):'—')+
    box('Sync de control',scopeState(ctx,'controlStatus')==='ok'&&one(control,'lastSync','last_sync','syncedAt','updatedAt')?fmtTs(one(control,'lastSync','last_sync','syncedAt','updatedAt')):'—')+'</div>'+
    (scopeState(ctx,'controlStatus')==='ok'&&Object.keys(control).length?
     '<details class="nxf-technical"><summary>Estado de control fiscal completo</summary><pre>'+esc(JSON.stringify(control,null,2))+'</pre></details>':'')+
    [...blockers,...warnings].map(x=>'<div class="nxf-warning"><b>'+v(x.code||x.severity)+'</b><p>'+v(x.detail||x.message)+'</p></div>').join('')+
    '<div class="nxf-provenance">'+Object.entries(ctx.data?.fisco?.resourceStates||{}).map(([k,s])=>
      '<div><b>'+v(k)+'</b><span>'+v(s)+'</span></div>').join('')+'</div>'+
    '<p>Este panel no presenta ni valida una declaración ante AEAT. Revisa las fuentes originales y la conciliación antes de utilizar el informe.</p></section>';
 }
 html+='</div>';return html;
}
