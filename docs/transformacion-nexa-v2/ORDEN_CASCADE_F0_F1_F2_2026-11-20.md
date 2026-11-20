# ORDEN DEFINITIVA PARA CASCADE — NEXA V2 · TRANSFORMACIÓN COMPLETA AISLADA
**Fecha:** 20-11-2026 · **Revisión:** 5 · **Sustituye el alcance F0/F1/F2 limitado de esta orden previa.**
**Rama EXCLUSIVA:** feature/nexa-v2-transformacion-20261120.
**Base de referencia:** main 47d79db3f7065e0e54481447129f2f88e9225fe2.
**Diseño de referencia:** design/nexa-apk-web-basico-pro-20261120; HTML NEXA y ORION en Drive privado.
**Documento bloqueante:** [Checklist completo de 75 puntos](CHECKLIST_PARIDAD_TOTAL_IDCA_SPOT_GRID_AMA_2026-11-20.md).
**Plan:** [F0-F6](PLAN_MAESTRO_2026-11-20.md).


## ORDEN DE TRABAJO PRINCIPAL Y RESPONSABILIDAD DEL CHECKLIST (REV. 4)
**Cascade es el único responsable de ejecutar, marcar, evidenciar y cerrar las comprobaciones**, NO el usuario. La orden obliga a seguir íntegro el **Plan Maestro F0–F6**, sus entregables y prioridades, sin convertir la lista de controles en una tarea separada ni dejar apartados del plan sin ejecutar.

### Bucle obligatorio fase a fase
**LEER PLAN → EJECUTAR FASE → MAPEAR DATOS → CORRER PRUEBAS → ACTUALIZAR CHECKLIST (C001–C075 y extras) → GUARDAR EVIDENCIAS → CORREGIR FALLOS → REPROBAR → PASAR A FASE SIGUIENTE.**
El checklist no se rellena por el usuario ni se acepta el autocumplimiento sin prueba.

Crear y actualizar en la rama `docs/transformacion-nexa-v2/seguimiento/`:
- `ESTADO_FASES.md`: F0–F6, estado, qué falta, bloqueos, pruebas y porcentaje demostrado.
- `MATRIZ_PARIDAD.csv`: cada dato, función, control e histórico existente, origen, destinos Básico/Pro y web/APK, estado y caso de prueba; sin datos privados.
- `EVIDENCIAS_CHECKLIST.md`: ID de casilla, resultado, evidencia reproducible, commit/test, fecha y notas.
- `INCIDENCIAS.md`: defectos, causa, reparación, nueva prueba, bloqueos de autorización.

**El documento [Checklist de 75 controles](CHECKLIST_PARIDAD_TOTAL_IDCA_SPOT_GRID_AMA_2026-11-20.md) es un documento activo:** Cascade debe editar en GitHub los `[ ]` a `[x]` exclusivamente tras verificar, añadir elementos descubiertos y vincular evidencias. Cada cierre parcial debe reflejar discrepancias; no esconder fallos. El valor de una maqueta DEMO no prueba operatividad de un backend/órdenes/DB. Los datos originales de IDCA mostrados en capturas son referencia de detalle, pero debe comprobar también **cada** campo existente en los otros modos y en módulos comunes.

**No termina el proyecto** por haber redactado plan o haber hecho un HTML: completar todas las fases autorizadas localmente F0–F6, incluida QA transversal, sin detenerse por errores técnicos ordinarios. Donde sea necesaria acción prohibida (VPS, DB real, migraciones, trading LIVE, deploy, merge), no ejecutarla; marcar BLOQUEADO POR AUTORIZACIÓN y continuar con el resto. Informar estado parcial real. **No marcar todo verde ni cerrar la Issue #17 sin pruebas.**


## MANDATO
Comenzar YA y completar autónomamente en local **todas las tareas de F0 a F6 técnicamente ejecutables sin infraestructura real**: auditoría, inventario, renovación visual, HTML terminado, conexión a contratos canónicos de lectura, preparación de una aplicación PWA y compilación obligatoria de APK Android local tras instalar las herramientas necesarias, tests y entrega verificable. **No parar tras F2 ni pedir permiso entre fases ordinarias**. Proseguir ante incidencias de build, types, pruebas, fixtures, UX o refactor local sin cambiar el alcance y sin ocultar fallos. Para bloqueos por autorización o dependencias externas, aislar la subacción, continuar con el resto y reportar lo que no se puede certificar. No declarar COMPLETO si subsiste algún campo sin destino o una prueba crítica fallida.

