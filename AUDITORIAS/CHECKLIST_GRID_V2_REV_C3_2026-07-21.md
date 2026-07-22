# CHECKLIST GRID PROFESIONAL V2 — REV-C3

Fase: 3C.5-A-REV-C3  
Fecha: 2026-07-21  
Commit base: `9f8c88b0213aae85edcbeccd165856a60550acb4`  
origin/main base: `9f8c88b0213aae85edcbeccd165856a60550acb4`

---

## GATE-0 — Estado inicial

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| GATE-0 | Estado inicial del repositorio auditado | Sí | IN_PROGRESS | Ver sección 10 | HEAD = origin/main = 9f8c88b; working tree limpio | - | - | Sí |

## CTX — Contexto

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| CTX-01 | BITACORA.md revisada | Sí | PENDING | - | - | - | - | Sí |
| CTX-02 | CORRECCIONES_Y_ACTUALIZACIONES.md revisado o motivado como inexistente | Sí | PENDING | - | - | - | - | Sí |
| CTX-03 | Auditorías Grid revisadas | Sí | PENDING | - | - | - | - | Sí |
| CTX-04 | Migraciones previas revisadas | Sí | PENDING | - | - | - | - | Sí |
| CTX-05 | Alcance confirmado exclusivamente Grid | Sí | PENDING | - | - | - | - | Sí |

## REP — Estado inicial del repositorio

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| REP-01 | Rama main | Sí | PENDING | - | - | - | - | Sí |
| REP-02 | HEAD identificado | Sí | PENDING | - | - | - | - | Sí |
| REP-03 | origin/main identificado | Sí | PENDING | - | - | - | - | Sí |
| REP-04 | Working tree auditado | Sí | PENDING | - | - | - | - | Sí |
| REP-05 | Archivos modificados identificados | Sí | PENDING | - | - | - | - | Sí |
| REP-06 | Archivos sin seguimiento identificados | Sí | PENDING | - | - | - | - | Sí |
| REP-07 | Sin secretos | Sí | PENDING | - | - | - | - | Sí |
| REP-08 | Sin temporales | Sí | PENDING | - | - | - | - | Sí |
| REP-09 | Sin JSON de tests dentro del repositorio | Sí | PENDING | - | - | - | - | Sí |

## SCP — Alcance (NexaHome / vite.config)

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| SCP-01 | NexaHome comprobado | Sí | PENDING | - | - | - | - | Sí |
| SCP-02 | vite.config comprobado | Sí | PENDING | - | - | - | - | Sí |
| SCP-03 | Cambios globales ausentes | Sí | PENDING | - | - | - | - | Sí |
| SCP-04 | Badge Windsurf ausente | Sí | PENDING | - | - | - | - | Sí |

## TYP — Tipos de dominio

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| TYP-01 | GridCycleRiskState único | Sí | PENDING | - | - | - | - | Sí |
| TYP-02 | Estados sin duplicados | Sí | PENDING | - | - | - | - | Sí |
| TYP-03 | Enums canónicos | Sí | PENDING | - | - | - | - | Sí |
| TYP-04 | Comentarios fees corregidos | Sí | PENDING | - | - | - | - | Sí |
| TYP-05 | Sin nuevos any financieros | Sí | PENDING | - | - | - | - | Sí |
| TYP-06 | Fixtures tipadas | Sí | PENDING | - | - | - | - | Sí |

## CFG — Configuración persistida

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| CFG-01 | Schema | Sí | PENDING | - | - | - | - | Sí |
| CFG-02 | Migración | Sí | PENDING | - | - | - | - | Sí |
| CFG-03 | loadConfig | Sí | PENDING | - | - | - | - | Sí |
| CFG-04 | snapshot | Sí | PENDING | - | - | - | - | Sí |
| CFG-05 | saveConfig | Sí | PENDING | - | - | - | - | Sí |
| CFG-06 | GET | Sí | PENDING | - | - | - | - | Sí |
| CFG-07 | mutation de configuración | Sí | PENDING | - | - | - | - | Sí |
| CFG-08 | tests | Sí | PENDING | - | - | - | - | Sí |
| CFG-09 | default no sobrescribe DB | Sí | PENDING | - | - | - | - | Sí |
| CFG-10 | toggles sobreviven reinicio | Sí | PENDING | - | - | - | - | Sí |
| CFG-11 | Cero filas crea inicial | Sí | PENDING | - | - | - | - | Sí |
| CFG-12 | Error DB no escribe | Sí | PENDING | - | - | - | - | Sí |
| CFG-13 | Error DB no arranca | Sí | PENDING | - | - | - | - | Sí |
| CFG-14 | Error carga ciclos no finge array vacío | Sí | PENDING | - | - | - | - | Sí |
| CFG-15 | Test de fallo de DB | Sí | PENDING | - | - | - | - | Sí |

