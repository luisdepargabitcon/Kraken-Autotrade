import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import {
  buildCanonicalSeedPlan,
  type SeedTranchePlanInput,
} from "../server/services/ama/amaDeterministicEngine";
import {
  makeAdaptiveDecision,
  replanTranches,
  createCooldownState,
  applyCooldown,
  createPeriodLimitState,
  applyTrancheToPeriod,
  type CooldownState,
  type PeriodLimitState,
  type ExecutedTrancheEvidence,
} from "../server/services/ama/amaAdaptivePlanner";
import {
  bootstrapHWM,
  processIncrementalClose,
  freezeHWM,
  computeATR,
  computeDropPct,
  type HighWaterMark,
  type Candle as AmaCandle,
} from "../server/services/ama/amaHwmBar";
import {
  determineExitPhase,
  createExitStrategy,
  shouldTriggerTrailingStop,
  computeDistributionSize,
} from "../server/services/ama/amaProtectionExits";
import { BTC_SEED_POLICY, BTC_SEED_TRANCHES } from "../server/services/ama/amaSeedTypes";
import type { AmaResolvedParameters, AmaCycle, AmaTranchePlan } from "../server/services/ama/amaTypes";

/**
 * AMA Quantitative Audit V2 — research-only, no DB and no real execution.
 *
 * V2 correction versus the initial research harness:
 * after the first executed tranche, all subsequent plans come from the canonical
 * replanTranches() pipeline using persisted-style ExecutedTrancheEvidence.
 * This prevents double-counting already executed capital during daily replanning.
 */

const OUT_DIR = "artifacts/ama-quant-audit-v2";
const DATA_URL = "https://raw.githubusercontent.com/riba2534/bitcoin-cycle-analysis/main/data/btcusdt_1d.csv";
const KRAKEN_URL = "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440";
const CAPITAL = 10_000;
const WARMUP = 200;
const MIN_WARMUP = 90;
const FEES = [0, 10, 25];
const REVERSAL = BTC_SEED_POLICY.fixedReversalCenterPct;
const CONFIRMATIONS = BTC_SEED_POLICY.requiredDailyCloses;

type FillTiming = "SAME_CLOSE" | "NEXT_OPEN";
type Variant = "ENTRY_CANONICAL_HOLD" | "DEFINED_EXIT_RUNNER_HOLD" | "EXPERIMENTAL_RUNNER_TRAIL";

interface Candle { date:string; timestamp:string; open:number; high:number; low:number; close:number; volume:number; source:string }
interface Trade { date:string; side:"BUY"|"SELL"; reason:string; price:number; grossUsd:number; feeUsd:number; quantity:number; trancheIndex?:number; hwm?:number; dropPct?:number }
interface Point { date:string; equity:number; cash:number; btc:number; close:number; costBasisUsd:number; hwm:number|null; hwmState:string|null }
interface Metrics {
  startDate:string; endDate:string; days:number; startingEquity:number; endingEquity:number; totalReturnPct:number;
  cagrPct:number|null; maxDrawdownPct:number; annualizedVolPct:number|null; sharpe:number|null; sortino:number|null;
  calmar:number|null; buys:number; sells:number; turnoverUsd:number; feesUsd:number; maxCapitalDeployedUsd:number;
  maxExposurePct:number; timeInvestedPct:number; finalBtc:number; weightedAvgBuyPrice:number|null;
}
interface Run { variant:Variant; fillTiming:FillTiming; feeBps:number; period:string; source:string; metrics:Metrics; trades:Trade[]; notes:string[]; deterministicHash:string }
interface Period { name:string; start:string; end:string }
interface PendingBuy { trancheId:string; trancheIndex:number; amountUsd:number; policyId:string; hwm:number; dropPct:number; decisionDate:string }

const PERIODS: Period[] = [
  {name:"FULL_AVAILABLE",start:"2018-03-05",end:"2026-02-01"},
  {name:"2018_BEAR",start:"2017-12-17",end:"2018-12-15"},
  {name:"COVID_2020",start:"2020-02-14",end:"2020-04-30"},
  {name:"2021_MID_CORRECTION",start:"2021-04-14",end:"2021-07-20"},
  {name:"2021_2022_BEAR",start:"2021-11-10",end:"2022-11-21"},
  {name:"2022_2025_EXPANSION",start:"2022-11-21",end:"2025-12-31"},
];

