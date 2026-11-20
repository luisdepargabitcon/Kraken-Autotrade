// NEXA V2 — configuración de runtime (sin secretos).
// La URL del backend se resuelve en este orden:
//  1) ?api=<url> en la URL (persistida)
//  2) localStorage 'nexa.apiBase'
//  3) mismo origen '/api' (producto servido junto al backend)
// NUNCA se guardan credenciales, claves de exchange ni tokens aquí.
const qp = new URLSearchParams(location.search);
if(qp.get('api')) localStorage.setItem('nexa.apiBase', qp.get('api'));

export const CONFIG = {
  apiBase: (localStorage.getItem('nexa.apiBase') || '/api').replace(/\/+$/,''),
  // 'api' = producto (siempre). 'test' solo se activa con ?test=1 explícito y es QA interna.
  mode: qp.get('test')==='1' ? 'test' : 'api',
  appVersion: '0.2.0',
  sessionKey: 'nexa.session',
};

export function setApiBase(url){
  localStorage.setItem('nexa.apiBase', url);
  CONFIG.apiBase = String(url||'').replace(/\/+$/,'') || '/api';
}