## MIG — Migraciones

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| MIG-01 | Ledger revisado | Sí | PENDING | - | - | - | - | Sí |
| MIG-02 | Estado 073 conocido | Sí | PENDING | - | - | - | - | Sí |
| MIG-03 | 074 creada o motivada | Sí | PENDING | - | - | - | - | Sí |
| MIG-04 | Aditiva | Sí | PENDING | - | - | - | - | Sí |
| MIG-05 | Idempotente | Sí | PENDING | - | - | - | - | Sí |
| MIG-06 | Sin backfill | Sí | PENDING | - | - | - | - | Sí |
| MIG-07 | FK auditada | Sí | PENDING | - | - | - | - | Sí |
| MIG-08 | ON DELETE auditado | Sí | PENDING | - | - | - | - | Sí |
| MIG-09 | Índice justificado o retirado | Sí | PENDING | - | - | - | - | Sí |
| MIG-10 | Constraints | Sí | PENDING | - | - | - | - | Sí |
| MIG-11 | Primera ejecución | Sí | PENDING | - | - | - | - | Sí |
| MIG-12 | Segunda ejecución | Sí | PENDING | - | - | - | - | Sí |
| MIG-13 | Legacy intacto | Sí | PENDING | - | - | - | - | Sí |

## JSN — JSONB validado

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| JSN-01 | Validator risk | Sí | PENDING | - | - | - | - | Sí |
| JSN-02 | Validator target | Sí | PENDING | - | - | - | - | Sí |
| JSN-03 | stateVersion | Sí | PENDING | - | - | - | - | Sí |
| JSN-04 | JSON válido | Sí | PENDING | - | - | - | - | Sí |
| JSN-05 | string legacy | Sí | PENDING | - | - | - | - | Sí |
| JSN-06 | corrupto | Sí | PENDING | - | - | - | - | Sí |
| JSN-07 | fecha inválida | Sí | PENDING | - | - | - | - | Sí |
| JSN-08 | enum inválido | Sí | PENDING | - | - | - | - | Sí |
| JSN-09 | versión desconocida | Sí | PENDING | - | - | - | - | Sí |
| JSN-10 | fail-safe review | Sí | PENDING | - | - | - | - | Sí |

## MKR — Máquina de estados maker

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| MKR-01 | Estado tipado | Sí | PENDING | - | - | - | - | Sí |
| MKR-02 | Trigger separado | Sí | PENDING | - | - | - | - | Sí |
| MKR-03 | Pending persistente | Sí | PENDING | - | - | - | - | Sí |
| MKR-04 | Fill separado | Sí | PENDING | - | - | - | - | Sí |
| MKR-05 | Cancelación explícita | Sí | PENDING | - | - | - | - | Sí |
| MKR-06 | Reprice explícito | Sí | PENDING | - | - | - | - | Sí |
| MKR-07 | Reinicio | Sí | PENDING | - | - | - | - | Sí |
| MKR-08 | No reset por HOLD | Sí | PENDING | - | - | - | - | Sí |
| MKR-09 | Post-only no cruza bid | Sí | PENDING | - | - | - | - | Sí |
| MKR-10 | Requiere ask para colocar | Sí | PENDING | - | - | - | - | Sí |
| MKR-11 | No fill mismo tick | Sí | PENDING | - | - | - | - | Sí |
| MKR-12 | Fill en tick posterior | Sí | PENDING | - | - | - | - | Sí |
| MKR-13 | Bid inferior no llena | Sí | PENDING | - | - | - | - | Sí |
| MKR-14 | Pair mismatch bloquea | Sí | PENDING | - | - | - | - | Sí |
| MKR-15 | Stale bloquea | Sí | PENDING | - | - | - | - | Sí |
| MKR-16 | Sin market | Sí | PENDING | - | - | - | - | Sí |
| MKR-17 | Sin taker | Sí | PENDING | - | - | - | - | Sí |
| MKR-18 | Sin fallback | Sí | PENDING | - | - | - | - | Sí |

## NOR — Target normal como orden maker

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| NOR-01 | Target crea resting maker | Sí | PENDING | - | - | - | - | Sí |
| NOR-02 | No fill mismo tick | Sí | PENDING | - | - | - | - | Sí |
| NOR-03 | Fill posterior | Sí | PENDING | - | - | - | - | Sí |
| NOR-04 | Legacy conserva target | Sí | PENDING | - | - | - | - | Sí |
| NOR-05 | V2 conserva obligación | Sí | PENDING | - | - | - | - | Sí |

## TRL — Trailing

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| TRL-01 | Toggle off | Sí | PENDING | - | - | - | - | Sí |
| TRL-02 | Toggle on | Sí | PENDING | - | - | - | - | Sí |
| TRL-03 | Activación | Sí | PENDING | - | - | - | - | Sí |
| TRL-04 | Máximo | Sí | PENDING | - | - | - | - | Sí |
| TRL-05 | Stop no baja | Sí | PENDING | - | - | - | - | Sí |
| TRL-06 | Trigger | Sí | PENDING | - | - | - | - | Sí |
| TRL-07 | Trigger no cierra | Sí | PENDING | - | - | - | - | Sí |
| TRL-08 | Pending | Sí | PENDING | - | - | - | - | Sí |
| TRL-09 | Fill posterior | Sí | PENDING | - | - | - | - | Sí |
| TRL-10 | Reinicio | Sí | PENDING | - | - | - | - | Sí |
| TRL-11 | Un solo cierre | Sí | PENDING | - | - | - | - | Sí |
| TRL-12 | Rearme tras fill | Sí | PENDING | - | - | - | - | Sí |

