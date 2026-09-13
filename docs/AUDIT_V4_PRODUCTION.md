# Audit Package — Entry V4 Quality Overlay Production Promotion

**Date:** 2026-01-15  
**Branch:** `feature/spot-adaptive-v3-shadow`  
**Base commit:** `89fdfdc2de4f51a67ee9c97bd23ac801b5457921`  
**Commit message:** `feat(spot-entry): promote certified V4 quality overlay to production`

---

## 1. Objective

Promote the certified Entry V4 soft quality overlay from research to the productive SPOT engine with a frozen threshold of **0.30** and equal weights of **0.20** per component.

## 2. Architecture

### 2.1 Single Source of Truth

| Module | Path | Role |
|--------|------|------|
| `spotEntryV4.ts` | `server/services/spot/spotEntryV4.ts` | **Productive V4 module** — frozen weights, threshold, scoring, acceptance, fail-closed gate |
| `spotEntryQualityFeatures.ts` | `server/services/spot/spotEntryQualityFeatures.ts` | **Shared feature extraction** — used by production, research, and tests |
| `spotEntryV4Research.ts` | `server/services/spot/research/spotEntryV4Research.ts` | **Re-export shim** — delegates to `spotEntryV4.ts` for backward compat |
| `fastResearchReplay.ts` | `server/services/spot/research/fastResearchReplay.ts` | **Research replay** — imports shared extractor, no local duplication |

### 2.2 V4 Quality Components

Five equal-weight (0.20) components:

1. **Impulse** — magnitude of the initial move relative to ATR
2. **Retracement** — depth of pullback (sweet spot scoring)
3. **Structure** — position relative to EMA20
4. **Reclaim** — bullish reclaim candle body size and position
5. **Resumption** — continuation candle body, wick, and volume

Quality score = weighted sum, range [0, 1].

### 2.3 Frozen Parameters

```typescript
SPOT_ENTRY_V4_ENABLED = true
SPOT_ENTRY_V4_MIN_QUALITY_SCORE = 0.30
V4_WEIGHTS = { impulse: 0.20, retracement: 0.20, structure: 0.20, reclaim: 0.20, resumption: 0.20 }
```

### 2.4 Integration Points

V4 gate is inserted in `spotEngine.ts` `scanPair` at two points, both **after** B0 `shouldExecute=true`:

1. **Active intent re-evaluation path** — existing intent passes anti-late checks
2. **New signal immediate execution path** — new intent passes anti-late checks

### 2.5 Fail-Closed Semantics

- V4 rejection → entry blocked, **no fallback to B0**
- V4 features unavailable → entry blocked
- V4 disabled → entry blocked (config flag)
- V4 error/exception → entry blocked

### 2.6 Structured Logging

`ENTRY_V4_EVALUATED` JSON log emitted on every V4 evaluation:

```json
{
  "event": "ENTRY_V4_EVALUATED",
  "pair": "BTC/USDT",
  "evaluationTime": 1234567890,
  "signalId": "abc-123",
  "b0IntentApproved": true,
  "v4Enabled": true,
  "qualityScore": 0.4567,
  "threshold": 0.30,
  "impulseScore": 0.8,
  "retracementScore": 0.6,
  "structureScore": 0.5,
  "reclaimScore": 0.3,
  "resumptionScore": 0.2,
  "accepted": false,
  "rejectReason": "V4_SCORE_BELOW_THRESHOLD"
}
```

### 2.7 Forward Twin Snapshot

V4 metadata added to `ForwardTwinIntentSnapshot`:
- `v4QualityScore`
- `v4Threshold`
- `v4Accepted`
- `v4RejectReason`

### 2.8 Context Snapshot

V4 gate added to `SpotContextSnapshot` gates array and V4 fields in snapshot output.

### 2.9 API

`/api/spot/status` now includes:

```json
{
  "entryStrategy": {
    "version": "V4_SOFT_QUALITY",
    "active": true,
    "minQualityScore": 0.30,
    "weights": {
      "impulse": 0.20,
      "retracement": 0.20,
      "structure": 0.20,
      "reclaim": 0.20,
      "resumption": 0.20
    }
  }
}
```

### 2.10 UI

Spot dashboard header shows:
- `ENTRY STRATEGY: V4 SOFT QUALITY` badge
- `STATUS: ACTIVE`
- `MIN SCORE: 0.30`
- `WEIGHTS: 0.2/0.2/0.2/0.2/0.2`

## 3. Invariants Verified

| # | Invariant | Test | Result |
|---|-----------|------|--------|
| 1 | Production-research parity | `ENTRY_V4_PRODUCTION_RESEARCH_PARITY` | PASS |
| 2 | Historical parity | `PRODUCTIVE_V4_HISTORICAL_PARITY` | PASS |
| 3 | 0.30 baseline regression | `PRODUCTION_030_BASELINE` | PASS |
| 4 | Fail-closed | `V4_FAIL_CLOSED` | PASS |
| 5 | B0 overlay | `V4_B0_OVERLAY` | PASS |
| 6 | Sizing unchanged | `V4_SIZING_UNCHANGED` | PASS |
| 7 | Mode independent | `V4_MODE_INDEPENDENT` | PASS |
| 8 | Closed candle contract | `V4_CLOSED_CANDLE` | PASS |
| 9 | Weights frozen | `V4_WEIGHTS_FROZEN` | PASS |
| 10 | Threshold frozen | `V4_THRESHOLD_FROZEN` | PASS |

### Existing tests (backward compat):

| Test | Result |
|------|--------|
| `testEntryV4.ts` (8 tests) | ALL PASS |
| `testEntryV4CounterAudit.ts` (6 tests) | ALL PASS |

## 4. Files Changed

### New files:
- `server/services/spot/spotEntryV4.ts` — Productive V4 module
- `server/services/spot/spotEntryQualityFeatures.ts` — Shared feature extraction
- `server/services/spot/research/testEntryV4ProductionParity.ts` — Production parity + invariant tests
- `docs/AUDIT_V4_PRODUCTION.md` — This audit document

### Modified files:
- `server/services/spot/research/spotEntryV4Research.ts` — Re-exports from `spotEntryV4.ts`
- `server/services/spot/research/fastResearchReplay.ts` — Uses shared feature extractor
- `server/services/spot/spotEngine.ts` — V4 gate integration with fail-closed
- `server/services/spot/spotForwardTwinTypes.ts` — V4 fields in intent snapshot
- `server/services/spot/spotForwardTwinBuilder.ts` — V4 metadata in builder
- `server/services/spot/spotContextSnapshot.ts` — V4 gate and metadata in snapshot
- `server/services/spot/spotContextSnapshotStore.ts` — V4 fields in snapshot interface
- `server/routes/spot.routes.ts` — V4 info in status API
- `client/src/pages/Spot.tsx` — V4 badge in UI header

## 5. TypeScript Compilation

```
npx tsc --noEmit → 0 errors
```

## 6. Safety

- No real order sending
- No automatic REAL mode activation
- No DB migrations
- No changes to sizing, exit, or real safety gates
- OFF/SHADOW/REAL modes unchanged
- B0 anti-late entry logic unchanged
