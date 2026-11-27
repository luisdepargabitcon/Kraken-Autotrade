// Regresión: Ajustes visibles antes de vincular; código de longitud real.
// Pruebas locales sin Internet, sin tokens ni conexión al VPS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const load=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const html=load('../web/index.html');
const app=load('../web/js/app.js');
const conf=load('../web/js/config.js');
const pairing=load('../web/js/pairing.js');
const css=load('../web/css/premium.css');

function makeConfig({native,stored=null}={}){
  const values=new Map(stored?[['nexa.apiBase',stored]]:[]);
  const localStorage={
    getItem:k=>values.get(k)||null,
    setItem:(k,v)=>values.set(k,v),
    removeItem:k=>values.delete(k)
  };
  const program=conf.replace(/export (function|const) /g,'$1 ');
  const mod=new Function('window','location','localStorage','URL','URLSearchParams',
    program+';return {CONFIG,validateApiBase,setApiBase};');
  return {result:mod({Capacitor:{isNativePlatform:()=>!!native}},
      {search:'',protocol:'https:'},localStorage,URL,URLSearchParams),values};
}
test('La ventana de vinculación muestra Ajustes y servidor antes del código',()=>{
  assert.match(html,/id="pair-config-toggle"/);
  assert.match(html,/id="pair-api-base"/);
  assert.match(html,/id="pair-api-save"/);
  assert.match(html,/id="pair-server-current"/);
  assert.match(html,/id="pair-config-form"/);
  assert.match(html,/Ajustes/);
});
test('Código admite 24 caracteres o pegado con separadores',()=>{
  const max=Number(html.match(/id="pair-code"[^>]*maxlength="(\d+)"/)?.[1]);
  assert.ok(max>=24,'No debe truncar código de 24 caracteres');
  assert.ok(app.includes('^[0-9A-F]{24}$'));
  assert.ok(app.includes("replace(/[\\s-]/g") || app.includes("replace(/[\\s-]/g"));
  assert.match(pairing,/timeoutMs:12000/);
});
test('Engranaje Ajustes permanente en cabecera; cinco destinos en pie',()=>{
  assert.match(html,/id="settings-shortcut"/);
  assert.match(html,/id="pair-config-toggle"/);
  // La lista canónica de destinos raíz vive en nav-model.js (ROOT_ITEMS) y la
  // barra inferior la deriva por nivel; Ajustes sigue fuera del pie.
  const navModel=load('../web/js/nav-model.js');
  assert.match(navModel,/ROOT_ITEMS = \[[\s\S]*?'home'[\s\S]*?'market'[\s\S]*?'engines'[\s\S]*?'portfolio'[\s\S]*?'activity'[\s\S]*?\]/);
  assert.doesNotMatch(navModel,/ROOT_ITEMS = \[[^\]]*?'settings'/);
  assert.match(app,/bottomItems\(state\.nav/);
  assert.match(app,/function openPairOverlay/);
  assert.match(app,/function syncPairServer/);
  assert.match(app,/pair-config-form.*addEventListener\('submit'/);
  assert.match(app,/setApiBase\(input\.value\.trim\(\)\)/);
});
test('Android establece NEXA HTTPS por defecto; web usa API mismo origen',()=>{
  const android=makeConfig({native:true}).result;
  const web=makeConfig({native:false}).result;
  assert.equal(android.CONFIG.apiBase,'https://nexa-5-250-184-18.nip.io/api');
  assert.equal(web.CONFIG.apiBase,'/api');
});
test('URLs antiguas http quedan borradas y servidores no HTTPS rechazados',()=>{
  const {result,values}=makeConfig({native:true,stored:'http://5.250.184.18:3020/api'});
  assert.equal(result.CONFIG.apiBase,'https://nexa-5-250-184-18.nip.io/api');
  assert.ok(!values.has('nexa.apiBase'));
  assert.throws(()=>result.validateApiBase('http://5.250.184.18:3020/api'));
  assert.throws(()=>result.validateApiBase('https://nexa-5-250-184-18.nip.io/api/v2'));
  assert.throws(()=>result.validateApiBase('https://usuario:clave@host/api'));
  assert.equal(result.setApiBase('https://nexa-5-250-184-18.nip.io/api'),
    'https://nexa-5-250-184-18.nip.io/api');
});

test('Vinculación mínima: un campo visible, nombre automático y pegar código',()=>{
  const overlay=html.slice(html.indexOf('id="pair-overlay"'),html.indexOf('id="modal-root"'));
  assert.match(overlay,/<h2>Conectar mi bot<\/h2>/);
  assert.match(overlay,/id="pair-code"/);
  assert.match(overlay,/id="pair-paste-btn"/);
  assert.match(overlay,/id="pair-label" type="hidden"/);
  assert.match(overlay,/id="pair-config-form"[^>]*hidden/);
  assert.match(overlay,/id="pair-btn">Conectar<\/button>/);
  assert.match(overlay,/id="pair-skip">Ahora no<\/button>/);
  assert.doesNotMatch(overlay,/Introduce el código de un solo uso generado por el administrador/);
});
test('Error 403 en lenguaje claro, nunca texto crudo API',()=>{
  assert.ok(app.includes('El código no es válido o ha caducado. Pide uno nuevo a Cascade.'));
  assert.ok(app.includes('No se puede conectar. Comprueba el servidor en ⚙ Ajustes.'));
  assert.ok(app.includes("navigator.clipboard.readText()"));
  assert.ok(app.includes('Comprobando código…'));
  assert.doesNotMatch(app,/Vinculación rechazada \(\$\{r\.status/);
});

test('Cabecera 360 px evita solapar Básico/Pro, mantiene selector de motor accesible',()=>{
  assert.match(html,/id="engine-btn"[^>]*aria-label="Cambiar motor"/);
  assert.match(app,/setAttribute\('aria-label','Cambiar motor\. Actual: '/);
  assert.match(css,/#engine-btn,#app\[data-screen="engines"\] #engine-btn/);
  assert.match(css,/Evitar que añadir el engranaje recorte Básico\/Pro/);
  assert.match(css,/\.nx-header-settings/);
});