## LÍMITES INALTERABLES
1. NO VPS/SSH, deploy, staging, producción, SQL/DB reales, migraciones, modificaciones de órdenes/ciclos/targets, cuentas externas, transacciones reales, activación LIVE/REAL ni merge a main. No iniciar servidor operativo en entorno que pueda ejecutar migraciones, reconciliaciones, schedulers u órdenes.
2. Se permiten archivos y cambios de código **en la rama aislada**, únicamente en modo desarrollo sin efectos reales. Integración backend solo por contratos READ-ONLY y mocks/fixtures desidentificados. No crear nuevos endpoints mutables. Un módulo de órdenes nuevo no se debe conectar al circuito LIVE.
3. Conservar todos los motores (SPOT/IDCA/Grid aislado/AMA), estrategia grid antigua SPOT diferenciada, overlay IDCA diferenciado, FISCO/AEAT, cartera y market metrics. No borrar datos/configuraciones de origen, ni ficheros de legado sin análisis.
4. Repositorio público: no subir secretos, .env, logs privados, CSV de operaciones reales, copias de DB, claves, respuestas autenticadas, datos fiscales/personales. No imprimir secretos en las evidencias.
5. Mantener exclusivamente esta rama para commits; preservar WIP ajeno. Prohibido git add -A, reset --hard, clean, stash de cambios ajenos, rebase y force-push. Revisar antes de push que no exista workflow que despliegue por cambios en la rama; de existir, no hacer push y documentar.

## PASOS QUE DEBES EJECUTAR SIN INTERRUPCIONES ORDINARIAS
### F0: congelación y P0
Leer AGENTS.md, secciones relevantes de BITACORA.md y las auditorías 20/11. Verificar hashes HEAD de main y rama, y diff. Catalogar riesgos confirmados vs condicionales: AMA executed=true sin orden real, endpoints mutables y auth, logs sensibles, selección Kraken/RevolutX, frescura OHLCV, inconsistencias de config, reservas compartidas. Verificar solo metadatos de evidencia de backups/FISCO 31 tablas, nunca datos reales. Separar problemas que requieren autorización de acciones que pueden resolverse sin acceso real.

### F1: inventario 100% y prueba de paridad
Comparar pantallas/código/rutas actuales y las **tres capturas IDCA** (panel, ciclo abierto, histórico). Crear matriz completa por campo: identificador, motor/página, etiqueta, valor/tipo/unidades, origen, API/DB/servicio, cálculo y timestamp, permisos, destinos Básico/Pro/Web/APK, evidencia y estado. Repetir en SPOT, Grid, AMA y módulos transversales. **El checklist de 75 puntos es obligatorio y se amplía si aparece cualquier campo no listado.** Campos sin destino o sin prueba bloquean la aprobación.

### F2: UX HTML terminada
Reutilizar referencias NEXA y ORION; trabajar en nueva ruta de rama, dejando intactos los prototipos. Web con barra superior; APK con navegación inferior, selector de motores por modal; dos experiencias realmente distintas Básico minimalista y Pro exhaustivo; detalle accesible en ambos. Mercado completo con indicadores, bandas, RSI/MACD/EMA/ATR/ADX/volumen, frescura, origen y avisos. Gráficas limpias; IDCA con detalle de entrada/score/ancla/TP/BE/trailing/duración/órdenes/histórico; Grid BUY→SELL por ciclo y rango; SPOT señales/protecciones; AMA macro/mandatos/risks; cartera/FISCO/monitor/logs/ajustes. Nada de botones placebo o demo que aparente datos reales.

### F3: contratos reales de lectura, sin efectos
Construir componentes y read-models reutilizables que representen **datos ya existentes** y sus estados unavailable/stale/error; evitar duplicar cálculos del motor. En pruebas, alimentarlos con datos sintéticos etiquetados DEMO y fixtures de cobertura, sin extraer datos privados. No activar ni modificar backends operativos ni DB.

