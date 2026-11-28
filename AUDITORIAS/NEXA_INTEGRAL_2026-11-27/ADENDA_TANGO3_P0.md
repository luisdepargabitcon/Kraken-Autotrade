# ADENDA TANGO-3 — Subsanación de los 4 bloqueantes P0 (revisión de 8ccffb3)

**Estado: CANDIDATO en aislamiento — SIN APROBAR PARA PRODUCCIÓN.** Sin VPS, sin despliegue, sin merge, sin órdenes reales.

Esta adenda documenta la corrección íntegra de los bloqueantes P0 publicados por TANGO en la revisión independiente de `8ccffb3` (issue #22, comentario 7240040246), más la identidad durable obligatoria de acciones financieras.

## P0-1 — Fill incierto marcado como aplicado sin contabilidad — CORREGIDO

**Defecto:** la aplicación atómica persistía `fillIds` y avanzaba `appliedQty` en la meta de la intención aunque la validación hubiera forzado `uncertain` y no se contabilizara nada. Al llegar después la evidencia corregida, el delta era 0 y la venta/compra jamás se contabilizaba.

**Corrección** (`IdcaLiveAtomicApply.ts`): invariante estricta — `fillIds`/`appliedQty`/`appliedGross`/`appliedFees` solo avanzan cuando hubo aplicación contable real dentro de la transacción (`quantityApplied > 0`). Los fills observados pero no aplicados no se marcan: en la siguiente reconciliación vuelven a ser nuevos y se contabilizan exactamente una vez. Ventas: avance por lo efectivamente aplicado con gross/fees en proporción si la aplicación fue parcial. Compras: catch-up completo al acumulado.

**Prueba DB real (PGlite, migraciones reales):** `incierto→válido→una sola contabilización` — verifica que tras el intento incierto la meta no contiene fills ni cantidad aplicada, que la evidencia corregida contabiliza exactamente una orden y cierra el ciclo, y que la re-reconciliación posterior no duplica.

## P0-2 — Cierre de ciclo con cantidad aún mantenida — CORREGIDO

**Defecto:** una venta 0,999/1 (dentro de tolerancia dust 0,25 %) cerraba el ciclo con `remainingQty=0` y consumía el 100 % del coste aunque quedara activo residual en el venue.

**Corrección** (`computeSellApplication`): política de dust explícita y conservadora —
- el coste se consume **siempre en proporción a la cantidad realmente vendida** (`sellRatio = quantitySold/oldQty`);
- el ciclo **solo se cierra cuando el remanente es cero efectivo** (≤1e-8);
- un fill terminal parcial deja el ciclo **activo** con cantidad y coste proporcionales; el residual se expone en `AtomicApplyResult.residualQty` y en `ReconciledOutcome.residualQty`, y se emite evento crítico `idca_residual_position` para conciliación antes de reapertura.

**Pruebas DB:** `fill terminal 0.999/1 NO cierra` — ciclo activo con 0,001 y coste 0,10 USD residual, PnL realizado exacto proporcional; `fill completo exacto sí cierra` (control) — cierre total con coste consumido íntegro.

## P0-3 — Reserva no efectiva en callers y venta sin tenencia — CORREGIDO

**Defectos:** (a) el caller real de compras no pasaba `reservedQuoteUsd` ni cap → reserva 0 y sin cap; (b) el evaluador solo rechazaba exceso de venta si `heldQty>0` — con tenencia cero cualquier venta pasaba.

**Correcciones:**
- `IdcaEngine.executeRealBuyWithGuard`: toda compra pasa `reservedQuoteUsd = finalUsd` (el quote que intenta gastar) y `availableQuoteCapUsd` derivado del balance validado por el guard (`validation.balanceCheck.availableUsd`).
- `evaluateReservation` compras: **reserva positiva obligatoria** — `buy_without_positive_reservation` si es 0.
- `evaluateReservation` ventas: disponible = tenencia live − ventas pendientes; con tenencia cero el disponible es cero y **toda** venta se rechaza (`sell_exceeds_held_plus_pending`), sin excepción.

**Pruebas DB:** venta con tenencia cero rechazada; compra sin reserva rechazada; compra con reserva dentro del cap aceptada (control); las carreras cross-ciclo y caps previos siguen verdes (13/13 suite PGlite original).

## P0-4 — Falta de fills indistinguible de cero fills — CORREGIDO

**Defectos:** `RevolutXService.getFills` devolvía `[]` ante errores; el reconciliador adoptaba `order.filledSize` como verdad contable sin fills corroborantes, pudiendo declarar `filled` sin evidencia.

**Correcciones:**
- `RevolutXService.getFills` acepta `strict: true`: los errores HTTP/excepciones se propagan en lugar de devolver `[]`. Los consumidores legacy no lo pasan (comportamiento inalterado); el puerto de venue del reconciliador lo pasa siempre.
- `reconcileIntent`: si la consulta de fills falla y la orden declara ejecución o es terminal → issue `fills_evidence_unavailable` → `uncertain`. Si la orden declara `filledSize>0` sin filas de fills corroborables → issue `order_claims_fill_without_fill_rows` → `uncertain`. **Nunca** éxito ni cierre sin evidencia de fills; el fallback contable a `filledSize` fue eliminado.

**Pruebas:** error de consulta de fills con orden FILLED → uncertain sin contabilizar; orden declara fill sin filas → uncertain; fills corroborables → filled con contabilidad (control). Las 25 pruebas de la suite del reconciliador y las 15 de matriz/validación siguen verdes.

## Identidad durable obligatoria de acciones financieras — IMPLEMENTADO

**Defecto:** el middleware durable pasaba directamente la acción financiera cuando faltaba `x-idempotency-key` — la protección era optativa.

**Corrección:** rechazo fail-closed **428 `idempotency_key_required`** para toda mutación a rutas financieras sin clave. Clientes: interceptor global instalado en el arranque del cliente web (`client/src/lib/financialIdempotency.ts` + `main.tsx`) que garantiza clave en **toda** mutación financiera — incluidas las llamadas fetch directas que no pasan por `apiRequest`. La APK es shell Capacitor del mismo cliente web: queda cubierta por el mismo interceptor. **Limitación honesta declarada:** la clave automática es uuid por petición; la protección fuerte contra doble-submit exige claves estables por operación de usuario en cada acción — el interceptor preserva intacta cualquier clave explícita que el caller pase. Endurecimiento por acción pendiente.

**Prueba:** `sin clave → 428` con handler jamás ejecutado; GETs y rutas no financieras sin exigencia (control). Suite completa de idempotencia durable 5/5.

## Resultados exactos de pruebas (esta adenda)

| Suite | Resultado |
|---|---|
| `idcaP0TangoIntegration.test.ts` (nueva, 9 tests: incierto→válido, residual, reservas, fallos de fills) | **9/9 verde** |
| `idcaAtomicApplyPglite.test.ts` (preexistente) | **13/13 verde** |
| `idcaLiveOrderReconciler.test.ts` | **25/25 verde** |
| `idcaSubmissionMatrixAndValidation.test.ts` | **15/15 verde** |
| `authV2DurableIdempotency.test.ts` (1 test reescrito al nuevo contrato) | **5/5 verde** |
| `tsc --noEmit` | ver sección de regresión en el comentario de la issue |

## Pendientes declarados (sin cambio)

- WebSocket: token en query y permisos no granulares por recurso — pendiente (no exigido como bloqueante P0 en esta revisión, sigue abierto del resto de la orden).
- Claves estables por operación en acciones de UI (endurecimiento sobre el uuid automático).
- Consumidores legacy Market Data/indicadores (H-018/022/023/029-032) — sin migrar.
- Copia privada #19, contención de infraestructura, migraciones 095/096 en producción, validación Pixel 9, firma release — todos requieren autorización expresa del propietario.
- PGlite es single-connection: la serialización por advisory lock se valida lógicamente; la concurrencia multi-proceso real se verificó con el test de dos procesos de la suite previa sobre la misma instancia.
