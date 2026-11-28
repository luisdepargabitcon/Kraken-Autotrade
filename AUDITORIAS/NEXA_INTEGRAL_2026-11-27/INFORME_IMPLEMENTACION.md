# INFORME IMPLEMENTACIÓN — NEXA INTEGRAL (orden #22)

**Estado final: CANDIDATO IMPLEMENTADO Y VALIDADO EN AISLAMIENTO en la medida que documenta este informe — SIN APROBAR PARA PRODUCCIÓN, pendiente de contraauditoría TANGO.** Sin merge, sin despliegue, sin VPS, sin credenciales, sin órdenes reales, sin secretos publicados. Rama `feature/nexa-integral-20261127`, PR #23 (draft), base `1784f94` (el SHA runtime auditado `3ae1831` es ancestro directo; los 2 commits intermedios son solo BITACORA).

## 0. Corrección de afirmaciones previas (exigida por TANGO)

- El BFF v2 de NEXA **sí existía** en la rama NEXA (`2c8d6ef`, `nexa-v2/bff/v2-auth.mjs` y `v2-proxy.mjs`): se ha comparado y reutilizado su contrato real (rutas `/api/v2`, permisos `recurso:read/:control`, csrf por sesión, TTLs, PERM_MAP deny-by-default). La afirmación anterior («no existía en ninguna rama») era incorrecta.
- «La APK no está en el repo» también fue incorrecto: existe el shell Capacitor `com.nexa.autotrade.v2` en la rama NEXA, integrada selectivamente (mapa en `MAPA_CONVERGENCIA.md`).

## 1. Verificación verificable

- **Baselines comparados en el mismo entorno aislado:** base `1784f94` vs candidato, mismo `node_modules` (hash idéntico), misma configuración sin DB. Comparación por (fichero, nombre de test) con mensajes normalizados idénticos.
- Suite final: **7402 tests — 7323 passed / 43 failed / 36 skipped (exit 1 solo por los 43 preexistentes); en cada paquete: 0 regresiones, 43/43 fallos idénticos a baseline**, ~120 tests nuevos, todos verdes.
- `npx tsc --noEmit`: exit 0. `npx vite build`: exit 0 (chunk ~2,4 MB, solo warning). `node --test` en `nexa-v2/tests`: **177/177 pass**. `git diff --check`: sin errores (ejecutado en la rama).
- Conteos, comandos y hashes de salidas de comparación saneadas en `audit20_tmp` (no publicados, contienen nombres de rutas); disponibles para TANGO.
- Replays/medición: `IMPACTO_INDICADORES.md` (score antiguo vs nuevo; ablation de volumen), `REPLAY_SENALES.md` (replay de señales, NO CONCLUYENTE), `ESTUDIO_FUENTES_SECUNDARIAS.md`, `LOW_API_RESULTADOS.md`, todos reproducibles offline con snapshots públicos y hashes SHA-256.
- **Escaneo de secretos:** diff y artefactos escaneados con patrones de claves PEM/tokens/passwords: 0 coincidencias (metadatos en `ARTEFACTOS_NEXA.md`).
- Datos privados: solo se consultaron endpoints públicos de mercado (Kraken/Bitstamp/Bitfinex/Binance spot, sin claves). Nunca Revolut X ni datos privados.

## 2. Lo implementado por dominio (commits completos en el log de la PR)

