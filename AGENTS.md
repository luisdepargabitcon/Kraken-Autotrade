# Gobernanza general de Kraken-Autotrade

## Fuente de verdad

- Leer `BITACORA.md` antes de planificar o modificar el proyecto.
- `BITACORA.md` es la única fuente documental vigente.
- `CORRECCIONES_Y_ACTUALIZACIONES.md` fue eliminado y no debe buscarse, recrearse, restaurarse ni utilizarse.
- No crear una segunda bitácora.

## Alcance

- Respetar estrictamente el alcance solicitado en cada tarea.
- No modificar módulos ajenos al alcance.
- No tocar IDCA, FISCO, SPOT, Telegram, autenticación, navegación global o REAL cuando la tarea no los incluya.
- No transformar una corrección local en un cambio global sin autorización.

## Git

- Auditar `git status` antes de modificar.
- No borrar cambios ajenos.
- Añadir archivos selectivamente.
- No usar `git add -A`.
- No usar `git reset --hard`.
- No usar `git clean`.
- No usar `rebase`.
- No usar `commit --amend`.
- No usar `push --force`.
- Antes del cierre, comprobar `HEAD = origin/main` y working tree limpio cuando la tarea incluya commit y push.

## Trading

- SHADOW no puede crear órdenes reales.
- No vender saldo HOLD.
- No mezclar ciclos, cantidades, lotes, niveles o rangos.
- Cada BUY pertenece a su propio ciclo y a su propia salida.
- Los ciclos legacy no deben modificarse retroactivamente sin autorización.
- Los rangos históricos pueden gestionar salidas, pero no crear nuevas BUY.
- Trigger, maker pending y fill deben ser estados separados.
- No permitir taker si la tarea exige maker-only.

## VPS staging

- El entorno operativo es el VPS staging, no el NAS.
- Acceder desde la terminal mediante SSH directo:

  `ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no root@5.250.184.18`

- Trabajar exclusivamente en `/opt/krakenbot-staging`.
- Usar exclusivamente `docker compose -f docker-compose.staging.yml`.
- No usar `docker-compose.yml` genérico.
- No usar `docker compose down`.
- No borrar volúmenes.
- No reiniciar ni recrear la DB.
- No ejecutar SQL manual si existe un runner oficial.
- Solo hacer deploy cuando la tarea vigente lo autorice expresamente.

## Finalización

- No declarar una tarea terminada con requisitos obligatorios pendientes.
- No convertir pendientes obligatorios en “no bloqueantes”.
- No cerrar un checklist añadiendo solamente una tabla resumen.
- Actualizar las filas originales.
- El primer resumen preparado al terminar es un borrador interno.
- Antes de responder, releer las instrucciones y comprobar si realmente se terminó todo.
- Si falta algo, continuar automáticamente.
- Los comandos largos deben ejecutarse con timeout, heartbeat y recuperación según `.windsurf/rules/01-recuperacion-comandos.md`.
- Las operaciones stateful nunca deben repetirse sin comprobar antes su estado.
- Solo detenerse por un bloqueo crítico real y demostrado.