function params(): AmaResolvedParameters {
  return {
    mandatoryReservePct:25,maxSingleTranchePct:15,maxCycleDeploymentPct:75,maxWeeklyDeploymentPct:30,
    maxMonthlyDeploymentPct:60,minimumSpacingPct:5,spacingAtrMultiplier:3,minimumDataCoveragePct:90,
    requiredConfirmationStrength:3,cooldownPolicy:"1_daily",maximumCandidateTranches:6,absoluteSafetyCap:CAPITAL,
    absoluteCapitalCapUsd:CAPITAL,absoluteTrancheCountCap:6,spreadTolerancePct:0.5,crossVenueBasisTolerancePct:1,
    profitRecoveryPolicy:"trailing",deRiskPolicy:"gradual",runnerPolicy:"50_pct",trailingPolicy:"atr_based",
    thesisInvalidationPolicy:"strict",asset:"BTC",
  };
}
function n(v:unknown){const x=Number(v);if(!Number.isFinite(x))throw new Error(`bad number ${v}`);return x}
async function text(url:string){const r=await fetch(url,{headers:{"user-agent":"ama-quant-audit-v2"}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.text()}
async function loadMain():Promise<Candle[]>{
  const lines=(await text(DATA_URL)).trim().split(/\r?\n/);lines.shift();
  return lines.map(line=>{const p=line.split(",");return {date:p[0],timestamp:`${p[0]}T23:59:59.000Z`,open:n(p[1]),high:n(p[2]),low:n(p[3]),close:n(p[4]),volume:n(p[5]),source:"BINANCE_BTCUSDT_RESEARCH_MIRROR"}}).sort((a,b)=>a.date.localeCompare(b.date));
}
async function loadKraken():Promise<Candle[]>{
  const j=JSON.parse(await text(KRAKEN_URL)); if(j.error?.length) throw new Error(j.error.join(","));
  const key=Object.keys(j.result).find(k=>k!=="last"); if(!key)throw new Error("no Kraken key"); const today=new Date().toISOString().slice(0,10);
  return (j.result[key] as unknown[][]).map(r=>{const d=new Date(n(r[0])*1000).toISOString().slice(0,10);return {date:d,timestamp:`${d}T23:59:59.000Z`,open:n(r[1]),high:n(r[2]),low:n(r[3]),close:n(r[4]),volume:n(r[6]),source:"KRAKEN_XBTUSD_PUBLIC_OHLC"}}).filter(c=>c.date<today).sort((a,b)=>a.date.localeCompare(b.date));
}
const dc=(c:Candle)=>({timestamp:c.timestamp,close:c.close,isClosed:true as const});
const ac=(xs:Candle[]):AmaCandle[]=>xs.map(c=>({timestamp:c.timestamp,open:c.open,high:c.high,low:c.low,close:c.close}));

function periodSlice(all:Candle[],p:Period){
  const s=all.findIndex(c=>c.date>=p.start); if(s<0)throw new Error(`${p.name} start missing`); let e=-1;for(let i=all.length-1;i>=0;i--){if(all[i].date<=p.end){e=i;break}}
  if(e<s)throw new Error(`${p.name} end missing`); const warm=all.slice(Math.max(0,s-WARMUP),s); if(warm.length<MIN_WARMUP)throw new Error(`${p.name} warmup ${warm.length}`);
  return {warm,test:all.slice(s,e+1),warmupShort:warm.length<WARMUP};
}
function normalizePeriodState(dec:ReturnType<typeof makeAdaptiveDecision>, prior:PeriodLimitState):PeriodLimitState{return {weekStart:dec.effectiveWeekStart??prior.weekStart,monthStart:dec.effectiveMonthStart??prior.monthStart,weeklyDeployedUsd:dec.effectiveWeeklyDeployedUsd??prior.weeklyDeployedUsd,monthlyDeployedUsd:dec.effectiveMonthlyDeployedUsd??prior.monthlyDeployedUsd}}
function mdd(es:number[]){let peak=es[0]??0,w=0;for(const e of es){peak=Math.max(peak,e);if(peak>0)w=Math.min(w,e/peak-1)}return Math.abs(w)*100}
function sd(a:number[]){if(a.length<2)return null;const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1))}
function metrics(points:Point[],trades:Trade[]):Metrics{
  const eq=points.map(x=>x.equity),rets=eq.slice(1).map((e,i)=>e/eq[i]-1),start=eq[0],end=eq.at(-1)!;const years=Math.max(1/365.25,points.length/365.25),cagr=start>0&&end>0?(end/start)**(1/years)-1:null;
  const s=sd(rets),mean=rets.length?rets.reduce((a,b)=>a+b,0)/rets.length:0,down=sd(rets.filter(x=>x<0)),dd=mdd(eq);const buys=trades.filter(t=>t.side==="BUY"),sells=trades.filter(t=>t.side==="SELL"),bq=buys.reduce((a,t)=>a+t.quantity,0),bg=buys.reduce((a,t)=>a+t.grossUsd,0);
  return {startDate:points[0].date,endDate:points.at(-1)!.date,days:points.length,startingEquity:start,endingEquity:end,totalReturnPct:(end/start-1)*100,cagrPct:cagr===null?null:cagr*100,maxDrawdownPct:dd,annualizedVolPct:s===null?null:s*Math.sqrt(365)*100,sharpe:s&&s>0?mean/s*Math.sqrt(365):null,sortino:down&&down>0?mean/down*Math.sqrt(365):null,calmar:cagr!==null&&dd>0?cagr*100/dd:null,buys:buys.length,sells:sells.length,turnoverUsd:trades.reduce((a,t)=>a+t.grossUsd,0),feesUsd:trades.reduce((a,t)=>a+t.feeUsd,0),maxCapitalDeployedUsd:Math.max(0,...points.map(x=>x.costBasisUsd)),maxExposurePct:Math.max(0,...points.map(x=>x.equity>0?x.btc*x.close/x.equity*100:0)),timeInvestedPct:points.filter(x=>x.btc>1e-12).length/points.length*100,finalBtc:points.at(-1)!.btc,weightedAvgBuyPrice:bq>0?bg/bq:null};
}
function hash(o:unknown){return createHash("sha256").update(JSON.stringify(o)).digest("hex")}
function benchmark(cs:Candle[],pct:number,feeBps:number){const f=feeBps/1e4,g=CAPITAL*pct,fee=g*f,qty=(g-fee)/cs[0].close,cash=CAPITAL-g;const pts=cs.map(c=>({date:c.date,equity:cash+qty*c.close,cash,btc:qty,close:c.close,costBasisUsd:g,hwm:null,hwmState:null}));const tr:Trade[]=[{date:cs[0].date,side:"BUY",reason:`BH_${pct}`,price:cs[0].close,grossUsd:g,feeUsd:fee,quantity:qty}];return metrics(pts,tr)}

