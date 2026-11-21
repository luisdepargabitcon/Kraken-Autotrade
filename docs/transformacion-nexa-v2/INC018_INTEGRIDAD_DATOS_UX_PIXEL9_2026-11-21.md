# INC-018 — BLOQUEANTE: Integridad de datos y arquitectura UX NEXA, Pixel 9 (21/11/2026)

**Evidencia:** nueve capturas de la APK NEXA 0.5.3 aportadas por el propietario. **Estado: SIN APROBAR, no afirmar producción terminada.**

## 1. Diagnóstico observado (sin confundir observación con causa)

| ID | Pantalla | Incidencia visible | Riesgo | Reproducción/criterio de cierre |
|---|---|---|---|---|
| P01 | IDCA Pro/Órdenes | Se ven BUY/SELL reales del 20/21-nov (IDs 823–827), pero «TOTAL COMPRAS $0,00 / TOTAL VENTAS $0,00» | **CRÍTICO**: contradicción económica | Identificar qué periodo y moneda representan los totales; usar los mismos registros de órdenes relevantes o mostrar «No calculable», nunca 0 falso. Sumar correctamente amounts, fees, parcializaciones con tests; mostrar «Hoy / periodo / histórico» inequívoco. |
| P02 | IDCA Básico/Panel | PnL +$0,00 / Ciclos 0 / Capital $0,00 mientras motor LIVE y hay órdenes/ciclos históricos | **CRÍTICO**: falsos ceros o distintos ámbitos | Cada KPI: fuente, período, status, validez; si el API no da total no mostrar 0. Diferenciar ciclos abiertos vs cerrados, capital motor asignado vs invertido. |
| P03 | Cartera Básico | «Valor total $5000,00» sin desglose real y PnL «—» | **CRÍTICO**: posible confusión entre presupuesto, exposición y NAV | Rastrear campo del API hasta NAV real; si procede de presupuesto/allocación, renombrar correctamente y no venderlo como valor patrimonial. NAV solo de saldos valorados del exchange con timestamp. Mostrar origen/frescura. |
| P04 | Historial IDCA | 38 ciclos presentados con «No disponible» repetido; desplegable #33 con entrada y duración, pero PnL, compras, capital, salida, tipo cierre faltan. | **ALTO**: falta información histórica | Auditar endpoint y esquema reales; detectar objetos anidados/alias/campos en string decimal; completar adaptador sin inventar. Distinguir ejecución LIVE de ciclo abierto/cerrado y valores ausentes. |
| P05 | Órdenes | Tabla móvil recortada, columnas ocultas, filas muy altas sin razón. | **ALTO** | Reemplazar tabla en móvil por lista de órdenes compacta: BUY verde / SELL rojo, fecha, par, precio, cantidad, total, comisión, ID, ciclo y detalle desplegable; Pro permite tabla en desktop con scroll y encabezados no truncados. |
| P06 | IDCA Configuración | Encabezados cortados/solapados («AULT», «ÁMBITO», «LEGACY», «NOTA») y tabla sin contenido. | **ALTO** | Lista móvil de parámetros con valor configurado y efectivo, ámbito, nota, última actualización, fuente; agrupación por categorías. Si no hay datos, estado explicativo + diagnóstico de endpoint en lugar de tabla vacía. |
| P07 | IDCA Hybrid/Grid | Prosa extensa con poco contenido y campos «No disponible»; diferencias entre overlay y grid propio poco claras. | MEDIO | Visualizar estado, modo, rango y legs reales cuando existan; separar claramente Grid SPOT interno, Hybrid/Grid IDCA y Grid aislado. No insinuar operaciones de grid no existentes. |
| P08 | FISCO/AEAT | Móvil «Conectado», identidad autorizada, pero FISCO protegido y CTA «Reintentar conexión». | **ALTO**: estado 403 mal interpretado | Distinguir «sesión autorizada sin permiso fisco:read» de «API caída» o 401. Mostrar «Acceso fiscal no habilitado» y solicitud de concesión separada de permiso, NO «Reintentar» cuando falta rol. No revelar información fiscal sin permiso. |
| P09 | Inicio/Actividades | Exposición $0,00 y «Aún no hay eventos» sin conciliación con órdenes y ciclos reales. | **ALTO** | No equiparar eventos no mapeados a ausencia de operaciones. Fuente, alcance, frescura, estado y capacidad de cada fuente. |
| P10 | UX transversal | Tarjetas enormes redundantes, subpestañas muy anchas, navegación a mitad de pantalla, sticky header que pisa contenido, toggles ambiguos. | ALTO | UX mobile-first 360–412dp: 5 tabs inferiores + engranaje discreto arriba, vistas de detalle full-screen, sin desplazamiento horizontal del documento ni header sobre contenido. Valores completos por modal/panel, sin perder datos. |
| P11 | Gráficas | Requerimiento de gráficas técnicas y OHLCV; API reportó no disponer velas válidas. | MEDIO | Verificar contratos de datos antes de dibujar; si endpoint no ofrece OHLCV, mostrar fuente ausente y opción de implementación futura, NUNCA curvas inventadas. |
| P12 | Semántica modo | Modo vista «Básico/Pro», estado de trading «LIVE», conexión «Conectado», permisos «read» se mezclan visualmente. | ALTO | Indicadores independientes y explícitos: sesión, motor, modo operativo, calidad de datos, permiso. No interpretar «Conectado» como fidelidad de todas las cifras. |

