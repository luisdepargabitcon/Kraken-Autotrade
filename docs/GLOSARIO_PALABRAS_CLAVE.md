# Glosario de palabras clave — BOT CRIPTO / NEXA

Versión: 1.0
Actualizado: 23/11/2026
Ámbito: coordinación entre el usuario, ChatGPT y Cascade.

## TANGO

**Significado:** “Cascade ha terminado de ejecutar e implementar la orden de trabajo. Revisa el resultado publicado en GitHub.”

### Acción de ChatGPT
1. Identificar la orden vigente y leer su versión actual, comentarios e informe final.
2. Revisar commits, diferencias de código, pruebas, evidencias y entregables. Comparar con todos los requisitos y criterios de aceptación.
3. Distinguir lo verificado directamente de lo declarado por Cascade y de lo pendiente.
4. Revisar las evidencias del VPS aportadas por Cascade, sin atribuirse acceso o comprobaciones directas en ese servidor.
5. Informar qué se completó, qué falla o falta y qué necesita prueba del usuario.
6. Dar enlaces directos de descarga de APK, ZIP, informes u otros archivos disponibles, con versión, finalidad y SHA-256 publicado para binarios.
7. Si hay defectos, actualizar la orden o crear una corrección vinculada; entregar un bloque breve para Cascade.
8. Si faltan resultados o evidencias, señalarlos sin inventar ejecución, validaciones ni enlaces.

**No implica:** aprobación automática, cierre de la orden, autorización de despliegue, activación REAL ni permiso para operar.

**Uso:** el usuario escribe TANGO. ChatGPT inicia la revisión sin pedir que se repita la tarea. Si hay varias órdenes posibles, consulta el contexto y GitHub; solo pregunta si sigue existiendo ambigüedad real.

## Protocolo de trabajo asociado

ChatGPT prepara y publica la orden detallada en GitHub y entrega su enlace con instrucciones breves. Cascade ejecuta, valida y publica código, evidencias e informe final. TANGO inicia la revisión de ChatGPT.

ChatGPT no tiene acceso operativo al VPS en este flujo. Cascade gestiona acceso, comprobaciones, despliegues y autorizaciones aplicables. ChatGPT no pregunta si puede conectarse o desplegar desde el chat. Esto no otorga permisos generales de modificación ni de trading.

## Mantenimiento y sincronización

- Mantener este glosario en GitHub y una copia de consulta en Google Drive.
- GitHub conserva el historial de cambios; las dos copias deben reflejar la misma versión y contenido operativo.
- Al añadir o modificar una palabra clave por instrucción del usuario, actualizar ambas copias, fecha, versión e historial; verificar las escrituras y devolver sus enlaces.
- Leer el glosario vigente antes de interpretar palabras clave en futuras tareas.
- No cambiar significados por iniciativa propia ni borrar definiciones anteriores sin indicación.
- Si una copia no se puede actualizar, indicar cuál quedó pendiente; no declarar sincronización completa.
- La actualización se realiza durante las solicitudes del usuario: no existe sincronización automática en segundo plano.
- Conservar los enlaces/identificadores de ambas copias en la documentación de continuidad cuando estén disponibles.

## Historial

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 23/11/2026 | Creación del glosario y definición de TANGO. |

Orden NEXA vigente al crear el glosario: https://github.com/luisdepargabitcon/Kraken-Autotrade/issues/18