function makeCycle(id:string,hwm:HighWaterMark,basis:number,btc:number,low:number|null,close:number):AmaCycle{return {cycleId:id,asset:"BTC",pair:"BTC/USD",mode:"REPLAY",state:btc>0?"POSITION_OPEN":"ACCUMULATING",highWaterMark:hwm.price,ceilingConfirmedAt:hwm.confirmedAt,cycleLow:low,cycleLowAt:null,maxDropPct:low?computeDropPct(hwm.price,low):null,currentDropPct:computeDropPct(hwm.price,close),reboundFromLowPct:low?((close-low)/low)*100:null,budgetUsd:CAPITAL,deployedUsd:basis,reservedUsd:0,freeUsd:Math.max(0,CAPITAL-basis),accumulatedQuantity:btc,averageCostBasis:btc>0?basis/btc:null,activePolicyId:BTC_SEED_POLICY.policyId,createdAt:hwm.timestamp,closedAt:null}}

function simulate(warm:Candle[],cs:Candle[],variant:Variant,timing:FillTiming,feeBps:number,period:string):Run{
  const P=params(),fee=feeBps/1e4;let hwm=bootstrapHWM(warm.map(dc),CONFIRMATIONS,REVERSAL);if(!hwm)throw new Error(`${period}: no HWM`);
  let cash=CAPITAL,btc=0,basis=0,low:number|null=null,highest:number|null=null,partial=false,entriesClosed=false,pending:PendingBuy|null=null;
  let cycleNo=1,cycleId=`q-${period}-${cycleNo}`;let cooldown:CooldownState=createCooldownState(P.cooldownPolicy),ps:PeriodLimitState=createPeriodLimitState(cs[0].timestamp);
  let basePlan:AmaTranchePlan|null=null;let baseSeed:SeedTranchePlanInput|null=null;let evidence:ExecutedTrancheEvidence[]=[];const trades:Trade[]=[],pts:Point[]=[],seen=[...warm];
  const reset=(c:Candle)=>{cycleNo++;cycleId=`q-${period}-${cycleNo}`;hwm={hwmId:`hwm-${c.timestamp}`,price:c.close,timestamp:c.timestamp,status:"CANDIDATE",confirmedAt:null,supersededBy:null};basePlan=null;baseSeed=null;evidence=[];low=null;highest=null;partial=false;entriesClosed=false;pending=null};
  const buy=(c:Candle,p:PendingBuy,price:number)=>{const gross=Math.min(p.amountUsd,cash);if(gross<=0)return;const fu=gross*fee,qty=(gross-fu)/price;cash-=gross;btc+=qty;basis+=gross;low=low===null?c.close:Math.min(low,c.close);highest=highest===null?c.close:Math.max(highest,c.close);trades.push({date:c.date,side:"BUY",reason:`CANONICAL_TRANCHE_${p.trancheIndex}`,price,grossUsd:gross,feeUsd:fu,quantity:qty,trancheIndex:p.trancheIndex,hwm:p.hwm,dropPct:p.dropPct});evidence.push({cycleId,asset:"BTC",policyId:p.policyId,policyVersion:1,trancheId:p.trancheId,seedTrancheIndex:p.trancheIndex,executedAmountUsd:gross,executedQuantity:qty,executedAt:c.timestamp,fillStatus:"FILLED",idempotencyKey:`${cycleId}-${p.trancheIndex}`});cooldown=applyCooldown(cooldown,c.timestamp);ps=applyTrancheToPeriod(ps,gross,c.timestamp);if(hwm!.status!=="FROZEN")hwm=freezeHWM(hwm!)};
  const sell=(c:Candle,qty:number,reason:string)=>{qty=Math.min(qty,btc);if(qty<=0)return;const before=btc,av=basis/before,gross=qty*c.close,fu=gross*fee,proceeds=gross-fu,bSold=av*qty;cash+=proceeds;btc-=qty;basis=Math.max(0,basis-bSold);trades.push({date:c.date,side:"SELL",reason,price:c.close,grossUsd:gross,feeUsd:fu,quantity:qty,hwm:hwm?.price,dropPct:hwm?computeDropPct(hwm.price,c.close):undefined})};
  for(let i=0;i<cs.length;i++){
    const c=cs[i];if(pending&&timing==="NEXT_OPEN"){buy(c,pending,c.open);pending=null}seen.push(c);const atr=computeATR(ac(seen.slice(-60)),20);
    if(btc<=1e-12){btc=0;basis=0;const oldKey=`${hwm.price}|${hwm.timestamp}`;const t=processIncrementalClose(hwm,dc(c),seen.map(dc),CONFIRMATIONS,REVERSAL);hwm=t.current;if(`${hwm.price}|${hwm.timestamp}`!==oldKey){basePlan=null;baseSeed=null;evidence=[]}}
    else {low=low===null?c.close:Math.min(low,c.close);highest=highest===null?c.close:Math.max(highest,c.close)}
    if(!entriesClosed&&(hwm.status==="CONFIRMED"||hwm.status==="FROZEN")){
      if(!basePlan){baseSeed={hwmPrice:hwm.price,hwmTimestamp:hwm.timestamp,budgetUsd:CAPITAL,deployedUsd:0,reservedUsd:0,parameters:P,cycleId,asset:"BTC",riskOverlayMultiplier:1,previousTranchePrice:null,atr};basePlan=buildCanonicalSeedPlan(baseSeed,dc(c))}
      let plan:AmaTranchePlan|null=basePlan;
      if(basePlan&&baseSeed&&evidence.length){plan=replanTranches({originalPlan:basePlan,seedInput:{...baseSeed,atr},confirmedClose:dc(c),executedTranches:evidence,portfolioDeployedUsd:basis})}
      if(plan&&baseSeed){const inp={hwmPrice:hwm.price,currentPrice:c.close,cycleLowPrice:low,atr,budgetUsd:CAPITAL,deployedUsd:basis,reservedUsd:0,previousTranchePrice:trades.filter(t=>t.side==="BUY").at(-1)?.price??null,parameters:P,cycleId,asset:"BTC" as const,riskOverlayMultiplier:1};const dec=makeAdaptiveDecision(plan,inp,cooldown,ps,c.timestamp);ps=normalizePeriodState(dec,ps);if(dec.action==="SIMULATE"&&dec.selectedTrancheId&&dec.selectedSeedTrancheIndex!==null&&dec.selectedAmountUsd!==null&&!pending){const cand=plan.candidateTranches.find(x=>x.trancheId===dec.selectedTrancheId);const p:PendingBuy={trancheId:dec.selectedTrancheId,trancheIndex:dec.selectedSeedTrancheIndex,amountUsd:dec.selectedAmountUsd,policyId:cand?.policyId??BTC_SEED_POLICY.policyId,hwm:hwm.price,dropPct:computeDropPct(hwm.price,c.close),decisionDate:c.date};if(timing==="SAME_CLOSE")buy(c,p,c.close);else if(i+1<cs.length)pending=p}}
    }
    if(variant!=="ENTRY_CANONICAL_HOLD"&&btc>1e-12){const cyc=makeCycle(cycleId,hwm,basis,btc,low,c.close),ex=createExitStrategy(cyc,P),phase=determineExitPhase(cyc,c.close,P),trail=highest!==null&&((phase==="TRAILING_ACTIVE")||partial)&&shouldTriggerTrailingStop(c.close,highest,ex.trailingStopPct);if(!partial&&(phase==="DISTRIBUTING"||trail)){const z=computeDistributionSize(btc,"DISTRIBUTING",ex.runnerPct);sell(c,z.distributeBtc,phase==="DISTRIBUTING"?"DEFINED_DISTRIBUTION_20PCT":"DEFINED_TRAILING_DISTRIBUTION");partial=true;entriesClosed=true;highest=c.close}else if(variant==="EXPERIMENTAL_RUNNER_TRAIL"&&partial&&highest!==null&&shouldTriggerTrailingStop(c.close,highest,ex.trailingStopPct)){sell(c,btc,"EXPERIMENTAL_RUNNER_TRAILING_EXIT");if(btc<=1e-12)reset(c)}}
    pts.push({date:c.date,equity:cash+btc*c.close,cash,btc,close:c.close,costBasisUsd:basis,hwm:hwm.price,hwmState:hwm.status});
  }
  const met=metrics(pts,trades),notes=["Entradas con buildCanonicalSeedPlan + replanTranches + makeAdaptiveDecision.","ExecutedTrancheEvidence canónico evita doble conteo de fills.",variant==="ENTRY_CANONICAL_HOLD"?"Sin salidas: calidad de entrada.":"Salidas son LAB_HYPOTHESIS.",variant==="EXPERIMENTAL_RUNNER_TRAIL"?"Salida final runner es hipótesis explícita, no runtime canónico.":"Runner restante se marca a mercado; no se inventa salida final."];
  const core={variant,fillTiming:timing,feeBps,period,source:cs[0]?.source??"UNKNOWN",metrics:met,trades,notes};return {...core,deterministicHash:hash(core)};
}

