# NEXA V2 — REFERENCIAS REALES Y DISEÑO FINAL DE INTERACCIÓN · REV. 10
**21/11/2026 · Obligatorio para Cascade · Documento funcional de aceptación visual**
**Producto:** panel de gestión del bot web y APK Android, **NO exchange alternativo ni app de compra manual**. Código en rama `feature/nexa-v2-transformacion-20261120`. VPS, DB y trading sin cambios.

## 1. LO PROMETIDO AL USUARIO (Y LA DEUDA DE UX)
- **Revolut X / Revolut:** simplicidad y orden en cartera: una cantidad dominante, rendimiento, gráfica histórica, activos/estrategias ordenados, navegación inferior limpia. No mostrar una lista larga de «No disponible».
- **Kraken Pro:** gestión profesional: gráfico de velas destacado con temporalidad y zoom, entrada/órdenes/posiciones vinculadas a la misma vista, profundidad cuando exista, filtros por actividad y estados claros, módulos de diagnóstico. No convertir toda la pantalla Pro en texto.
- **Coinbase Advanced:** contexto técnico: gráfico interactivo, tipos de operación y filtros, libro/órdenes/historial cuando los datos lo respalden; indicadores RSI, MACD, EMA, BB y herramientas de interpretación organizadas y legibles.
- **NEXA aporta lo que esas apps no tienen:** cuatro motores automáticos con estados, scores, protecciones, reglas efectivas, riesgos, ciclos BUY→SELL, banderas de autorización, explicaciones de decisión, cartera unificada y FISCO. **NO presentar controles de mercado como si hicieran trading manual por defecto.**

Referencias de investigación oficiales (aprender patrones, NO copiar imágenes/código/marcas):
- https://www.revolut.com/es-ES/revolut-x/
- https://support.kraken.com/es/articles/kraken-pro-trading-interface-guide
- https://support.kraken.com/articles/360056804571-how-to-place-orders-with-the-kraken-pro-app
- https://help.coinbase.com/en/coinbase/trading-and-funding/advanced-trade/dashboard-overview
- https://www.coinbase.com/advanced-trade

**Diagnóstico en la rama rev9:** ya se incorporó `nexa-v2/web/js/experience.js`, con hero de cartera, mercado, motores y estados honestos. Aún **NO es suficiente**: el gráfico Pro depende de la vieja implementación, la diferenciación de modo tiende a ser un acordeón antiguo, las subpestañas de SPOT/IDCA/Grid/AMA siguen siendo tablas primitivas y las pantallas sin conexión no permiten ver la profundidad de la experiencia. Necesitamos rediseñar los flujos, no solo reacomodar los bloques.

## 2. ARQUITECTURA DE EXPERIENCIA — DOS COMPOSICIONES DE VERDAD
### Básico: estilo *portfolio-first* inspirado en la claridad de Revolut (sin clonarlo)
- **Inicio**: primera pantalla útil en **un viewport móvil**: cabecera discreta, patrimonio con PnL del período, mini curva de valor si hay datos, **4 tarjetas compactas de motor**, avisos de importancia; un toque a motor abre su ficha simple.
- **Motor Básico**: título y modo REAL del motor (o «Sin conexión», nunca falsear «LIVE/OFF»); exposición, PnL, nº posiciones/ciclos, riesgo principal, próximo paso; dos pestañas «Resumen | Actividad» y un botón «Detalles» que abre una ficha completa. No llenarlo de rótulos «OFF / LAB / SHADOW_SCENARIO / ...» como descripción.
- **Mercado Básico**: BTC/ETH, precio, % y **gráfica protagonista**, tres chips (tendencia, volatilidad, alerta) si existe información, sin 20 indicadores escritos debajo.
- **Cartera Básico**: patrimonio, rendimiento, distribución por activo/motor, balances importantes y alertas.
- **Sin conexión**: 1 mensaje amigable de vinculación, CTA, navegación y explicación; nunca 15 indicadores «N/A» con apariencia de trading activo.

### Pro: terminal profesional inspirado en Kraken Pro y Coinbase Advanced (sin clonarlo)
- **Inicio Pro**: dashboard configurable con «Mercado | Posiciones/ciclos | Riesgo | Órdenes recientes | Alertas», paneles por prioridad; **NO** la misma home de Básico con 20 filas debajo.
- **Motor Pro**: encabezado estado real / modo de ejecución, cuadro de riesgo y capital, **gráfico de precio y operaciones del motor** cuando la fuente lo soporte, posición/ciclo en tarjetas dinámicas, pasos del motor con score y explicación, protecciones con distancias, trailing/BE/TP, movimientos y órdenes; controles separados y confirmados.
- **IDCA Pro**: arriba resumen con BTC y ETH; al tocar cada par, vista temporal de ciclo, anclas/compra media/TP, visual de progreso de BE/trailing, órdenes por evento y motivo; histórico completo y configuraciones efectivas.
- **Grid Pro**: **mapa de niveles** vertical de precios con rango actual y antiguos, BUY/SELL 1:1 por ciclo, capital bloqueado/liberado, maker-only, orders pendientes; nada de dos tablas vacías que ocupan toda la pantalla.
- **SPOT Pro**: señales/score por par y filtros RSI/MACD/EMA/ADX, posición y exposición, SL/TP y protecciones, motivos por orden y PnL por estrategia. Mantener dryRun vs LIVE real.
- **AMA Pro**: macro, presupuesto, mandatos, readiness paso a paso y trazabilidad; una tarjeta de estado «REAL NO HABILITADO» con explicación cuando sea verdadero; separar reservado/enviado/ejecutado/filled.
- **Mercado Pro**: velas/timescale con overlay de EMA y Bollinger; tabs para RSI, MACD, ATR, ADX, volumen, spread y fuentes. Gráficos siempre vinculados a datos reales con hora.
- **Cartera Pro**: series de NAV/PnL por tiempo, distribución, desglose por exchange/motor, HOLD separado, riesgos y movimientos.
- **FISCO y Actividad Pro**: calendarios, filtros, reportes y eventos con su contexto, nunca tablas vacías sin explicación.
- En web, terminal adaptable (2–3 columnas según ancho, widgetización opcional). En Android, scroll vertical por prioridad y fichas a pantalla completa. NO usar la misma tabla horizontal extensa en 390 px.