## 2. CONTRATO DE DATOS obligatorio

Crear tabla verificable «KPI / pantalla / JSON exacto / endpoint / unidad / moneda / periodo / marca de tiempo / semántica / origen / calidad / última verificación». Cada API debe traducirse con adaptadores tipados/testeados, sin suposiciones por `|| 0` o `Number(x)||0`.

Valores `null`, ausentes, NaN, no verificados y stale → estado explícito, no cero. Zero SOLO cuando API verificable devuelve 0 de esa métrica, mismo periodo/categoría. No agregar historial LIVE y simulación sin separación. FISCO requiere rol separado.

Crear fixtures de respuesta **capturados/redactados** de endpoints vigentes SOLO LECTURA en un área privada de QA (NO incluir órdenes/datos personales ni claves en GitHub público), más fixtures sintéticos únicamente para tests. No copiar .env ni credenciales.

## 3. Diseñar UX, no eliminar información

- Básico: navegación muy breve, 1 panel de patrimonio **solo si hay NAV auténtico**, PnL periodizado, estado por motor, actividad reciente real y atajo Mercado. Todo detalle disponible desde vistas específicas.
- Pro: terminal profesional con subpestañas por motor, pero cada sección con datos integrales tipo la IDCA original. Desglose de órdenes/ciclos/fees/TP/BE/trailing/históricos/alertas/indicadores según fuente; no forzar todos los campos de IDCA a otros motores sin equivalente real.
- Historial móvil: lista compacta + pantalla de ciclo con órdenes, comisiones, capital, resultado y motivos de salida. Proponer filtros por fecha/par/estado/ganancia, sin perder registros.
- Cartera: separar capital asignado, capital libre, efectivo, NAV real, PnL real/no realizado y HOLD; periodo/moneda explícitos. Los presupuestos NO son NAV.
- Monitor: si falta serie de eventos, mostrar «No hay datos de eventos verificados» con diagnóstico de origen, no «0 operaciones».
- Estados visuales: sin autorización, sin dato, sin permiso, error, stale, valor 0 real, y en tiempo real son estados DISTINTOS.
- Iconografía semántica: BUY verde y SELL rojo en todas las pantallas, coherencia y accesibilidad.

## 4. Checklist ejecutivo PARA CASCADE (no es tarea del propietario)

