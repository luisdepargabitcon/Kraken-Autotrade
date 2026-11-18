# ORDEN DE TRABAJO VPS–GOOGLE CORRECCIONES
**Proyecto:** NEXA Crypto Suite / Kraken-Autotrade  
**Fecha de apertura:** 18/11/2026  
**Propietario de las decisiones y autorizaciones:** usuario del proyecto  
**Documento de trabajo vivo:** se actualizará con nuevos hallazgos y decisiones, sin crear una segunda bitácora.  
**Estado global:** \`FASE 1 EN CURSO\` — exportación histórica VPS → Google Drive; **sin autorización para limpiar PostgreSQL, instalar sincronización periódica, desplegar ni cambiar estrategias**.

> **Instrucción principal para Cascade:** AHORA centrarse en **obtener, conservar y verificar en Google Drive todos los datos operativos relevantes** del VPS, sin perjudicar al bot. La sincronización de miércoles y domingo, las correcciones y la limpieza del VPS son **fases posteriores pendientes de aprobación específica**. No confundir un plan documentado con permiso para ejecutarlo.

## 0. Reglas innegociables

1. **Sistema fiscal / AEAT: INTOCABLE.** Quedan fuera de esta orden todas las tablas y procesos fiscales (incluyendo cualquier \`fisco_*\`), documentos justificativos, operaciones de respaldo fiscal, disposiciones, informes fiscales, datos de coste fiscal, lotes y registros necesarios para declaraciones a la AEAT, backups fiscales, retenciones fiscales y su trazabilidad. **No borrar, depurar, truncar, reescribir, migrar, compactar de forma destructiva ni modificar nada fiscal.** No exportar datos fiscales en esta fase, ni usar el volumen de tablas fiscales como argumento para borrarlas. Si cualquier tabla mixta interviene en contabilidad o fiscalidad, **conservarla** hasta determinar su clasificación y obtener autorización separada.
2. **VPS y DB operativos:** mantener sus modos y servicios, sin reinicios, despliegues, migraciones, cambios de configuración, activaciones REAL ni llamadas que ejecuten órdenes. SQL exclusivamente \`SELECT\`/\`COPY (SELECT ...)\` en **transacciones READ ONLY**, con límites razonables de tiempo, recursos y paginación. No tocar posiciones HOLD, ciclos ni históricos.
3. **Nada de archivos de exportación grandes en C: ni en el disco VPS.** Transferencia **PostgreSQL/VPS → compresión en flujo → Google Drive privado**, por lotes; usar RAM acotada y vigilar carga de CPU, memoria, E/S y espacio. No ejecutar \`SELECT *\` masivo, \`ORDER BY\` sin índice ni carga entera de snapshots en Node; no agravar el fallo de heap observado.
4. **GitHub es público:** únicamente código/documentos técnicos anonimizados, estado, recuentos, manifest y enlaces a esta orden/Issue. **Prohibido** subir órdenes individuales privadas, volcados, tokens, contraseñas, .env, secretos, datos fiscales, identificadores sensibles o logs sin sanitizar. Google Drive debe permanecer **privado y con permisos mínimos**.
5. **Token OAuth previamente expuesto en la salida de una herramienta:** tratarlo como comprometido aunque no conste publicación en GitHub. **Antes de nuevas exportaciones extensas, revocar ese acceso y renovar mediante un flujo limpio**, con aprobación del propietario, sin imprimir token ni volcar \`rclone.conf\`; limitar alcance a \`drive.file\` si es viable. No conservar claves de acceso en GitHub, chats o logs; para la futura sincronización se precisará credencial persistente protegida y autorización separada.
6. Un script o ruta de deploy existente no otorga autorización automática: **cualquier escritura persistente, borrado, cron, systemd, cambio de rol o servicio del VPS requiere permiso expreso específico**.

## 1. FASE ACTUAL — DESCARGA / ARCHIVO HISTÓRICO A GOOGLE DRIVE (PRIORIDAD MÁXIMA)

### 1.1. Origen y destino

- Origen: VPS \`5.250.184.18\`, PostgreSQL y componentes reales desplegados en \`/opt/krakenbot-staging\`. Versionar el **commit ejecutado**, imagen Docker, timestamp UTC y versión de esquema sin confundirlos con \`main\`.
- Cuenta de destino: Google Drive conectado del propietario (seleccionada en la Issue #9).
- Carpeta principal creada previamente: **NEXA — Auditorías y operaciones**, privada.
- Carpeta creada por Cascade con alcance OAuth limitado: **NEXA_AUDITORIA_CASCADE_2026-11-17**, privada. **Conservar ambas**. Si el propietario decide mover la carpeta de Cascade dentro de la principal, comprobar que no cambien los permisos ni se rompa el acceso de la aplicación; no moverla ni reconfigurar permisos automáticamente.
- Subcarpetas existentes: \`00_MANIFIESTOS\`, \`01_OPERACIONES\`, \`02_DECISIONES\`, \`03_DIAGNOSTICOS\`, \`04_INFORMES\`.
- **Espacio:** el propietario informa que dispone de suficiente capacidad en Google; antes de una exportación grande comprobar cuota real libre y estimación de bytes comprimidos. No interpretar afirmaciones contradictorias sobre capacidad como medición suficiente.

### 1.2. Lote inicial constatado

De la revisión mediante el conector de Drive del 18/11/2026:

- \`01_OPERACIONES\`: **14 CSV.GZ**, aproximadamente **1,24 MB comprimidos**, tablas de operaciones, fills, órdenes, ciclos y estados.
- \`00_MANIFIESTOS\`: **1 manifiesto** \`manifest_lote001_20261118T045634Z.jsonl\`.
- \`03_DIAGNOSTICOS\`: **1 archivo pequeño de prueba**.
- \`02_DECISIONES\` y \`04_INFORMES\`: sin archivos en el momento de esa revisión.
- El primer lote comprendía **23.645 filas de 14 tablas**, no 23.645 operaciones independientes; se informó coincidencia de recuentos y hashes MD5 del manifiesto tras descarga. **No duplicarlo**: comprobar primero inventario/hashes/fecha de corte.

**Estado:** \`LOTE 001 ARCHIVADO\` / \`HISTÓRICO TOTAL AÚN NO COMPLETADO\`. La conciliación contra exchange y las decisiones históricas siguen pendientes.

### 1.3. Qué debe conservarse (histórico completo de datos útiles, no solo resúmenes)

**A. Libro íntegro de trading (todas las filas disponibles, por modo y período):**

- SPOT, IDCA/DCA institucional, GRID Isolated, AMA, cartera global y cualquier motor adicional efectivamente desplegado.
- Operaciones, ciclos, lotes **no fiscales**, intents, fills, órdenes parciales, ejecutadas, rechazadas y canceladas; inventario y posiciones relevantes; entradas/salidas; precios, cantidades, comisiones, origen, estado, motivo, fechas UTC y versión, dejando fuera secretos.
- Separar \`REAL/LIVE\`, \`SHADOW\`, \`SIMULATION/DRY_RUN\` y mercado/exchange. Nunca confundir PnL de simulación con resultado de dinero real.
- Incluir **operaciones históricas importadas** que pertenezcan al inventario operativo, sin copiar o modificar tablas fiscales protegidas.

**B. Señales y decisiones (histórico íntegro cuando sea necesario para estudiar estrategias):**

- Intentos de compra/venta, candidatos, vetos principales/secundarios, puntuaciones, rebotes, señales, cambios de régimen, límites de capital y riesgo, niveles Grid, estados de trailing, reintentos, errores, tiempos y versiones.
- \`grid_isolated_events\`, \`institutional_dca_events\`, \`idca_hybrid_events\`, \`bot_events\`, \`order_intents\` y otras fuentes descubiertas. **No asumir cantidades de un diagnóstico antiguo como recuentos actuales**.
- Conservar el detalle de eventos para permitir reconstrucción posterior, pero exportarlos **particionados, comprimidos, con columnas necesarias y sin secretos**; producir además un índice agregado consultable por ChatGPT.

**C. Series de mercado, snapshots y logs operativos:**

- \`spot_forward_twin_snapshots\` (tabla grande que se relaciona con fallo de memoria), \`market_candles\`, \`market_metrics_snapshots\`, snapshots de decisión y logs operativos útiles.
- Hacer **archivo frío en Drive por periodos y rangos de PK** si el volumen lo justifica; mantener resúmenes pequeños y un catálogo para consultas rápidas. Es admisible archivar todo el material no fiscal útil que quepa en Drive, **siempre que no afecte al trading ni a la estabilidad del VPS**.
- Los logs con cuerpos HTTP, secretos o datos personales se deben **sanitizar antes de abandonar el VPS**. No usar \`SELECT *\` indiscriminado.

**Exclusión absoluta en esta orden:** \`fisco_*\`, tablas fiscales, documentos AEAT, respaldos fiscales, borrados/migraciones fiscales, claves, tokens y copias masivas de la DB que incluyan esas tablas.

### 1.4. Procedimiento de extracción

1. Inventariar la DB real: nombre de tabla, motor, finalidad, rango temporal, filas verificadas/estimadas, tamaño, sensibilidad, PK/índices, fuente y estado \`PENDIENTE / ARCHIVADA / EXCLUIDA POR SEGURIDAD / ERROR\`.
2. Clasificar primero tablas grandes y dependencias con procesos activos; evitar consultas que disparen CPU/heap, repetición del backfill de SPOT o reinicios. Si el VPS está saturado, **pausar** y replanificar por rangos pequeños.
3. Transmitir CSV/JSONL de consultas \`READ ONLY\` comprimido (gzip) **directamente a Drive mediante un flujo de tamaño acotado**; nombres con \`motor_tabla_inicio_fin_UTC_lote\` para no sobrescribir ni duplicar. No usar sincronizadores con opción de borrado.
4. Validar por lote: nº filas esperado vs exportado (por ventana y PK), byte size, **SHA-256 preferido**; opcional checksum de transporte MD5, integridad gzip, esquema, fecha inicial/final, versión de código, UTC, denominación, errores y existencia en Drive. No decir “integridad verificada” si solo se comprobó que el fichero existe.
5. Mantener manifiesto global \`inventario_exportacion\` con archivos, checksums, fechas, recuentos y brechas. Ante error de subida o corte de red, comprobar remoto antes de reintentar; nunca descartar/duplicar silenciosamente.
6. Nunca borrar datos de PostgreSQL **por haberlos copiado**; copiar a Drive **no es un backup transaccional recuperable** de toda PostgreSQL ni demuestra que se puedan restaurar.
7. Detener la extracción pesada ante fallos/reinicios/sobrecarga y comunicar bloqueo con mediciones, sin modificar el sistema.

### 1.5. Entregables y criterio de cierre de esta fase

- [ ] Manifiesto general de **todas las tablas no fiscales relevantes** con inventario, clasificación, períodos, estado y motivo de exclusiones.
- [ ] Histórico completo y verificable de operaciones, órdenes/fills, ciclos, estados y cartera de todos los motores, sin duplicar lote 001.
- [ ] Histórico de decisiones/vetos, eventos y datos de mercado necesarios para estudiar cada estrategia, incluidos los periodos de pérdidas y oportunidades rechazadas.
- [ ] Series/snapshots/logs operativos voluminosos archivados de forma segura por particiones o brechas documentadas si no se pueden extraer sin riesgo.
- [ ] Comparativa recuentos DB–Drive, SHA-256, tamaños, muestras de lectura/descompresión y relación de archivos faltantes; clasificación de datos sensibles/excluidos.
- [ ] Credencial OAuth previamente expuesta revocada; autorización futura configurada de forma segura solo si el propietario la aprueba.
- [ ] VPS estable y sin cambios operativos; nada borrado en base de datos.
- [ ] Publicar en GitHub **solo un resumen documental anonimizado** (a través de la Issue #9 y PR documental), manteniendo las exportaciones privadas en Drive.

**Prioridad inmediata de Cascade:** terminar lotes faltantes \`02_DECISIONES\`, \`03_DIAGNOSTICOS\` y archivo histórico relevante de tablas grandes; **no** implementar la sincronización ni limpiar el VPS durante esta fase.

## 2. FASE FUTURA — CORRECCIONES DEL BOT (NO EJECUTAR AHORA)

Tras cerrar la auditoría y comparar los resultados con [auditoría inicial](AUDITORIAS/AUDITORIA_INTEGRAL_2026-11-17.md) y la contraauditoría de Cascade:

1. **P0 estabilidad:** investigar y corregir la carga ilimitada de \`spot_forward_twin_snapshots\`, consumo de heap, reinicios, restauración del estado de trailing y fallos de continuidad. No aumentar memoria como única “solución” sin perfilar la causa.
2. **P0 contabilidad y conciliación:** discrepancias de PnL SPOT/IDCA, fees reales vs estimadas, órdenes pendientes, cierres con cantidad residual, capital compartido por modos y posiciones HOLD. Separar SHADOW de REAL.
3. **P1 ejecución:** errores \`401 Unauthorized\` de Revolut X, estado de adaptadores, bloqueos Maker-Only y régimen; proteger autorización y no desbloquear operaciones reales.
4. **P1 estrategias:** SPOT \`STRUCTURE_INVALIDATION\` y SmartExit; IDCA rebote/confluencia/ventanas de precio/trailing; Grid rangos/no-viabilidad/salidas; AMA y cartera compartida. Basar propuestas en replay, costes y pruebas out-of-sample.
5. **P1 seguridad y calidad:** superficie HTTP/API, credenciales, Docker socket, logging de respuestas, pruebas CI y telemetría de errores.

**Entrega:** PR separadas con pruebas, benchmark y plan reversible; **ninguna corrección, deploy, migración ni orden real sin revisión y permiso expreso**.

## 3. FASE FUTURA — SINCRONIZACIÓN AUTOMÁTICA VPS → GOOGLE (MIÉRCOLES Y DOMINGOS)

**Frecuencia elegida por el propietario:** **todos los miércoles y domingos**. El **horario exacto queda por decidir**, preferiblemente en ventana de poca actividad. Usar \`Europe/Madrid\` para planificar (teniendo en cuenta horario de verano) y UTC en registros, evitando dobles ejecuciones.

**Diseño deseado, no implementado:**

1. Un solo exportador con permisos mínimos de lectura a PostgreSQL y escritura únicamente en la ubicación autorizada de Drive, supervisado por un planificador sencillo en VPS **solo cuando se autorice su instalación**. Evitar GitHub Actions como puente y no depender del ordenador personal.
2. **Primera copia histórica completa** (Fase 1), después **incrementales** de nuevos registros y modificaciones de estados de ciclos/órdenes. Usar cursor/fecha+ID estable, pequeño solapamiento para cambios tardíos y deduplicación por entidad+versión; no fiarse solo de \`created_at\`.
3. Cubrir SPOT, IDCA, Grid, AMA, cartera, decisiones, fallos y series de mercado elegidas; **excluir siempre fiscal/AEAT**. Un fallo parcial no debe marcar el lote como completo.
4. Compresión y streaming, reintentos con backoff, límites de carga, timeout, cuota de Drive, checksums y verificación de lectura. No montar Drive como disco ni subir archivos duplicados; política de archivos inmutables y manifiesto incremental.
5. Protección OAuth: credencial de mínima exposición, almacenada en mecanismo de secretos protegido **solo mediante autorización separada**; nunca salida en consola ni en logs. Monitorización de expiración/permisos y alertas si falla la sincronización.
6. Reportar resumen mínimo de **éxito/fracaso, hora, modo, filas, bytes, último cursor, fallos y espacio disponible**. Sin automatizar trading ni decisiones del bot mediante Drive.
7. Ensayar con un lote de prueba, interrupción de red, reintentos, ejecuciones repetidas, cambio horario, huecos y restauración de archivos; comprobar que no perjudica a las estrategias antes de activarlo.

**Criterio de activación:** auditoría cerrada + acceso OAuth saneado + tests satisfactorios + plan revisado + **autorización explícita del propietario para configurar y desplegar esta tarea**.

## 4. FASE FUTURA — LIMPIEZA SEGURA DE DATOS OBSOLETOS DEL VPS (PENDIENTE; NUNCA AUTOMÁTICA POR DEFECTO)

**Objetivo:** evitar crecimiento indefinido y fallos por datos repetidos, **sin perder material para estudiar estrategias ni poner en riesgo PostgreSQL**.

- **Prohibido tocar de cualquier modo tablas o backups fiscales/AEAT (\`fisco_*\` y dependencias), aunque ocupen mucho**. No aplicar reglas de retención genéricas al esquema entero.
- Primera etapa: **solo inventario** de tablas operativas no fiscales: índices, bloat, tamaño, antigüedad, dependencias, usos por motores, auditoría, replay y backups. Clasificar \`CRÍTICO_OPERATIVO\`, \`HISTÓRICO_NECESARIO\`, \`TELEMETRÍA_DESCARTABLE_TRAS_VALIDAR\`, \`FISCAL_PROTEGIDO\`, \`DESCONOCIDO_NO_TOCAR\`.
- Candidatos a evaluar **sin borrarlos todavía**: logs técnicos duplicados, cachés regenerables, eventos repetidos sin valor forense y snapshots antiguos archivados íntegros en Drive. **No** suponer que \`market_candles\` o \`spot_forward_twin_snapshots\` son prescindibles: podrían alimentar estrategia, entrenamiento o replay y el problema OOM requiere resolver consultas, no borrar evidencia.
- **Condiciones acumulativas antes de cualquier eliminación de datos no fiscales:**
  1. Identificar tabla y filas exactas, su dependencia y justificación.
  2. Exportación íntegra y verificada **de ese conjunto de datos**, incluyendo hashes y lectura de prueba.
  3. Backup PostgreSQL independiente, verificable y restaurable; Drive no sustituye al backup.
  4. Política de retención aprobada por tabla, período y motor; análisis de efectos sobre backtests, reconciliación y seguridad.
  5. Simulación \`dry-run\` de registros afectados, tamaño recuperable real, prueba de restauración y rollback.
  6. **Nueva autorización explícita del usuario para ejecutar la limpieza exacta** en una ventana controlada; sin \`TRUNCATE\`, \`DROP\`, \`VACUUM FULL\`, borrado de backups ni cambios sobre fiscal.
- Si no se obtiene aprobación, **no borrar nada**; proponer particionamiento, consulta paginada, compresión o retención futura sin alterar históricos.

**Importante:** archivar datos a Google **no autoriza automáticamente a borrarlos del VPS**.

## 5. CHATGPT: AUDITORÍA BAJO DEMANDA O MENSUAL OPCIONAL

- ChatGPT accederá a los ficheros privados de Google Drive **cuando el propietario lo solicite expresamente** y emitirá auditoría, análisis de estrategias, anomalías y recomendaciones contrastadas con GitHub y la versión real del VPS.
- Alternativamente, **el propietario podrá activar una tarea mensual específica en ChatGPT** para revisar archivos actualizados, si la automatización está disponible y cuenta con acceso a los datos. **No crearla ni activarla con esta orden.**
- **NO** se requiere revisión permanente ni se debe afirmar vigilancia en tiempo real: la sincronización prevista es miércoles y domingo; las auditorías ocurren al pedirlas o con una tarea mensual que se apruebe por separado.
- Las conclusiones se convertirán en **nuevas propuestas** y, una vez aprobadas, en issues/PR de Cascade; ChatGPT no ejecutará órdenes del exchange ni cambios VPS por el simple hecho de leer Drive.

## 6. MANTENIMIENTO DE ESTA ORDEN (DOCUMENTO VIVO)

**Regla de continuidad:** este archivo es el **plan de trabajo**; [\`BITACORA.md\`](BITACORA.md) sigue siendo la **bitácora única** de hechos y decisiones técnicas según [\`AGENTS.md\`](AGENTS.md). No crear otra bitácora.

Cuando el usuario aporte nuevos informes de Cascade, resultados en Drive o evidencia de GitHub, ChatGPT podrá **actualizar este mismo archivo** añadiendo propuestas o estado, con fecha y referencia, previa revisión del alcance. **No se actualiza solo en segundo plano** y no implica aprobación tácita para ejecutar nuevas fases.

Formato para cada actualización:
- **Fecha / fuente verificable:** documento, commit, issue, manifest o archivo privado (sin revelar su contenido en GitHub).
- **Hallazgo o solicitud:** qué sucede; diferenciar hecho comprobado, hipótesis, pendiente de verificar.
- **Prioridad y consecuencias:** seguridad, integridad, estabilidad, rendimiento, trading.
- **Acción sugerida:** prueba/consulta/corrección, responsable, dependencia y autorización necesaria.
- **Estado:** \`PENDIENTE\`, \`EN CURSO\`, \`VERIFICADO\`, \`PROPUESTO\`, \`APROBADO\`, \`IMPLEMENTADO\`, \`DESPLEGADO\`; no confundir ninguno.

### Registro inicial de tareas

| ID | Trabajo | Prioridad | Estado | Permiso actual |
| --- | --- | --- | --- | --- |
| G01 | Completar exportación histórica no fiscal a Drive, por lotes, sin duplicar lote 001 | P0 | EN CURSO | Consultas de lectura / transferencia autorizada, con saneamiento OAuth |
| G02 | Inventariar y verificar archivos, recuentos, SHA-256, integridad, cobertura por motor y período | P0 | PENDIENTE | Solo lectura |
| G03 | Revocar token expuesto y rediseñar autenticación mínima segura | P0 | PENDIENTE | Solicitar confirmación del propietario antes de acciones sobre la credencial |
| G04 | Contraauditoría de Cascade de todos los motores, VPS y discrepancias con informe inicial | P0 | EN CURSO | Solo lectura |
| C01 | Resolver OOM/reinicios y estados de estrategias | P0 | PROPUESTO | NO implementado / NO deploy |
| C02 | Conciliar PnL, fills, Grid/IDCA y errores de adaptadores; propuestas estratégicas | P0 | PROPUESTO | NO implementado / NO deploy |
| S01 | Diseñar y probar sincronización incremental miércoles y domingo | P1 | PROPUESTO | **Sin autorización de instalación/activación** |
| L01 | Inventario y propuesta de limpieza de tablas operativas **no fiscales** | P1 | PROPUESTO | **NO autoriza borrados** |
| L02 | Limpieza selectiva futura, solo tras backups/restauración, validación y nueva orden | P2 | BLOQUEADO POR APROBACIÓN | NO |
| A01 | Auditoría ChatGPT cuando se solicite o mediante tarea mensual opcional activada por el propietario | P1 | PROPUESTO | Sin tarea mensual creada |

### Enlaces documentales

- Trabajo operativo actual: [Issue #9 — auditoría integral](https://github.com/luisdepargabitcon/Kraken-Autotrade/issues/9).
- Auditoría estática inicial: [AUDITORIAS/AUDITORIA_INTEGRAL_2026-11-17.md](AUDITORIAS/AUDITORIA_INTEGRAL_2026-11-17.md).
- Normas de agente: [AGENTS.md](AGENTS.md).
- Bitácora técnica única: [BITACORA.md](BITACORA.md).

**Estado de cierre de esta versión:** únicamente **documentado**. No se ha programado sincronización, limpieza, auditoría mensual ni correcciones mediante esta orden. Ningún servicio VPS ni dato fiscal ha sido alterado para crear este documento.
