# ADENDA TANGO-5 — sistema único de ventas, coordinación cross-motor, gesto/retry, indicadores y trazabilidad

HEAD de esta adenda: `482da47` (WP17+WP18+WP18b+WP19). Estado: **SIN APROBAR — pendiente de TANGO.**

## 1. Sistema único de ejecución/reconciliación/contabilidad de ventas IDCA (P0 §1)

**Principio unificado:** en modo live la transacción atómica durable (`submitAndReconcile` → `IdcaLiveAtomicApply`) es la ÚNICA escritura contable — orden, cantidades, coste, PnL y cierre ocurren dentro de la misma tx. Ningún caller escribe contabilidad paralela ni precontabiliza.

Rutas corregidas (verificación por diff en `IdcaEngine.ts`):

| Ruta | Defecto TANGO | Corrección |
|---|---|---|
| `executeExit` | (ya corregido en WP16) | patrón de referencia |
| `emergencyCloseAll` | contaba cualquier filled como cerrado | solo cuenta cierre si `residualQty=0`; residual → `exit_partial_executed` sin contar |
| venta parcial TP | orden escrita ANTES del venue; cantidades sobrescritas | orden solo simulación; live: la tx atómica; updateCycle live solo transición de estado (sin campos contables) |
| trailing exit | orden + cierre tras aplicación, duplicando | live: sin createOrder/updateCycle contable; residual → evento parcial + telegram + return con protección activa |
| breakeven | igual que trailing | mismo patrón |
| PLUS | orden/cierre ANTES de enviar | reordenado: live ejecuta primero; jamás precontabiliza; residual → sin cierre |
| Recovery | escritura antes y después | live ejecuta primero, sin escrituras paralelas; residual → return temprano |
| manual close | PnL sobre coste íntegro con residual | coste proporcional a lo vendido; evento/telegram honestos (parcial vs cierre) |

**Tests:** `idcaUnifiedSellPaths.test.ts` — 12/12 con venue mock: residual terminal en trailing/BE/PLUS/Recovery/manual (evento parcial, sin cierre, sin escrituras paralelas), fill total sin duplicidad, rechazo de venue sin precontabilización, emergency con conteo honesto (1 cerrado + 1 residual = count 1), manual con PnL proporcional exacto (9,94 vs 9,95 diferenciando parcial/total). Regresión de reconciliación 50/50. PGlite 15/15.

**Limitación honesta:** tests a nivel caller con mocks de repo/venue, no DB efímera completa end-to-end; la aplicación atómica sí está probada contra PGlite con migraciones reales. La conciliación del residual como vía de cierre posterior sigue siendo manual/operativa.

## 2. Coordinación de reservas cross-motor (P0 §2)

- Lock advisory compartido `account_live_buy_reservation` adquirido tanto por IDCA (`insertIntentWithReservation`) como por SPOT (`persistAndReserveRealEntryIntentAtomic`): las reservas de compra de la cuenta se serializan en un único dominio transaccional.
- IDCA: el cap descuenta la exposición pendiente agregada de TODOS los `engine_owner` (compras en submitting/accepted_pending/uncertain/partial).
- SPOT: dentro del lock descuenta la exposición pendiente de motores no-SPOT antes de validar capital.
- Tests PGlite nuevos 2/2: SPOT 400 reservados → IDCA solo puede 100 de cap 500; agregación entre pares.
- **No se cambiaron presupuestos ni se activaron modos reales.** GRID permanece aislado (paper). Limitación declarada: la exposición ya materializada en fills se refleja vía balance fresco del venue; la ventana residual es la de la propia transacción, serializada por el lock compartido.

## 3. Idempotencia efectiva del cliente real (§10.3)

- `app.js`: cada gesto de confirmación genera `operationSeed` nuevo — una repetición intencionada con el mismo payload YA NO se confunde con la operación anterior; los reintentos del mismo gesto conservan el seed (misma clave).
- Identidad ligada al dispositivo (`deviceId`/`nxv2-device-instance`), no al token de sesión renovable.
- La incertidumbre `in_progress` NUNCA expira: solo registros completados/fallidos caducan a 24h.
- Fail-closed: si la identidad no puede persistirse antes del envío, la operación NO se ejecuta.
- 409 in_progress: sin reinvención de clave (ya existía) + mensaje de reconciliación.
- **Limitación declarada:** pruebas de concurrencia real contra backend durable con aplicación de efectos quedan pendientes de harness dedicado; las existentes (5/5 E2E HTTP real de WP16 + 22/22 ficheros de suite cliente) cubren reintento/doble toque/reinicio a nivel cliente.

## 4. Indicadores centralizados (§10.4)

- `provider.js`: los indicadores oficiales del servidor NUNCA se sobrescriben ni fusionan con cálculo local. `m.indicators` = oficiales o null; el cálculo local se expone como `visualAuxIndicators` namespaced.
- `dashboard.js`: la sección etiqueta la procedencia ("oficiales del motor" / "cálculo visual local — no es señal del motor"); el fallback visual solo rellena cuando no hay oficiales.
- Validación UX contra backend aislado con fixtures: pendiente declarada (Pixel y conexión real siguen pendientes sin promesa de firma).

## 5. Trazabilidad de release corregida

- La etiqueta anterior apuntaba a `main` por creación implícita sin `--target`. La nueva candidata fija la etiqueta al SHA exacto compilado: `482da47` (versionCode 29, 0.13.0-qa). No se movieron ni borraron etiquetas existentes.
- `SHA256SUMS.txt` contrastado; build-info sellado con el commit exacto.
