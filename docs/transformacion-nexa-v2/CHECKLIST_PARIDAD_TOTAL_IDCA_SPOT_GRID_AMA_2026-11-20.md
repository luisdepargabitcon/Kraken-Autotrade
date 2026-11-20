# NEXA V2 — Checklist bloqueante de conservación total (20/11/2026)

Fuente: tres capturas de la interfaz IDCA aportadas por el usuario (Panel, Ciclos abiertos y Historial), auditorías NEXA de noviembre y código actual de los cuatro motores. Esta lista es un **mínimo**, no un límite máximo. La **fuente de verdad** es el inventario real del repositorio y las pantallas; no inferir que algo existe para otro motor si no se verifica.

## NORMA DE ACEPTACIÓN
- [ ] CERO pérdida de información, métricas, comportamiento, controles, histórico, trazabilidad, indicadores, reglas o funcionalidades del bot anterior.
- [ ] Crear MATRIZ DE PARIDAD completa: id, motor/página origen, etiqueta de campo, origen (API/tabla/servicio), tipo/unidad/moneda, calidad/frescura/timestamp, permiso, acción, modo de ejecución, pantalla destino Básico, destino Pro, destino web, destino APK, prueba y resultado.
- [ ] Para cada elemento, marcar: PARIDAD DEMOSTRADA / PENDIENTE / NO DISPONIBLE EN ORIGEN / NO APLICA CON JUSTIFICACIÓN / BLOQUEADO POR AUTORIZACIÓN. Nunca marcar como terminado con un simple mock o un campo parecido.
- [ ] Básico y Pro son SOLO presentaciones, no motores ni modos de ejecución. Ocultar inicialmente en Básico ≠ borrar: acceso por detalle, modal, desplegable o enlace claramente descubrible; en Pro acceso completo y sin pérdida.
- [ ] Web y APK dan acceso equivalente a cada dato y ficha, aunque la composición responsive difiera.
- [ ] No inventar métricas ni operaciones; DEMO inequívoco para datos simulados; no mostrar 0 en lugar de no disponible o stale. Fecha real de observación y proveedor.

## IDCA — ESTADO Y ENTRADAS (referencia visual obligatoria)
- [ ] Estado global IDCA ON/OFF, enabled, DISABLED/SIMULATION/LIVE reales, tick y hora última actualización.
- [ ] Pausa global y emergencia: visibilidad, estado, confirmaciones, permisos y semántica; maqueta no puede ejecutar acciones.
- [ ] Activación de BTC/USD y ETH/USD por separado, par/estado y modo de ejecución real.
- [ ] Precio actual, moneda, precio del par y última actualización por par.
- [ ] Confianza/score de entrada, umbral y desglose de componentes (V/C/R/D/M u otros nombres reales sin inventar significados).
- [ ] Régimen/rango de mercado, ATR/ATRP, volatilidad, tendencia, rebote/confirmación y motivo de espera.
- [ ] Caída/drawdown detectado y porcentaje exigido para entrar; barra de progreso y advertencias.
- [ ] Referencia dinámica y señal «vigilar rebote», datos y texto de decisión del engine.
- [ ] Capital asignado/usado/libre; PnL realizado y no realizado; ciclos activos; comparativa por par.
- [ ] Compras/ventas de hoy, trailing activo, Smart Mode y estados auxiliares si operativos.
- [ ] Contexto de mercado, ancla viva, ancla de ciclo, distancia %, base y referencia híbrida/VWAP si existen; diferenciar referencia antigua y nueva.
- [ ] Pestañas Panel, Ciclos abiertos, Configuración, Hybrid/Grid, Historial, Alertas y Ayuda conservadas o ruta equivalente explícita.

