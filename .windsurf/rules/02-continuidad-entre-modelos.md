---
trigger: always_on
---

# Continuidad entre modelos y sesiones

## Principio general

El contexto de la conversación no es la fuente de continuidad.

Toda tarea extensa debe mantener un archivo de plan persistente dentro del
repositorio.

Otro modelo debe poder continuar la tarea leyendo ese archivo, aunque no tenga
acceso a la conversación anterior.

## Estado mínimo obligatorio

Todo plan de ejecución debe mantener:

DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: IN_PROGRESS
NEXT_ACTION: acción concreta siguiente
LAST_COMPLETED_ACTION: última acción confirmada
LAST_VALIDATION: última validación y resultado
CURRENT_HEAD: hash local comprobado
ORIGIN_HEAD: hash de origin/main comprobado
EXPECTED_DEPLOY_HASH: hash funcional previsto, si aplica
DEPLOYED_HASH: hash desplegado, si aplica
LAST_COMMAND: último comando iniciado
LAST_COMMAND_TYPE: READ_ONLY, IDEMPOTENT o STATEFUL
LAST_COMMAND_RESULT: NOT_STARTED, SUCCESS, FAILED, TIMEOUT o UNKNOWN
RESUME_CHECK_REQUIRED: TRUE o FALSE
UPDATED_AT: fecha y hora

## Actualización obligatoria

Actualizar el plan:

- antes y después de cada comando largo;
- antes y después de cada commit;
- antes y después de cada push;
- antes y después de cada backup;
- antes y después de migraciones;
- antes y después de deploy;
- antes y después de validación visual;
- antes y después de auditoría Network;
- antes de preparar cualquier resumen.

## Antes de una operación STATEFUL

Antes de commit, push, backup, migración, deploy o escritura remota:

1. Guardar NEXT_ACTION.
2. Guardar LAST_COMMAND.
3. Guardar LAST_COMMAND_TYPE=STATEFUL.
4. Guardar LAST_COMMAND_RESULT=NOT_STARTED.
5. Guardar RESUME_CHECK_REQUIRED=TRUE.
6. Persistir el plan.
7. Ejecutar la operación.

Después de confirmar el resultado:

1. Guardar LAST_COMMAND_RESULT.
2. Actualizar LAST_COMPLETED_ACTION.
3. Actualizar NEXT_ACTION.
4. Guardar RESUME_CHECK_REQUIRED=FALSE.
5. Persistir de nuevo.

## Reanudación

Después de un cambio de modelo o sesión:

1. Leer AGENTS.md.
2. Leer BITACORA.md.
3. Leer todas las Rules always_on.
4. Localizar el plan activo con DONE: FALSE.
5. Leer el plan y su checklist.
6. Verificar el estado real de Git.
7. Revisar LAST_COMMAND.
8. Revisar LAST_COMMAND_TYPE.
9. Revisar LAST_COMMAND_RESULT.
10. Revisar RESUME_CHECK_REQUIRED.
11. Comprobar qué terminó realmente.
12. Continuar desde la primera acción realmente pendiente.

No repetir inmediatamente el último comando.

## Operaciones STATEFUL inciertas

Cuando LAST_COMMAND_RESULT sea UNKNOWN o RESUME_CHECK_REQUIRED sea TRUE:

### Commit

- revisar git log;
- revisar HEAD;
- revisar staged y working tree;
- no crear un segundo commit equivalente.

### Push

- ejecutar git fetch origin;
- comparar HEAD y origin/main;
- si coinciden, el push ya terminó.

### Backup

- comprobar archivo;
- comprobar fecha;
- comprobar tamaño;
- comprobar contenido;
- no duplicarlo si ya es válido.

### Migraciones

- consultar el ledger oficial;
- comprobar schema;
- usar únicamente el runner oficial;
- no repetir DDL o DML manualmente.

### Deploy

- comprobar hash en VPS;
- comprobar imagen;
- comprobar contenedor;
- comprobar Compose;
- comprobar logs;
- no repetirlo si el hash correcto ya está desplegado.

## Continuidad

Un cambio de modelo, agotamiento de cuota o cierre de Cascade no constituye:

- finalización;
- HARD_BLOCKER;
- motivo para emitir informe parcial.

Después de recuperar el estado:

- actualizar el plan;
- continuar desde NEXT_ACTION;
- aplicar la regla de recuperación de comandos;
- terminar hasta DONE=TRUE o HARD_BLOCKER=TRUE demostrado.