## 3. ELEMENTOS VISUALES Y NAVEGACIÓN
- 1 acción principal por sección; estados críticos junto al dato que afectan, no en una franja de textos interminable.
- Bottom nav móvil **Inicio · Mercado · Motores · Cartera · Actividad**, 56–68 dp + inset; más secciones mediante menú discreto.
- Selección de motor en **bottom-sheet con 4 tarjetas/iconos/estado**, no selector estrecho que tapa «Básico/Pro» o truncado «SPOT / Swing».
- Header móvil: logo NEXA, motor en pantalla de motores, Básico/Pro en acceso contextual (no invadir pantalla), icono de seguridad. El usuario no debe ver dos filas altas vacías antes del contenido.
- Tipografía y espacio: cabecera 15–17 px; KPIs principales 30–40 px; cuerpo mínimo 13–15 px; controles táctiles mínimo 44 dp; contraste AA; no desbordes.
- Color: azul oscuro neutro + acento azul, ganancias verde, pérdidas rojo, alertas ámbar; otras etiquetas neutrales. Un resultado faltante **nunca** se codifica como 0, LIVE, detenido, inactivo o error del motor.
- Gráficas útiles: interacción toque para precios/fechas, selector de temporalidad, escalas y leyenda; cuando no exista dato real, un solo placeholder contextual y acceso a configuración, no gráfico sintético en el producto.
- Controles sensibles: confirmación, permisos del servidor, auditoría; jamás «botón visual» que dispare otra acción.
- PIN/huella/rostro del usuario e identidad de dispositivo con seguridad del backend, conforme rev8. No user/password.

## 4. SECUENCIA DE TRABAJO EN CÓDIGO — SIN CREAR PROTOTIPOS
1. Reutilizar `nexa-v2` y mantener la única base web/Capacitor Android. No sustituir `main`, no otros proyectos alternativos.
2. Crear una arquitectura de diseño compartida `PortfolioHero`, `EngineOverview`, `MarketChart`, `CycleDetail`, `OrderTimeline`, `RiskStatus`, `EmptyState` (puede ser JS vanilla, no exige framework).
3. **Sustituir los renderizadores de subpestañas antiguos por componentes reales de experiencia**, conservando todos los datos del origen; el legacy puede seguir disponible para auditoría hasta certificar paridad, pero no ser la UX Pro final «escondida en details».
4. Crear **dos árboles de composición** para Básico y Pro; el selector sólo cambia render, NO consulta/estado del motor ni omite captura de datos. Mantener una ruta de detalle para los 112+ controles.
5. Trabajar primero con contrato API local y pruebas internas; no introducir datos DEMO en el bundle público. Comprobar estado conectado/desconectado/forbidden/stale/error.
6. Hacer QA real en pantallas web y emulador Android con framebuffer; grabar capturas comparativas de la versión 0.3.0 y la nueva, comprobar toque/scroll/atrás, teclado y status bars.
7. Compilar APK y empaquetar web final **solo después** de inspección y tests. Si no hay gráfico/serie en contrato real, no inventar; documentar fuente necesaria.
8. Publicar como GitHub Release descargable tras controles de firma/seguridad, dejando **SIN APROBAR** hasta validación del usuario. El panel web privado requiere autorización de despliegue aparte.

## 5. CRITERIOS DE ACEPTACIÓN BLOQUEANTES
- Pantallas básicas Inicio, Mercado, Motores y Cartera deben ser **visualmente distinguibles entre sí**, con jerarquía centrada en una tarea real, no repetir un panel de KPIs.
- Básico vs Pro: **composición marcadamente distinta**. Una captura de cada par debe demostrarlo sin necesidad de leer etiquetas. Si basta cambiar `data-mode`/clase CSS, el cambio fracasa.
- Pro: no se considera implementado por añadir un acordeón con la pantalla antigua o la misma tabla debajo.
- Al menos una gráfica operacional relevante en cada vista que tenga soporte de series de datos reales; donde no exista serie, mostrar «Fuente no disponible» con motivo.
- IDCA/GRID: ciclos con representación visual (timeline/niveles/targets) y ficha de orden exhaustiva.
- No pérdida de funciones del bot, verificación C001–C112 y extensiones.
- 0 solapes de status bar/nav inferior, 0 controles fuera de viewport, 0 texto truncado, 0 valores ficticios.
- Todos los controles funcionales o claramente bloqueados con permisos, con tests negativos; sin trading real en QA.
- Entrega de capturas comparativas Android real/emulador y web para Básico/Pro; **si faltan capturas o APK compilada, UX NO aprobada**.
- No VPS, producción, DB real, órdenes reales, merges ni despliegues por este documento.

**Regla operativa:** los productos de referencia aportan patrones de experiencia, **NEXA no debe clonarlos**. La implementación debe cumplir la función propia de centro de control de cuatro motores de trading automático.
