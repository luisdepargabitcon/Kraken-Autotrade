# PLAN DE CORRECCIÓN PRIORIZADO — Issue #20 (continuación TANGO)

**Solo propuesta. Nada de lo aquí descrito se ha ejecutado.** Cada fase requiere autorización expresa del propietario, es reversible y tiene pruebas aisladas previas. No se desplegará `main` ni se fusionarán las ramas divergentes (`3ae1831` ↔ `main`: 101/43 commits) como parte de este plan sin una orden específica de convergencia.

## Principios rectores

1. **Preservar la gestión legítima de posiciones en todo momento:**
   - IDCA `live` debe poder seguir comprando y vendiendo en Revolut X (es la operación prevista y autorizada).
   - Las salidas de reducción de riesgo (cierres manuales, emergency close, TimeStop, fail-safe) **nunca** deben quedar bloqueadas por la contención: se autentican y auditan, no se impiden.
   - FISCO debe poder seguir leyendo de Kraken (requiere clave con permiso Query).
   - GRID/SPOT/AMA en SHADOW deben seguir simulando.
2. **Kraken solo datos; Revolut X único venue; SHADOW jamás ejecuta.**
3. **Reversibilidad:** cada cambio se puede deshacer de forma independiente.
4. **Pruebas primero:** ninguna fase se aplica sin sus pruebas aisladas en verde (mocks, sin red, sin credenciales).

## Fase 0 — Decisiones del propietario (sin tocar el sistema)

| Acción | Detalle |
|---|---|
| 0.1 | Confirmar en el panel de Kraken los permisos reales de la clave actual (Query / Trade / Withdraw). Resultado esperado: saber si H-001 es ejecutable hoy. |
| 0.2 | Decidir el canal de acceso remoto legítimo a la UI/API (túnel SSH, proxy con autenticación, VPN). |
| 0.3 | Tratar por canal privado el detalle de red/topología de la exposición (omitido en los documentos públicos a propósito) y decidir qué hacer con el historial ya publicado en el PR #21 / Issue #20. |
| 0.4 | Autorizar expresamente la Fase 1. |

## Fase 1 — Perímetro (infraestructura, sin código, reversible)

| Acción | Verificación | Rollback |
|---|---|---|
| La API deja de ser alcanzable desde Internet; el acceso remoto queda solo por el canal autenticado decidido en 0.2. Detalle técnico exacto por canal privado. | Lectura externa → sin respuesta. Lectura por canal autorizado → correcta. UI usable como antes por el canal. | Restaurar la publicación anterior del puerto. |

Criterio de salida: ninguna ruta mutativa alcanzable sin autenticación desde fuera del host.

## Fase 2 — Credencial Kraken de solo lectura (sin código)

| Acción | Verificación | Rollback |
|---|---|---|
| Rotar la clave Kraken por una con permisos **solo Query** (datos públicos no necesitan clave; las lecturas privadas de FISCO sí). **No borrar la antigua antes de verificar.** | Datos de mercado siguen llegando (son públicos). FISCO sigue leyendo ledgers/trades. Cualquier orden enviada a Kraken es rechazada por el propio venue. | Volver a la clave anterior si FISCO u otra lectura privada se rompe. |

Criterio de salida: aunque R1/R4/R5 fueran alcanzadas, Kraken rechazaría las órdenes. Contención de H-001/H-003/H-004 sin tocar código.

## Fase 3 — Guards de ejecución en código (rama nueva desde runtime, no desde main)

Prerequisito: trabajo sobre una rama creada desde `3ae1831` (lo que realmente corre), nunca desplegar `main` directamente.