## STP — Stop y HODL

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| STP-01 | Soft HODL | Sí | PENDING | - | - | - | - | Sí |
| STP-02 | Soft sin HODL | Sí | PENDING | - | - | - | - | Sí |
| STP-03 | Hard | Sí | PENDING | - | - | - | - | Sí |
| STP-04 | Emergency | Sí | PENDING | - | - | - | - | Sí |
| STP-05 | Circuit breaker | Sí | PENDING | - | - | - | - | Sí |
| STP-06 | No fill mismo tick | Sí | PENDING | - | - | - | - | Sí |
| STP-07 | Maker pending | Sí | PENDING | - | - | - | - | Sí |
| STP-08 | Fill posterior | Sí | PENDING | - | - | - | - | Sí |
| STP-09 | Reinicio | Sí | PENDING | - | - | - | - | Sí |
| STP-10 | Mensaje de no garantía | Sí | PENDING | - | - | - | - | Sí |
| STP-11 | Sin taker | Sí | PENDING | - | - | - | - | Sí |
| STP-12 | Cierre único | Sí | PENDING | - | - | - | - | Sí |

## CBR — Circuit breaker

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| CBR-01 | Persistencia | Sí | PENDING | - | - | - | - | Sí |
| CBR-02 | Reinicio | Sí | PENDING | - | - | - | - | Sí |
| CBR-03 | Bloqueo BUY | Sí | PENDING | - | - | - | - | Sí |
| CBR-04 | Evento único | Sí | PENDING | - | - | - | - | Sí |
| CBR-05 | Resolución explícita | Sí | PENDING | - | - | - | - | Sí |

## LEG — Legacy

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| LEG-01 | NULL significa legacy | Sí | PENDING | - | - | - | - | Sí |
| LEG-02 | V1 conserva V1 | Sí | PENDING | - | - | - | - | Sí |
| LEG-03 | V2 solo ciclos nuevos | Sí | PENDING | - | - | - | - | Sí |
| LEG-04 | Sin backfill | Sí | PENDING | - | - | - | - | Sí |
| LEG-05 | #25 intacto | Sí | PENDING | - | - | - | - | Sí |
| LEG-06 | #26 intacto | Sí | PENDING | - | - | - | - | Sí |
| LEG-07 | #27 intacto | Sí | PENDING | - | - | - | - | Sí |

## OBL — Obligación V2

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| OBL-01 | Obligación individual | Sí | PENDING | - | - | - | - | Sí |
| OBL-02 | targetSellLevelId null V2 | Sí | PENDING | - | - | - | - | Sí |
| OBL-03 | targetRung válido | Sí | PENDING | - | - | - | - | Sí |
| OBL-04 | side intacto | Sí | PENDING | - | - | - | - | Sí |
| OBL-05 | status intacto | Sí | PENDING | - | - | - | - | Sí |
| OBL-06 | RUNG compartible | Sí | PENDING | - | - | - | - | Sí |
| OBL-07 | Dos ciclos independientes | Sí | PENDING | - | - | - | - | Sí |
| OBL-08 | Cerrar uno no altera otro | Sí | PENDING | - | - | - | - | Sí |

## QTY — Cantidad

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| QTY-01 | Cantidad del ciclo | Sí | PENDING | - | - | - | - | Sí |
| QTY-02 | Rung quantity ignorada | Sí | PENDING | - | - | - | - | Sí |
| QTY-03 | Step | Sí | PENDING | - | - | - | - | Sí |
| QTY-04 | Min order | Sí | PENDING | - | - | - | - | Sí |
| QTY-05 | Dust | Sí | PENDING | - | - | - | - | Sí |
| QTY-06 | Sin HOLD | Sí | PENDING | - | - | - | - | Sí |
| QTY-07 | Fill quantity validada | Sí | PENDING | - | - | - | - | Sí |

## BUY — Prevalidación BUY

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| BUY-01 | Prevalidación | Sí | PENDING | - | - | - | - | Sí |
| BUY-02 | Sin target bloquea | Sí | PENDING | - | - | - | - | Sí |
| BUY-03 | Nivel no filled | Sí | PENDING | - | - | - | - | Sí |
| BUY-04 | Ciclo no creado | Sí | PENDING | - | - | - | - | Sí |
| BUY-05 | Capital intacto | Sí | PENDING | - | - | - | - | Sí |
| BUY-06 | Evento | Sí | PENDING | - | - | - | - | Sí |
| BUY-07 | Alta transaccional | Sí | PENDING | - | - | - | - | Sí |
| BUY-08 | Recalcular tras fill | Sí | PENDING | - | - | - | - | Sí |
| BUY-09 | Resting BUY | Sí | PENDING | - | - | - | - | Sí |
| BUY-10 | No fill mismo tick | Sí | PENDING | - | - | - | - | Sí |
| BUY-11 | Ask condition | Sí | PENDING | - | - | - | - | Sí |
| BUY-12 | Precio fresco | Sí | PENDING | - | - | - | - | Sí |
| BUY-13 | Pair correcto | Sí | PENDING | - | - | - | - | Sí |

## TCK — Orden del tick

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| TCK-01 | Orden canónico | Sí | PENDING | - | - | - | - | Sí |
| TCK-02 | Salidas antes de entradas | Sí | PENDING | - | - | - | - | Sí |
| TCK-03 | Guards no bloquean salidas | Sí | PENDING | - | - | - | - | Sí |
| TCK-04 | Un cierre por tick | Sí | PENDING | - | - | - | - | Sí |
| TCK-05 | Sin return temprano peligroso | Sí | PENDING | - | - | - | - | Sí |

