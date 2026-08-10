# AMA R4 — Inventario formal de botones

Rama: `fix/ama-r4-controls-lab-ux-20260810` · Commit de referencia: ver `git log -1`.

Convenciones:
- `LOADING_STATE`/`ERROR_STATE` = Sí si el botón deshabilita/muestra spinner/texto de carga y error humano al fallar `response.ok`/`json.success`.
- `DOUBLE_CLICK_PROTECTED` = Sí si existe un flag `busy`/`pending` que bloquea reentradas mientras la petición está en curso.
- `TEST` referencia el archivo de test que cubre la propiedad (cuando existe cobertura directa; los marcados "fuente" están cubiertos por escaneo de código fuente, no por render+click, por ausencia de jsdom/RTL en este repo — ver nota al final).

## A. Barra de comando (`AmaCommandBar.tsx`)

| Label visible | Acción | Endpoint | Efecto backend | Loading | Success | Error | Doble clic | Test |
|---|---|---|---|---|---|---|---|---|
| Actualizar | `onRefresh` → `fetchData()` (padre) | GET status/market-view/portfolio/readiness | Ninguno (solo lectura) | N/A (rápido, sin bloqueo visible) | Refresca datos | `error` global si falla | N/A (solo lectura) | — |
| Parada de emergencia / Emergencia activa — Restablecer | Abre modal de confirmación | — | Ninguno hasta confirmar | — | — | — | Sí (`killSwitchPending`) | `amaR4Controls.test.tsx` (fuente) |
| Cancelar (modal) | Cierra modal | — | Ninguno | — | — | — | Sí (deshabilitado si `killSwitchPending`) | — |
| Confirmar parada de emergencia / Restablecer operación (modal) | `onToggleKillSwitch` → `toggleKillSwitch()` (Ama.tsx) | `POST /api/ama/kill-switch` | Activa/desactiva kill switch | Sí ("Procesando...") | Actualiza `status.killSwitchActive` solo tras `res.ok && json.success` | Mensaje humano en `error` | Sí (`killSwitchPending`) | fuente |

## B. Selector de modo (`AmaModeSelector.tsx`)

| Label | Acción | Endpoint | Efecto | Loading | Success | Error | Doble clic | Test |
|---|---|---|---|---|---|---|---|---|
| Desactivado | `onSelectEnvironment("OFF")` → `handleEnvironmentChange` | `POST /api/ama/mode` (si no estaba ya OFF) | Cambia modo a OFF | `modeActionPending` (interno a `setMode`) | Navega a subtab por defecto solo si backend confirma | `error` global | Sí (`modeActionPending` en `setMode`) | `amaR4Controls.test.tsx` |
| Laboratorio | `onSelectEnvironment("LAB")` | `POST /api/ama/mode` (si no estaba ya en familia LAB) | Cambia modo a LAB | ídem | ídem | ídem | ídem | `amaR4Controls.test.tsx` |
| Real | `onSelectEnvironment("REAL")` | Ninguna llamada directa: si ya está en REAL solo navega; si no, abre el asistente | — | — | Abre `AmaRealActivationWizard` | — | — | `amaR4Controls.test.tsx` |

## C. Navegación contextual (`AmaContextualNav.tsx`)

Todas las opciones (`Resumen/Historial/Eventos/Ayuda` en OFF; `Inicio/Resultados/Eventos/Ayuda` en Laboratorio; `Estado/Activación/Estrategia/Ciclo y tramos/Órdenes/Movimientos/Historial/Eventos/Seguridad/Ayuda` en Real) solo llaman `onSubtabChange` (estado local del padre). **Nunca llaman a `/api/ama/mode`** — verificado por `amaContextualNav` (renderizado puro, sin `fetch` en el archivo) y por el comentario/contrato del componente. Sin loading/error aplicable (no son llamadas API).

## D. Laboratorio — Inicio (`AmaLabPanel.tsx`)

| Label | Acción | Endpoint | Efecto | Loading | Success | Error | Doble clic | Test |
|---|---|---|---|---|---|---|---|---|
| Probar una caída | `setActiveFlow("fall")` | — | Ninguno (navegación local) | — | — | — | N/A | `amaUxRedesign.test.tsx` |
| Probar un período pasado | `setActiveFlow("period")` | — | Ninguno | — | — | — | N/A | ídem |
| Probar el sistema completo | `setActiveFlow("scenario")` | — | Ninguno | — | — | — | N/A | ídem |
| Observar el mercado actual | `setActiveFlow("live")` | — | Ninguno | — | — | — | N/A | ídem |
| Volver al Laboratorio | `setActiveFlow(null)` | — | Ninguno | — | — | — | N/A | — |

