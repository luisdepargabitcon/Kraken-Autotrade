// NEXA — URL de una pasarela HTTPS autorizada, nunca HTTP ni rutas directas del bot.
const qp = new URLSearchParams(location.search);
const native = !!window.Capacitor?.isNativePlatform?.();
export function validateApiBase(input){
  const value=String(input||'').trim().replace(/\/+$/,'');
  if(value==='/api' && !native && location.protocol==='https:')return value;
  let u;
  try{u=new URL(value);}catch{throw new Error('Introduce una dirección completa https://servidor/api');}
  if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash || u.pathname!=='/api'){
    throw new Error('La conexión debe ser HTTPS y terminar exactamente en /api');
  }
  return u.href.replace(/\/+$/,'');
}
let initial='/api';
try{
  const saved=localStorage.getItem('nexa.apiBase');
  if(saved)initial=validateApiBase(saved);
}catch{
  localStorage.removeItem('nexa.apiBase'); // Purge insecure URLs saved by older APKs.
}
if(qp.has('api')){
  try{
    initial=validateApiBase(qp.get('api'));
    localStorage.setItem('nexa.apiBase',initial);
  }catch{
    // Never persist an insecure unvalidated URL from a link.
  }
}
export const CONFIG={
  apiBase:initial,
  mode:qp.get('test')==='1'?'test':'api',
  appVersion:'0.4.0',
  sessionKey:'nexa.session'
};
export function setApiBase(url){
  const value=validateApiBase(url);
  localStorage.setItem('nexa.apiBase',value);
  CONFIG.apiBase=value;
  return value;
}