### F4: análisis de estrategias, SIN reconfigurar REAL
Revisar discrepancia SPOT agosto ganancia/septiembre pérdida con los informes disponibles, así como Grid, IDCA y AMA; documentar hipótesis, cambios de configuración y oportunidades, con prudencia sobre backtests, sin reescribir políticas de entrada/salida, ciclos o targets. Crear mejoras propuestas para investigaciones futuras, no ejecutarlas en trading.

### F5: PWA/APK de prueba
Implementar frontend responsive, seguridad de acceso/selección y aplicación Android local de laboratorio. **La compilación e instalación de la APK de pruebas es un entregable OBLIGATORIO, no opcional por ausencia inicial de herramientas.** No confundir esta APK de laboratorio con el despliegue conectado al bot real; solo DEMO/lectura y sin credenciales ni endpoint de producción embebidos.

**Obligación explícita de preparar el entorno:** detectar primero herramientas existentes y su compatibilidad con el proyecto; instalar/configurar para el usuario actual, según necesidad, JDK compatible, Android SDK y command-line tools, build-tools/plataformas requeridas, Gradle/Gradle Wrapper y dependencias Node/Capacitor u otro framework usado realmente por el repositorio. Preferir instaladores oficiales y versiones compatibles con el proyecto; verificar descargas y respetar licencias. No introducir malware, instaladores desconocidos ni credenciales en el código. Conservar instalaciones existentes y no alterar PATH global innecesariamente. Registrar versiones y pasos reproducibles en la documentación.

**Permisos:** la instalación local no privilegiada de dependencias de desarrollo necesarias está incluida en esta orden. Si instalar requiere permisos de administrador, elevar privilegios, modificar configuración sensible del equipo, aceptar acuerdos que requieran decisión del usuario o contratar servicios, pedir autorización antes de ESA acción; intentar alternativas en directorio de usuario. No tocar VPS, infraestructura ni DB real bajo ninguna circunstancia.

**Compilar y validar:** sincronizar assets Android, generar APK de pruebas local (firma de depuración cuando corresponda), generar SHA-256, comprobar manifest/permisos/ausencia de secretos, instalarla en emulador o dispositivo de pruebas accesible y comprobar arranque, PIN, navegación, Básico/Pro, datos demo, offline, atrás y logs sin acciones reales. Proporcionar archivo APK verificable y ruta de compilación; no afirmar instalada si no se ha instalado.

**Gestión de bloqueos:** si tras intentar de forma documentada instalar toolchain y compilar sigue siendo técnicamente imposible, NO dar la fase F5 como aprobada, no declarar transformación terminada y explicar error concreto, intentos y acción/permiso pendiente. Continuar con el resto del plan. No publicar una release de producción ni firmar APK de distribución; se permite únicamente el GitHub Release pre-release de APK DEMO QA descrito en Rev. 5.

### F6: QA final
Probar Básico/Pro x web/móvil x 4 motores, estados activos/sin datos/offline/stale, cientos de registros, múltiples ciclos y rangos legacy, historial y exportaciones seguras. Validar UI 360, 390, 768, 1280, 1920 px y Pixel 9 si hay emulador equivalente; accesibilidad, menús, modales, atrás, safe areas y ausencia de desbordamientos. Ejecutar check, tests, build y controles anti POST en acciones de lectura; no declarar ejecutado un test que no se ejecutó. Revisar matriz y checklist y todos los diffs. Commit/push SOLO rama si no hay deploy trigger. No PR merge.


## ENTREGABLES DE ACCESO DIRECTO — REV. 5 (SOLICITUD EXPRESA DEL USUARIO)
Se autoriza de forma limitada la **publicación de la maqueta web estática DEMO** y la **subida de la APK debug DEMO como GitHub Release prerelease de pruebas**, para que el usuario pueda abrir el panel y descargar el APK por enlaces reales. Esto NO autoriza deploy en VPS, conexión a backend operativo, configuración LIVE ni release de producción.