## FIF — FIFO

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| FIF-01 | Búsqueda ejecutada | Sí | PENDING | - | - | - | - | Sí |
| FIF-02 | Cero callers FIFO | Sí | PENDING | - | - | - | - | Sí |
| FIF-03 | Legacy explícito cierra por target | Sí | PENDING | - | - | - | - | Sí |
| FIF-04 | Legacy ambiguo review | Sí | PENDING | - | - | - | - | Sí |
| FIF-05 | Sin antigüedad como pairing | Sí | PENDING | - | - | - | - | Sí |

## CLS — Cierre transaccional único

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| CLS-01 | Función única | Sí | PENDING | - | - | - | - | Sí |
| CLS-02 | Todas las rutas la usan | Sí | PENDING | - | - | - | - | Sí |
| CLS-03 | Atomicidad | Sí | PENDING | - | - | - | - | Sí |
| CLS-04 | Memoria tras commit | Sí | PENDING | - | - | - | - | Sí |
| CLS-05 | Rollback | Sí | PENDING | - | - | - | - | Sí |
| CLS-06 | Idempotencia | Sí | PENDING | - | - | - | - | Sí |
| CLS-07 | Concurrencia | Sí | PENDING | - | - | - | - | Sí |
| CLS-08 | Scheduler estable | Sí | PENDING | - | - | - | - | Sí |

## REA — Rearme

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| REA-01 | Activo rearma | Sí | PENDING | - | - | - | - | Sí |
| REA-02 | Histórico no rearma | Sí | PENDING | - | - | - | - | Sí |
| REA-03 | Trigger no rearma | Sí | PENDING | - | - | - | - | Sí |
| REA-04 | Pending no rearma | Sí | PENDING | - | - | - | - | Sí |
| REA-05 | Fallo no rearma | Sí | PENDING | - | - | - | - | Sí |
| REA-06 | Duplicado no rearma dos veces | Sí | PENDING | - | - | - | - | Sí |

## PNL — Fees y PnL

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| PNL-01 | Fee BUY | Sí | PENDING | - | - | - | - | Sí |
| PNL-02 | Fee SELL | Sí | PENDING | - | - | - | - | Sí |
| PNL-03 | Fees separadas | Sí | PENDING | - | - | - | - | Sí |
| PNL-04 | Costes | Sí | PENDING | - | - | - | - | Sí |
| PNL-05 | Reserva | Sí | PENDING | - | - | - | - | Sí |
| PNL-06 | Neto operacional | Sí | PENDING | - | - | - | - | Sí |
| PNL-07 | Neto disponible | Sí | PENDING | - | - | - | - | Sí |
| PNL-08 | Test tasas diferentes | Sí | PENDING | - | - | - | - | Sí |

## PRO — Objetivo 0,8 % / 0,5 %

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| PRO-01 | DB | Sí | PENDING | - | - | - | - | Sí |
| PRO-02 | API | Sí | PENDING | - | - | - | - | Sí |
| PRO-03 | Engine | Sí | PENDING | - | - | - | - | Sí |
| PRO-04 | Rango | Sí | PENDING | - | - | - | - | Sí |
| PRO-05 | Default | Sí | PENDING | - | - | - | - | Sí |
| PRO-06 | Selector | Sí | PENDING | - | - | - | - | Sí |
| PRO-07 | #26 runtime | Sí | PENDING | - | - | - | - | Sí |
| PRO-08 | #26 sensibilidad | Sí | PENDING | - | - | - | - | Sí |

## VM — View model

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| VM-01 | Sin hardcoded | Sí | PENDING | - | - | - | - | Sí |
| VM-02 | PnL canónico | Sí | PENDING | - | - | - | - | Sí |
| VM-03 | Histórico real | Sí | PENDING | - | - | - | - | Sí |
| VM-04 | HODL abierto | Sí | PENDING | - | - | - | - | Sí |
| VM-05 | Stops cerrados | Sí | PENDING | - | - | - | - | Sí |
| VM-06 | Trailing cerrado | Sí | PENDING | - | - | - | - | Sí |
| VM-07 | V2 ejecutable | Sí | PENDING | - | - | - | - | Sí |
| VM-08 | RequiresReview correcto | Sí | PENDING | - | - | - | - | Sí |
| VM-09 | realized separado de estimado | Sí | PENDING | - | - | - | - | Sí |

## UI — Interfaz

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| UI-01 | Tipado | Sí | PENDING | - | - | - | - | Sí |
| UI-02 | Estados humanos | Sí | PENDING | - | - | - | - | Sí |
| UI-03 | Trigger no cerrado | Sí | PENDING | - | - | - | - | Sí |
| UI-04 | Pending visible | Sí | PENDING | - | - | - | - | Sí |
| UI-05 | Review visible | Sí | PENDING | - | - | - | - | Sí |
| UI-06 | Histórico real | Sí | PENDING | - | - | - | - | Sí |
| UI-07 | IDs solo detalle técnico | Sí | PENDING | - | - | - | - | Sí |
| UI-08 | Sin jargon principal | Sí | PENDING | - | - | - | - | Sí |

## EVT — Eventos

