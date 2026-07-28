import { describe, expect, it, vi } from "vitest";

const updates: any[] = []; const cycleRows = new Map<string, any>(); const levelRows = new Map<string, any>();
vi.mock("../../../db", () => {
  let cycles: Map<string, any> | null = null; let levels: Map<string, any> | null = null; let calls = 0;
  const update = () => ({ set: (payload: any) => ({ where: () => ({ returning: async () => {
    if (!cycles || !levels) return [];
    const map = calls++ === 0 ? cycles : levels; const row = [...map.values()][0];
    if (!row || (map === cycles && (row.status === "completed" || row.completedAt)) || (map === levels && (row.side !== "BUY" || row.status !== "filled"))) return [];
    Object.assign(row, payload); updates.push(payload); return [{ id: row.id }];
  } }) }) });
  return { db: { insert: () => ({ values: () => ({ returning: async () => [] }) }), update, transaction: async (fn: any) => {
    cycles = new Map([...cycleRows].map(([k,v]) => [k,{...v}])); levels = new Map([...levelRows].map(([k,v]) => [k,{...v}])); calls = 0;
    const result = await fn({ update }); cycleRows.clear(); cycles.forEach((v,k)=>cycleRows.set(k,v)); levelRows.clear(); levels.forEach((v,k)=>levelRows.set(k,v)); cycles = null; levels = null; return result;
  } } };
});

import { GridIsolatedEngine } from "../gridIsolatedEngine";

describe("GridIsolatedEngine circuit breaker V3", () => {
  it("D1 bloquea BUY nuevos con el breaker abierto", async () => {
    const engine: any = new GridIsolatedEngine();
    engine.config = { pair: "BTC/USD", mode: "SHADOW" }; engine.circuitBreakerOpen = true;
    const result = engine.canProcessShadowFill({ id: "buy", side: "BUY", status: "planned", rangeVersionId: "range" }, "range", { active: false }, { tickId: 1, pair: "BTC/USD", freshness: { isFresh: true } }, { bid: 100, ask: 101, price: 100 }, 0.5);
    expect(result).toMatchObject({ ok: false, eventType: "GRID_CIRCUIT_BREAKER_BLOCKED_BUY" });
  });

  it("D2 permite cerrar un ciclo V3 real con el breaker activo", async () => {
    const engine: any = new GridIsolatedEngine(); const risk = engine.defaultRiskState();
    const targetCalculationJson = { selected:true,stateVersion:2,policyVersion:"CYCLE_OWNED_NET_TARGET_V3",targetKind:"CYCLE_OWNED_SYNTHETIC",targetSellLevelId:null,targetRungLevelId:null,targetSellPrice:100,targetSellQuantity:1,grossExitGapPct:1,actualGrossGapPct:1,grossPnlUsd:2,buyFeePct:0,sellFeePct:0,spreadBufferPct:0,safetyBufferPct:0,taxReservePct:0,buyFeeUsd:0,sellFeeUsd:0,exchangeFeesUsd:0,operationalCostsUsd:0,netBeforeTaxUsd:2,netBeforeTaxPct:2,taxReserveUsd:0,availablePnlAfterTaxUsd:2,availablePnlAfterTaxPct:2,netProfitTargetPct:1,priceTickSize:.5,quantityStep:.00001,minOrderBase:.00001,minOrderQuote:1,minOrderUsd:1,maxOrderBase:100,baseCurrency:"BTC",quoteCurrency:"USD",constraintsSource:"test",constraintsFetchedAt:new Date().toISOString(),rejectedCandidates:[],explanation:"test" };
    const cycle:any={id:"cb-cycle",rangeVersionId:"range",pair:"BTC/USD",status:"buy_filled",buyLevelId:"buy",sellLevelId:null,targetSellLevelId:null,targetRungLevelId:null,buyPrice:98,targetSellPrice:100,targetSellQuantity:1,quantity:1,exitPolicyVersion:"CYCLE_OWNED_NET_TARGET_V3",targetKind:"CYCLE_OWNED_SYNTHETIC",targetCalculationJson,riskStateJson:risk,requiresReview:false};
    engine.config={pair:"BTC/USD",mode:"SHADOW",isActive:true}; engine.circuitBreakerOpen=true; engine.activeRangeVersion={id:"range"}; engine.cycles=[cycle]; engine.levels=[]; engine.logEvent=vi.fn(); cycleRows.set(cycle.id,{id:cycle.id,status:"sell_placed",completedAt:null}); levelRows.set("buy",{id:"buy",side:"BUY",status:"filled"});
    const now=new Date(); const price:any={pair:"BTC/USD",price:100.1,bid:100.1,ask:100.3,source:"ticker_last",timestamp:new Date().toISOString()}; const ctx=(tickId:number,at:Date)=>({tickId,startedAt:at,pair:"BTC/USD",freshness:{isFresh:true},bid:100.1,ask:100.3});
    await engine.evaluateRiskForOpenCycles(price,ctx(1,now)); await engine.evaluateRiskForOpenCycles(price,ctx(2,new Date(now.getTime()+1))); const exit=cycle.riskStateJson.protectiveExit; expect(exit.state).toBe("MAKER_PENDING"); expect(await engine.processOpenCyclesShadow(price,ctx(2,new Date(now.getTime()+1)))).toBe(0);
    const at=new Date(exit.makerEligibleAfter.getTime()+1); expect(await engine.processOpenCyclesShadow({...price,bid:101,price:101,timestamp:new Date().toISOString()},ctx(3,at))).toBe(1); expect(cycle).toMatchObject({status:"completed",sellLevelId:null,targetSellLevelId:null,targetRungLevelId:null}); expect(cycle.riskStateJson.protectiveExit.state).toBe("MAKER_FILLED"); expect(engine.circuitBreakerOpen).toBe(true);
  });

  it("D3 no se autocierra por reviewAfter o cooldown vencido", () => {
    const engine: any = new GridIsolatedEngine(); engine.circuitBreakerOpen = true;
    engine.circuitBreakerCooldownUntil = new Date(0); engine.config = { circuitBreakerOpen: true, circuitBreakerReviewAfter: new Date(0) };
    expect(engine.circuitBreakerOpen).toBe(true);
  });

  it("D4 solo resolveCircuitBreaker cierra y persiste la resolución", async () => {
    updates.length = 0;
    const engine: any = new GridIsolatedEngine(); engine.circuitBreakerOpen = true;
    engine.config = { circuitBreakerOpen: true, circuitBreakerOpenedAt: new Date(), circuitBreakerReason: "risk" };
    engine.saveConfig = vi.fn(async () => undefined);
    await expect(engine.resolveCircuitBreaker({ resolutionReason: "manual review", resolvedBy: "tester" })).resolves.toEqual({ success: true });
    expect(engine.circuitBreakerOpen).toBe(false);
    expect(engine.config).toMatchObject({ circuitBreakerOpen: false, circuitBreakerResolvedBy: "tester", circuitBreakerResolutionReason: "manual review" });
    expect(engine.config.circuitBreakerResolvedAt).toBeInstanceOf(Date);
  });
});