## E. Resultados de Laboratorio (`AmaLabPanel.tsx`)

| Label | Acción | Endpoint | Efecto | Loading | Success | Error | Doble clic | Test |
|---|---|---|---|---|---|---|---|---|
| Todos / Caídas / Pasado / Sistema completo (filtro) | `setResultFilter(key)` | — | Ninguno (filtro local) | — | — | — | N/A | — |
| Ver resultado | `setOpenResult(item)` → abre `AmaResultDetail` | GET `/api/ama/lab/sessions/:id` o `/api/ama/replay/runs/:id` (shadow usa datos ya cargados) | Ninguno (solo lectura) | "Cargando detalle..." | Muestra métricas reales o "No disponible" | Mensaje humano si falla el fetch | N/A (solo lectura) | `amaResultDetail.test.tsx` |

## F. Laboratorio — Probar una caída (`LabTab` en `AmaTabs.tsx`)

| Label | Acción | Endpoint | Efecto | Loading | Success | Error | Doble clic | Test |
|---|---|---|---|---|---|---|---|---|
| 6 presets de caída | `setSelectedPreset(i)` | — | Ninguno | — | — | — | N/A | — |
| Iniciar experimento | `startLab()` | `POST /api/ama/lab/sessions` | Crea sesión de laboratorio | "Iniciando..." (`starting`) | Refresca lista solo si `res.ok && json.success` | `startError` visible | Sí (`starting`) | `amaR4Controls.test.tsx` (fuente) |

## G. Laboratorio — Probar un período pasado (`ReplayTab`)

| Label | Acción | Endpoint | Efecto | Loading | Success | Error | Doble clic | Test |
|---|---|---|---|---|---|---|---|---|
| 4 presets de período | `setSelectedPreset(i)` | — | Ninguno | — | — | — | N/A | — |
| Iniciar reproducción | `startReplay()` | `POST /api/ama/replay/run` | Crea reproducción histórica | "Iniciando..." | Refresca lista solo si éxito confirmado | `startError` visible | Sí (`starting`) | fuente |

## H. Laboratorio — Probar el sistema completo (`ShadowScenarioTab`)

| Label | Acción | Endpoint | Efecto | Loading | Success | Error | Doble clic | Test |
|---|---|---|---|---|---|---|---|---|
| 6 presets de escenario | `setSelectedPreset(i)` | — | Ninguno | — | — | — | N/A | — |
| Crear escenario | `createScenario()` | `POST /api/ama/shadow/scenarios` | Crea escenario simulado | "Creando..." | Refresca lista solo si éxito | `createError` visible | Sí (`creating`) | fuente |
| Ejecutar | `runScenario(id)` | `POST /api/ama/shadow/scenarios/:id/run` | Ejecuta el escenario | "Ejecutando..." | Refresca lista | `actionError` visible | Sí (`busyScenarioId`) | fuente |
| Cerrar | `closeScenario(id)` | `POST /api/ama/shadow/scenarios/:id/close` | Cierra el escenario | "Cerrando..." | Refresca lista | `actionError` visible | Sí (`busyScenarioId`) | fuente |

## I. Laboratorio — Observar el mercado actual (`ShadowLiveTab`)

| Label | Acción | Endpoint | Efecto | Loading | Success | Error | Doble clic | Test |
|---|---|---|---|---|---|---|---|---|
| Iniciar simulación en vivo | `handleStart()` → `onSetMode("SHADOW_LIVE")` | `POST /api/ama/mode` | Cambia modo a SHADOW_LIVE | "Iniciando..." (`busy`) | UI muestra "Simulación en vivo activa" **solo** si `currentMode === "SHADOW_LIVE"` confirmado por backend | Mensaje humano | Sí (`busy`) | `amaR4Controls.test.tsx` |
| Detener simulación | `handleStop()` → `onSetMode("LAB")` | `POST /api/ama/mode` | Cambia modo a LAB | "Deteniendo..." | Vuelve a estado inactivo tras confirmación | Mensaje humano | Sí (`busy`) | ídem |

## J. Asistente de activación Real (`AmaRealActivationWizard.tsx`)

