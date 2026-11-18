# ORDEN DE TRABAJO — VPS ↔ Google Drive · auditoría y correcciones NEXA

**Documento permanente y ampliable.** Fecha de apertura: **18/11/2026**.  
**Proyecto:** NEXA Crypto Suite / Kraken-Autotrade.  
**Estado:** **FASE 1 EN CURSO — completar extracción histórica del VPS a Google Drive**. Fases 2 a 4 son **PLANIFICACIÓN**, no autorización para modificar el VPS o los motores.  
**Orden operativa de auditoría:** [Issue #9](https://github.com/luisdepargabitcon/Kraken-Autotrade/issues/9).  
**Antecedente técnico:** [AUDITORIAS/AUDITORIA_INTEGRAL_2026-11-17.md](AUDITORIAS/AUDITORIA_INTEGRAL_2026-11-17.md).  
**Fuentes de continuidad:** \`AGENTS.md\` y apartados pertinentes de \`BITACORA.md\` (no crear una segunda bitácora).  
**Repo público:** este archivo NO debe contener tokens, credenciales, rutas a secretos, movimientos individuales, balances privados, identificadores de órdenes ni datos fiscales/personales.

## 0. Qué queremos conseguir — en pocas palabras

1. **Ahora:** descargar/exportar **todo el historial relevante** de operaciones, decisiones, eventos y evidencias del VPS a **Google Drive privado**, íntegro, verificable, comprimido y sin ocupar el disco del PC ni producir grandes archivos temporales en el VPS.
2. **Después:** terminar la auditoría de SPOT, IDCA, Grid, AMA y cartera, contrastarla con la auditoría de ChatGPT, y **proponer** correcciones. Nada de cambiar algoritmos sin análisis de resultados.
3. **Tras la corrección y autorización expresa:** sincronizar desde el VPS a Google Drive **miércoles y domingos**, preferentemente a las **04:00 Europe/Madrid** (hora local, sujeto a confirmación y compatibilidad del programador), enviando únicamente novedades/correcciones desde el último punto de control.
4. **Más adelante:** estudiar limpieza de **datos técnicos obsoletos**, primero archivar/verificar y aprobar una política de retención, **sin tocar jamás el circuito fiscal/AEAT ni comprometer reconstrucción contable**.
5. **ChatGPT no vigila el VPS ni Drive constantemente**: solo revisa los archivos cuando lo pida el propietario o al ejecutarse una **tarea mensual de auditoría que se configure por separado**. La programación semanal de exportaciones no dispara por sí sola un análisis de ChatGPT.

### Reglas innegociables

- La autorización vigente de la **Issue #9** es **auditoría SELECT/READ ONLY y exportación de datos**; **NO** autoriza eliminación SQL, cambios de contenedores, restarts, instalación permanente, crons, despliegues, cambios de riesgo, operaciones de trading, activar REAL ni migraciones.
- **Protección fiscal absoluta:** no borrar, purgar, truncar, normalizar, reescribir ni modificar el módulo **FISCO/AEAT**; incluye **todas** las tablas \`fisco_*\` y sus backups, operaciones, disposiciones, lotes, balances, coste fiscal, justificantes, informes y demás dependencias legales. No considerar obsoleto un dato fiscal por ser antiguo, duplicado a simple vista o voluminoso. **Ni esta orden ni una exportación implican permiso de tocarlo.** Si un dato histórico de SPOT/IDCA/Grid alimenta FISCO, también queda protegido hasta determinar sus dependencias y obtener autorización explícita independiente.
- Nunca limpiar \`backups/\`, WAL/volúmenes, \`trade_fills\`, operaciones/fills originales, audit trail, IDs, conversiones de moneda o cost basis sin inventario de dependencias, copia verificada y nueva autorización.
- Sin datos operativos crudos en GitHub: únicamente informes técnicos agregados, inventarios sin secretos, hashes/verificaciones y código revisable.
- Reutilizar la **carpeta privada de Google Drive ya utilizada por Cascade para el lote 001**. La carpeta inicial creada para NEXA y la nueva creada por \`rclone\` son distintas; **no duplicar, mover ni publicar** hasta verificar su organización y contar con permiso del propietario.
- **Token OAuth:** Cascade informó de que un token apareció en la salida de una herramienta durante la configuración. Considerarlo **potencialmente comprometido**: **revocar y sustituir antes de dejar una sincronización permanente**, no volver a imprimirlo, no subirlo a GitHub ni exponerlo en informes; el acceso nuevo se autorizará con permisos mínimos adecuados. **Jamás usar la credencial expuesta como base de la integración permanente.**

## 1. FASE ACTUAL — Exportación histórica COMPLETA y verificación

**Prioridad máxima. No pasar a limpieza ni automatización.**

### 1.1 Inventario antes de exportar

- [x] Identificar **versión realmente desplegada** (rama, SHA, imagen, esquema/migraciones, estado de los servicios) sin asumir igualdad con \`main\`.
- [x] Listar **todas las tablas y vistas** de PostgreSQL, con finalidad, tamaño, cardinalidad real o estimada, rango de fechas, PK/índices, origen y relación entre motores. Categorizar: **OPERACIONES**, **DECISIONES**, **EVENTOS**, **MERCADO**, **LOGS**, **ESTADO**, **FISCAL PROTEGIDO** y **OTROS**.
- [x] Separar SHADOW/SIMULATION/DRY_RUN/LIVE/REAL, exchange, estrategia, activo y versión del motor. **No sumar universos incompatibles** ni llamar orden real a un nivel \`planned\`.
- [x] Marcar las tablas fiscales como **EXCLUIDAS de tratamiento**; solo incluir metadatos mínimos de su existencia y dependencias para evitar cualquier limpieza accidental.
- [x] Consultar límites de RAM, CPU, cuota de Drive, tamaño de lotes y ventanas de baja carga. La carga histórica de snapshots SPOT ya fue relacionada con **OOM/reinicios**; no repetir \`SELECT\` sin límite, lecturas que reconstruyen todos los snapshots en memoria ni queries que agoten \`work_mem\`.

### 1.2 Qué datos exportar

- [x] **Histórico íntegro de transacciones y trazabilidad** por cada motor (SPOT, DCA/IDCA, Grid, AMA si tiene datos, cartera, órdenes compartidas): trades, order intents, fills, lot matches, estados de órdenes, BUY/SELL parciales, lotes, ajustes, costes, comisiones, PnL en sus distintas fuentes, posiciones, ciclos, reservas e inventario residual.
- [x] **Decisiones que NO se ejecutaron**: candidatos, motivos y umbrales de veto, señales, indicadores guardados, eventos de entrada/salida, políticas de riesgo, mercado de referencia; seleccionar todos los códigos y preservar ventana detallada para incidentes. No es suficiente exportar compras/ventas.
- [x] **Eventos completos relevantes** para comparar comportamientos y regresiones, incluidos eventos IDCA, Grid, SPOT y motores compartidos. Exportar por fecha/PK en lotes pequeños; comprimir en streaming.
- [x] **Histórico de mercado/snapshots y logs diagnósticos**: inventariar todo, exportar completo **si es útil y se puede hacer sin perjudicar el servicio**; los registros de gran volumen se dividen por ventanas y se prioriza reconstrucción de decisiones. Nunca forzar una exportación masiva que tire el proceso. Explicar por escrito qué tablas, columnas o períodos se omiten, su tamaño y por qué.
- [x] **No exportar** contraseñas, API keys, OAuth/refresh tokens, \`.env\`, cookies, headers de autenticación, bodies sensibles, claves privadas, dumps de credenciales o datos personales/fiscales no necesarios. Transformar de forma irreversible los identificadores privados cuando sea viable sin perder trazabilidad.
- [x] Para fuentes muy grandes o duplicadas, conservar **100 % de los registros significativos** y un catálogo de elementos excluidos/no necesarios; que el manifiesto indique explícitamente si el histórico está **COMPLETO, PARCIAL o NO VERIFICADO**.

### 1.3 Transferencia directa VPS → Drive

- [x] Mantener **PostgreSQL/lectura → tubería/compresión acotada en memoria → Google Drive** sin usar el ordenador del propietario como destino y sin crear ficheros grandes en VPS.
- [x] Crear nombres únicos con UTC, motor, tabla, rango, schema version y número de lote. **Nunca** \`rclone sync\` de forma destructiva, ni sobrescritura/sobrescritura silenciosa de archivos.
- [x] Verificar **antes/después** \`COUNT(*)\` por rango, cantidad de cabeceras, columnas, checksum SHA-256 o hash de contenido claramente definido, tamaño, estado del archivo en Drive, legibilidad al descomprimir y error de transferencia; manifest con fecha UTC, rango y SHA de código.
- [x] Tolerancia a cortes: reintentos idempotentes por rango, detección de duplicados, lotes incompletos identificados, control de tasa de consultas y backpressure; NO marcar éxito si queda algún intervalo perdido.
- [ ] Verificar que Drive no está compartido públicamente. No colocar datos personales ni vínculos directos privados en el repo público.

### 1.4 Estado inicial observado: lote 001 (no repetirlo)

El **18/11/2026**, Cascade informó de su primer lote y ChatGPT comprobó en Drive **14 archivos de tablas operativas** (aprox. **1,24 MB comprimidos**, **23.645 filas entre tablas**), más **manifiesto** y fichero de prueba. Se verificaron legibilidad, tamaños, hashes MD5 del manifiesto y recuentos de filas **en los ficheros descargados**, **no** la exactitud de todos los datos contra el exchange.

Tablas incluidas: \`trades\`, \`trade_fills\`, \`lot_matches\`, \`trade_snapshots\`, \`dry_run_trades\`, \`order_intents\`, \`institutional_dca_cycles\`, \`institutional_dca_orders\`, \`idca_cycle_exit_instructions\`, \`idca_grid_legs\`, \`grid_isolated_cycles\`, \`grid_isolated_levels\`, \`applied_trades\`, \`smart_exit_state\`.

- [x] Primera prueba de escritura y descarga/lectura desde Google Drive.
- [x] Lote 001 almacenado y comprobado por lectura del conector Google Drive.
- [x] Exportar las **tablas restantes** conforme al inventario, sin duplicar lote 001.
- [x] Completar \`02_DECISIONES\`, \`03_DIAGNOSTICOS\` y \`04_INFORMES\` en la carpeta privada.
- [x] Emitir **manifiesto global** con todas las tablas y períodos: filas estimadas, filas exportadas, excluidas justificadas, fechas y estado de integridad.
- [x] Cerrar la Issue #9 con **contraauditoría completa**, evidencias y propuestas **sin aplicar**; enlazar desde aquí el informe y PR cuando existan.

**Criterio de salida FASE 1:** totalidad del histórico relevante accesible **identificado y verificado**, faltantes enumerados, carpeta privada operativa y PR documental; ningún cambio de operativa/VPS. Si alguna tabla grande no puede exportarse de forma segura, declararlo **PARCIAL** con plan de extracción, no ocultarlo.

## Avance real de la FASE 1 (Cascade, 18/11/2026) — COMPLETA al corte 14:36 UTC

**Informe y PR:** `AUDITORIAS/CONTRAAUDITORIA_NEXA_CASCADE_2026-11-17.md` (+ `NEXA_AUDIT_SUMMARY_2026-11-17.json`). Sin datos privados en GitHub.

- **Versión desplegada:** rama `integration/staging-spot-v4` @ `3ae18319` (2026-09-20), divergente de `main` (101 por delante, 2 por detrás).
- **Exportación:** 180 archivos / 67,9 MiB comprimidos en la carpeta privada `NEXA_AUDITORIA_CASCADE_2026-11-17` (creada por rclone con `drive.file`; **no** movida ni compartida). 1.771.666 filas en tablas: 64 COMPLETO, 5 PARCIAL solo por deriva de inserciones en vivo tras el corte (44+20+74+2 filas nuevas), 39 vacías, 5 excluidas por secretos, 31 fiscales **excluidas y no tocadas**. Verificación por archivo: MD5 remoto, SHA-256 por relectura, recuento de filas y escaneo de secretos (0 aciertos).
- **Lote 003 (incremental):** +175.625 filas — `GRID_SHADOW_EXECUTION_PRICE` exportado **íntegro** (165.242), deltas de `bot_events`, `institutional_dca_events`, `server_logs` err/warn, `spot_forward_twin_snapshots` slim, `market_candles`, `market_metrics_snapshots`; `institutional_dca_ohlcv_cache` re-exportada completa (v2, sustituye lote 002); agregados delta.
- **Parcial por diseño:** `server_logs` (solo ERROR/WARN íntegros; INFO/DEBUG agregados), `grid_isolated_events` (solo `GRID_CYCLES_RECOVERED` agregado, ruido de reinicios), `institutional_dca_events` (`migration_validation_warning` agregado), `spot_forward_twin_snapshots` (filas completas sin `data.candles`, recalculable).
- **Anomalía:** `spot_forward_twin_snapshots` y `market_candles` tienen **menos filas en origen que exportadas** → el bot poda/borra datos; la exportación conserva ids ya eliminados en origen.
- **Token OAuth:** expuesto anteriormente en una salida de herramienta (riesgo documentado). **Por orden expresa del propietario (18/11) se conserva** para esta extracción; pendiente de sustitución antes de cualquier sincronización permanente. Nunca publicado ni copiado a GitHub.
- **Pendiente:** verificar que la carpeta Drive no esté compartida; backtests/benchmarks; decidir retención de datos de ruido agregados.
- **Hallazgo prioritario (no corregido):** bucle de reinicios por OOM (~500/día, contador >17.000) por una consulta ilimitada a `spot_forward_twin_snapshots`; error `401` continuo de Revolut X; panel/API accesibles sin autenticación.
- **No se ha realizado:** ningún cambio en VPS, PostgreSQL, estrategias, servicios, despliegues ni REAL.

## 2. FASE FUTURA — Auditoría y correcciones (orden separada con autorización)

- [ ] Conciliar SPOT por fill real/simulado, fees **estimadas vs reales**, razones de salida, MFE/MAE, invalidación de estructura, profit factor y reversión de ganancias; no confundir pérdidas SHADOW con dinero real.
- [ ] Conciliar IDCA por ciclo/fill/cost basis, diferencias PnL almacenado vs canónico, residual en ciclos cerrados, entradas vetadas y estado de trailing ante reinicios.
- [ ] Analizar Grid: rangos inviables, órdenes \`planned/replaced\` vs \`submitted/filled\`, rechazos maker/post-only, ciclos abiertos sin cierre y persistencia tras restart.
- [ ] Analizar AMA, cartera, reservas/capital cruzado, modo LIVE/SHADOW, conciliación y errores del exchange.
- [ ] Priorizar **estabilidad operativa**: reinicios OOM por snapshots SPOT, consultas ilimitadas de gran tamaño, errores 401, visibilidad del proceso; **corregir la causa, no solo ocultar los síntomas ni borrar datos para que arranque**.
- [x] Comparar contra la auditoría inicial de ChatGPT y la de Cascade: **CONFIRMADO / REFUTADO / CORREGIDO / PENDIENTE**, versión exacta, evidencia, coste e impacto.
- [x] Proponer hasta 3 mejoras por motor con pruebas de replay/backtest walk-forward, costes, deslizamiento, riesgo, regresiones y un procedimiento de rollback.
- [ ] Nueva issue/PR y autorización antes de tocar código operativo, DB, despliegues o estrategias.

**Ningún punto de esta sección autoriza una corrección automática.**

## 3. FASE FUTURA — Sincronización VPS → Google Drive miércoles y domingos

**Objetivo:** archivo actualizado **2 veces a la semana**, sin extracción total repetida. **NO IMPLEMENTAR NI PROGRAMAR AHORA**.

**Horario propuesto:** miércoles y domingo a las **04:00 Europe/Madrid**. Confirmar hora con el propietario antes de activar. Respetar zona horaria y cambio verano/invierno.

Diseño mínimo propuesto:

1. **Fuente:** consultas de solo lectura de PostgreSQL y, si corresponde, datos diagnósticos sanitizados; nunca leer FISCO para esta sincronización.
2. **Incrementales:** detectar registros nuevos y actualizaciones posteriores (por PK + \`updated_at\`, versiones o mecanismo de reconciliación); no basarse únicamente en \`created_at\` cuando existan updates tardíos. Capturar cierres tardíos, cambios de estado y correcciones; diseñar watermark, deduplicación y margen temporal de reproceso.
3. **Transporte:** streaming comprimido en fragmentos por fuente/período, sin archivos temporales voluminosos, con límites de memoria/carga y pausas si PostgreSQL o trading están saturados.
4. **Destinos:** Drive privado con estructura fija, datos originales inmutables por snapshot, \`manifest.json\`, checksums y un índice de revisión. Una segunda subida del mismo lote NO debe generar doble contabilidad.
5. **Autenticación:** credenciales OAuth rotadas, de permisos mínimos, almacenamiento seguro no accesible por otros usuarios y fuera de GitHub/logs; servicio con privilegios mínimos, no root salvo imposibilidad justificada. Token temporal expuesto anteriormente: **revocado y sustituido** antes de producción.
6. **Fiabilidad:** timeout, reintentos con backoff, informe de fallo/éxito, alerta si no hay nueva copia dentro de la ventana, caducidad de sesión tratada y prueba periódica de restauración/lectura. La sincronización nunca debe detener el bot por falta de Drive.
7. **Validación:** prueba con datos simulados, prueba puntual con pocos registros, 2 ciclos de sincronización correctos, recuentos/MD5-SHA comparados, carga DB segura, privacidad revisada, rollback consistente.
8. **Gobernanza:** propuesta técnica → revisión/PR → autorización del usuario → despliegue controlado y verificaciones. Nunca crear cron/scheduler persistente o añadir accesos OAuth nuevos sin la aprobación específica.

### ChatGPT y auditorías

- **NO** habrá vigilancia continua por ChatGPT. **Solo** revisar Drive cuando el usuario lo pida o cuando se configure y ejecute una **tarea mensual específica** en ChatGPT, si el sistema soporta ese flujo y está autorizada. **No hay una tarea mensual creada por este documento.**
- Las copias miércoles/domingo se hacen **desde VPS/servicio autorizado**, no dependen de que ChatGPT esté abierto.
- El archivo debe permitir auditoría de estrategias y comparación histórica por periodos, modos y versiones; ChatGPT no obtiene control del bot ni conexión SQL en vivo por el hecho de leer Drive.

## 4. FASE FUTURA — Orden, archivado y limpieza **segura** del VPS

**Objetivo:** liberar espacio **solo de información técnica realmente prescindible**, tras preservar el histórico de estudio. **NO EJECUTAR LIMPIEZA CON ESTA ORDEN.**

### Antes de estudiar borrados

- [ ] Elaborar listado de candidatos por tabla/columna/rango/GB estimados; crecimiento diario, conexiones, índices, bloat, dependencia de entrenamiento/backtest, auditoría y restarts.
- [ ] Distinguir datos **de negocio permanentes**, **fiscales/AEAT intocables**, **historias de decisión necesarias para aprendizaje** y **telemetría temporal duplicada**. No deducir caducidad de un registro por tamaño, antigüedad o frecuencia.
- [ ] Verificar backup/restauración privada, hash de exportación, validación de recuentos, soporte de auditoría y plan reversible. Confirmar que ningún módulo lee la fuente antes de cambiar retención. Consultar obligaciones legales de conservación con asesoramiento competente; este archivo no fija periodos fiscales.
- [ ] Preferir **optimizar queries, streaming, índices, paginación, particionamiento y compresión** antes de borrar. El OOM de carga masiva SPOT requiere una **corrección de diseño**, no solo purgar históricos.
- [ ] Definir una **política por tipo de dato** (sin plazos definitivos ahora): eventos técnicos de alta frecuencia, logs sanitizados, snapshots redundantes, caché recalculable. Señalar pruebas/umbral de impacto y tabla dependiente. **Nunca** borrar órdenes/fills originales ni datos necesarios para cost basis y AEAT.
- [ ] Proponer en una nueva issue el SQL y rollback **para revisión, no ejecución**, con dry-run informativo y estimación de espacio recuperable. Borrado real solo con **autorización expresa posterior** y ventana controlada.

### ZONA PROTEGIDA — Fiscal AEAT

**Prohibición explícita permanente hasta nueva instrucción inequívoca del propietario:** no ejecutar \`DELETE\`, \`TRUNCATE\`, \`DROP\`, \`UPDATE\`, migraciones destructivas, compactaciones que alteren los datos o cambios de semántica sobre \`fisco_*\`, su histórico/backups, cálculos fiscales y cualquier dependencia que sirva para declarar o justificar operaciones ante la AEAT. Tampoco tocar \`backups/\` ni eliminar datos operativos que FISCO necesite para trazabilidad, aunque estén en tablas sin prefijo \`fisco_\`.

**Las copias de Drive no equivalen automáticamente a backup legal o restaurable.** Conservación y prueba de restauración deben validarse antes de toda política de retención.

## 5. Lista de seguimiento — actualizar este mismo archivo

Usar las marcas \`[ ] / [x]\` y una línea de evidencia por hito. No sustituir estimaciones por certezas sin pruebas.

| ID | Trabajo | Estado | Evidencia / enlace |
| --- | --- | --- | --- |
| T01 | Inventario total de tablas, fechas, tamaño y dependencias | EN CURSO | Issue #9 |
| T02 | Lote 001 de operaciones → Drive privado | VERIFICADO | 14 archivos + manifiesto, 18/11 |
| T03 | Históricos restantes / decisiones / eventos / snapshots | PENDIENTE | No duplicar T02 |
| T04 | Contraste y cierre de auditorías Cascade ↔ ChatGPT | PENDIENTE | Issue #9 |
| T05 | Diseño de correcciones de estabilidad / estrategias | FUTURO | Requiere revisión del usuario |
| T06 | Automatismo VPS → Drive miércoles y domingo | FUTURO / SIN AUTORIZAR | Sin cron ni deploy |
| T07 | Inventario técnico para posible limpieza no fiscal | FUTURO / SIN AUTORIZAR | Solo estudio |
| T08 | Tarea mensual de auditoría ChatGPT (opcional) | NO CREADA | Requiere solicitud/consentimiento |
| T09 | Revocación/rotación credencial OAuth expuesta | PENDIENTE / SEGURIDAD | Completar antes del servicio permanente |

### Formato breve para futuras actualizaciones

Añadir bajo esta sección o actualizar la fila correspondiente:

> **Fecha UTC — ID — Estado:** qué se comprobó, evidencia verificable (Issue/PR/commit/manifest sin datos privados), qué falta, riesgos y **si se cambió algo o no**. Toda implementación requiere autorización de fase y se registra también en \`BITACORA.md\`, única bitácora técnica oficial.

---

**Regla final:** **AHORA DESCARGAR Y VERIFICAR DATOS**. Después **ANALIZAR Y PROPONER**. Solo entonces, con permisos separados, **CORREGIR**, **SINCRONIZAR** y eventualmente **LIMPIAR**; **FISCO/AEAT permanece protegido**.
