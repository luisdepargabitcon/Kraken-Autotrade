# NEXA V2 — Checklist ejecutable por Cascade: conservación total (20/11/2026)

Fuente: tres capturas de la interfaz IDCA aportadas por el usuario (Panel, Ciclos abiertos y Historial), auditorías NEXA de noviembre y código actual de los cuatro motores. Esta lista es un **mínimo**, no un límite máximo. La **fuente de verdad** es el inventario real del repositorio y las pantallas; no inferir que algo existe para otro motor si no se verifica.


## PROTOCOLO DE EJECUCIÓN OBLIGATORIO PARA CASCADE (NO ES UNA LISTA PARA EL USUARIO)
**Responsable de marcar, verificar y mantener este checklist: Cascade/Devin, no el propietario del proyecto.** Este documento es un instrumento de ejecución y QA de la transformación, no un formulario para el usuario.

1. Leer **primero y de forma íntegra** el [PLAN MAESTRO F0–F6](PLAN_MAESTRO_2026-11-20.md) y la [ORDEN OPERATIVA](ORDEN_CASCADE_F0_F1_F2_2026-11-20.md). Ejecutar el plan completo; el checklist **no sustituye** sus entregables, prioridades, dependencias ni restricciones.
2. En F0 inicializar `docs/transformacion-nexa-v2/seguimiento/ESTADO_FASES.md`, `MATRIZ_PARIDAD.csv` (sin datos financieros personales), `EVIDENCIAS_CHECKLIST.md` y `INCIDENCIAS.md`. Marcar fases F0–F6 como PENDIENTE / EN CURSO / VALIDADA LOCALMENTE / PARCIAL / BLOQUEADA POR AUTORIZACIÓN. Actualizar después de cada cambio relevante.
3. Las 75 casillas enumeradas C001–C075 son **responsabilidad de Cascade**: para cada una registrar en `EVIDENCIAS_CHECKLIST.md` ID, fase, fuente y pantalla de origen, implementación/destino, prueba o reproducción, resultado, archivo/commit/captura si existe y estado: **VERIFICADA / FALLIDA / PENDIENTE / NO APLICA (motivo demostrado) / BLOQUEADA POR AUTORIZACIÓN**.
4. Solo transformar `- [ ]` en `- [x]` si existe prueba verificable satisfactoria y toda la comprobación se cumplió. No marcar por suposición, por maqueta o por documentación de tercero. Para NO APLICA o BLOQUEADA dejar la casilla sin marcar y referenciar su justificación; la verificación de runtime nunca se sustituye por una prueba de HTML ficticio.
5. Al finalizar **cada fase**, volver a recorrer los IDs relacionados, identificar faltantes, corregir defectos ordinarios y volver a probar. Registrar el resumen en `ESTADO_FASES.md`: total de controles, verificados, fallidos, pendientes, N/A justificados y bloqueados; porcentaje calculado sobre controles aplicables, sin considerar N/A o bloqueados como tests exitosos.
6. **Añadir nuevas casillas con nuevos IDs** cuando el inventario de código/pantallas descubra un campo, acción o control que no aparece aquí. No eliminar ninguna comprobación para mejorar el porcentaje de cobertura.
7. Prueba de regresión obligatoria: matriz origen→Básico/Pro→Web/APK de SPOT, IDCA, GRID y AMA; controles, historiales, acciones, mercados y módulos transversales. Verificar también estados offline/stale, faltantes, historial y rangos antiguos. Básico menos visible, pero todos los detalles accesibles; Pro profundo. Una función ausente en origen se documenta como N/A con evidencia.
8. **Puertas de fase:** no declarar VALIDADA LOCALMENTE una fase con errores P0 no resueltos dentro de ese alcance, campos perdidos, tests críticos fallidos o casillas aplicables sin evidencia. Si falta infraestructura/acceso REAL, marcar PARCIAL/BLOQUEADA y continuar con fases locales seguras; no simular que el VPS fue auditado.
9. Entregar automáticamente al finalizar los **tres documentos de seguimiento cumplimentados**, `MATRIZ_PARIDAD.csv`, checklist actualizado, HTML y frontend, builds reales disponibles, tests, SHA y enlaces. En la Issue #17 enlazar evidencias públicas no sensibles, resumir estado por fase y mantener abierta si quedan pendientes. No publicar datos fiscales, credenciales, órdenes individuales o secretos en el repositorio público.
10. Esta checklist **pertenece al agente ejecutor**. No trasladar casillas al usuario para rellenarlas ni solicitarle que audite el trabajo de Cascade.