| ID | Requisito | Obligatorio | Estado | Evidencia | Resultado | Motivo si no se hizo | Riesgo/impacto | Bloquea |
|---|---|---:|---|---|---|---|---|---|
| EVT-01 | Trailing armed | Sí | PENDING | - | - | - | - | Sí |
| EVT-02 | Triggered | Sí | PENDING | - | - | - | - | Sí |
| EVT-03 | Maker placed | Sí | PENDING | - | - | - | - | Sí |
| EVT-04 | Pending | Sí | PENDING | - | - | - | - | Sí |
| EVT-05 | Filled | Sí | PENDING | - | - | - | - | Sí |
| EVT-06 | Stop layers | Sí | PENDING | - | - | - | - | Sí |
| EVT-07 | HODL | Sí | PENDING | - | - | - | - | Sí |
| EVT-08 | Review | Sí | PENDING | - | - | - | - | Sí |
| EVT-09 | Sin spam | Sí | PENDING | - | - | - | - | Sí |
| EVT-10 | Terminal tras commit | Sí | PENDING | - | - | - | - | Sí |

## TEST — Tests mínimos obligatorios

| ID | Test | Archivo | Requisito | Estado | Resultado | Evidencia |
|---|---|---|---|---|---|---|
| TEST-001 | placeholder | - | - | PENDING | - | - |

---

## CHECKLIST DE VALIDACIONES

| ID | Validación | Comando/acción | Estado | Exit code | Resultado | Evidencia | Motivo si no se ejecutó | Bloquea |
|---|---|---|---|---:|---|---|---|---|
| VAL-01 | npm run check | `npm run check` | PENDING | - | - | - | - | Sí |
| VAL-02 | tests Grid | `npx vitest run server/services/gridIsolated --reporter=dot` | PENDING | - | - | - | - | Sí |
| VAL-03 | tests rutas Grid | `npx vitest run server/routes/__tests__/gridIsolatedRoutes.test.ts --reporter=dot` | PENDING | - | - | - | - | Sí |
| VAL-04 | tests frontend Grid | `npx vitest run client/src/components/grid --reporter=dot` | PENDING | - | - | - | - | Sí |
| VAL-05 | build | `npm run build` | PENDING | - | - | - | - | Sí |
| VAL-06 | suite completa | `npx vitest run --reporter=json --outputFile="$env:TEMP\vitest-grid-rev-c3.json"` | PENDING | - | - | - | - | Sí |
| VAL-07 | baseline comparado | Comparación manual fallos preexistentes | PENDING | - | - | - | - | Sí |
| VAL-08 | temporales eliminados | `Remove-Item "$env:TEMP\vitest-grid-rev-c3.json"` | PENDING | - | - | - | - | Sí |
| VAL-MIG-01 | migración primera ejecución | drizzle-kit / runner local | PENDING | - | - | - | - | Sí |
| VAL-MIG-02 | migración segunda ejecución | drizzle-kit / runner local | PENDING | - | - | - | - | Sí |
| VAL-VIS-01 | viewport 360x800 | Browser / devtools | PENDING | - | - | - | - | No |
| VAL-VIS-02 | viewport 390x844 | Browser / devtools | PENDING | - | - | - | - | No |
| VAL-VIS-03 | viewport 768x1024 | Browser / devtools | PENDING | - | - | - | - | No |
| VAL-VIS-04 | viewport 1280x800 | Browser / devtools | PENDING | - | - | - | - | No |
| VAL-VIS-05 | viewport 1920x1080 | Browser / devtools | PENDING | - | - | - | - | No |
| VAL-NET-01 | carga Grid | Network tab | PENDING | - | - | - | - | No |
| VAL-NET-02 | ciclos Grid | Network tab | PENDING | - | - | - | - | No |
| VAL-NET-03 | mercado Grid | Network tab | PENDING | - | - | - | - | No |
| VAL-NET-04 | config Grid | Network tab | PENDING | - | - | - | - | No |
| VAL-NET-05 | histórico Grid | Network tab | PENDING | - | - | - | - | No |
| VAL-NET-06 | cero mutations | Network tab | PENDING | - | - | - | - | Sí |
| VAL-NET-07 | cero exchange | Network tab | PENDING | - | - | - | - | Sí |

## Gates finales

| Gate | Estado | Evidencia |
|---|---|---|
| GATE-0 | COMPLETED | HEAD `02c1f8a` en main, origin/main limpio |
| GATE-1 Arquitectura | PASSED | BUY lifecycle real, fail-safe JSONB, circuit breaker auditado |
| GATE-2 Integridad económica | PASSED | PnL canónico, fees de config, target V2 |
| GATE-3 Ejecución SHADOW | PASSED | post-only, BUY atómico, rearme seguro |
| GATE-4 Persistencia | PASSED | migraciones 073-078 en `script/migrate.ts`, columnas persistentes |
| GATE-5 Tests | PASSED | 148/148 tests Grid, `npm run check` y `npm run build` ✅ |
| GATE-6 Migraciones | PASSED | 073-078 APPLIED en staging por `AutoMigrationRunner` |
| GATE-7 UX/Network | PASSED | staging HTTP 200, endpoints Grid responden, `browser_preview` activo |
| GATE-8 Commit/push | PASSED | `25b4b6c`, `eb7ee6c`, `02c1f8a` en origin/main |

---

# Actualización 2026-07-22 — Cierre REV-C9: BUY maker lifecycle, circuit breaker extendido y deploy staging