| # | Cambio | Hallazgos | Prueba aislada de aceptación |
|---|---|---|---|
| 3.1 | `krakenService.placeOrder/placeOrderRaw/cancelOrder` lanzan `KRAKEN_EXECUTION_FORBIDDEN` incondicionalmente | H-001 | T1: con cualquier configuración, placeOrder lanza; getTicker/getOHLC/getBalance siguen funcionando |
| 3.2 | ExchangeFactory sin fallback silencioso: RX no inicializado → `VENUE_UNAVAILABLE` fail-closed con alerta | H-004 | T2: `getExchange('revolutx')` sin init → error, nunca Kraken |
| 3.3 | `POST /api/config/active-exchange` rechaza `kraken`; botón de Integrations actualizado | H-003 | T4: POST con kraken → 400 |
| 3.4 | Guard `mode==="live"` dentro de `executeExit` y de todo envío de orden IDCA; simulation → orden simulada registrada | H-005 | T3: `executeExit(simulation)` → 0 llamadas a placeOrder (spy) |
| 3.5 | Guard de modo en `IdcaExecutionManager` o eliminación si es código muerto | H-033 | Revisión estática + test de diagnósticos sin efectos |
| 3.6 | Autenticación en todas las rutas mutativas `/api` | H-002 | Test e2e local: mutativo sin credencial → 401; con credencial → flujo normal |
| 3.7 | Guards simétricos en positions buy/close **con excepción auditada para reducción de riesgo**: los cierres se autentican y registran, no se bloquean | H-028 | Test: close autenticado funciona incluso con TRADING_ENABLED=false |

Criterio de salida: ningún camino de código puede terminar en orden en Kraken ni en orden real en modo simulación, y la gestión legítima sigue operativa.

## Fase 4 — LOW_API Revolut X (calidad de servicio)

| # | Cambio | Hallazgos | Prueba |
|---|---|---|---|
| 4.1 | Scheduler único de llamadas privadas con prioridades (fills/órdenes/protecciones > balance > histórico) y respeto de `Retry-After` | H-007 | T6: 429 con Retry-After N → siguiente petición ≥ N s |
| 4.2 | Eliminar `getTicker` firmado del allocator GRID; valorar BTC con referencia Kraken (MDS) | H-006 | T5: planificación SHADOW → 0 GET firmados de ticker |
| 4.3 | Caché de balance compartida entre consumidores | H-006/H-007 | Contador de requests por endpoint en métricas |

## Fase 5 — Calidad de datos e indicadores técnicos (no estrategia)

| # | Cambio | Hallazgos | Prueba |
|---|---|---|---|
| 5.1 | Portar la normalización s/ms a `main` antes de cualquier despliegue | H-009/H-020 | Test upsert con segundos → fecha correcta |
| 5.2 | Corrección EMA50 BTC→ETH y volumen relativo real en IDCA | H-016/H-017 | Fixtures E-041/E-042 invertidos |
| 5.3 | MACD/RSI/Bollinger/percentB: unificar en librería de indicadores con tests de referencia (o documentar convención y consumidores) | H-030/H-031/H-032 | Fixture E-045 como tests permanentes |
| 5.4 | Velas cerradas vs en formación: decisión explícita por consumidor | H-018 | Test con vela en formación controlada |
| 5.5 | Market Metrics: corregir OI (serie Δ%), funding (edad por tsProvider, sin fallback cruzado), stale/NaN; o retirar el modo "activo" si no hay consumidor | H-010…H-013 | Fixture E-040 invertido |
| 5.6 | Reconciliar ventas sin `exchange_order_id` contra fills del venue antes de cualquier corrección | H-025 | Informe de reconciliación |

## Fase 6 — Convergencia de ramas y recuperación estructural

- Plan separado y autorizado para reconciliar `integration/staging-spot-v4` con `main` (101/43 commits divergentes). Sin esto, cualquier despliegue futuro introduce regresiones conocidas (H-008, H-009).
- Limpieza de la instancia legacy inactiva (H-026), retención de `market_metrics_snapshots` (H-014) y evaluación del bloat de `market_candles` (H-027, causa por verificar).
- Análisis de la causa de los 17 529 reinicios (NO_VERIFICADO — no atribuir sin evidencia).

## Dependencias y orden

```
Fase 0 → Fase 1 (perímetro) → Fase 2 (credencial) → Fase 3 (código) → Fase 4/5 (calidad) → Fase 6 (convergencia)
```

Las fases 1 y 2 contienen el riesgo P0 sin tocar código ni interrumpir la operación legítima. La fase 3 no debe empezar antes de la 2. Las fases 4-5 son independientes entre sí.

**Este plan no autoriza por sí mismo ninguna acción. Estado: PROPUESTO / SIN APROBAR.**
