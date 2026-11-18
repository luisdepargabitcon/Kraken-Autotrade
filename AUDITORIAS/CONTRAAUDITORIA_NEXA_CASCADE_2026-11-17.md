# CONTRAAUDITORÍA NEXA — Cascade (Issue #9)



**Fecha de ejecución:** 2026-11-18 (UTC) · **Alcance:** solo lectura (SELECT / READ ONLY, inspección de procesos y código) · **Estado de la entrega:** FASE 1 de exportación **COMPLETA AL CORTE 2026-11-18T18:15Z — incluidas las 31 tablas FISCO, los originales antes resumidos y `data.candles` de todos los snapshots existentes** (deriva posterior documentada en §9) · **No desplegado, no mergeado, sin cambios en VPS/DB/estrategias.**



> Este documento es **público y agregado**. No contiene operaciones individuales, identificadores de órdenes, credenciales, balances privados ni datos fiscales. Los datos de detalle están en una carpeta privada de Google Drive (ver §9).



## 0. Resumen ejecutivo



1. **El VPS no ejecuta `main`.** Corre la rama `integration/staging-spot-v4` @ `3ae18319` (2026-09-20), **101 commits por delante y 2 por detrás** de `main` (`81f212c`, 2026-11-17). La auditoría inicial se basó en `9ca8506` (2026-08-30). Todo hallazgo "de main" requiere cotejo con esta rama.

2. **Hallazgo crítico nuevo (NEW-01): bucle de reinicios por OOM (~500 reinicios/día).** `server/services/spotAiForwardTwin/spotAiDurableTrainingStore.ts:1202` ejecuta `SELECT data FROM spot_forward_twin_snapshots ORDER BY timestamp ASC` **sin límite**, cargando una tabla de ~53.400 filas (~4,5 GB de JSON) en memoria de Node (heap ≈2 GB) → `FATAL ERROR: JavaScript heap out of memory`. Evidencia: `RestartCount` ≈16.700–16.900, 6.499 eventos `BOT_STARTED` en 14 días (≈500/día, 05–18 nov), traza OOM en `JsonParser`, y la consulta activa en `pg_stat_activity` con la BD al ~98 % de CPU. Este bucle afecta a **todos los motores** (estado en memoria perdido cada ~3 min).

3. **SPOT (−845,01 USD) es SHADOW, no dinero real.** Son 167 ventas `SHADOW` (20-ago→12-nov, política `SPOT-1.0.0-20260812`) con comisiones **ESTIMADAS** (732,24 USD). Acierto 28,1 % (47/167), **PF neto 0,683** (coincide con pantalla); **PF bruto 0,947** y expectativa bruta −0,68 USD/op frente a −5,06 USD/op neta: **las comisiones estimadas explican ~86 % de la pérdida por operación**. La salida `STRUCTURE_INVALIDATION` concentra el daño (98 ops, 4 ganadoras, −2.050 USD neto).

4. **IDCA: los 31 ciclos son `live` pero la configuración actual es `simulation`; sin ciclos nuevos desde 2026-09-03.** Se reproduce la suma cruda +1.735,92 USD; el PnL "canónico" −445,90 USD no se pudo reproducir con la información accesible, pero se demuestran **inconsistencias estructurales** entre filas de ciclo y órdenes (ciclos 15, 17, 18, 21, 26, 31) y **cantidad residual sin respaldo en órdenes** (22, 24, 26).

5. **El trailing buy de IDCA no puede completarse:** 2.964 `trailing_buy_activated` y 4.347 `level1_activated` frente a **2** `trailing_buy_triggered` (estado en `Map` en memoria + reinicio cada ~3 min).

6. **Grid:** 100 % SHADOW, 17 ciclos históricos (+40,16 USD neto simulado), 43 de 2.250 niveles `filled`; 1.243 `planned` y 931 `replaced` **no son órdenes reales**. Bloqueo dominante: `GRID_PROFESSIONAL_GENERATOR_NOT_VIABLE` / `NO_VIABLE_RANGE`.

7. **AMA:** modo `OFF`, estado `OBSERVING`, último tick 2026-08-17, `NOT_READY`; 0 operaciones; sin posiciones.

