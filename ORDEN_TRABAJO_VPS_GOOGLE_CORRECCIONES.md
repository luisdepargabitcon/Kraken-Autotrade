# ORDEN DE TRABAJO — VPS ↔ Google Drive · auditoría y correcciones NEXA

**Documento permanente y ampliable.** Fecha de apertura: **18/11/2026**.  
**Proyecto:** NEXA Crypto Suite / Kraken-Autotrade.  
**Estado:** **FASE 1 AMPLIADA — copia integral de datos operativos, eventos originales, velas SPOT y FISCO/AEAT a Google Drive**. Fases 2 a 4 son **PLANIFICACIÓN**, no autorización para modificar el VPS o los motores.  
**Orden operativa de auditoría:** [Issue #9](https://github.com/luisdepargabitcon/Kraken-Autotrade/issues/9).  
**Antecedente técnico:** [AUDITORIAS/AUDITORIA_INTEGRAL_2026-11-17.md](AUDITORIAS/AUDITORIA_INTEGRAL_2026-11-17.md).  
**Fuentes de continuidad:** \`AGENTS.md\` y apartados pertinentes de \`BITACORA.md\` (no crear una segunda bitácora).  
**Repo público:** este archivo NO debe contener tokens, credenciales, rutas a secretos, movimientos individuales, balances privados, identificadores de órdenes ni datos fiscales/personales.

## 0. Qué queremos conseguir — en pocas palabras

1. **AHORA:** copiar y verificar **todas las filas originales disponibles** de operaciones, eventos, logs, mercado, snapshots SPOT incluidos `data.candles`, además de **las 31 tablas FISCO/AEAT** en copia privada cifrada de solo lectura. No omitir originales por tamaño o ruido; sin archivos voluminosos en disco del VPS/PC. Las credenciales activas no se trasladan.
2. **Después:** terminar la auditoría de SPOT, IDCA, Grid, AMA y cartera, contrastarla con la auditoría de ChatGPT, y **proponer** correcciones. Nada de cambiar algoritmos sin análisis de resultados.
3. **Tras la corrección y autorización expresa:** sincronizar desde el VPS a Google Drive **miércoles y domingos**, preferentemente a las **04:00 Europe/Madrid** (hora local, sujeto a confirmación y compatibilidad del programador), enviando únicamente novedades/correcciones desde el último punto de control.
4. **Más adelante:** estudiar limpieza de **datos técnicos obsoletos**, primero archivar/verificar y aprobar una política de retención, **sin tocar jamás el circuito fiscal/AEAT ni comprometer reconstrucción contable**.
5. **ChatGPT no vigila el VPS ni Drive constantemente**: solo revisa los archivos cuando lo pida el propietario o al ejecutarse una **tarea mensual de auditoría que se configure por separado**. La programación semanal de exportaciones no dispara por sí sola un análisis de ChatGPT.

### Reglas innegociables

- La autorización vigente de la **Issue #9** es **auditoría SELECT/READ ONLY y exportación de datos**; **NO** autoriza eliminación SQL, cambios de contenedores, restarts, instalación permanente, crons, despliegues, cambios de riesgo, operaciones de trading, activar REAL ni migraciones.
- **Protección fiscal absoluta del ORIGEN:** el propietario **AUTORIZA EXPRESAMENTE LEER Y COPIAR** todas las tablas `fisco_*`, sus registros y relaciones, **SIN MODIFICAR NADA en el VPS**. Prohibidos `DELETE`, `UPDATE`, `TRUNCATE`, `DROP`, migraciones, reconstrucción fiscal, purga, modificación de costes/lotes y eliminación de backups o registros necesarios para AEAT. La prohibición de borrado es permanente; no equivale a prohibición de copia.
- Nunca limpiar \`backups/\`, WAL/volúmenes, \`trade_fills\`, operaciones/fills originales, audit trail, IDs, conversiones de moneda o cost basis sin inventario de dependencias, copia verificada y nueva autorización.
- Sin datos operativos crudos en GitHub: únicamente informes técnicos agregados, inventarios sin secretos, hashes/verificaciones y código revisable.
- Reutilizar la **carpeta privada de Google Drive ya utilizada por Cascade para el lote 001**. La carpeta inicial creada para NEXA y la nueva creada por \`rclone\` son distintas; **no duplicar, mover ni publicar** hasta verificar su organización y contar con permiso del propietario.
- **Token OAuth — decisión del propietario del 18/11/2026:** el propietario **NO autoriza revocarlo ni eliminar la configuración temporal ahora**; quiere mantener el acceso `drive.file` activo para continuar las exportaciones sin reiterar aprobaciones. Consta riesgo residual: la credencial apareció en una salida de herramienta y debe considerarse **potencialmente expuesta**. No mostrar token ni refresh token, no copiarlo a GitHub/logs ni cambiar su almacenamiento/permisos. El token está en RAM y puede perderse al finalizar la sesión/reiniciar; **no prometer persistencia**. El paso futuro a un sincronizador persistente exige diseño de custodia segura, aprobación y revisión explícita del riesgo, evitando pedir consentimientos innecesarios.

## 1. FASE ACTUAL — Exportación histórica COMPLETA y verificación

**Prioridad máxima. No pasar a limpieza ni automatización.**

### 1.1 Inventario antes de exportar

- [ ] Identificar **versión realmente desplegada** (rama, SHA, imagen, esquema/migraciones, estado de los servicios) sin asumir igualdad con \`main\`.
- [ ] Listar **todas las tablas y vistas** de PostgreSQL, con finalidad, tamaño, cardinalidad real o estimada, rango de fechas, PK/índices, origen y relación entre motores. Categorizar: **OPERACIONES**, **DECISIONES**, **EVENTOS**, **MERCADO**, **LOGS**, **ESTADO**, **FISCAL PROTEGIDO** y **OTROS**.
- [ ] Separar SHADOW/SIMULATION/DRY_RUN/LIVE/REAL, exchange, estrategia, activo y versión del motor. **No sumar universos incompatibles** ni llamar orden real a un nivel \`planned\`.
- [ ] Clasificar FISCO como **PROTEGIDO CONTRA CUALQUIER MODIFICACIÓN PERO INCLUIDO EN COPIA**. Inventariar y respaldar las 31 tablas `fisco_*` y sus relaciones. El antiguo estado `EXCLUIDA_FISCAL` pasa a `PENDIENTE_COPIA_FISCAL` hasta verificar la copia privada cifrada.
- [ ] Consultar límites de RAM, CPU, cuota de Drive, tamaño de lotes y ventanas de baja carga. La carga histórica de snapshots SPOT ya fue relacionada con **OOM/reinicios**; no repetir \`SELECT\` sin límite, lecturas que reconstruyen todos los snapshots en memoria ni queries que agoten \`work_mem\`.

### 1.2 Qué datos exportar

- [ ] **Histórico íntegro de transacciones y trazabilidad** por cada motor (SPOT, DCA/IDCA, Grid, AMA si tiene datos, cartera, órdenes compartidas): trades, order intents, fills, lot matches, estados de órdenes, BUY/SELL parciales, lotes, ajustes, costes, comisiones, PnL en sus distintas fuentes, posiciones, ciclos, reservas e inventario residual.
- [ ] **Decisiones que NO se ejecutaron**: candidatos, motivos y umbrales de veto, señales, indicadores guardados, eventos de entrada/salida, políticas de riesgo, mercado de referencia; seleccionar todos los códigos y preservar ventana detallada para incidentes. No es suficiente exportar compras/ventas.
- [ ] **Eventos completos relevantes** para comparar comportamientos y regresiones, incluidos eventos IDCA, Grid, SPOT y motores compartidos. Exportar por fecha/PK en lotes pequeños; comprimir en streaming.
- [ ] **Registros ORIGINALES de mercado, snapshots, eventos y logs sin resumir**, incluidos `server_logs` INFO/DEBUG, `GRID_CYCLES_RECOVERED`, `migration_validation_warning` y `spot_forward_twin_snapshots.data.candles`. Los agregados anteriores se conservan como índices, nunca como sustituto del original. Extraer en lotes pequeños para no agotar RAM/CPU y registrar si el original ya fue eliminado antes de copiarlo.
- [ ] **No exportar secretos activos** en claro: contraseñas, API keys, OAuth/refresh tokens, `.env`, cookies y claves privadas. **Autorización fiscal específica:** copiar registros y campos fiscales íntegros, incluyendo identificadores, importes, fechas, lotes y trazabilidad, **cifrados desde el origen antes de Drive**; NO seudonimizar el respaldo fiscal original. La clave privada de descifrado quedará bajo control exclusivo del propietario y fuera de VPS, Google Drive y GitHub. Si falta el mecanismo de cifrado seguro, detener solo FISCO y solicitar una única autorización técnica imprescindible; continuar con el resto.
- [ ] Preservar **100 % de registros originales existentes**, aunque parezcan ruido o duplicados. No deduplicar filas del origen: solo evitar transferir dos veces el mismo lote. Para registros ya podados, documentar ID, fecha y estado `NO_RECUPERABLE_EN_ORIGEN` si no hay backups preexistentes.

### 1.3 Transferencia directa VPS → Drive

- [ ] Mantener **PostgreSQL/lectura → tubería/compresión acotada en memoria → Google Drive** sin usar el ordenador del propietario como destino y sin crear ficheros grandes en VPS.
- [ ] Crear nombres únicos con UTC, motor, tabla, rango, schema version y número de lote. **Nunca** \`rclone sync\` de forma destructiva, ni sobrescritura/sobrescritura silenciosa de archivos.
- [ ] Verificar **antes/después** \`COUNT(*)\` por rango, cantidad de cabeceras, columnas, checksum SHA-256 o hash de contenido claramente definido, tamaño, estado del archivo en Drive, legibilidad al descomprimir y error de transferencia; manifest con fecha UTC, rango y SHA de código.
- [ ] Tolerancia a cortes: reintentos idempotentes por rango, detección de duplicados, lotes incompletos identificados, control de tasa de consultas y backpressure; NO marcar éxito si queda algún intervalo perdido.
- [ ] Verificar que Drive no está compartido públicamente. No colocar datos personales ni vínculos directos privados en el repo público.

### 1.4 Estado inicial observado: lote 001 (no repetirlo)

El **18/11/2026**, Cascade informó de su primer lote y ChatGPT comprobó en Drive **14 archivos de tablas operativas** (aprox. **1,24 MB comprimidos**, **23.645 filas entre tablas**), más **manifiesto** y fichero de prueba. Se verificaron legibilidad, tamaños, hashes MD5 del manifiesto y recuentos de filas **en los ficheros descargados**, **no** la exactitud de todos los datos contra el exchange.

Tablas incluidas: \`trades\`, \`trade_fills\`, \`lot_matches\`, \`trade_snapshots\`, \`dry_run_trades\`, \`order_intents\`, \`institutional_dca_cycles\`, \`institutional_dca_orders\`, \`idca_cycle_exit_instructions\`, \`idca_grid_legs\`, \`grid_isolated_cycles\`, \`grid_isolated_levels\`, \`applied_trades\`, \`smart_exit_state\`.

- [x] Primera prueba de escritura y descarga/lectura desde Google Drive.
- [x] Lote 001 almacenado y comprobado por lectura del conector Google Drive.
- [ ] Exportar las **tablas restantes** conforme al inventario, sin duplicar lote 001. **Mantener por ahora la autorización OAuth actual activa según instrucción expresa del propietario**, sin ampliación de alcance.
- [ ] Completar \`02_DECISIONES\`, \`03_DIAGNOSTICOS\` y \`04_INFORMES\` en la carpeta privada.
- [ ] Emitir **manifiesto global** con todas las tablas y períodos: filas estimadas, filas exportadas, excluidas justificadas, fechas y estado de integridad.
- [ ] Cerrar la Issue #9 con **contraauditoría completa**, evidencias y propuestas **sin aplicar**; enlazar desde aquí el informe y PR cuando existan.

**Criterio de salida FASE 1:** totalidad del histórico relevante accesible **identificado y verificado**, faltantes enumerados, carpeta privada operativa y PR documental; ningún cambio de operativa/VPS. Si alguna tabla grande no puede exportarse de forma segura, declararlo **PARCIAL** con plan de extracción, no ocultarlo.

## AMPLIACIÓN PRIORITARIA — 18/11/2026 · COPIA INTEGRAL DE TODOS LOS DATOS

> **La nueva autorización del propietario prevalece** sobre exclusiones anteriores. Se puede **COPIAR FISCO/AEAT** en lectura, pero jamás borrar ni modificar el origen. Logs, eventos y velas SPOT se conservan originales, no solo agregados. **No empezar correcciones ni limpieza.**

**Base ya respaldada, NO repetir:** corte 18/11/2026 14:36 UTC; 1.771.666 filas en tablas y 180 archivos declarados, 67,9 MiB comprimidos. Manifiesto `manifest_global_20261118T143629Z.json`. Las 31 tablas FISCO aparecían como excluidas; ello era una interpretación de seguridad anterior, **ahora corregida**.

### A. Originales y datos que faltan

- [ ] **Logs INFO/DEBUG íntegros:** aproximadamente **2.465.771 filas** de `server_logs` antes resumidas. Mantener campos originales salvo secretos activos identificados/mascarados y registrar cualquier redacción en manifiesto.
- [ ] **Grid original:** recuperar ~177.600 eventos `GRID_CYCLES_RECOVERED` antes resumidos, sin omitir eventos repetitivos ni otros tipos. Los 165.242 `GRID_SHADOW_EXECUTION_PRICE` del lote previo no se duplican.
- [ ] **IDCA original:** recuperar ~12.466 eventos `migration_validation_warning` antes resumidos, conservando íntegros IDs, fechas, tipo y razones (excepto secretos activos). Reconciliar con el resto de IDCA.
- [ ] **SPOT con velas:** realizar exportación COMPLEMENTARIA, vinculada por ID estable y hash, de `spot_forward_twin_snapshots.data.candles` **ORIGINAL e ÍNTEGRO**, para cada snapshot aún conservado; la tabla ocupaba ~5,7 GB. No resumir, truncar ni reconstruir durante el respaldo. **Prioridad temporal alta** por poda activa de snapshots.
- [ ] **Poda anterior:** analizar si existen backups legítimos ya presentes, sin restaurarlos en producción, para recuperar los `data.candles` de snapshots que el VPS ya borró. Si no existen, declarar `ORIGINAL_IRRECUPERABLE` por rango; **NO afirmar equivalencia con `market_candles` sin pruebas**.
- [ ] **Incrementales desde el último corte:** `bot_events` (+44 en inventario), `grid_isolated_events` (+2), `institutional_dca_events` (+20), `market_metrics_snapshots` (+74) y cualesquiera otras altas/actualizaciones. Las cantidades citadas son **solo una foto del corte**, no un recuento actual. Utilizar keysets + mecanismo para detectar UPDATE tardíos; fijar un nuevo corte coherente.
- [ ] **Otras fuentes del proyecto:** inventariar otros esquemas o bases de datos de NEXA y archivos operativos/históricos locales del VPS que no figuren en `public`. Solo copia de fuentes del proyecto, no credenciales activas, contenido personal ajeno ni volúmenes enteros innecesarios. Registrar qué se inspeccionó y qué no.

### B. Respaldo fiscal / AEAT — lectura permitida, borrado absolutamente prohibido

- [ ] Exportar las **31 tablas `fisco_*` completas**: operaciones, disposiciones, lotes, costes de adquisición, staging, respaldos fiscales, importaciones, conciliaciones, cálculos, resultados, estados e histórico. Inventario anterior: **~4.785.639 filas estimadas** y **1.847.803.904 bytes** de almacenamiento (cifras estimadas de catálogo; comprobar el COUNT exacto en snapshot). No filtrar datos antiguos/duplicados por su apariencia.
- [ ] Preservar **esquema, columnas y tipos, exactitud decimal, nulls, IDs, fechas, relaciones, claves y dependencias**. Exportar en una **vista transaccional coherente y de solo lectura**, preferiblemente un `pg_dump` lógico consistente que pueda restaurarse en un **entorno aislado** más adelante; **NO ejecutar restore en el VPS**.
- [ ] Crear subcarpeta **privada `05_FISCAL_AEAT_CIFRADO`** dentro de la carpeta NEXA existente creada por rclone. **Cifrar en origen en streaming antes de subir**, con clave pública del usuario y custodia exclusiva de clave privada fuera de Drive y VPS; jamás mostrar secretos en salidas, URL, logs o GitHub. **Si no hay clave pública confiable o método seguro, detener solo FISCO y solicitar autorización técnica mínima para habilitarlo**, no subir fiscal en claro bajo el token OAuth previamente expuesto.
- [ ] Crear manifiesto fiscal privado con **COUNT por tabla, snapshot/corte, esquema/versión, bytes, SHA-256 del contenido original y archivo cifrado, ruta, verificaciones y estado de recuperabilidad**. Probar descifrado y lectura en entorno seguro autorizado, sin archivos grandes en VPS/PC y sin escribir en BD productiva. No dar por «backup legal/restaurable» hasta probarlo.
- [ ] **Mantener token actual de rclone `drive.file` activo**, como pidió el propietario; no revocar, borrar, imprimir, persistir ni ampliar permisos sin nueva autorización. El riesgo histórico de exposición sigue registrado. Para FISCO en concreto: **sin almacenamiento en claro en Drive**.

### C. Método y validación de la Fase 1 ampliada

- [ ] `psql READ ONLY` / `COPY TO STDOUT` / `pg_dump` de solo lectura → streaming por lotes, compresión/cifrado acotados en memoria → Drive privado. Sin copiar archivos grandes al disco del VPS o PC. Respetar límites de CPU/RAM, ventanas, `statement_timeout`, evitar OOM y detener lotes degradantes.
- [ ] Lotes únicos y **no destructivos**; nunca `rclone sync` con borrados ni reemplazar los archivos 001–003 originales. Guardar fecha UTC, versión, snapshot, PK/intervalos, suma de filas, SHA-256 por relectura del archivo en Drive, integridad gzip/JSONL/dump, deduplicación **de lotes**, no de datos.
- [ ] Reconciliar todas las tablas y orígenes al corte, con clasificación `COMPLETO_ORIGINAL` / `COMPLETO_CON_SECRETOS_SANEADOS` / `PENDIENTE` / `IRRECUPERABLE_EN_ORIGEN` / `EXCLUIDO_SECRETOS_ACTIVOS`. Una foto al corte **nunca** incluye futuras escrituras; no exigir «cero filas nuevas» mientras el bot sigue activo.
- [ ] Emitir nuevo `manifest_global` y `cobertura`, separados por motor y fiscal, distinguir **fuentes originales recuperadas** de agregados existentes. Verificar que el origen FISCO no cambió por la extracción. Comprobar privacidad real y no compartir archivos con terceros.
- [ ] Actualizar la **Issue #9, PR #10 y este documento maestro mediante PR**, conservando cambios ajenos. GitHub público solo agregados inocuos y pruebas técnicas sin datos/identificadores personales, financieros, fiscales, rutas privadas o secretos.
- [ ] **No pasar a correcciones de P0, despliegues, sincronización semanal, ajustes o limpieza** hasta cerrar esta exportación ampliada y presentar inventario de completitud. Si alguna fuente es inaccesible o no recuperable, declararlo abiertamente. La limitación histórica no se resuelve inventando reconstrucciones.

**Cierre:** datos originales operativos + fiscales existentes archivados con integridad; las velas SPOT preservadas o pérdidas anteriores documentadas; logs sin resumir; manifiesto completo; sin modificación del VPS ni de las bases. **FISCO intacto.**


## 2. FASE FUTURA — Auditoría y correcciones (orden separada con autorización)

- [ ] Conciliar SPOT por fill real/simulado, fees **estimadas vs reales**, razones de salida, MFE/MAE, invalidación de estructura, profit factor y reversión de ganancias; no confundir pérdidas SHADOW con dinero real.
- [ ] Conciliar IDCA por ciclo/fill/cost basis, diferencias PnL almacenado vs canónico, residual en ciclos cerrados, entradas vetadas y estado de trailing ante reinicios.
- [ ] Analizar Grid: rangos inviables, órdenes \`planned/replaced\` vs \`submitted/filled\`, rechazos maker/post-only, ciclos abiertos sin cierre y persistencia tras restart.
- [ ] Analizar AMA, cartera, reservas/capital cruzado, modo LIVE/SHADOW, conciliación y errores del exchange.
- [ ] Priorizar **estabilidad operativa**: reinicios OOM por snapshots SPOT, consultas ilimitadas de gran tamaño, errores 401, visibilidad del proceso; **corregir la causa, no solo ocultar los síntomas ni borrar datos para que arranque**.
- [ ] Comparar contra la auditoría inicial de ChatGPT y la de Cascade: **CONFIRMADO / REFUTADO / CORREGIDO / PENDIENTE**, versión exacta, evidencia, coste e impacto.
- [ ] Proponer hasta 3 mejoras por motor con pruebas de replay/backtest walk-forward, costes, deslizamiento, riesgo, regresiones y un procedimiento de rollback.
- [ ] Nueva issue/PR y autorización antes de tocar código operativo, DB, despliegues o estrategias.

**Ningún punto de esta sección autoriza una corrección automática.**

## 3. FASE FUTURA — Sincronización VPS → Google Drive miércoles y domingos

**Objetivo:** archivo actualizado **2 veces a la semana**, sin extracción total repetida. **NO IMPLEMENTAR NI PROGRAMAR AHORA**.

**Horario propuesto:** miércoles y domingo a las **04:00 Europe/Madrid**. Confirmar hora con el propietario antes de activar. Respetar zona horaria y cambio verano/invierno.

Diseño mínimo propuesto:

1. **Fuente:** consultas de solo lectura de PostgreSQL y diagnósticos sanitizados, pudiendo **incluir incrementales fiscales cifrados en diseño futuro**, previa aprobación independiente antes de configurar el servicio permanente. Nunca modificar FISCO.
2. **Incrementales:** detectar registros nuevos y actualizaciones posteriores (por PK + \`updated_at\`, versiones o mecanismo de reconciliación); no basarse únicamente en \`created_at\` cuando existan updates tardíos. Capturar cierres tardíos, cambios de estado y correcciones; diseñar watermark, deduplicación y margen temporal de reproceso.
3. **Transporte:** streaming comprimido en fragmentos por fuente/período, sin archivos temporales voluminosos, con límites de memoria/carga y pausas si PostgreSQL o trading están saturados.
4. **Destinos:** Drive privado con estructura fija, datos originales inmutables por snapshot, \`manifest.json\`, checksums y un índice de revisión. Una segunda subida del mismo lote NO debe generar doble contabilidad.
5. **Autenticación:** acceso OAuth de permisos mínimos, almacenamiento seguro no accesible por otros usuarios y fuera de GitHub/logs; servicio con privilegios mínimos, no root salvo imposibilidad justificada. El propietario ha pedido **no revocar ahora** el token temporal; la exposición previa se documenta como riesgo no resuelto. Antes de automatizar de forma persistente, revisar y obtener autorización específica para custodia segura, mitigación del riesgo y eventual rotación sin exigir consentimientos repetitivos.
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

**AUTORIZADO AHORA:** leer y copiar registros FISCO/AEAT mediante `SELECT`/`COPY TO STDOUT`/`pg_dump` en modo solo lectura y streaming para respaldo privado cifrado. **PROHIBIDO:** cualquier `DELETE`/`UPDATE`/`TRUNCATE`/`DROP`/restore/migración/purga/reconstrucción o modificación de datos originales, backups y dependencias fiscales, también si viven en tablas sin prefijo `fisco_`.

**Las copias de Drive no equivalen automáticamente a backup legal o restaurable.** Conservación y prueba de restauración deben validarse antes de toda política de retención.


> **Actualización 18/11/2026 — autorización Google Drive:** El propietario ha rechazado expresamente las opciones «revocar y borrar ya» y «mantener un poco» como solicitudes de elección repetidas: **dejar el token activo**. Cascade debe proseguir la Fase 1 con la sesión OAuth limitada existente, sin borrar/revocar ni cambiar su ubicación o permisos; si la sesión se pierde, explicar el motivo y solicitar solo la intervención imprescindible. Esto NO autoriza convertir el token expuesto en una integración permanente, instalar servicios ni ampliar los permisos.

## 5. Lista de seguimiento — actualizar este mismo archivo

Usar las marcas \`[ ] / [x]\` y una línea de evidencia por hito. No sustituir estimaciones por certezas sin pruebas.

| ID | Trabajo | Estado | Evidencia / enlace |
| --- | --- | --- | --- |
| T01 | Inventario del esquema existente (144 tablas), ampliar a fuentes ajenas a public.* | BASE COMPLETADA · AMPLIAR | Manifest 18/11 · Issue #9 |
| T02 | Lote 001 de operaciones → Drive privado | VERIFICADO | 14 archivos + manifiesto, 18/11 |
| T03 | Históricos operativos iniciales (lotes 001–003) | BASE RESPALDADA · NO ÍNTEGRA | 1.771.666 filas al corte 14:36 UTC; falta origen íntegro |
| T04 | Contraste y cierre de auditorías Cascade ↔ ChatGPT | PENDIENTE | Issue #9 |
| T05 | Diseño de correcciones de estabilidad / estrategias | FUTURO | Requiere revisión del usuario |
| T06 | Automatismo VPS → Drive miércoles y domingo | FUTURO / SIN AUTORIZAR | Sin cron ni deploy |
| T07 | Inventario técnico para posible limpieza no fiscal | FUTURO / SIN AUTORIZAR | Solo estudio |
| T08 | Tarea mensual de auditoría ChatGPT (opcional) | NO CREADA | Requiere solicitud/consentimiento |
| T09 | Gestión del riesgo del token OAuth expuesto | RIESGO ACEPTADO TEMPORALMENTE · NO REVOCAR AHORA | Decisión propietario 18/11: mantener sesión `drive.file` en RAM; no imprimir ni persistir sin permiso. Revisar medidas antes de sincronizador permanente |
| T10 | Logs INFO/DEBUG y eventos repetitivos originales | PENDIENTE, NUEVA ORDEN | ~2.655.837 filas resumidas |
| T11 | Velas `data.candles` originales de snapshots SPOT | PENDIENTE, PRIORIDAD ALTA | ~55 mil snapshots; posible poda activa |
| T12 | Respaldo íntegro cifrado de 31 tablas FISCO/AEAT | AUTORIZADA COPIA / PENDIENTE | ~4,8 M filas estimadas; NO modificar origen |
| T13 | Incrementales de todas las tablas y fuentes nuevas | PENDIENTE | Corte y cambio tardío |
| T14 | Verificación completa y prueba de lectura/restaurabilidad fiscal aislada | PENDIENTE | No iniciar fase 2 |
| T15 | SPOT 167 operaciones: replay pérdidas y máximos teóricos bruto/neto | ORDEN CREADA · SOLO LECTURA | [Issue #14](https://github.com/luisdepargabitcon/Kraken-Autotrade/issues/14) · tras extracción y antes de correcciones; entrega integral idéntica en GitHub **verificado privado** y Google Drive privado |

### Formato breve para futuras actualizaciones

Añadir bajo esta sección o actualizar la fila correspondiente:

> **Fecha UTC — ID — Estado:** qué se comprobó, evidencia verificable (Issue/PR/commit/manifest sin datos privados), qué falta, riesgos y **si se cambió algo o no**. Toda implementación requiere autorización de fase y se registra también en \`BITACORA.md\`, única bitácora técnica oficial.

---

**Regla final:** **AHORA ARCHIVAR TODOS LOS ORIGINALES DISPONIBLES, INCLUIDOS LOS DATOS FISCALES CIFRADOS Y LAS VELAS SPOT**. Después analizar y proponer. Correcciones, sincronización y posible limpieza NO FISCAL requieren nuevas autorizaciones. **El sistema FISCO/AEAT nunca se borra ni modifica en el VPS; únicamente se copia de forma segura.**
