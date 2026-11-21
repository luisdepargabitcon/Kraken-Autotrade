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
test('Ajustes figura en la barra móvil y no exige sesión',()=>{
  assert.match(app,/const BOTTOM_NAV = \[[^\]]*'settings'/);
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