8. **Cartera global vacía:** las tablas `portfolio_*`, `open_positions`, reservas y locks tienen 0 filas; solo existe un presupuesto AMA/BTC de 5.000 USD sin desplegar.

9. **Seguridad confirmada en runtime:** el panel (puerto 3020) responde `200` desde Internet y un endpoint `/api/...` responde `200` **sin autenticación**; el código no contiene middleware de autenticación en rutas HTTP (solo en WebSockets). `.env`/`.env.stg` están versionados; `docker.sock` montado en la app.

10. **Revolut X:** 108 errores `401 Unauthorized` en 30 min sobre endpoints de mercado (`order_book`, `trades`, `trades/public`), con credenciales presentes en BD desde 2026-01-18 → probable credencial caducada/revocada o esquema de firma inválido (**hipótesis, no verificada**).



## 1. Versión realmente desplegada (OPS-01)



| Elemento | Valor |

|---|---|

| Rama / SHA VPS | `integration/staging-spot-v4` / `3ae18319b8c0b68c9374241db65f8ef9bdd39a57` (2026-09-20) |

| `main` actual | `81f212c6331886b6ff8c84c15ec65272d3f9dd05` (2026-11-17) |

| Divergencia (API compare) | `diverged`: 101 ahead, 2 behind, ~300 archivos |

| Árbol de trabajo VPS | 4 rutas sin versionar (`artifacts/`, `audits/`, `backups/`, un `spotReplayRunner.ts`) |

| Contenedor app | creado 2026-09-20, `unless-stopped`, RestartCount ≈ 16.900 |

| PostgreSQL | 16.11, 10,08 GB |

| Modo observado | SPOT canónico SHADOW; IDCA `simulation`; Grid `SHADOW`; AMA `OFF`; REAL no activo |



## 2. Inventario de motores



| Motor | Estado real observado | Datos |

|---|---|---|

| SPOT canónico (`server/services/spot/*`) | activo SHADOW, política `SPOT-1.0.0-20260812` | `trades` 578 (REAL 411 histórico ene–mar; SHADOW 167) |

| SPOT legacy (`tradingEngine.ts`) | **solo supervisor** ("SPOT runtime owner is active… Legacy new entries DISABLED") | – |

| IDCA | habilitado, **simulation**; 31 ciclos históricos `live` | ciclos 31, órdenes 68 |

| Grid Isolated | SHADOW, post-only/maker simulado | ciclos 17, niveles 2.250, eventos 483 k |

| AMA | `OFF` / `OBSERVING` / `NOT_READY` | 0 ciclos, 0 tramos; solo replays LAB |

| Cartera global | sin datos | 0 filas |

| FISCO | **excluido, no tocado** | metadatos mínimos |

| Otros contenedores en el mismo host | `kraken-bot-app` (puerto 3000, ~3 meses), apps ajenas al proyecto | no auditados |



## 3. SPOT — evidencia



Universo SHADOW (167 ventas): ver cifras en §0. Por motivo de salida (neto USD): `STRUCTURE_INVALIDATION` −2.050,4 (98 ops, 4 ganadoras, retención media 86 min), `EMERGENCY` −287,8 (4), `BREAK_EVEN` −21,1 (4), `TIME_EFFICIENCY` +141,0 (49; bruto +336,8, comisiones 195,8), `TRAILING` +501,0 (6), `PROFIT` +872,3 (6). Suma = −845,01 ✔.



Por mes (neto): ago +1.030,0 (41 ops) · sep −1.515,4 (115) · oct −234,1 (7) · nov −125,6 (4). Por par: TON −477,9 · ETH −352,3 · XRP −189,9 · BTC −5,8 · SOL +180,8. La caída de volumen en oct–nov coincide con el periodo de reinicios (relación **no demostrada**).



Coste: comisión ida y vuelta media estimada 0,18 % (4,38 USD/op sobre ~2.436 USD). 106 de las 120 operaciones perdedoras tuvieron MFE>0; 70 con MFE>comisión *(si la unidad de `mfe` es USD — pendiente de verificar)*; 5 operaciones fueron ganadoras brutas y perdedoras netas.