- **Ejecución/venue (P0):** Kraken solo datos (prohibición incondicional); `/api/trade` → 410; venue único `getExecutionVenue()` fail-closed sin autorización tácita; scope IDCA validado contra modo persistido; Grid REAL exige admin. (`5f7234d`, `e24d4ac`, `3c244ce`)
- **Reconciliación de fills (P0):** intención durable en `order_intents` antes de enviar, idempotencia por clave, submissionState AMBIGUOUS sin reenvío, fills parciales/duplicados, crash/restart, contabilidad por cantidades reales, cierre solo con remanente conciliado. (`6a524ed`) **ACTUALIZADO en WP10+WP15 (ver `ADENDA_TANGO3_P0.md`):** aplicación contable atómica en transacción única con locks/CAS, fills inciertos jamás marcados como aplicados, cierre con residual conservado, reservas positivas obligatorias cableadas en el motor, evidencia de fills estricta. **Limitaciones honestas restantes:** compra inicial sin ciclo no recreable; recuperación de compras no recalcula estrategia derivada; fees sin moneda explícita se etiquetan `estimated_preset`.
- **Autenticación/autorización (P0):** contrato real ECDSA P-256, pairing bootstrap seguro, sesiones hash-only, csrf, permisos granulares, rate-limit, store Drizzle validado con PGlite (migración 095 preparada y NO registrada), enforcement global deny-by-default con test de cobertura de 511 rutas, WebSockets autenticados, idempotencia server-side, cliente NEXA integrado y verificado E2E con los módulos reales, cliente web React con `AuthGate` y claves no exportables. (`320845b`…`4f0c30d`) **Sigue pendiente:** contención de infraestructura (autorización separada) y prerrequisitos de despliegue (`docs/AUTH_V2_DEPLOYMENT.md`).
- **LOW_API (P1):** scheduler común con prioridades y envejecimiento, Retry-After, jitter, reintentos solo GET, breaker; BalanceCache con generaciones/edad; GRID SHADOW medido en workload simulado: **0 llamadas privadas de planificación**; valoración parcial explícita. (`9ddc5c3`…`f86eac2`)
- **Market Data/indicadores (P1):** contrato tipado con procedencia temporal triple y validación estricta; gate de entrada fail-closed; precio de salida jamás inventado; normalizador de timestamps en toda ingesta; librería de indicadores con referencias independientes; inventario de divergencias y modo shadow apagado por defecto; medición pública del impacto. (`28dd5e8`…`a2a2324`)
- **Market Metrics (P1/P2):** OI causal, funding sin fallback y con unidad, UNKNOWN≠favorable, alcanzabilidad, dedup por observación, advisory aislado, retención propuesta. (`c3beba6`…`d7918aa`)
- **IDCA #19 (P2):** política versionada (default legacy; variantes solo simulation/shadow/replay), matriz de rutas, variantes de rebote A1a/A1b/A1c con estados, enforcement de confluencia, fuente canónica del trailing buy, plan ATRP efectivo en variante, guards de compras testeados; **replay de señales con velas públicas: NO CONCLUYENTE (todas las variantes OFF)**. (`610b251`…`fbefa3f`)
- **Fuentes secundarias (P2):** estudio + adaptador Bitstamp **desactivado por defecto** con política por consumidor. (`e78a239`, `2e38ceb`)
- **H-025/reinicios (P2/P3):** matcher puro y diseño de consulta de solo lectura; diagnóstico estático e idempotencia de arranque. (`8b453aa`, `7a1a83f`, `e882286`)
- **NEXA web/APK (P2):** integración selectiva, artefactos con SHA-256, **APK debug `.qa` (NO firma de publicación), discrepancia de permisos biométricos abierta** — ver `ARTEFACTOS_NEXA.md`. (`769911c`…`e6a5012`)
- **Convergencia:** medida con git; plan propuesto sin ejecutar. (`f1af550`)

## 3. Matriz y pendientes

La matriz H-001…H-034 y los criterios §9 con estado por fila están en `MATRIZ_H001_H034.md`. Pendientes principales que requieren autorización o datos del propietario:
1. Contención urgente de infraestructura (Fases 1–2 del plan de #20) — autorización expresa.
2. Migración 095 aplicada + bootstrap + emparejado admin — en el despliegue autorizado.
3. Replay #19 con copia privada existente — se solicita acceso por canal privado.
4. Causa real de reinicios y permisos de la clave Kraken/IPv6 — VPS read-only autorizado.
5. Ejecución privada del matcher H-025 y propuesta de retención.
6. Firma de publicación y validación en dispositivo del APK — entorno del propietario.

## 4. Rollback

Rollback de la candidata = no mergear. Cada paquete es reversible por commit; no hay cambios en producción que revertir. Los flags/políticas tienen default legacy/off. Nada desactiva la seguridad introducida una vez desplegada (los guards no son desactivables por configuración).