## NORMA DE ACEPTACIÓN
- [ ] **C001** CERO pérdida de información, métricas, comportamiento, controles, histórico, trazabilidad, indicadores, reglas o funcionalidades del bot anterior.
- [ ] **C002** Crear MATRIZ DE PARIDAD completa: id, motor/página origen, etiqueta de campo, origen (API/tabla/servicio), tipo/unidad/moneda, calidad/frescura/timestamp, permiso, acción, modo de ejecución, pantalla destino Básico, destino Pro, destino web, destino APK, prueba y resultado.
- [ ] **C003** Para cada elemento, marcar: PARIDAD DEMOSTRADA / PENDIENTE / NO DISPONIBLE EN ORIGEN / NO APLICA CON JUSTIFICACIÓN / BLOQUEADO POR AUTORIZACIÓN. Nunca marcar como terminado con un simple mock o un campo parecido.
- [ ] **C004** Básico y Pro son SOLO presentaciones, no motores ni modos de ejecución. Ocultar inicialmente en Básico ≠ borrar: acceso por detalle, modal, desplegable o enlace claramente descubrible; en Pro acceso completo y sin pérdida.
- [ ] **C005** Web y APK dan acceso equivalente a cada dato y ficha, aunque la composición responsive difiera.
- [ ] **C006** No inventar métricas ni operaciones; DEMO inequívoco para datos simulados; no mostrar 0 en lugar de no disponible o stale. Fecha real de observación y proveedor.

## IDCA — ESTADO Y ENTRADAS (referencia visual obligatoria)
- [ ] **C007** Estado global IDCA ON/OFF, enabled, DISABLED/SIMULATION/LIVE reales, tick y hora última actualización.
- [ ] **C008** Pausa global y emergencia: visibilidad, estado, confirmaciones, permisos y semántica; maqueta no puede ejecutar acciones.
- [ ] **C009** Activación de BTC/USD y ETH/USD por separado, par/estado y modo de ejecución real.
- [ ] **C010** Precio actual, moneda, precio del par y última actualización por par.
- [ ] **C011** Confianza/score de entrada, umbral y desglose de componentes (V/C/R/D/M u otros nombres reales sin inventar significados).
- [ ] **C012** Régimen/rango de mercado, ATR/ATRP, volatilidad, tendencia, rebote/confirmación y motivo de espera.
- [ ] **C013** Caída/drawdown detectado y porcentaje exigido para entrar; barra de progreso y advertencias.
- [ ] **C014** Referencia dinámica y señal «vigilar rebote», datos y texto de decisión del engine.
- [ ] **C015** Capital asignado/usado/libre; PnL realizado y no realizado; ciclos activos; comparativa por par.
- [ ] **C016** Compras/ventas de hoy, trailing activo, Smart Mode y estados auxiliares si operativos.
- [ ] **C017** Contexto de mercado, ancla viva, ancla de ciclo, distancia %, base y referencia híbrida/VWAP si existen; diferenciar referencia antigua y nueva.
- [ ] **C018** Pestañas Panel, Ciclos abiertos, Configuración, Hybrid/Grid, Historial, Alertas y Ayuda conservadas o ruta equivalente explícita.

## IDCA — CICLOS ABIERTOS (ficha completa)
- [ ] **C019** Identificador del ciclo, par, fecha/hora de inicio, tiempo abierto, nº compras, score, TP de referencia y dip de entrada.
- [ ] **C020** Precio actual, precio medio de compras, ancla del ciclo, base de entrada, próxima compra, cantidad exacta y objetivo TP dinámico.
- [ ] **C021** Capital utilizado por ciclo, valor de mercado, PnL USD y %, costes, PnL neto y marcación de moneda/coste.
- [ ] **C022** Break-even: habilitación, umbral de activación, distancia restante, estado visual; preservar lógica original.
- [ ] **C023** Trailing stop: activación, margen, progreso y distancia faltante; no aproximar ni alterar porcentajes.
- [ ] **C024** Duración, tiempo restante, fecha y regla de protección/tiempo; opción de activar/desactivar solo si existe y está autorizada.
- [ ] **C025** Gráficos/mini barras de estado de BE y trailing, objetivo y avance (cuando existan en origen).
- [ ] **C026** TP dinámico: valor, base, compras, volatilidad, rebote, intervalo y desglose de componentes.
- [ ] **C027** Tabla de todas las órdenes del ciclo: fecha y hora, tipo, lado BUY/SELL, precio, cantidad, valor, fees, slippage y motivo completo; totales compras/ventas.
- [ ] **C028** Acciones originales: pausar ciclo, cerrar posición, programar salida, añadir compra manual, eliminar ciclo; conservar acceso en Pro y seguridad/autorización de cada acción, sin activarlas en prototipo.