**Universos (pantalla vs JSON histórico):** pantalla −845,01 = SHADOW canónico. El "JSON 389 registros, +366,27 USD" **no se reprodujo**: el libro REAL (ene–mar) tiene 195 ventas con `realized_pnl_usd` = −919,67 y comisiones sin registrar (0,00). No son sumables ni equiparables → **NO VERIFICABLE** hasta conocer el filtro del JSON.



## 4. IDCA — evidencia



- Configuración: BTC `min_dip` 3,00 %, ETH 3,50 %; rebote requerido y trailing buy activos; modo `simulation` (transición 2026-10-22).

- Bloqueos, últimos 14 días (`reason_code`): `insufficient_dip` 4.573 · `vwap_weekly_trend_bearish` 3.045 · `no_rebound_confirmed` 1.480 · `market_score_too_low` 202. No aparecen `confluence_*` ni `max_execution_price_exceeded`.

- Ciclos: 31 (`live`): 20 `trailing_exit` (+2.484,57), 9 `breakeven_exit` (+12,99), 1 `fail_safe` (−106,69), 1 `manual_close` (−654,95). Suma cruda **+1.735,92** ✔ (importados/manuales: 4 ciclos, +477,34 crudos).

- **Conciliación ciclo↔órdenes (PnL por caja = ventas − compras − comisiones):** coinciden en 24 de los 27 ciclos gestionados por el bot; **difieren** el ciclo 18 (cruda 1.128,01 vs caja 85,01), 21 (22,25 vs 648,05), 22 (−0,71 vs 15,62) y los importados 15, 17, 26, 31 (las compras originales no están en `institutional_dca_orders`, por lo que la "caja" solo mide ingresos). Ciclos 22, 24 y 26: cantidad residual en la fila (0,0157 / 0,0180 / 0,0500 BTC) **sin movimientos en órdenes que la expliquen**.

- 0 órdenes huérfanas; 0 ciclos sin órdenes.



## 5. Grid — evidencia



Ciclos (todos SHADOW): 11 `completed` +39,32 · 5 `trailing_closed` +0,84 · 1 `buy_filled` abierto (2026-11-18). Niveles: 1.243 `planned`, 931 `replaced`, 43 `filled`, 24 `cancelled`, 9 `buy_maker_pending`.

Eventos últimos 7 días: `GRID_CYCLES_RECOVERED` 10.654 (efecto de reinicios), `GRID_SHADOW_EXECUTION_PRICE` 7.422, `GRID_PROFESSIONAL_GENERATOR_NOT_VIABLE` 1.721, `GRID_SHADOW_WAITING` 1.490, `GRID_SHADOW_NO_VIABLE_RANGE` 1.117, `GRID_LEVEL_POST_ONLY_REJECTED` 613.

Histórico: `GRID_CYCLES_RECOVERED` 177.217 y `GRID_SHADOW_EXECUTION_PRICE` 164.987 dominan el volumen (tratados como agregados al exportar).



## 6. Comparación con los 16 hallazgos de la auditoría inicial



Veredicto: **CONFIRMADO / REFUTADO / PARCIAL / NO VERIFICABLE** (sobre la rama desplegada salvo indicación).



| ID | Veredicto | Evidencia |

|---|---|---|

| SEC-01 | **CONFIRMADO (runtime)** | Panel :3020 `200` desde Internet; `/api/grid-isolated/status` `200` sin credenciales; compose publica 5435/3020; `.env`/`.env.stg` versionados. Puerto 5435 no accesible desde mi red de prueba (no concluyente). |

| SEC-02 | **CONFIRMADO en código** | `docker.sock` montado; `server/index.ts` captura `res.json` de `/api`. Explotación no probada. |

| OPS-01 | **CONFIRMADO** | §1. |

| SPOT-01 | **NO CAUSAL para las 167 ops** | El motor legacy es solo supervisor y `DEFAULT_SMART_EXIT_CONFIG.enabled=false`; las pérdidas provienen del SPOT canónico. Ausencia de gate de comisión en la ruta SmartExit legacy: confirmado en código, sin impacto runtime demostrado. |

| SPOT-02 | **PARCIAL** | Existe reconstrucción de contexto legacy, pero en la rama desplegada el fallback es `0` (no `3`) y el motor legacy no abre entradas. |

| SPOT-03 | **CONFIRMADO con datos** | PF 0,683, acierto 28,1 %, MFE>0 en 106 pérdidas; unidad MFE por verificar. |

