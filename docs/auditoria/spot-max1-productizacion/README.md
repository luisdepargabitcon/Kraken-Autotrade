# SPOT MAX1 — Certificación de productización

Cambio único de política SPOT: `DEFAULT_SPOT_RISK_CONFIG.maxLotsPerPair` 2 → 1
(`server/services/spot/spotRiskManager.ts`).

## Base

- Branch: `fix/spot-single-lot-per-pair`
- Base SHA: `1784f94845ea49fb7beefe05f74deb11287908d8` (integration/staging-spot-v4)
- Forensic SHA (evidencia): `45120521950b0dd65849cebd922e867f02e5d104`

## Race guard (spotEngine.ts)

Auditoría signal → intent → sizing → execution → position:

- `countOpenLotsForPair` + `evaluateSizing` corrían ANTES de entrar en la
  sección crítica por par → dos evaluaciones podían pasar la gate con
  `openLots=0` y materializar ambas.
- `enterPairCriticalSection` es un contador de drain (para disable), NO un
  mutex: dos entries del mismo par podían coexistir dentro.
- Un REAL `PENDING_FILL` vive en `order_intents` sin fila en
  `open_positions` → evadía el contador de lots.

Guard mínimo implementado:

1. `pairEntryLocks` — mutex FIFO por par que serializa gate→persist dentro
   de la sección crítica. Pares distintos NO se serializan entre sí
   (BTC OPEN + ETH OPEN + SOL OPEN sigue siendo posible).
2. `countInFlightEntryIntentsForPair` — cuenta `order_intents` en
   `pending`/`accepted`/`uncertain`/`PENDING_FILL` del mismo par
   (excluye el propio `internalIntentId`; fail-closed ante error DB).
3. Re-check dentro de la sección crítica: si `open + inFlight >=
   maxLotsPerPair` → bloqueo con `reasonCode=MAX_LOTS_REACHED`
   (reason canónico existente, sin nueva familia).

## Regresión económica (control certificado)

Runner: `server/services/spot/research/runStackingControl.ts`
Salida: `MAX1_CERTIFICATION_CONTROL.csv`

Umbrales históricos `[0.50, 0.30, 0.30]`:

| policy | trades | net | PF | DD |
|---|---|---|---|---|
| CURRENT_MAX2 | 52 | 297.38 | 1.408 | 275.98 |
| MAX1 | 40 | 332.71 | 1.624 | 203.72 |

Producción `0.30`:

| policy | trades | net | PF | DD |
|---|---|---|---|---|
| CURRENT_MAX2 | 59 | 217.22 | 1.262 | 275.98 |
| MAX1 | 46 | 241.58 | 1.382 | 203.72 |

Reproducción exacta del control certificado — sin optimización.

## Freeze

ENTRY_V4_CHANGED=NO / EXIT_E0_CHANGED=NO — hashes idénticos pre/post:

- spotEntryV4.ts `a7f6b656f4`
- spotEntryQualityFeatures.ts `07ad23a6e8`
- spotEntryIntent.ts `362c2a0167`
- spotCanonicalStrategy.ts `a127402b8d18`
- spotExitPolicy.ts `a1e8862c21`

DEPLOY_EXECUTED=NO, REAL_ORDER_SENT=NO.