### A. Enlace de acceso al panel
1. Preparar una versión estática plenamente navegable de `nexa-v2/web/`, con rutas, módulos ES y recursos funcionando desde la URL pública (no usar enlaces a archivos en `blob/` que no sirven el panel). Verificar que se ve el banner DEMO, PIN de pruebas, Básico/Pro, motores y gráficos. No incluir `.env`, tokens, cuentas, datos privados, URLs internas ni endpoints productivos.
2. Publicar como **vista previa DEMO en GitHub Pages** si puede hacerse sin sustituir o romper cualquier sitio Pages existente ni disparar despliegues de producción. Si hay un Pages preexistente que se modificaría, hace falta permiso/configuración privilegiada o las opciones disponibles requieren un hosting externo/pago, NO cambiarlo ni contratar; documentar el bloqueo y ofrecer la alternativa estática segura sin fingir URL publicada.
3. Comprobar mediante acceso HTTPS desde un navegador la URL pública completa; entregarla literalmente como **«Abrir panel web NEXA V2 (DEMO)»**. Un enlace al repositorio o al archivo HTML de GitHub NO sustituye la dirección del panel navegable. Añadir el enlace a `nexa-v2/BUILD_APK.md` o documento de entrega y a la Issue #17.

### B. GitHub APK descargable
1. Tras corregir QA, reconstruir APK de pruebas, verificar `SHA-256`, paquete, tamaño, firma de debug, permisos y ausencia de secretos/cuentas/ejecución real. Confirmar que instalación y navegación siguen funcionando. Acompañarla de `.sha256.txt` y nota de «DEMO — SIN TRADING REAL», además de versión/SHA de commit.
2. Publicar el binario como **asset descargable de GitHub Releases**: crear tag de pruebas `nexa-v2-qa-YYYYMMDD-rN` apuntando EXCLUSIVAMENTE al commit de la rama `feature/nexa-v2-transformacion-20261120`, Release **PRE-RELEASE** con nombre `NEXA V2 QA — DEMO, SIN APROBAR`. No adjuntar binarios al git history, no cambiar `main` y no marcar `latest`/release estable.
3. Entregar la **URL directa del asset .apk**, la URL de la pre-release y el SHA-256. Verificar que el asset realmente está subido, visible y descargable desde GitHub; no ofrecer un path local `D:\...` como sustituto. Si las herramientas carecen de permisos para subir assets, dejar un bloqueo concreto y solicitar la autorización/acción mínima, sin afirmar publicado.

### C. Cierre obligatorio
En la respuesta final Cascade debe incluir DOS ENLACES REALES Y PROBADOS: **(1) Abrir panel web DEMO; (2) Descargar APK de pruebas desde GitHub Releases**. Indicar el alcance DEMO, no operación real. No marcar F6/entrega cerrada sin esos enlaces y QA visual; si no puede publicar alguno, marcar la entrega PARCIAL, explicar por qué y continuar con el resto. Mantener los 75 controles del checklist y el plan F0–F6; no fusionar con main ni intervenir en VPS/DB/trading.

## CONDICIÓN DE TERMINACIÓN
No terminar mientras existan errores ordinarios corregibles. Entregar:
- Código HTML final navegable + fuentes y frontend en rama.
- **APK local compilada, SHA-256, informe de instalación y pruebas**; si imposibilitada por un bloqueo externo real después de provisionar el entorno, estado F5 PARCIAL/BLOQUEADA, pruebas y errores registrados, nunca COMPLETADA.
- Matriz origen → destino con **100% de campos del origen auditado** mapeados o explícitamente N/A justificado y probados; checklist C001–C075 (más extensiones) actualizado por Cascade con evidencias, no casillas sin revisar; además ESTADO_FASES.md, MATRIZ_PARIDAD.csv, EVIDENCIAS_CHECKLIST.md e INCIDENCIAS.md.
- Informe de peligros P0 y bloqueos REALES pendientes, sin fingir runtime auditado.
- Tests ejecutados y resultados, fallos honestos, capturas comparativas, commit SHA completo, rutas y links a GitHub y Drive privado.
- No afirmar que el software nuevo ejecuta o ha sido desplegado en producción.

**No esperar confirmación para arreglar defectos técnicos dentro de esta rama. SOLO solicitar autorización si la acción precisa VPS, DB real, deploy, modificación de configuración LIVE, órdenes REALES, cambio de ramas protegidas o borrado destructivo.**