function staircaseInvariant(){
  const P=params(),cycleId="staircase",hwm=100000,hwmTs="2020-01-01T23:59:59.000Z";const seed:SeedTranchePlanInput={hwmPrice:hwm,hwmTimestamp:hwmTs,budgetUsd:CAPITAL,deployedUsd:0,reservedUsd:0,parameters:P,cycleId,asset:"BTC",riskOverlayMultiplier:1,previousTranchePrice:null,atr:null};
  const dates=["2020-01-08","2020-01-15","2020-01-22","2020-01-29","2020-02-05","2020-02-12"],prices=[81000,74000,66000,57000,47000,36000];let base:AmaTranchePlan|null=null,ev:ExecutedTrancheEvidence[]=[],deployed=0,cd=createCooldownState(P.cooldownPolicy),ps=createPeriodLimitState(`${dates[0]}T23:59:59.000Z`);const got:number[]=[];
  for(let i=0;i<dates.length;i++){const close={timestamp:`${dates[i]}T23:59:59.000Z`,close:prices[i],isClosed:true as const};if(!base)base=buildCanonicalSeedPlan(seed,close);const plan=ev.length?replanTranches({originalPlan:base!,seedInput:seed,confirmedClose:close,executedTranches:ev,portfolioDeployedUsd:deployed}):base;if(!plan)throw new Error(`staircase plan null ${i}`);const inp={hwmPrice:hwm,currentPrice:prices[i],cycleLowPrice:prices[i],atr:null,budgetUsd:CAPITAL,deployedUsd:deployed,reservedUsd:0,previousTranchePrice:null,parameters:P,cycleId,asset:"BTC" as const,riskOverlayMultiplier:1};const d=makeAdaptiveDecision(plan,inp,cd,ps,close.timestamp);ps=normalizePeriodState(d,ps);if(d.action!=="SIMULATE"||d.selectedSeedTrancheIndex===null||d.selectedAmountUsd===null||!d.selectedTrancheId)throw new Error(`staircase no selection ${i}:${d.reason}`);got.push(d.selectedAmountUsd);deployed+=d.selectedAmountUsd;const cand=plan.candidateTranches.find(c=>c.trancheId===d.selectedTrancheId)!;ev.push({cycleId,asset:"BTC",policyId:cand.policyId!,policyVersion:cand.policyVersion!,trancheId:d.selectedTrancheId,seedTrancheIndex:d.selectedSeedTrancheIndex,executedAmountUsd:d.selectedAmountUsd,executedQuantity:d.selectedAmountUsd/prices[i],executedAt:close.timestamp,fillStatus:"FILLED",idempotencyKey:`stair-${i}`});cd=applyCooldown(cd,close.timestamp);ps=applyTrancheToPeriod(ps,d.selectedAmountUsd,close.timestamp)}
  const expected=[700,900,1200,1400,1500,1800];if(JSON.stringify(got)!==JSON.stringify(expected)||deployed!==7500)throw new Error(`staircase mismatch got=${got} deployed=${deployed}`);return {got,deployed};
}
function pct(x:number|null){return x===null?"N/D":`${x.toFixed(2)}%`}function val(x:number|null){return x===null?"N/D":x.toFixed(2)}
function table(rows:string[][]){const w=rows[0].map((_,i)=>Math.max(...rows.map(r=>(r[i]??"").length)));const line=(r:string[])=>`| ${r.map((v,i)=>v.padEnd(w[i])).join(" | ")} |`;return [line(rows[0]),line(w.map(x=>"-".repeat(Math.max(3,x)))),...rows.slice(1).map(line)].join("\n")}