## IDCA — CICLOS ABIERTOS (ficha completa)
- [ ] Identificador del ciclo, par, fecha/hora de inicio, tiempo abierto, nº compras, score, TP de referencia y dip de entrada.
- [ ] Precio actual, precio medio de compras, ancla del ciclo, base de entrada, próxima compra, cantidad exacta y objetivo TP dinámico.
- [ ] Capital utilizado por ciclo, valor de mercado, PnL USD y %, costes, PnL neto y marcación de moneda/coste.
- [ ] Break-even: habilitación, umbral de activación, distancia restante, estado visual; preservar lógica original.
- [ ] Trailing stop: activación, margen, progreso y distancia faltante; no aproximar ni alterar porcentajes.
- [ ] Duración, tiempo restante, fecha y regla de protección/tiempo; opción de activar/desactivar solo si existe y está autorizada.
- [ ] Gráficos/mini barras de estado de BE y trailing, objetivo y avance (cuando existan en origen).
- [ ] TP dinámico: valor, base, compras, volatilidad, rebote, intervalo y desglose de componentes.
- [ ] Tabla de todas las órdenes del ciclo: fecha y hora, tipo, lado BUY/SELL, precio, cantidad, valor, fees, slippage y motivo completo; totales compras/ventas.
- [ ] Acciones originales: pausar ciclo, cerrar posición, programar salida, añadir compra manual, eliminar ciclo; conservar acceso en Pro y seguridad/autorización de cada acción, sin activarlas en prototipo.

## IDCA — HISTORIAL
- [ ] Ciclos cerrados y filtros; número wins/losses/neutral; PnL histórico total conciliado.
- [ ] Orden cronológico y tarjeta expandible con ID, par, modo, entrada/salida, duración, nº compras y tipo de cierre.
- [ ] Capital invertido, vendido, fees, slippage, PnL neto $, PnL %, duración, salida BE/trailing/TP/stop y motivo.
- [ ] Desglose de órdenes individuales, fecha, cantidad, precio, side y explicación de la decisión.
- [ ] Exportación CSV e históricos y alertas existentes con sus condiciones; sin mezclar histórico LIVE con SIMULATION.

## SPOT / SWING — EQUIVALENTES PROPIOS DEL MOTOR
- [ ] Estado/estrategia/pares/venue, dry-run vs live y configuración efectiva, no solo formulario guardado.
- [ ] Señal, score, indicadores RSI/MACD/Bollinger/EMA/ADX/ATR/volumen y otros existentes; setup y régimen de mercado.
- [ ] Entrada: disparadores, condiciones, filtros, vetos, confianza, motivo de aceptación/rechazo y tiempo de vela.
- [ ] Posiciones/operaciones: quantity, precio medio/actual, coste, valor, PnL %, PnL neto, capital y exposición.
- [ ] Stop loss, take profit, break-even, trailing, time-stop, Smart Guard y límites realmente soportados.
- [ ] Órdenes, fills parciales, comisiones, slippage, histórico, causa de entrada/salida y logs.
- [ ] Mantener como conceptos distintos «gridStrategy» de SPOT, overlay Grid de IDCA y Grid aislado.

## GRID AISLADO — INTEGRIDAD OPERATIVA
- [ ] Estado OFF/SHADOW/REAL_LIMITED/REAL_FULL, maker-only/post-only, par, capital, ciclo y límites.
- [ ] Centro, rejilla/niveles, spacing, rango actual, versiones de rangos anteriores, BUY planificados/ejecutados y targets SELL.
- [ ] En cada ciclo BUY → SELL objetivo (1:1), cantidad exacta, precio de fill, comisiones netas, beneficio objetivo y PnL efectivo.
- [ ] SELL pendientes de rangos antiguos siguen visibles y gestionados; no mezclarlos con nuevas entradas ni HOLD.
- [ ] Registros de cancelaciones, fees, estado de órdenes, alertas de bloqueo, capital bloqueado y liberado.
- [ ] Estado de la política simétrica/adyacente en la documentación SIN cambiar ninguna política operativa ni targets históricos.

## AMA — MACRO / ACUMULACIÓN
- [ ] Modos OFF/LAB/REPLAY/SHADOW_SCENARIO/SHADOW_LIVE/REAL_* diferenciados, guardas, scheduler/heartbeat y kill switch.
- [ ] Mandatos, activos, scoring, contexto macro, fuentes reales vs taxonomías/condicionales, explicación de compra/no compra.
- [ ] Capital, presupuesto, reservas, exposición, límites de riesgo y estado de HWM donde exista.
- [ ] Señales, replays, órdenes/decisiones y trazabilidad; executed/reserved/submitted/filled **no son sinónimos**.
- [ ] REAL no habilitado por aparente botón, ni presentado como ejecutado mientras sea gateway placeholder.