| IDCA-01 | **CONFIRMADO con datos** | §4 (cadena de vetos; `insufficient_dip`, VWAP semanal bajista, rebote). El panel "caída 2,72 % > 1,30 %" es compatible con `no_rebound_confirmed`/VWAP. |

| IDCA-02 | **CONFIRMADO en código; sin impacto observado** | `smartAdjustmentEnabled:false` ("solo diagnóstico") pero se añaden `confluence_hard_blocked/no_entry` (líneas ~4413–4430); 0 ocurrencias en 14 días. |

| IDCA-03 | **NO VERIFICABLE** | Posibilidad matemática; `max_execution_price_exceeded` no aparece en 14 días. |

| IDCA-04 | **CONFIRMADO (código + runtime)** | `Map` en memoria sin rehidratación; 2.964/4.347 activaciones vs 2 disparos; ~500 reinicios/día. |

| GRID-01 | **CONFIRMADO en código** | `no_band_snapshot` → `GRID_SHADOW_NO_LEVELS` y retorno antes del procesamiento de salidas (≈ líneas 1250–1342); frecuencia runtime no medida. |

| GRID-02 | **CONFIRMADO con datos** | §5: NOT_VIABLE y NO_VIABLE_RANGE dominan; falta razón única por tick persistida. |

| GRID-03 | **NO VERIFICADO** | No se contrastó la corrección `moderate→normal_lateral` en la rama desplegada. |

| REPO-01 | **CONFIRMADO** | `.env`, `.env.stg` versionados; `artifacts/`, `audits/`, `backups/` sin versionar en VPS. |

| QA-01 | **CONFIRMADO** | Solo 2 workflows (`ama-*`) en la rama desplegada; sin CI de SPOT/IDCA/Grid. |

| PORT-01 | **CONFIRMADO con datos** | §0.8; sin reservas ni locks; presupuesto solo AMA. |



**Referencias específicas del encargo:** SPOT −845,01 vs +366,27 → universos distintos (§3), JSON no reproducido. IDCA canónico −445,90 vs crudo +1.735,92 → crudo reproducido; canónico no reproducido; faltan compras originales de ciclos importados y la definición de coste FIFO. Ciclos cerrados con residual 22/24/26 → confirmados. Grid centralGap 1,5916 > 1,5 → no medido en esta pasada (eventos `GRID_CYCLE_TARGET_REVIEW_REQUIRED` 841 como pista). Crecimiento DB → 10,08 GB (twin snapshots 5,46 GB: ~443 kB/escaneo de `candles` recalculables). Autenticación efectiva → ausente en HTTP (§0.9).



## 7. Hallazgos nuevos



| ID | Gravedad | Hallazgo |

|---|---|---|

| NEW-01 | **P0** | Bucle de reinicios por OOM (consulta ilimitada a `spot_forward_twin_snapshots`). Causa raíz localizada; corrección pendiente de autorización. |

| NEW-02 | **P1** | Revolut X `401` continuo con credenciales presentes (desde ene-2026). |

| NEW-03 | **P1** | `spot_forward_twin_snapshots` almacena ~443 kB de `candles` por escaneo; el resto de la fila ocupa ~1,5 kB. |

| NEW-04 | **P1** | Ruido de eventos: `server_logs` 2,5 M filas/30 d (≈93 % INFO), `GRID_CYCLES_RECOVERED` 177 k, `migration_validation_warning` 12 k, `BOT_STARTED` ≈500/día. |

| NEW-05 | **P1** | Comisiones SHADOW estimadas, no reales; el libro REAL no tiene comisión registrada (0,00). |

| NEW-06 | **P2** | AMA inactivo desde 2026-08-17; `restart_count` 445. |

| NEW-07 | **P2** | Cartera global sin datos; sin control de exposición cruzada. |

| NEW-08 | **P2** | Ciclos IDCA `live` históricos con configuración actual `simulation`; sin actividad desde 2026-09-03. |



## 8. Propuestas (máx. 3 por motor, sin implementar)