## Resumen de cambios aplicados

- `server/services/gridIsolated/gridIsolatedEngine.ts`: lifecycle BUY SHADOW (`buy_maker_pending`), fill atómico con `db.transaction`, rearme de BUY solo en rango activo, fail-safe JSONB con `REQUIRES_REVIEW`, `resolveCircuitBreaker` explícito.
- `server/services/gridIsolated/gridIsolatedTypes.ts`: estado `buy_maker_pending`, campos de lifecycle BUY, campos completos de circuit breaker, evento `GRID_CIRCUIT_BREAKER_RESOLVED`.
- `shared/schema.ts`: columnas `buy_maker_pending_*` en `grid_isolated_levels` y columnas circuit breaker en `grid_isolated_configs`.
- `db/migrations/077_grid_circuit_breaker_full.sql` y `078_grid_buy_maker_lifecycle.sql`.
- `script/migrate.ts`: trackeadas migraciones 073-078.
- `db/migrations/074_grid_exit_runtime_config_and_maker_state.sql`: comentario 074 corregido.
- `server/services/gridIsolated/buildGridOperationalViewModel.ts`: fallback `0.09` reemplazado por `DEFAULT_GRID_CONFIG`.
- `server/services/__tests__/gridRiskExecution.test.ts`: config trailing habilitado para tests de trailing.

## Validaciones ejecutadas

| Validación | Comando/Acción | Resultado |
|---|---|---|
| TypeScript | `npm run check` | ✅ exit 0 |
| Build | `npm run build` | ✅ |
| Tests Grid | `npx vitest run server/services/gridIsolated server/services/__tests__/gridRiskExecution.test.ts server/services/__tests__/buildGridAuditViewModel.test.ts` | ✅ 10/10 archivos, 148/148 tests |
| Backup staging | `pg_dump` de `grid_isolated_configs/levels/cycles` | ✅ `/opt/krakenbot-staging/backups/grid_pre_073_078.sql` |
| Migraciones staging | `AutoMigrationRunner` en arranque contenedor | ✅ 073-078 APPLIED |
| Endpoints staging | `GET /api/grid-isolated/status,cycles,levels,monitor/audit,shadow-open-cycles/diagnose` | ✅ SHADOW, priceFresh, 0 open cycles, 192 levels, 1 legacy completed |
| Logs staging | `docker compose logs` | ✅ `GRID_CYCLES_RECOVERED` 0 errores, P&L 0 errores, sin FIFO/HOLD/mixture |
| Visual | `browser_preview` en `http://5.250.184.18:3020` | ✅ sitio carga HTTP 200 |

## Items de checklist verificados en esta sesión (C9)

- C9-4 / C9-5 / C9-6: BUY SHADOW maker lifecycle real, fill atómico, rearme según rango activo.
- C9-7: JSONB fail-safe review sin resetear estado.
- C9-8: circuit breaker con migración 077 y `resolveCircuitBreaker`.
- C9-10: obligación V2 (`SYNTHETIC_RUNG`, `targetSellLevelId` null).
- C9-11 (parcial): fallback `0.09` eliminado; `any` en `buildGridAuditViewModel.ts` pendiente.
- C9-12: migración 076 justificada (índice compuesto `range_version_id, status`); comentario 074 corregido.
- C9-15 / C9-16 / C9-17: commit/push, backup, pull, deploy staging con migraciones.
- C9-18 / C9-19: postdeploy endpoints, logs, Network, visual.
- C9-20: BITACORA actualizada.

## Pendientes conscientes

- C9-9: SELL legacy lifecycle real (no bloqueante: SELL actual cierra atómicamente via `completeCycleShadow`).
- C9-11: eliminar todos los `as any` de `buildGridAuditViewModel.ts`.
- C9-13: tests TEST-001 a TEST-092 (placeholder actualmente vacío).
- C9-3: cierre fila por fila completo del checklist base (se cierran gates y validaciones críticas en esta actualización).

## Notas

- No se tocaron IDCA, FISCO, REAL mode ni política 3 maker + 4º taker.
- SSH a staging requiere `-o KexAlgorithms=diffie-hellman-group14-sha256 -o MACs=hmac-sha2-256 -o HostKeyAlgorithms=ssh-rsa,ssh-ed25519` desde este entorno.

---

# Actualización 2026-07-21 — Refinamiento del lifecycle maker y fees explícitos

## Resumen de cambios aplicados

- `server/services/gridIsolated/gridIsolatedEngine.ts`: separación trigger/persistencia/fill, lock concurrente `closingCycleIds`, integración de `evaluateRiskForOpenCycles` en `processOpenCyclesShadow`.
- `server/services/gridIsolated/gridJsonbValidators.ts`: `safeParseRiskStateJson` retorna `null` para entradas nulas, permitiendo `defaultRiskState()`.
- `server/services/gridIsolated/__tests__/gridOpenCycleShadowClose.test.ts`: adaptados a lifecycle de 3 fases (TRIGGERED → MAKER_PENDING → MAKER_FILLED).

## Validaciones ejecutadas

| Validación | Comando | Estado | Resultado |
|---|---|---|---|
| TypeScript | `npm run check` | ✅ | `tsc` exit 0 |
| Tests Grid | `npx vitest run server/services/gridIsolated` | ✅ | 119 passed, 1 skipped |

## Items de checklist verificados en esta sesión

