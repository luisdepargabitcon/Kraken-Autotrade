# STACKING_FORENSIC — same-pair stacking audit (forward, audit only)

BASE_AUDIT_SHA=8618c44 · deployed code verified: 3ae18319 DEFAULT_SPOT_RISK_CONFIG.maxLotsPerPair=2 (git show)

## Overlaps reales (mismo pair, second.openedAt < first.closedAt)
certified: 13 pares solapados | all-scope: 14
clasificación: SAME_SETUP_DUPLICATE=11 RELATED_SETUP=2 INDEPENDENT_SETUP=1
sameMarketContextId en overlaps: 0/14 (cada entrada evaluada en scan distinto — no son el mismo contextId)

## MAX1 counterfactual (certified scope)
CURRENT_TRADES=27 NET=-101.08 PF=0.634 DD=171.41
MAX1_TRADES=14 NET=12.41 PF=1.110 DD=58.05
SECOND_LOTS_BLOCKED=13 DELTA_NET=113.49 DELTA_DD=-113.37
blocked net sum=-113.49

## Single vs multi cluster (certified)
SINGLE_ENTRY_CLUSTERS: n=11 net=-0.75 pf=0.993 exp=-0.07
MULTI_ENTRY_CLUSTERS: n=16 net=-100.33 pf=0.394 exp=-6.27

## Per pair (certified)
BTC/USD: current=-62.53 max1=-18.64 blocked=1 delta=43.89
ETH/USD: current=-26.67 max1=-13.25 blocked=3 delta=13.42
SOL/USD: current=4.91 max1=55.21 blocked=3 delta=50.30
XRP/USD: current=-16.79 max1=-10.91 blocked=6 delta=5.88

## All-scope (incl TON)
CURRENT: n=29 net=-166.04 | MAX1: n=15 net=-23.41 blocked=14
## Control histórico (replay E0/V4 congelado, solo maxLots varía)

HISTORICAL thresholds [0.50,0.30,0.30], test folds 30d:
- fold0 (thr 0.50): 0 trades ambas políticas
- fold1 (thr 0.30): idéntico n=5 net=5.41 (sin overlaps en ese fold)
- fold2 (thr 0.30): MAX2 n=47 net=291.96 dd=275.98 | MAX1 n=35 net=327.30 dd=203.72
- OOS: MAX2 net=297.38 pf=1.408 dd=275.98 | MAX1 net=332.71 pf=1.624 dd=203.72

PRODUCTION_030 [0.30×3]:
- fold0: MAX2 n=7 net=-80.16 | MAX1 n=6 net=-91.13 (único fold donde MAX1 pierde, -10.97)
- fold1: idéntico n=5 net=5.41
- fold2: MAX2 n=47 net=291.96 | MAX1 n=35 net=327.30
- OOS: MAX2 net=217.22 pf=1.262 dd=275.98 | MAX1 net=241.58 pf=1.382 dd=203.72

## Veredicto del criterio

FORWARD_MAX1_IMPROVES=YES (+113.49 net, DD 171.41→58.05 certified; all-scope +142.63)
HISTORICAL_MAX1_IMPROVES=YES (+35.33 net, +0.22 PF, DD -72.26)
PROD030_MAX1_IMPROVES=YES (+24.36 net, DD -72.26)

CONCLUSION=CANDIDATE_DEFECT_CONFIRMED
Caveat: el contrafactual forward elimina segundas entradas manteniendo el primer
trade intacto (regla especificada); no modela efectos de capital liberado sobre
entradas posteriores en otros pares. El control histórico path-dependent sí
reproduce el bloqueo real y confirma la dirección.
NO DESPLEGAR — decisión pendiente de contraauditoría.
