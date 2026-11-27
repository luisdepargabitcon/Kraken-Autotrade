export type EntryDataHealth={validity:'valid'|'stale'|'invalid'|'unknown';ageMs:number|null;maxAgeMs:number;missing:string[];origin?:string;components?:Record<string,{available:boolean;reason?:string}>};
export function resolveEntryDataGate(h:EntryDataHealth){
 const missing=h.missing.filter(x=>x!=='gaps');
 if(h.validity==='invalid')return{allow:false,code:'market_data_invalid',reason:'datos de mercado inválidos',missing:h.missing};
 if(h.validity==='unknown')return{allow:false,code:'market_data_unavailable',reason:'datos de mercado no disponibles o warm-up insuficiente',missing:h.missing};
 if(h.validity==='stale'||h.ageMs==null||h.ageMs>h.maxAgeMs)return{allow:false,code:'market_data_stale',reason:'datos de mercado obsoletos para entrada',missing:h.missing,ageMs:h.ageMs};
 if(missing.length)return{allow:false,code:'market_data_incomplete',reason:'faltan componentes indispensables de mercado',missing};
 return{allow:true,code:null,reason:'ok',missing:[]};
}
export function resolveExitPriceInput(i:{realtimePrice:number|null;realtimeAgeMs:number|null;fallbackPrice?:number|null;fallbackAgeMs?:number|null;maxRealtimeAgeMs:number;maxFallbackAgeMs:number}){
 const rt=i.realtimePrice!=null&&Number.isFinite(i.realtimePrice)&&i.realtimePrice>0&&i.realtimeAgeMs!=null&&i.realtimeAgeMs<=i.maxRealtimeAgeMs;
 if(rt)return{price:i.realtimePrice,source:'realtime',degraded:false,alert:null};
 const fb=i.fallbackPrice!=null&&Number.isFinite(i.fallbackPrice)&&i.fallbackPrice>0&&i.fallbackAgeMs!=null&&i.fallbackAgeMs<=i.maxFallbackAgeMs;
 if(fb)return{price:i.fallbackPrice,source:'fallback',degraded:true,alert:'exit_price_degraded_fallback'};
 return{price:null,source:'none',degraded:true,alert:'exit_price_unavailable_no_invented_price'};
}