- [ ] Auditar pantallas Pixel 9 frente al panel IDCA original y crear inventario completo de datos por motor, sin eliminar campos.
- [ ] Auditar desde API read-only cada endpoint y esquema **reales** de órdenes, ciclos, cartera, FISCO y configuración; documentar discrepancias del adapter.
- [ ] Corregir P01/P02/P03 **antes que cambios estéticos**; demostrar reconciliación de datos y ausencia de ceros falsos.
- [ ] Corregir P04 ciclos históricos con pruebas para campos anidados, decimales como string, motivos de cierre, comisiones, estados, monedas.
- [ ] Corregir P08 diferenciación 403 permisos vs conexión; no conceder fisco:read sin autorización separada.
- [ ] Rediseñar P05/P06 mobile: lista de órdenes y fichas de configuración con todos los campos; desktop conserva tablas, jamás cortar columnas.
- [ ] Rehacer Inicio/Básico/Pro específicos, P07/P09/P10/P12, no limitarse a colores.
- [ ] Matriz de no-regresión para 4 motores SPOT/IDCA/GRID/AMA, Cartera, Mercado, Actividad, FISCO, Ajustes, con cada dato del panel original.
- [ ] Validar 360, 393, 412, 480, 768, 1280, 1920dp, landscape, scroll sticky/safe-area, tamaños y controles táctiles.
- [ ] Ejecutar `npm test`, pruebas con fixtures de contrato y E2E de API read-only en entorno autorizado; pruebas de datos y UX con screenshots legítimas.
- [ ] Compilar APK nueva, instalar en emulador y Pixel 9 si disponible, verificar con datos reales, publicar release solo tras QA, tag exacto y SHA-256. Marcar SIN APROBAR.
- [ ] Ningún cambio en motor, VPS operativo, SQL, DB, posiciones, órdenes LIVE, firewall ni `main`; los cambios de gateway/api requerirían su autorización separada.

## 5. Pruebas de aceptación NO NEGOCIABLES

A. Una lista de órdenes BUY/SELL con importes positivos no puede coexistir con total período $0 salvo que el total etiquete un intervalo vacío distinto y lo explique.

B. Un presupuesto de 5000 USD no puede representarse como «Valor total cartera» salvo prueba independiente de NAV.

C. Pantalla «Conectado» + falta permiso fiscal muestra «Permiso fiscal no habilitado», nunca «Error de conexión» para 403.

D. Si faltan campos históricos, mostrar dato verificable, faltante por campo y origen; no inventar ciclo 0 ni estado cerrado.

E. Ninguna pantalla de móvil tiene tablas recortadas, submenús invisibles ni valores económicos sin unidad y fuente.

F. No publicar hasta que Pro ofrezca la riqueza operacional del panel actual de cada motor y Básico sea una selección minimalista de las mismas cifras verificadas.

**Nota:** en screenshots se detectan contradicciones pero NO se puede determinar la causa exacta sin inspeccionar los payloads auténticos. No asumir que el motor ganó/perdió ni que la API tenga todos los campos sin evidencia.


## 6. Ampliación obligatoria — inspección universal de operaciones y salidas

**21/11/2026:** el propietario exige que una sola pulsación en **cualquier operación o salida** abra un modal emergente de detalles completos, destacado y visualmente jerarquizado. Debe cubrir compras, ventas, salidas por TP/BE/trailing, cierres manuales, cancelaciones, órdenes parciales, ciclos/históricos, posiciones, niveles GRID, tranches AMA, decisiones y eventos. Básico y Pro deben permitir acceder a **la misma ficha completa**, aunque Basic reduzca el ruido del listado. `reserved` AMA no implica ejecución. Ver contrato de diseño, alcance y QA:

[`UX_FICHA_UNIVERSAL_OPERACIONES_2026-11-21.md`](./UX_FICHA_UNIVERSAL_OPERACIONES_2026-11-21.md).

Implementación inicial de frontend **en rama, sin desplegar**: `nexa-v2/web/js/inspector.js`, `app.js`, `screens.js`, `premium.js`, `ui.js` y `css/style.css`. La ficha usa objetos del read-model, no JSON embebido en atributos DOM; campos anidados, colores BUY/SELL, resultado/importe visible, motivo, precios, fees, estados, y órdenes vinculadas a ciclo IDCA cuando existen.

- [ ] Completar QA de cada modal con fixtures de todos los motores, registros abiertos/cerrados, LIVE/SIM y campos faltantes.
- [ ] Contrastar que el inspector accede a TODOS los campos reales necesarios; enriquecer vía GET de detalle si están publicados (sin POST ni VPS operativo).
- [ ] Probar funcionamiento Android Back, scroll conservado, modo horizontal, focos y safe areas en Pixel 9.
- [ ] Mantener SIN APROBAR hasta pruebas visuales y numéricas; esta capa **no resuelve todavía P01–P04** de integridad.
