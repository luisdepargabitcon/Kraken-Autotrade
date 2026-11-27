import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import type { Server } from "http";
import { AuthV2Service, InMemoryAuthV2Store } from "../../../../server/services/authV2/authV2Service";
import { createAuthV2Enforcement } from "../../../../server/services/authV2/authV2Enforcement";
import { AUTHV2_ROUTE_POLICY } from "../../../../server/services/authV2/authV2Policy";
import { registerAuthV2Routes } from "../../../../server/routes/authV2.routes";
import { configureAuthV2, pairAuthV2Device, obtainAuthV2Session, getAuthV2Session, type AuthV2KeyStorage } from "../authV2";
import { apiRequest } from "../queryClient";

class MemoryStorage {
  private data = new Map<string,string>();
  getItem(k:string){ return this.data.get(k) ?? null; }
  setItem(k:string,v:string){ this.data.set(k,String(v)); }
  removeItem(k:string){ this.data.delete(k); }
  clear(){ this.data.clear(); }
}
function memoryKeys(): AuthV2KeyStorage {
  const data = new Map<string,CryptoKey>();
  return { async get(k){ return data.get(k); }, async set(k,v){ data.set(k,v); }, async delete(k){ data.delete(k); } };
}
async function listen(app: Express): Promise<{ server: Server; base: string }> {
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0,"127.0.0.1",()=>resolve(s)); });
  return { server, base:`http://127.0.0.1:${(server.address() as any).port}` };
}
async function close(server: Server){ await new Promise<void>(resolve=>server.close(()=>resolve())); }

function idbRequest<T>(fn:()=>T): any {
  const r:any={};
  queueMicrotask(()=>{ try{ r.result=fn(); r.onsuccess?.(); }catch(e){ r.error=e; r.onerror?.(); } });
  return r;
}
function memoryIndexedDB(){
  const dbs=new Map<string,Map<string,Map<string,unknown>>>();
  return { open(name:string){
    const r:any={};
    queueMicrotask(()=>{
      if(!dbs.has(name)){
        const stores=new Map<string,Map<string,unknown>>();
        r.result={ createObjectStore:(n:string)=>void stores.set(n,new Map()), transaction:(n:string)=>({objectStore:()=>({
          get:(k:string)=>idbRequest(()=>stores.get(n)?.get(k)),
          put:(v:unknown,k:string)=>idbRequest(()=>{stores.get(n)?.set(k,v);return true;}),
          delete:(k:string)=>idbRequest(()=>{stores.get(n)?.delete(k);return true;}),
        })}) };
        r.onupgradeneeded?.();
        dbs.set(name,stores);
      }
      const stores=dbs.get(name)!;
      r.result={ transaction:(n:string)=>({objectStore:()=>({
        get:(k:string)=>idbRequest(()=>stores.get(n)?.get(k)),
        put:(v:unknown,k:string)=>idbRequest(()=>{stores.get(n)?.set(k,v);return true;}),
        delete:(k:string)=>idbRequest(()=>{stores.get(n)?.delete(k);return true;}),
      })}) };
      r.onsuccess?.();
    });
    return r;
  }};
}