**Sistema/estabilidad (prerrequisito):** (1) sustituir el `SELECT` ilimitado por lectura por lotes con `keyset` y límite de memoria, y fijar un `--max-old-space-size`/política de reinicio con backoff; criterio: 0 `FATAL ERROR` y `BOT_STARTED` ≤ 2/día. (2) Autenticación central + cerrar 3020/5435/3000 al exterior; criterio: `401/403` sin credencial. (3) Resolver los `401` de Revolut X (verificar credencial/firma) con prueba de solo lectura.

**SPOT:** (1) Revisar `STRUCTURE_INVALIDATION` con *replay walk-forward* (confirmación, ATR, tiempo mínimo); métrica: PF neto y expectativa; guardarraíl: drawdown máximo. (2) Puerta de coste de entrada: exigir recorrido esperado > k × coste ida y vuelta real. (3) Sustituir comisiones estimadas por reales/maker y comparar con *buy & hold* y DCA simple con mismo capital.

**IDCA:** (1) Persistir el estado de trailing buy (tras estabilizar reinicios). (2) Unificar la semántica "diagnóstico vs veto" de confluencia y validar la ventana rebote/precio máximo. (3) PnL canónico único por *cost basis* y conciliación de residuales (22, 24, 26) y de importados.

**Grid:** (1) Persistir una razón de bloqueo única por tick con duración. (2) Procesar salidas SHADOW antes de exigir banda (GRID-01). (3) Estudio de viabilidad neta de niveles adyacentes por comisiones (NOT_VIABLE dominante).

**AMA:** (1) Definir criterios de preparación antes de salir de `OFF`. (2) Calidad de datos/no-look-ahead medible. (3) Integración con presupuesto por motor en la cartera.

**Cartera:** (1) Poblar reservas/presupuestos por motor y mostrar exposición agregada. (2) Prueba de idempotencia entre motores sobre el mismo activo. (3) Conciliación periódica solo-lectura contra exchange.



Backtests/replays con *benchmarks* y sensibilidad **no ejecutados** en esta pasada: los datos de mercado (`market_candles`, `market_metrics_snapshots`, `spot_forward_twin_snapshots` sin velas) están ya en Drive para hacerlo bajo la siguiente orden.



## 9. Exportación a Google Drive privado (estado)



Método: PostgreSQL `READ ONLY` → `gzip` en memoria → RAM (`tmpfs`) → `rclone` (permiso `drive.file`) → comprobación de MD5 remoto, SHA-256 por relectura y recuento de filas. Sin ficheros de datos en el disco del VPS ni del PC. Un token OAuth apareció en una salida de herramienta durante la configuración: **riesgo documentado**; por orden expresa del propietario el token se conserva temporalmente para esta extracción y **no se revoca ni se borra** en esta fase; deberá sustituirse antes de cualquier sincronización permanente.



| Métrica | Valor |

|---|---|

| Carpeta | `NEXA_AUDITORIA_CASCADE_2026-11-17` (privada, creada por rclone; no movida ni compartida) |

| Objetos / tamaño | **432 archivos, 5,395 GiB comprimidos** |

| Filas exportadas | **9.540.841 en tablas** (+ agregados auxiliares y secciones del dump) |

| Clasificación | 64 COMPLETO · 45 COMPLETO_VACIA (incl. 6 fiscales vacías verificadas) · **25 COMPLETO_FISCO_EXPORTADO** · 5 PARCIAL (solo deriva en vivo posterior al lote 006) · 5 EXCLUIDA_SECRETOS |

| Verificación | todos los archivos `OK` (md5 remoto, sha256 relectura, filas = esperadas, escaneo de secretos 0 aciertos) |

| Manifiestos | `manifest_global_20261118T181507Z.json`, `cobertura_20261118T181507Z.csv`, `inventario_tablas_*.csv`, manifiestos por lote (001, 002×7, 003, 003b, 003c, 004, 004b, 005_dump, 006) |



**Corte final:** 2026-11-18T18:15Z (lote 006). **Lotes 004/004b/005/006 (ampliación integral autorizada el 18/11):**