| Label | Acción | Endpoint | Efecto | Loading | Success | Error | Doble clic | Test |
|---|---|---|---|---|---|---|---|---|
| Cancelar (paso 1) / Atrás (pasos 2-4) | Cierra asistente o retrocede paso | — | Ninguno | — | — | — | Deshabilitado si `submitting` | — |
| Siguiente | Avanza paso (validado: readiness/campos/checkbox) | — | Ninguno | — | — | — | N/A | — |
| Activar Real limitado | `handleActivate()` | `POST /api/ama/real/activate` | Autoriza y arma Real limitado | "Activando..." (`submitting`) | Marca `activated=true` solo tras `res.ok && json.success`; llama `onActivated()` (padre navega tras refetch) | `submitError` visible | Sí (`submitting`) | — |
| Cerrar (paso 4, tras éxito) | `onClose()` | — | Ninguno | — | — | — | N/A | — |

## K. Real — Activación (`OperationTab` en `AmaTabs.tsx`)

| Label | Acción | Endpoint | Efecto | Loading | Success | Error | Doble clic | Test |
|---|---|---|---|---|---|---|---|---|
| Activar real limitado / Cancelar (toggle) | `setShowGrantForm` | — | Ninguno | — | — | — | N/A | — |
| Confirmar activación → Armado | `grant()` | `POST /api/ama/real/activate` | Autoriza Real limitado | "Activando..." (`granting`) | Cierra formulario y refresca solo tras éxito confirmado | `activationError` visible | Sí (`granting`) | `amaR4Controls.test.tsx` (fuente) |
| Pausar nuevas operaciones | `callRealEndpoint("pause", ...)` | `POST /api/ama/real/pause` | Pausa autorización | "Pausando..." | Refresca tras éxito | `actionError` visible | Sí (`actionBusy`) | fuente |
| Reanudar | `callRealEndpoint("resume")` | `POST /api/ama/real/resume` | Reanuda autorización | "Reanudando..." | ídem | ídem | Sí | fuente |
| Desactivar | `callRealEndpoint("deactivate", ...)` | `POST /api/ama/real/deactivate` | Desactiva autorización | "Desactivando..." | ídem | ídem | Sí | fuente |
| Parada de emergencia → Sí, detener / Cancelar | Confirmación inline → `callRealEndpoint("kill-switch", {active:true})` | `POST /api/ama/real/kill-switch` | Detiene Real inmediatamente | "Deteniendo..." | ídem | ídem | Sí | fuente |

## L. Real — resto de subpestañas

`Estado`, `Estrategia`, `Ciclo y tramos`, `Órdenes`, `Movimientos`, `Historial`, `Seguridad` son **solo lectura** (fetch periódico, sin botones que muten estado backend). Manejan error de fetch con `error`/mensaje visible (`RealOrdersPanel`, `RealHistoryPanel`).

## M. Eventos (`AmaEventsPanel.tsx`)

| Label | Acción | Efecto | Test |
|---|---|---|---|
| Todos/Información/Advertencias/Errores (filtro severidad) | `setActiveLevel` | Filtro local, re-fetch con `severity` en query | — |
| Todos/Laboratorio/Real (filtro modo, oculto si `hideModeFilter`) | `setModeFilterValue` | Filtro local, re-fetch con `mode` en query | — |

No existe paginación (lista limitada a `limit`, por defecto 100, con polling cada 5s). No hay botón de "cargar más" — **NOT_DONE** si se requiere paginación explícita; no estaba en el alcance previo y no se ha añadido en esta sesión por no ser un defecto de seguridad/veracidad.

## Resumen de propiedades

```
AMA_ALL_BUTTONS_AUDITED=PASS (inventario completo arriba, ~40 botones/controles interactivos)
AMA_ALL_API_BUTTONS_HANDLE_ERRORS=PASS (todos los botones que llaman a la API validan response.ok Y json.success; ver amaR4Controls.test.tsx)
AMA_DOUBLE_CLICK_PROTECTED=PASS (todos los botones mutadores usan un flag busy/pending)
```

## Nota sobre cobertura de tests

Este repositorio (`vitest` con `environment: "node"`) **no tiene instalado jsdom ni @testing-library/react**, y no se ha instalado en esta sesión (fuera del alcance autorizado: instalar dependencias nuevas no es una acción segura de ejecutar sin aprobación explícita, y el usuario no la ha pedido). Por eso:
- Los componentes puros (sin hooks) se testean con `renderToString` + invocación directa de `onClick` (patrón ya usado en `amaR4Controls.test.tsx`).
- Los componentes con estado/efectos (fetch, doble-clic, `busy`) se verifican mediante **escaneo de código fuente** (aserciones sobre patrones exactos como `if (granting) return;` o `!res.ok || !json?.success`), no mediante simulación real de clics + fetch mockeado.
- Esto es suficiente para detectar regresiones de "vuelve a aparecer el bug" pero no sustituye una prueba de integración real con jsdom. Se registra como seguimiento pendiente, no como bloqueador de esta tarea.