describe("cliente web authV2", () => {
  let server: Server;
  let base: string;
  let service: AuthV2Service;
  let probeGets = 0;
  let probePosts = 0;

  beforeAll(async () => {
    service = new AuthV2Service(new InMemoryAuthV2Store());
    // Dispositivo admin preexistente: los códigos emitidos conservan roles acotados.
    await service.store.saveDevice({ deviceId:"owner-admin", publicKeySpkiB64:"x", roles:["admin"], pairedAt:Date.now(), revokedAt:null });
    const app = express();
    app.use(express.json());
    app.use(createAuthV2Enforcement({ service, policy: [
      { path:"/api/probe/web", permission:"read" },
      { path:"/api/probe/control", permission:"idca:control" },
      ...AUTHV2_ROUTE_POLICY,
    ] }));
    registerAuthV2Routes(app, service);
    app.get("/api/probe/web", (_req,res)=>{ probeGets++; res.json({ok:true,probeGets}); });
    app.post("/api/probe/control", (_req,res)=>{ probePosts++; res.json({ok:true,probePosts}); });
    ({ server, base } = await listen(app));
    Object.assign(globalThis, {
      window: new EventTarget(),
      location: { protocol: "https:", search: "" },
      indexedDB: memoryIndexedDB(),
      localStorage: new MemoryStorage(),
      sessionStorage: new MemoryStorage(),
      btoa: (s:string)=>Buffer.from(s,"binary").toString("base64"),
    });
  });
  afterAll(async () => { await close(server); });
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear();
    configureAuthV2({ keyStorage: memoryKeys(), apiBase: base + "/api" });
  });

  async function pairAndLogin(roles:string[]) {
    const { code } = await service.issuePairingCode(roles);
    const paired = await pairAuthV2Device(code);
    expect(paired.ok).toBe(true);
    const session = await obtainAuthV2Session();
    expect(session?.token).toMatch(/^[a-f0-9]{64}$/);
    expect(session?.roles).toEqual(roles);
    return session!;
  }

  it("empareja con clave ECDSA, firma challenge verificable y apiRequest envía bearer/csrf", async () => {
    await pairAndLogin(["read","idca:control"]);
    expect(getAuthV2Session()?.csrf).toBeTruthy();
    expect((await apiRequest("GET", base + "/api/probe/web")).status).toBe(200);
    expect((await apiRequest("POST", base + "/api/probe/control", {})).status).toBe(200);
    expect(probeGets).toBe(1);
    expect(probePosts).toBe(1);
  });

  it("renueva silenciosamente una sesión caducada conservando la identidad del dispositivo", async () => {
    const first = await pairAndLogin(["read","idca:control"]);
    sessionStorage.setItem("nexa.authv2.session", JSON.stringify({ ...first, expiresAt: Date.now() - 1 }));
    const res = await apiRequest("GET", base + "/api/probe/web");
    expect(res.status).toBe(200);
    expect(getAuthV2Session()?.token).toBeTruthy();
    expect(getAuthV2Session()?.token).not.toBe(first.token);
  });

  it("401 limpia sesión y 403 devuelve error de permiso claro", async () => {
    const session = await pairAndLogin(["read","idca:control"]);
    await service.revokeToken(session.token);
    await expect(apiRequest("GET", base + "/api/probe/web")).rejects.toThrow(/401: Sesión caducada/);
    expect(getAuthV2Session()).toBeNull();

    localStorage.setItem("nexa.authv2.deviceId", crypto.randomUUID());
    configureAuthV2({ keyStorage: memoryKeys(), apiBase: base + "/api" });
    await pairAndLogin(["read"]);
    await expect(apiRequest("POST", base + "/api/probe/control", {})).rejects.toThrow(/403: Permiso insuficiente/);
  });

  it("coexiste con el cliente NEXA usando dos dispositivos y sesiones distintas", async () => {
    const webSession = await pairAndLogin(["read","idca:control"]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input:any, init?:any) => {
      let url = String(input);
      if (url.startsWith("https://nexa-coex.test/")) url = base + url.slice("https://nexa-coex.test".length);
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const { setApiBase } = await import("../../../../nexa-v2/web/js/config.js");
      const { redeemPairCode, obtainSession } = await import("../../../../nexa-v2/web/js/pairing.js");
      const { session: nexaSession, apiFetch } = await import("../../../../nexa-v2/web/js/auth.js");
      setApiBase("https://nexa-coex.test/api");
      const { code } = await service.issuePairingCode(["read"]);
      expect((await redeemPairCode(code, "nexa-coex")).ok).toBe(true);
      const nexa = await obtainSession();
      expect(nexa.ok).toBe(true);
      nexaSession.set(nexa);

      expect(nexa.token).not.toBe(webSession.token);
      expect(localStorage.getItem("nexa.deviceId")).toBeTruthy();
      expect(localStorage.getItem("nexa.authv2.deviceId")).toBeTruthy();
      expect(localStorage.getItem("nexa.deviceId")).not.toBe(localStorage.getItem("nexa.authv2.deviceId"));

      expect((await apiRequest("GET", base + "/api/probe/web")).status).toBe(200);
      const nexaRead = await apiFetch("/probe/web");
      expect(nexaRead.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
