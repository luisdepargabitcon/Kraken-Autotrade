---
trigger: always_on
---

# Cierre y reauditoría obligatorios

## Continuidad

- No detenerse entre subfases cuando la tarea ya autorice su ejecución.
- No preguntar repetidamente si debe continuar.
- No entregar informes parciales.
- No detenerse porque la tarea sea larga.
- Mantener NEXT_ACTION cuando exista un plan o checklist.

## Primer resumen

- El primer resumen es únicamente un borrador interno.
- No enviarlo todavía al usuario.

## Segunda comprobación

Antes de responder:

1. Releer la petición original.
2. Releer todas las instrucciones de la tarea.
3. Releer `AGENTS.md`.
4. Releer `BITACORA.md`.
5. Releer el checklist o plan activo.
6. Auditar el diff.
7. Comprobar tests, migraciones, Git, deploy, UI y Network cuando apliquen.
8. Comparar cada requisito con evidencia real.

Si falta algo:

- no enviar el informe;
- marcar DONE como FALSE si existe ese campo;
- actualizar NEXT_ACTION;
- terminar lo pendiente;
- repetir las validaciones;
- volver a realizar esta comprobación.

## Tercera comprobación

Cuando aparentemente todo esté terminado:

- comprobar HEAD y origin/main;
- comprobar working tree;
- comprobar tests y skipped;
- comprobar migraciones;
- comprobar hash desplegado si hubo deploy;
- comprobar DB, logs y endpoints;
- comprobar visual y Network cuando formen parte de la tarea;
- comprobar todas las filas originales del checklist;
- ejecutar el verificador de cierre.

Si se detecta un problema:

- volver a DONE=FALSE;
- corregirlo;
- repetir segunda y tercera comprobación.

## Condición de finalización

Solo entregar el informe final cuando:

- PENDING = 0;
- IN_PROGRESS = 0;
- FAIL = 0;
- BLOCKED = 0;
- tests obligatorios ejecutados;
- cero fallos nuevos;
- cero tests críticos skipped;
- build correcto cuando aplique;
- checklist original actualizado;
- HEAD = origin/main cuando haya push;
- working tree limpio;
- deploy y postdeploy completados cuando estén autorizados;
- visual y Network validados cuando estén exigidos;
- `BITACORA.md` actualizada cuando corresponda.

## Evidencia

No son evidencia suficiente:

- “implementado”;
- “tests verdes” sin detalles;
- HTTP 200 como validación visual;
- navegador abierto como validación responsive;
- curl GET como auditoría Network;
- un resumen redactado por el propio agente;
- una tabla de cierre añadida al final.

## Bloqueo crítico

Solo detenerse cuando exista un bloqueo crítico demostrado.

No son bloqueos:

- tarea extensa;
- muchos archivos;
- tests corregibles;
- necesidad de acceder al VPS ya disponible;
- falta de DATABASE_URL local si existe staging;
- validaciones pendientes;
- necesidad de completar un checklist;
- autorización conceptual que ya fue concedida.

## Aprobación técnica de la interfaz

Si Windsurf bloquea físicamente un comando:

- preparar el comando completo;
- esperar únicamente la aprobación técnica;
- no entregar un informe parcial;
- después de aprobarse, continuar automáticamente desde NEXT_ACTION.