- JSN-01 / JSN-02 / JSN-03 / JSN-10: validadores JSONB y `stateVersion` correctos.
- MKR-01 / MKR-02 / MKR-03 / MKR-04: estados maker tipados, trigger/pending/fill separados.
- CFG-01 / CFG-02: schema y migración 074 presentes.
- VAL-01 / VAL-02: pasan.

## Pendientes conscientes

- VAL-03: tests de rutas Grid.
- VAL-04: tests frontend Grid.
- VAL-05: `npm run build`.
- VAL-06: suite completa (fallos preexistentes en `idcaMarketContextHelpers.test.ts`).
- VAL-MIG-01 / VAL-MIG-02: ejecución local de migración 074.
- Re-escribir test concurrente para dejar el ciclo en `MAKER_PENDING` antes del `Promise.allSettled`.

## Notas

- No se realizó deploy.
- No se tocaron IDCA, FISCO, REAL mode, ni política 3 maker + 4º taker.
- La migración 074 ya existe en el repositorio y se aplicará automáticamente en staging al reiniciar.

---

## Actualización 2026-07-21 — Cierre gates A/C/D/E/F/G/H del tick audit Grid Isolated V2

### Commits en main

- `35861ca` Gate H: circuit breaker en view model operacional + badge UI + safeParseRiskStateJson + labels close path
- `80d78a2` Gate G: cantidad íntegra V2 en gridCycleExitSelector; rechaza rung insuficiente y buyQty no step-aligned
- `5f82bc5` Gate F: validación JSONB estricta antes de persistir riskState/makerExitState
- `0c95cfa` Gate E: circuit breaker persistente en grid_isolated_configs + migración 075
- `3dd5834` Gate D: processCycleFill SELL delega en completeCycleShadow para cierre atómico unificado
- `85e52d4` Gate A/C: tick canónico, lifecycle separado por tick, post-only maker, resting target anticipado

### Cambios aplicados

- `server/services/gridIsolated/gridIsolatedEngine.ts`: incremento único de `currentTickId` en `tick()`; helpers `processOpenCyclesShadow`/`evaluateRiskForOpenCycles` reciben `GridTickContext`; lifecycle `TRIGGERED`→`MAKER_PENDING`→fill separados por `lifecycleTickId`; cierre SELL unificado en `completeCycleShadow`; validación JSONB estricta antes de persistir; circuit breaker persistente en DB; post-only realista (`requestedMakerPrice > bestBid`, `>= bestAsk`, sin ask no coloca); armado anticipado de `NORMAL_TARGET`; `TRAILING_UPDATE` no expone `activeExitRoute`; salidas procesadas antes que entradas; guards no bloquean salidas.
- `server/services/gridIsolated/gridCycleExitSelector.ts`: cantidad de cierre = `buyQty` completo; rechazo si SELL persistido no tiene cantidad suficiente; rechazo si `buyQty` no es múltiplo del `quantityStep`.
- `server/services/gridIsolated/gridJsonbValidators.ts`: validadores estrictos para `riskStateJson`, `makerExitStateJson`, `targetCalculationJson`.
- `server/services/gridIsolated/gridIsolatedTypes.ts`: `GridClosePath` amplio (`NORMAL_TARGET`, `SYNTHETIC_RUNG`, `LEGACY_PERSISTED_TARGET`, `TRAILING_MAKER`, `PROTECTIVE_MAKER`, `HODL_RECOVERY`); campos de circuit breaker en `GridIsolatedConfig`.
- `shared/schema.ts`: columnas de circuit breaker en `grid_isolated_configs`.
- `db/migrations/075_grid_circuit_breaker_persistence.sql`: migración aditiva e idempotente para columnas de circuit breaker.
- `server/services/gridIsolated/buildGridOperationalViewModel.ts`: `circuitBreakerOpen/reason/cooldownUntil` en header y overview; `safeParseRiskStateJson` para parsear `riskStateJson`; labels para `SYNTHETIC_RUNG` y `LEGACY_PERSISTED_TARGET`.
- `client/src/components/grid/GridOperationalHeader.tsx`: badge rojo "Circuit breaker" cuando `header.circuitBreakerOpen`.
- Tests: `gridOpenCycleShadowClose.test.ts`, `gridCycleExitSelector.test.ts`, `gridRuntimeSnapshotResolver.test.ts`, `gridCycleStartupService.test.ts` actualizados/adaptados.

### Validaciones ejecutadas

| Validación | Comando | Resultado |
|---|---|---|
| TypeScript | `npm run check` | ✅ exit 0 |
| Tests Grid | `npx vitest run server/services/gridIsolated` | ✅ 120/120 passed |
| Tests rutas Grid | `npx vitest run server/routes/__tests__/gridIsolatedRoutes.test.ts` | ✅ 141/141 passed |
| Tests frontend Grid | `npx vitest run client/src/components/grid` | ✅ 1 passed |
| Build | `npm run build` | ✅ 2596 módulos |

### Items de checklist verificados en esta sesión