- **Originales antes resumidos, ya íntegros:** `server_logs` INFO/DEBUG completo (~2,48 M filas, `line` con redacción de patrones de secretos), `GRID_CYCLES_RECOVERED` íntegro (177,7 k), `migration_validation_warning` íntegro, `spot_forward_twin_snapshots.data.candles` íntegros **enlazados por `id` a su snapshot** en lotes de 1.500 filas (~4,4 GB comprimidos; cada archivo lleva rango `idA-B` en el nombre).
- **FISCO/AEAT:** las 31 tablas `fisco_*` exportadas completas por rangos de id (~4,4 M filas, ~480 MiB) a `05_FISCO_PRIVADO/`, incluidas `fisco_backup_operations` (1,81 M), `fisco_backup_disposals` (1,70 M), `fisco_backup_lots` (894 k) y las `staging_*`. **Sin cifrar, por decisión expresa del propietario en esta sesión** (la orden en `main` contempla cifrado con clave del propietario; queda como opción pendiente re-cifrar/re-subir sin tocar los archivos actuales). Origen fiscal **no modificado**.
- **Dump de seguridad `pre_forward_twin_088` (26-ago-2026, 381 MB gz):** secciones `COPY` extraídas en streaming **sin restaurar la base**; incluye `spot_forward_twin_snapshots` de esa fecha → respaldo histórico de snapshots ya podados del origen vivo. Tablas de secretos del dump retenidas fuera de Drive.
- **Bases legacy descubiertas y exportadas:** `kraken-bot-db` (segundo contenedor) y esquema `kraken_staging` — `trades`, `applied_trades`, `open_positions`, `market_data`, configs… (sus `api_config` excluidas por secretos).
- **Lote 006 (cierre exacto por rangos de id):** cerró **huecos reales** detectados al reconciliar: 1 evento Grid no-RECOVERED (ids 484157–484160), 165 errores de `server_logs` entre el corte previo de errores y el full INFO/DEBUG, velas de 15 snapshots (653222–653236) que tenían fila slim pero no `candles`; además las colas incrementales de todas las tablas vivas y fiscales. Los archivos `inc2`/`inc3` solapados quedan marcados `SUPERSEDED` en el manifiesto (sin borrar nada).

**PARCIAL al cierre = solo deriva en vivo (bot activo, sin huecos en rangos):** `server_logs` 651, `market_metrics_snapshots` 148, `bot_events` 95, `institutional_dca_events` 50, `grid_isolated_events` 24 — filas insertadas durante/después del lote 006 (17:59–18:15 UTC).

**Anomalías de conteo (origen activo):** `spot_forward_twin_snapshots` exportadas 109.554 > origen 53.522 (suma filas slim + filas-vela ligadas por id) y `market_candles` exportadas 110.409 > origen 109.804 → el bot **poda filas**; la exportación conserva ids ya eliminados y el dump del 26-ago añade respaldo histórico. **Excluido:** `api_config`, tokens/chats Telegram, `master_backups` (credenciales). Columnas sensibles excluidas/redactadas (`chat_id`, `token_id`, `*_key`, `message`/`meta`/`line` con patrones). Lote 001 en CSV; resto en JSONL.



Limitaciones: la carpeta se creó con `drive.file` y no se pudo verificar su estado de compartición vía API; el acceso a la carpeta NEXA preexistente no es posible con ese permiso.



## 10. Checklist y siguientes pasos



- [x] SHA/rama desplegados identificados · [x] Motores inventariados · [x] Inventario 145 tablas/vistas (+2 bases legacy) · [x] Exportación histórica íntegra con verificación · [x] Originales antes resumidos completados · [x] `data.candles` por id · [x] FISCO completo · [x] Dump pre088 extraído sin restaurar · [x] Cierre de huecos por id (lote006)

- [x] Contraauditoría de los 16 hallazgos · [x] Propuestas (≤3 por motor) · [ ] Backtests/benchmarks · [~] Token OAuth expuesto: conservado por orden del propietario (riesgo documentado; sustituir antes de sincronización permanente) · [ ] Verificar privacidad de la carpeta Drive · [ ] Cifrado opcional de la copia FISCO si el propietario lo requiere · [ ] Prueba de restauración aislada de la copia FISCO (requiere entorno autorizado)

- **Modo operativo observado:** SHADOW/simulation; REAL no activo. **NO desplegado.**

- Siguiente paso: ChatGPT contrasta este informe y prepara la orden de correcciones, empezando por NEW-01 (estabilidad) y seguridad; Cascade no aplica cambios sin autorización.

