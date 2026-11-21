# NEXA — Ficha universal de detalle por pulsación (21/11/2026)

**Mandato del propietario:** «Si pulsas en una operación, debería mostrar un modal emergente donde muestre toda la información de la operación, bien detallada y resaltando los datos importantes. Extrapolalo a todas las operaciones, salidas, etc.».

## Regla UX transversal irrenunciable

**Cualquier elemento de actividad/operativa individual es inspeccionable con UN toque** en Web y APK, tanto Básico como Pro. El detalle es una **ficha emergente unificada de solo lectura** (bottom sheet a pantalla casi completa en móvil; modal centrado en escritorio) con todas las propiedades reales disponibles sin pérdida de información; nunca reemplazar la ficha por pequeñas columnas con scroll horizontal.

Elementos mínimos:
- IDCA: compra base, compra de seguridad, compra manual, venta parcial, venta final, break-even, take profit, trailing, cierre manual/automático, ciclos activos y cerrados, órdenes/ejecuciones, alertas y reglas de salida.
- SPOT/Swing: BUY/SELL, órdenes, posiciones, operaciones históricas, decisiones/señales, protecciones activadas, salidas por time-stop, stop, trailing, etc.
- GRID aislado: BUY/SELL 1:1 por ciclo, nivel, órdenes abiertas/canceladas/parciales/filled, objetivos de rango, SELL heredados de rangos antiguos, eventos y cancelaciones. Nunca mezclar un SELL antiguo con una compra nueva ni con HOLD.
- AMA Macro: decisión, mandato, tranche, reserva, orden creada/enviada, parcial/filled/cancelada, ledger y validaciones. **`reserved` / `planned` / `submitted` / `executed` / `filled` son estados distintos**; no tratar reservas como ejecuciones.
- Transversal: cartera (movimientos/variaciones y atribución cuando existan), monitor, alertas, actividad y eventos; enlaces desde gráficos reales y desde listas compactas cuando exista un registro de respaldo.

## Diseño de la ficha

**Cabecera compacta:** tipo `COMPRA` verde, `VENTA` rojo (solo color semántico por lado), par, motor, `#orden`, estado y `LIVE/SIMULATION/DRY-RUN` según respuesta exacta. No mezclar modalidad de la app Básico/Pro con modalidad operativa del bot.

**Zona protagonista (hero):** PnL neto (si corresponde y es verificable) con moneda y signo/color; en una compra sin PnL, importe ejecutado o total de orden. No poner +0,00 para dato ausente. Si hay PnL, acompañar PnL bruto/comisiones cuando la API los incluya.

**Zona esencial:** cantidad, precio de ejecución, valor bruto y neto, comisiones (base/quote si están), slippage, fecha/hora local (y UTC disponible), estado exacto, proveedor/exchange/venue, ciclo/posición asociado y motivo operativo legible.

**Detalles por tipo:** 
- Compra: motivo disparo, setup/score, señal/indicadores observados al ejecutar (solo si hay snapshot real), referencia precio/ancla y siguiente nivel.
- Venta/cierre: tipo de salida (TP/trailing/BE/stop/manual/time-stop/emergencia), precio de entrada medio y salida, cantidad vendida, motivo exacto, retorno/beneficio neto en USD y %, fees, slippage y ejecución parcial si existe.
- Ciclo: fecha inicio/cierre, duración, estado, compras/ventas asociadas, precio medio, capital usado y reservado, cantidad, objetivos TP, umbrales BE, trailing y serie de operaciones enlazadas. Diferenciar abierto (PnL no realizado) de cerrado (PnL realizado).
- Orden en proceso: requested/submitted/accepted/partially-filled/filled/cancelled/rejected con eventos/errores, cantidad solicitada, ejecutada y pendiente, fill prices y timestamps de cada fill, si los tiene el API.
- Decisión/señal/mandato: reglas, filtros, vetos, score, indicadores, timestamp del contexto, responsable lógico, estado de la decisión, siguiente acción prevista, siempre según datos verificados.
- Logs y eventos: descripción humana, severidad, motor, par, id/correlación, fuente, timestamp y detalles estructurados permitidos, con campos sensibles ocultos.

**Sección «Datos completos»:** etiquetas comprensibles en castellano; listar TODOS los campos de la respuesta, también los anidados, desplegables por grupos; permitir ver identificadores largos sin cortar, mantener precisión monetaria suficiente, y señalar los ausentes como «No disponible». No ocultar datos al pasar de Pro a Básico: Básico muestra menos CONTENIDO en la lista pero la **misma ficha completa** al pulsar.