## TRANSVERSALES — MERCADO, CARTERA, FISCO, ACTIVIDAD Y AJUSTES
- [ ] Mercado: precio, variación, velas OHLCV/temporalidades, volumen, spread/bid-ask, indicadores y bandas completos, momentum/régimen, fuentes y freshness.
- [ ] Métricas externas si existen y están activas: OI, funding, CoinGlass/Binance Futures, DeFiLlama, Coin Metrics, Whale Alert; marcar ausencia o condición de licencia.
- [ ] Cartera: balances por exchange/activo/motor, usado/reservado/libre, HOLD separado, NAV, exposición, PnL realizado y no realizado por activo/estrategia y global.
- [ ] FISCO/AEAT: saldos, lotes, eventos imponibles, costes, histórico, exportes e informes existentes; no confundir reserva fiscal con fees. Prohibido usar datos personales en repo público.
- [ ] Monitor/logs/actividad: eventos, errores, trazas y decisiones, alertas, notificaciones, estado de exchange, latencias, staleness y timestamps.
- [ ] Configuración: cada control y slider existente, valor guardado y valor EFECTIVO en la decisión del motor, defaults/legacy y alcance.
- [ ] Seguridad: PIN/sesión móvil, autorización de mutaciones, confirmaciones, no secrets en HTML/APK, no UI engañosa en acciones críticas.

## EXPERIENCIA WEB/APK Y PARIDAD VISUAL
- [ ] Web con navegación superior y modal de motor, sin sidebar permanente obligatorio; móvil con navegación inferior y detalle en pantalla completa.
- [ ] Dos composiciones **realmente diferentes** Básico (minimalista) y Pro (información completa); no solo cambio de color, pero sin pérdida del dato.
- [ ] Para cada motor, disponer de Panel, posición/ciclos, historial, órdenes, actividad/alertas y configuración equivalente o documentar N/A.
- [ ] Cada cifra tiene unidad, símbolo, precisión, origen, timestamp y denominador explícito; distinguir PnL neto/bruto/no realizado.
- [ ] Expandibles, detalles, acciones, tablas y filtros funcionales; evitar botones placebo.
- [ ] Gráficas legibles en 360/390/768/1280/1920 px, sin scroll horizontal ni superposición con safe areas.
- [ ] Accesibilidad: contraste, foco visible, teclado, táctil, lectores de pantalla cuando aplique; navegación atrás y estados offline.

## TESTS Y CRITERIOS DE CIERRE (BLOQUEANTES)
- [ ] Archivo de inventario cuenta el número de elementos fuente y destinos. Ninguno queda «SIN DESTINO»; justificar expresamente NO APLICA.
- [ ] Prueba comparativa origen vs maqueta y nueva UI por cada motor, en Básico/Pro y móvil/web. Capturas y matriz por pantalla, campo y función.
- [ ] Pruebas automatizadas de campos/propiedades por contrato (sin snapshots superficiales exclusivamente).
- [ ] Tests de faltantes, stale, endpoint error, permisos, modo apagado, historial grande, múltiples ciclos y fills, sin falsos ceros.
- [ ] Tests de seguridad: navegación/cambio Básico-Pro no hacen POST ni órdenes; SHADOW no transmite órdenes reales; no cambio DB/targets.
- [ ] npm run check, tests pertinentes, npm run build, build local Android si es viable, y manifiesto de qué se ejecutó realmente.
- [ ] Revisión de GitHub commit SHA, diff exacto, archivos y CI; solo rama feature, no main, no merge, no VPS, no deploy.
- [ ] Para todo incumplimiento, registrar ID, gravedad, reproducción, evidencia, reparación y nueva prueba. No marcar COMPLETADO si hay incumplimientos P0 o pérdida de paridad.
- [ ] Entregables: HTML navegable, fuentes, inventario CSV/MD sin datos personales, checklist cumplimentado con evidencia, guía de instalación/QA local, APK de prueba si se logra compilar; si no, bloqueo técnico concreto.
- [ ] Estado final: IMPLEMENTADO LOCAL/VALIDADO LOCAL/PENDIENTE APROBACIÓN. **No declarar bot transformado en producción ni estrategia REAL validada**.

**Regla final:** no sacrificar datos por estética, no fusionar motores, no degradar trazabilidad y no afirmar éxito sin evidencia.