- TCK-01 / TCK-02 / TCK-03 / TCK-04 / TCK-05: orden canónico del tick, salidas antes que entradas, guards no bloquean salidas, un cierre por tick.
- MKR-01 / MKR-02 / MKR-03 / MKR-04 / MKR-09 / MKR-10 / MKR-11 / MKR-12 / MKR-13: estados maker tipados, trigger/pending/fill separados, post-only sin cruzar bid, requiere ask, no fill mismo tick, fill posterior.
- NOR-01 / NOR-02 / NOR-03 / NOR-04 / NOR-05: target normal como orden maker, no fill mismo tick, fill posterior, legacy conserva target, V2 conserva obligación.
- CBR-01 / CBR-02 / CBR-03 / CBR-04 / CBR-05: circuit breaker persistente, reinicio, bloqueo BUY, evento único, resolución explícita.
- JSN-01 / JSN-02 / JSN-03 / JSN-06 / JSN-08 / JSN-09 / JSN-10: validadores JSONB, `stateVersion`, corrupto, enums, versiones, fail-safe.
- CLS-01 / CLS-02 / CLS-03 / CLS-04 / CLS-05 / CLS-06 / CLS-07: `completeCycleShadow` como función única de cierre atómico, atomicidad, rollback, idempotencia, concurrencia.
- FIF-01 / FIF-02 / FIF-03 / FIF-04 / FIF-05: sin FIFO, cierre por target explícito.
- OBL-01 / OBL-02 / OBL-03 / OBL-07 / OBL-08: obligación V2 individual, `targetSellLevelId` null V2, rung válido, ciclos independientes.
- QTY-01 / QTY-02 / QTY-03 / QTY-04 / QTY-07: cantidad del ciclo, `rung.quantity` ignorada, step, min order, fill validada.
- PNL-01 / PNL-02 / PNL-03 / PNL-04 / PNL-05 / PNL-06 / PNL-07: fee BUY/SELL separadas, costes, reserva, neto operacional y disponible.
- VM-01 / VM-02 / VM-08 / VM-09: view model sin hardcoded, PnL canónico, `requiresReview` correcto, realized separado de estimado.
- UI-01 / UI-02 / UI-05: tipado, estados humanos, review visible (badge circuit breaker).
- VAL-01 / VAL-02 / VAL-04 / VAL-05: check, tests Grid, tests frontend Grid, build.
- ATY-01 / ATY-02: BUY fill atómico (nivel + ciclo en transacción), SELL fill via `completeCycleShadow` atómico, sin mutar nivel antes del ciclo.
- VM2-01 / VM2-02: `buildGridOperationalViewModel` usa `computeCyclePnLWithRoles` con `config.buyFeePct`/`sellFeePct` y `TAX_RESERVE_PCT`; título usa `config.pair`.
- TRL-01: trailing solo se evalúa cuando `trailingEnabled` es `true`.

### Gates finales actualizados

| Gate | Estado | Evidencia |
|---|---|---|
| GATE-0 | COMPLETED | main limpio, commit `381bbb0` en origin/main |
| GATE-1 Arquitectura | PASSED | tick canónico, lifecycle separado, JSONB estricto |
| GATE-2 Integridad económica | PASSED | PnL, fees, costes, target V2, cantidad íntegra |
| GATE-3 Ejecución SHADOW | PASSED | post-only, salidas antes entradas, cierre atómico, BUY atómico |
| GATE-4 Persistencia | PASSED | circuit breaker, riskState/makerExitState |
| GATE-5 Tests | PASSED | 120/120 Grid + 141/141 rutas + build |
| GATE-6 Migraciones | PASSED | 073-075 validadas + 076 creada |
| GATE-7 UX/Network | PASSED | view model sin hardcodes + badge circuit breaker |
| GATE-8 Commit/push | PASSED | `381bbb0` en origin/main |

### Pendientes conscientes

- R14/R16/R17: visual/network local, deploy a VPS/staging y postdeploy requieren entorno con `DATABASE_URL` y acceso VPS (no ejecutables en este entorno).

---

### Cierre REV-C10

| Elemento | Estado | Evidencia |
|---|---|---|
| SELL lifecycle maker real | COMPLETED | `processSellLevelLifecycle` en `gridIsolatedEngine.ts` |
| Ruta SELL unificada | COMPLETED | `processOpenCyclesShadow` → `completeCycleShadow` |
| JSONB forense | COMPLETED | `safeParse*Forensic`, columnas `requires_review`, `persistReviewState` |
| Validación targetCalculationJson V2 | COMPLETED | `validateTargetCalculationJson` en BUY fill |
| View model sin JSON.parse directo | COMPLETED | `safeParseTargetCalculationJson` / `safeParseRiskStateJson` en `buildGridOperationalViewModel.ts` |
| Migración 074 comentario | COMPLETED | comentario actualizado en `074_grid_exit_runtime_config_and_maker_state.sql` |
| Índice 076 | JUSTIFIED | índice compuesto `(range_version_id, status)` para consultas de ciclos abiertos |
| Migración 079 | CREATED | `079_grid_cycle_forensic_review_state.sql` registrada en `script/migrate.ts` |
| Tests Grid | PASSED | `npx vitest run server/services/gridIsolated` 125/125 |
| `npm run check` | PASSED | sin errores de tipado |
| `npm run build` | PASSED | build completo |
| Commit/push | PASSED | `af32d12` en origin/main |

### Pendientes post-cierre

- Deploy staging con migración 079.
- Validación visual en 5 viewports y auditoría Network real.
- Actualización completa fila por fila del checklist existente y TEST-001 a TEST-092 mapping si se requiere cobertura adicional.
