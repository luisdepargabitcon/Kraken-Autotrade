// IDCA import-position parity: PREVIEW ONLY until separate authorized action gateway.
// The read-only BFF forbids POST; this module deliberately never sends an HTTP request.
import {esc,fmtUsd} from './util.js';
import {openModal} from './ui.js';
const n=x=>typeof x==='number'&&Number.isFinite(x)?x:typeof x==='string'&&x.trim()!==''&&Number.isFinite(Number(x))?Number(x):null;
const fixed=x=>n(x)===null?'—':fmtUsd(n(x));
const field=id=>'<label for="ip-'+id+'">';
export function makeImportPreview(values,status={}){
 const {pair,exchangeSource,quantity,avgEntryPrice,capitalUsedUsd,sourceType,estimatedFeePct,feesOverrideManual,soloSalida,notes,isManualCycle,warningAcknowledged}=values;
 const q=n(quantity),price=n(avgEntryPrice),capital=n(capitalUsedUsd),feePct=n(estimatedFeePct);
 if(!['BTC/USD','ETH/USD'].includes(pair))return {ok:false,error:'Selecciona BTC/USD o ETH/USD.'};
 if(!['manual','normal_bot','exchange','external'].includes(sourceType))return {ok:false,error:'Origen no reconocido.'};
 if(!(q>0)&&!(q===0))return {ok:false,error:'Cantidad inválida.'};
 if(!(q>0)||!(price>0))return {ok:false,error:'Cantidad y precio medio deben ser positivos.'};
 if(!(capital>0))return {ok:false,error:'El capital invertido debe ser positivo.'};
 if(!(feePct>=0&&feePct<=100))return {ok:false,error:'La comisión porcentual no es válida.'};
 const estimatedFeeUsd=Math.round(capital*feePct)/100;
 const pairStatus=status?.pairs?.[pair]||null;
 const active=pairStatus?.hasActiveCycle===true||pairStatus?.hasActive===true||
   pairStatus?.activeCycle===true||pairStatus?.activeCycleId!=null;
 const verified=status?.pairs&&Object.hasOwn(status.pairs,pair);
 const coexistenceOk=!active||(sourceType==='manual'&&isManualCycle===true&&warningAcknowledged===true);
 return {ok:true,pair,exchangeSource,quantity:q,avgEntryPrice:price,
  capitalUsedUsd:capital,sourceType,estimatedFeePct:feePct,estimatedFeeUsd,feesOverrideManual:!!feesOverrideManual,
  soloSalida:soloSalida!==false,notes:String(notes||'').slice(0,700),isManualCycle:isManualCycle===true,
  warningAcknowledged:warningAcknowledged===true,active,verified,coexistenceOk};
}
const read=(root,k)=>root.querySelector('#ip-'+k);
export function openImportPositionPreview(idca){
 const info=idca?.data||{},status=info.importableStatus||{},feeData=info.feePresets||{};
 const presets=feeData?.presets&&typeof feeData.presets==='object'?feeData.presets:null;
 const opts=presets?Object.entries(presets).map(([key,x])=>'<option value="'+esc(key)+'">'+esc(x.label||key)+'</option>').join(''):
 '<option value="">API de comisiones no disponible</option>';
 const rootHtml='<div class="nx-import-position"><span class="nx-import-kicker">IDCA / POSICIÓN ABIERTA</span>'+
 '<h2>Importar posición existente</h2><p>Esta función crea un nuevo ciclo gestionado por IDCA. '+ 
 '<b>No es una compra</b>, no modifica el historial previo ni reconstruye ejecuciones antiguas.</p>'+
 '<div class="nx-import-fields">'+
 '<label>Activo <select id="ip-pair"><option value="BTC/USD">BTC/USD</option><option value="ETH/USD">ETH/USD</option></select></label>'+
 '<label>Exchange <select id="ip-exchange">'+opts+'</select></label>'+
 '<label>Cantidad real <input id="ip-qty" type="number" min="0.00000001" step="any" inputmode="decimal" placeholder="0.001"></label>'+
 '<label>Precio medio USD <input id="ip-price" type="number" min="0.00000001" step="any" inputmode="decimal" placeholder="Precio original"></label>'+
 '<label>Capital invertido USD <input id="ip-capital" type="number" min="0.01" step="any" inputmode="decimal" placeholder="Cantidad × precio medio"></label>'+
 '<label>Comisión estimada (%) <input id="ip-fee" type="number" min="0" max="100" step="0.0001" inputmode="decimal"></label>'+
 '<label>Origen <select id="ip-source"><option value="manual">Manual</option><option value="normal_bot">Bot normal</option>'+
 '<option value="exchange">Exchange</option><option value="external">Externo</option></select></label>'+
 '<label>Gestión de la posición <select id="ip-solo"><option value="true">Solo salida (recomendado)</option>'+
 '<option value="false">Gestión completa (puede comprar más)</option></select></label>'+
 '</div><label class="nx-import-note">Notas de la importación <textarea id="ip-notes" maxlength="700" rows="2"></textarea></label>'+
 '<label class="nx-import-check"><input id="ip-manual" type="checkbox"> Crear ciclo manual independiente</label>'+
 '<label class="nx-import-check"><input id="ip-warning" type="checkbox"> Confirmo los riesgos de convivencia si ya existe un ciclo activo</label>'+
 '<p id="ip-status" class="nx-import-status">Se consultará el estado de importación por par desde la API. Sin permiso de escritura.</p>'+
 '<button type="button" class="nx-import-preview-button" id="ip-preview">Revisar importación</button>'+
 '<div id="ip-review" aria-live="polite"></div>'+
 '<div class="nx-import-blocked">IMPORTACIÓN REAL BLOQUEADA: la pasarela actual es solo lectura. Nunca se envían datos a /import-position desde esta pantalla.</div></div>';
 const modal=openModal(rootHtml),root=modal.root;
 const updateFee=()=>{
  const selected=read(root,'exchange').value;
  const pct=n(presets?.[selected]?.defaultFeePct);
  if(pct!==null)read(root,'fee').value=String(pct);
 };
 const cost=()=>{
  const q=n(read(root,'qty').value),p=n(read(root,'price').value);
  if(q!==null&&p!==null&&q>0&&p>0)read(root,'capital').value=(q*p).toFixed(2);
 };
 read(root,'exchange').addEventListener('change',updateFee);
 read(root,'qty').addEventListener('input',cost);
 read(root,'price').addEventListener('input',cost);
 if(presets){read(root,'exchange').value=feeData.defaultExchange||Object.keys(presets)[0];updateFee();}
 read(root,'preview').addEventListener('click',()=>{
  const s=makeImportPreview({
   pair:read(root,'pair').value,exchangeSource:read(root,'exchange').value,
   quantity:read(root,'qty').value,avgEntryPrice:read(root,'price').value,
   capitalUsedUsd:read(root,'capital').value,estimatedFeePct:read(root,'fee').value,
   sourceType:read(root,'source').value,soloSalida:read(root,'solo').value==='true',
   notes:read(root,'notes').value,isManualCycle:read(root,'manual').checked,
   warningAcknowledged:read(root,'warning').checked,
   feesOverrideManual:true
  },status);
  const container=read(root,'review');
  if(!s.ok){container.textContent=s.error;container.className='nx-import-error';return;}
  const risk=s.active&&!s.coexistenceOk?
    'Existe un ciclo activo en este par: importación no permitida con estos parámetros.':
    !s.verified?'No se ha verificado el estado de convivencia por API.':
    s.active?'Convivencia advertida y reconocida: requiere autorización real.':'No consta un ciclo activo en la respuesta consultada.';
  container.className='nx-import-review';
  container.innerHTML='<h3>Vista previa · NO se ejecutará</h3>'+
   '<div><b>'+esc(s.pair)+'</b><span>'+esc(s.exchangeSource)+'</span></div>'+
   '<div><span>Cantidad</span><b>'+esc(String(s.quantity))+'</b></div>'+
   '<div><span>Precio medio</span><b>'+fixed(s.avgEntryPrice)+'</b></div>'+
   '<div><span>Capital invertido</span><b>'+fixed(s.capitalUsedUsd)+'</b></div>'+
   '<div><span>Comisiones estimadas</span><b>'+fixed(s.estimatedFeeUsd)+' ('+esc(String(s.estimatedFeePct))+' %)</b></div>'+
   '<div><span>Origen</span><b>'+esc(s.sourceType)+'</b></div>'+
   '<div><span>Gestión IDCA</span><b>'+(s.soloSalida?'Solo salida':'Gestión completa')+'</b></div>'+
   '<p>'+esc(risk)+'</p>'+
   '<p><strong>Sin cambios:</strong> para importar de verdad se requiere una pasarela de escritura expresamente autorizada.</p>';
 });
 return modal;
}