async function main(){
  await mkdir(OUT_DIR,{recursive:true});const staircase=staircaseInvariant();const all=await loadMain(),kraken=await loadKraken();const runs:Run[]=[],bench:any[]=[];const vars:Variant[]=["ENTRY_CANONICAL_HOLD","DEFINED_EXIT_RUNNER_HOLD","EXPERIMENTAL_RUNNER_TRAIL"];
  for(const p of PERIODS){const {warm,test,warmupShort}=periodSlice(all,p);for(const fee of FEES){bench.push({period:p.name,feeBps:fee,warmupDays:warm.length,warmupShort,bh100:benchmark(test,1,fee),bh75:benchmark(test,.75,fee)});for(const timing of ["SAME_CLOSE","NEXT_OPEN"] as FillTiming[])for(const v of vars){const a=simulate(warm,test,v,timing,fee,p.name),b=simulate(warm,test,v,timing,fee,p.name);if(a.deterministicHash!==b.deterministicHash)throw new Error(`nondeterministic ${p.name}/${v}/${timing}/${fee}`);runs.push(a)}}}
  const recent:Run[]=[];if(kraken.length>260){const w=kraken.slice(0,200),t=kraken.slice(200);for(const timing of ["SAME_CLOSE","NEXT_OPEN"] as FillTiming[])for(const v of vars)recent.push(simulate(w,t,v,timing,10,"KRAKEN_RECENT_WINDOW"))}
  const prim=runs.filter(r=>r.period==="FULL_AVAILABLE"&&r.feeBps===10&&r.fillTiming==="NEXT_OPEN"),bb=bench.find(b=>b.period==="FULL_AVAILABLE"&&b.feeBps===10);const global:string[][]=[["Estrategia","Retorno","CAGR","Max DD","Sharpe","Compras","Ventas","Fin USD","Capital máx"]];for(const r of prim)global.push([r.variant,pct(r.metrics.totalReturnPct),pct(r.metrics.cagrPct),pct(r.metrics.maxDrawdownPct),val(r.metrics.sharpe),String(r.metrics.buys),String(r.metrics.sells),r.metrics.endingEquity.toFixed(2),r.metrics.maxCapitalDeployedUsd.toFixed(0)]);global.push(["BUY_HOLD_100",pct(bb.bh100.totalReturnPct),pct(bb.bh100.cagrPct),pct(bb.bh100.maxDrawdownPct),val(bb.bh100.sharpe),"1","0",bb.bh100.endingEquity.toFixed(2),"10000"],["BUY_HOLD_75_CASH_25",pct(bb.bh75.totalReturnPct),pct(bb.bh75.cagrPct),pct(bb.bh75.maxDrawdownPct),val(bb.bh75.sharpe),"1","0",bb.bh75.endingEquity.toFixed(2),"7500"]);
  const hist:string[][]=[["Período","AMA entry","B&H75","B&H100","DD AMA","DD B&H100","Compras"]];for(const p of PERIODS){const r=runs.find(x=>x.period===p.name&&x.variant==="ENTRY_CANONICAL_HOLD"&&x.fillTiming==="NEXT_OPEN"&&x.feeBps===10)!,b=bench.find(x=>x.period===p.name&&x.feeBps===10);hist.push([p.name,pct(r.metrics.totalReturnPct),pct(b.bh75.totalReturnPct),pct(b.bh100.totalReturnPct),pct(r.metrics.maxDrawdownPct),pct(b.bh100.maxDrawdownPct),String(r.metrics.buys)])}
  const fees:string[][]=[["Coste bps/lado","AMA entry retorno","Fin USD","Compras"]];for(const f of FEES){const r=runs.find(x=>x.period==="FULL_AVAILABLE"&&x.variant==="ENTRY_CANONICAL_HOLD"&&x.fillTiming==="NEXT_OPEN"&&x.feeBps===f)!;fees.push([String(f),pct(r.metrics.totalReturnPct),r.metrics.endingEquity.toFixed(2),String(r.metrics.buys)])}
  const recentRows:string[][]=[["Variante Kraken reciente","Retorno","Max DD","Compras","Ventas","Fin USD"]];for(const r of recent.filter(x=>x.fillTiming==="NEXT_OPEN"))recentRows.push([r.variant,pct(r.metrics.totalReturnPct),pct(r.metrics.maxDrawdownPct),String(r.metrics.buys),String(r.metrics.sells),r.metrics.endingEquity.toFixed(2)]);
  const entryFull=prim.find(r=>r.variant==="ENTRY_CANONICAL_HOLD")!;const tradeRows:string[][]=[["Fecha","Tramo","Caída","Precio","USD"]];for(const t of entryFull.trades.filter(t=>t.side==="BUY"))tradeRows.push([t.date,String((t.trancheIndex??0)+1),pct(t.dropPct??null),t.price.toFixed(2),t.grossUsd.toFixed(0)]);
  const report=`# Auditoría cuantitativa AMA BTC — V2 corregida\n\nGenerada: ${new Date().toISOString()}\n\n## Control canónico\n\n- Staircase invariant: ${staircase.got.join(" + ")} = **${staircase.deployed} USD (75%)**.\n- Entradas: buildCanonicalSeedPlan → replanTranches(ExecutedTrancheEvidence) → makeAdaptiveDecision.\n- Máximo una compra por cierre confirmado; cooldown y límites semanal/mensual activos.\n- HWM: flujo puro canónico de cierres, reversión ${REVERSAL}% y ${CONFIRMATIONS} confirmaciones; congelado tras primer fill.\n- Salidas BTC siguen siendo LAB_HYPOTHESIS en el código.\n\n## Resultado global principal\n\nSupuesto principal: NEXT_OPEN + 10 bps/lado.\n\n${table(global)}\n\n## Compras canónicas del histórico completo\n\n${table(tradeRows)}\n\n## Estrés por períodos\n\n${table(hist)}\n\n## Sensibilidad a costes\n\n${table(fees)}\n\n## Robustez en fuente Kraken reciente\n\n${table(recentRows)}\n\n## Qué significa\n\n- **ENTRY_CANONICAL_HOLD** es la evidencia fuerte: mide la calidad de la escalera de compras sin inventar una salida.\n- **DEFINED_EXIT_RUNNER_HOLD** aplica únicamente la distribución parcial definida y deja el runner marcado a mercado.\n- **EXPERIMENTAL_RUNNER_TRAIL** añade una salida final del runner que NO está orquestada actualmente; solo sirve para investigación.\n- B&H 75/25 es el benchmark más justo para comparar con la reserva estructural del 25% de AMA.\n\n## Hallazgos de implementación\n\n1. `amaReplayService.ts` actual no representa el seed canónico y no debe usarse para afirmar rentabilidad AMA.\n2. El runtime HWM bootstrap y el flujo puro canónico no son equivalentes: runtime usa máximo HIGH de las velas recibidas; el flujo canónico usa cierres + confirmación.\n3. La política de salida BTC está explícitamente en estado LAB_HYPOTHESIS; falta cerrar su orquestación end-to-end antes de evaluar REAL como estrategia completa.\n4. Esta V2 corrige el doble conteo detectado en el primer harness mediante `replanTranches` + evidencia ejecutada.\n\n## Datos\n\n- Principal: ${all[0].date} → ${all.at(-1)!.date}, ${all.length} velas BTCUSDT diarias (mirror de investigación Binance).\n- Kraken reciente: ${kraken[0].date} → ${kraken.at(-1)!.date}, ${kraken.length} velas XBT/USD de API pública.\n- No se realizaron órdenes, llamadas privadas ni movimientos de capital.\n`;
  const manifest={generatedAt:new Date().toISOString(),auditVersion:"V2",staircase,sources:{main:{url:DATA_URL,first:all[0].date,last:all.at(-1)!.date,candles:all.length},kraken:{url:KRAKEN_URL,first:kraken[0].date,last:kraken.at(-1)!.date,candles:kraken.length}},seed:{policy:BTC_SEED_POLICY,tranches:BTC_SEED_TRANCHES}};
  await writeFile(`${OUT_DIR}/AUDITORIA_CUANTITATIVA_AMA_BTC_V2.md`,report);await writeFile(`${OUT_DIR}/manifest.json`,JSON.stringify(manifest,null,2));await writeFile(`${OUT_DIR}/runs.json`,JSON.stringify({runs,recent,bench},null,2));const csv=["period,variant,timing,fee,date,side,reason,price,grossUsd,feeUsd,quantity,trancheIndex,hwm,dropPct"];for(const r of runs)for(const t of r.trades)csv.push([r.period,r.variant,r.fillTiming,r.feeBps,t.date,t.side,t.reason,t.price,t.grossUsd,t.feeUsd,t.quantity,t.trancheIndex??"",t.hwm??"",t.dropPct??""].join(","));await writeFile(`${OUT_DIR}/trades.csv`,csv.join("\n"));console.log(report);console.log(`PRIMARY_RUNS=${runs.length}`);console.log(`RECENT_RUNS=${recent.length}`);console.log("AMA_QUANT_AUDIT_V2=PASS");
}
main().catch(e=>{console.error("AMA_QUANT_AUDIT_V2=FAIL");console.error(e);process.exit(1)});
