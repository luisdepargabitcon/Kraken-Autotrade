import { describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import { requireAdminForRealGridMode } from "../gridModeAuthGuard";

async function listen(app: express.Express): Promise<{server:Server;base:string}> {
  const server = await new Promise<Server>(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  return {server,base:`http://127.0.0.1:${(server.address() as any).port}`};
}

describe("grid mode admin guard", () => {
  it("allows non-real modes for grid operators and requires admin for real or invalid modes", async () => {
    const app = express();
    app.use(express.json());
    app.use((req,_res,next)=>{ (req as any).authV2={roles:JSON.parse(String(req.headers["x-test-roles"]||"[]"))}; next(); });
    app.post("/api/grid-isolated/mode", requireAdminForRealGridMode, (_req,res)=>res.json({ok:true}));
    const {server,base}=await listen(app);
    try {
      const call=(roles:string[],body:any)=>fetch(base+"/api/grid-isolated/mode",{method:"POST",headers:{"content-type":"application/json","x-test-roles":JSON.stringify(roles)},body:JSON.stringify(body)});
      const operator=["grid:control"];
      expect((await call(operator,{mode:"SHADOW"})).status).toBe(200);
      expect((await call(operator,{mode:"OFF"})).status).toBe(200);
      expect((await call(operator,{mode:"REAL_LIMITED"})).status).toBe(403);
      expect((await call(operator,{mode:"REAL_FULL"})).status).toBe(403);
      expect((await call(operator,{mode:"bogus"})).status).toBe(403);
      expect((await call(operator,{})).status).toBe(403);
      expect((await call(["admin"],{mode:"REAL_LIMITED"})).status).toBe(200);
      expect((await call(["admin"],{mode:"bogus"})).status).toBe(200); // el guard de modo propio del motor sigue validando el valor
    } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
  });
});