**Vinculación:** desde ciclo y cierre ver todas sus órdenes reales; desde orden abrir el ciclo asociado cuando el read-model permite identificarlo; en fases posteriores, consultar `GET /institutional-dca/cycles/:id` en modo solo lectura para completar detalle, con autorización del gateway. Cuando no hay datos de un endpoint informar de ello, no rellenar con simulaciones.

## Interacción y seguridad

- Un toque abre la ficha; `X`, toque en el fondo, `Esc`, navegación Atrás cierran (Android Back pendiente de QA en WebView). Al cerrar se conserva lista, filtro, pestaña y scroll original.
- No se ejecuta ninguna orden ni cambia el estado del bot al abrir/ver/cerrar; cualquier acción LIVE (si se implementa) vive en otro flujo con confirmación y permisos, separada de esta ficha de consulta.
- Acceso por teclado (`Enter`/`Espacio`), foco inicial accesible, cierre y retorno del foco; contrastes AA, texto legible, scroll interior, safe-area, móvil 360–412 dp, paisaje y desktop.
- No exponer token/session secrets/passwords ni otros secretos del payload en la UI o capturas; no guardar valores sensibles en HTML attributes.
- Ni la conexión general ni un `200` implica que todos los campos económicos estén verificados. Cada fila requiere fuente/alcance y frescura.

## Implementación iniciada en rama de transformación (NO DESPLEGADA)

- `nexa-v2/web/js/inspector.js`: inspector universal read-only que muestra resumen destacado, razón y campos completos anidados, enmascara claves sensibles y resuelve IDs/índices del read-model.
- `nexa-v2/web/js/app.js`: delegación común `data-inspect`.
- `nexa-v2/web/js/screens.js`: disparadores IDCA (órdenes, ciclos, historial), SPOT (histórico y posiciones), GRID (ciclos/niveles/estados/cancelaciones), AMA (mandato, órdenes/tranches/ledger/decisiones).
- `nexa-v2/web/js/premium.js`: tarjetas de ciclos, posiciones, niveles y eventos.
- `nexa-v2/web/css/style.css`: modal responsive, detalle con jerarquía y semántica de resultado.
- `nexa-v2/web/js/ui.js`: `Esc`, cierre y restauración del foco.

**Estos cambios son de la rama de trabajo: no hay afirmación de compatibilidad con todos los endpoints reales, Android ni producción. Se requiere QA.**

## Pruebas obligatorias de aceptación

- [ ] Pulsar IDCA BUY con ID y par → ficha accesible completa, verde, precio, cantidad, fees, motivo y ciclo asociados.
- [ ] Pulsar IDCA SELL final/BE/TP → ficha roja; PnL neto solo si fuente lo proporciona; salida y motivo resaltados.
- [ ] Pulsar ciclo cerrado #33 o ejemplo vigente → todas las órdenes vinculadas presentes si las suministra API; al menos mostrar ausencia de enlace sin inventar.
- [ ] Pulsar una posición SPOT → costo, valor, protección, PnL y detalles reales; pulsar una venta SPOT → precio y razón de salida.
- [ ] Pulsar GRID BUY / SELL objetivo / SELL heredado → rangos no mezclados y trazabilidad completa.
- [ ] Pulsar AMA reserved → estado `reserved`, **sin** presentarlo como `filled`; seleccionar filled → detalles de fill si existentes.
- [ ] Pulsar log/evento y señal → modal de detalles y campos anidados sin credenciales.
- [ ] Valores `null` y `undefined` muestran «No disponible»; 0 autenticado muestra 0; dinero string decimal se convierte solo cuando sea verificable.
- [ ] Mismo registro desde Básico y Pro → identidad, números y detalle idénticos, sin truncamientos.
- [ ] Apertura y cierre 30 veces sin listeners Escape acumulados, modal queda por encima de la barra inferior, no pierde scroll y es accesible con teclado.
- [ ] Validar todos los paths `data-inspect` con fixtures de API y E2E visual en el Pixel 9 y Web. Mantener versión SIN APROBAR hasta revisión del propietario.

**Condición de seguridad:** no tocar `main`, VPS, bot LIVE, estrategias, órdenes, balances, SQL, historial ni permisos de FISCO. 