## IDCA — HISTORIAL
- [ ] **C029** Ciclos cerrados y filtros; número wins/losses/neutral; PnL histórico total conciliado.
- [ ] **C030** Orden cronológico y tarjeta expandible con ID, par, modo, entrada/salida, duración, nº compras y tipo de cierre.
- [ ] **C031** Capital invertido, vendido, fees, slippage, PnL neto $, PnL %, duración, salida BE/trailing/TP/stop y motivo.
- [ ] **C032** Desglose de órdenes individuales, fecha, cantidad, precio, side y explicación de la decisión.
- [ ] **C033** Exportación CSV e históricos y alertas existentes con sus condiciones; sin mezclar histórico LIVE con SIMULATION.

## SPOT / SWING — EQUIVALENTES PROPIOS DEL MOTOR
- [ ] **C034** Estado/estrategia/pares/venue, dry-run vs live y configuración efectiva, no solo formulario guardado.
- [ ] **C035** Señal, score, indicadores RSI/MACD/Bollinger/EMA/ADX/ATR/volumen y otros existentes; setup y régimen de mercado.
- [ ] **C036** Entrada: disparadores, condiciones, filtros, vetos, confianza, motivo de aceptación/rechazo y tiempo de vela.
- [ ] **C037** Posiciones/operaciones: quantity, precio medio/actual, coste, valor, PnL %, PnL neto, capital y exposición.
- [ ] **C038** Stop loss, take profit, break-even, trailing, time-stop, Smart Guard y límites realmente soportados.
- [ ] **C039** Órdenes, fills parciales, comisiones, slippage, histórico, causa de entrada/salida y logs.
- [ ] **C040** Mantener como conceptos distintos «gridStrategy» de SPOT, overlay Grid de IDCA y Grid aislado.

## GRID AISLADO — INTEGRIDAD OPERATIVA
- [ ] **C041** Estado OFF/SHADOW/REAL_LIMITED/REAL_FULL, maker-only/post-only, par, capital, ciclo y límites.
- [ ] **C042** Centro, rejilla/niveles, spacing, rango actual, versiones de rangos anteriores, BUY planificados/ejecutados y targets SELL.
- [ ] **C043** En cada ciclo BUY → SELL objetivo (1:1), cantidad exacta, precio de fill, comisiones netas, beneficio objetivo y PnL efectivo.
- [ ] **C044** SELL pendientes de rangos antiguos siguen visibles y gestionados; no mezclarlos con nuevas entradas ni HOLD.
- [ ] **C045** Registros de cancelaciones, fees, estado de órdenes, alertas de bloqueo, capital bloqueado y liberado.
- [ ] **C046** Estado de la política simétrica/adyacente en la documentación SIN cambiar ninguna política operativa ni targets históricos.

## AMA — MACRO / ACUMULACIÓN
- [ ] **C047** Modos OFF/LAB/REPLAY/SHADOW_SCENARIO/SHADOW_LIVE/REAL_* diferenciados, guardas, scheduler/heartbeat y kill switch.
- [ ] **C048** Mandatos, activos, scoring, contexto macro, fuentes reales vs taxonomías/condicionales, explicación de compra/no compra.
- [ ] **C049** Capital, presupuesto, reservas, exposición, límites de riesgo y estado de HWM donde exista.
- [ ] **C050** Señales, replays, órdenes/decisiones y trazabilidad; executed/reserved/submitted/filled **no son sinónimos**.
- [ ] **C051** REAL no habilitado por aparente botón, ni presentado como ejecutado mientras sea gateway placeholder.

## TRANSVERSALES — MERCADO, CARTERA, FISCO, ACTIVIDAD Y AJUSTES
- [ ] **C052** Mercado: precio, variación, velas OHLCV/temporalidades, volumen, spread/bid-ask, indicadores y bandas completos, momentum/régimen, fuentes y freshness.
- [ ] **C053** Métricas externas si existen y están activas: OI, funding, CoinGlass/Binance Futures, DeFiLlama, Coin Metrics, Whale Alert; marcar ausencia o condición de licencia.
- [ ] **C054** Cartera: balances por exchange/activo/motor, usado/reservado/libre, HOLD separado, NAV, exposición, PnL realizado y no realizado por activo/estrategia y global.
- [ ] **C055** FISCO/AEAT: saldos, lotes, eventos imponibles, costes, histórico, exportes e informes existentes; no confundir reserva fiscal con fees. Prohibido usar datos personales en repo público.
- [ ] **C056** Monitor/logs/actividad: eventos, errores, trazas y decisiones, alertas, notificaciones, estado de exchange, latencias, staleness y timestamps.
- [ ] **C057** Configuración: cada control y slider existente, valor guardado y valor EFECTIVO en la decisión del motor, defaults/legacy y alcance.
- [ ] **C058** Seguridad: PIN/sesión móvil, autorización de mutaciones, confirmaciones, no secrets en HTML/APK, no UI engañosa en acciones críticas.

## EXPERIENCIA WEB/APK Y PARIDAD VISUAL
- [ ] **C059** Web con navegación superior y modal de motor, sin sidebar permanente obligatorio; móvil con navegación inferior y detalle en pantalla completa.
- [ ] **C060** Dos composiciones **realmente diferentes** Básico (minimalista) y Pro (información completa); no solo cambio de color, pero sin pérdida del dato.
- [ ] **C061** Para cada motor, disponer de Panel, posición/ciclos, historial, órdenes, actividad/alertas y configuración equivalente o documentar N/A.
- [ ] **C062** Cada cifra tiene unidad, símbolo, precisión, origen, timestamp y denominador explícito; distinguir PnL neto/bruto/no realizado.
- [ ] **C063** Expandibles, detalles, acciones, tablas y filtros funcionales; evitar botones placebo.
- [ ] **C064** Gráficas legibles en 360/390/768/1280/1920 px, sin scroll horizontal ni superposición con safe areas.
- [ ] **C065** Accesibilidad: contraste, foco visible, teclado, táctil, lectores de pantalla cuando aplique; navegación atrás y estados offline.

## TESTS Y CRITERIOS DE CIERRE (BLOQUEANTES)
- [ ] **C066** Archivo de inventario cuenta el número de elementos fuente y destinos. Ninguno queda «SIN DESTINO»; justificar expresamente NO APLICA.
- [ ] **C067** Prueba comparativa origen vs maqueta y nueva UI por cada motor, en Básico/Pro y móvil/web. Capturas y matriz por pantalla, campo y función.
- [ ] **C068** Pruebas automatizadas de campos/propiedades por contrato (sin snapshots superficiales exclusivamente).
- [ ] **C069** Tests de faltantes, stale, endpoint error, permisos, modo apagado, historial grande, múltiples ciclos y fills, sin falsos ceros.
- [ ] **C070** Tests de seguridad: navegación/cambio Básico-Pro no hacen POST ni órdenes; SHADOW no transmite órdenes reales; no cambio DB/targets.
- [ ] **C071** npm run check, tests pertinentes, npm run build, build local Android si es viable, y manifiesto de qué se ejecutó realmente.
- [ ] **C072** Revisión de GitHub commit SHA, diff exacto, archivos y CI; solo rama feature, no main, no merge, no VPS, no deploy.
- [ ] **C073** Para todo incumplimiento, registrar ID, gravedad, reproducción, evidencia, reparación y nueva prueba. No marcar COMPLETADO si hay incumplimientos P0 o pérdida de paridad.
- [ ] **C074** Entregables: HTML navegable, fuentes, inventario CSV/MD sin datos personales, checklist cumplimentado con evidencia, guía de instalación/QA local, APK de prueba si se logra compilar; si no, bloqueo técnico concreto.
- [ ] **C075** Estado final: IMPLEMENTADO LOCAL/VALIDADO LOCAL/PENDIENTE APROBACIÓN. **No declarar bot transformado en producción ni estrategia REAL validada**.

**Regla final:** no sacrificar datos por estética, no fusionar motores, no degradar trazabilidad y no afirmar éxito sin evidencia.
