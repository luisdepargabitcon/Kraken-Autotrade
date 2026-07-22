---
trigger: always_on
---

# Recuperación obligatoria de comandos

## Principio general

Ningún comando potencialmente largo o susceptible de bloqueo debe ejecutarse sin timeout explícito, captura de stdout y stderr, medición de duración, código de salida, estrategia de recuperación y NEXT_ACTION definido. No esperar indefinidamente a que un comando termine.

## Clasificación previa

Antes de ejecutar un comando, clasificarlo como:

### READ_ONLY

No modifica estado. Ejemplos: `git status`, `git diff`, `git log`, `git rev-parse`, GET, SELECT read-only, `docker compose ps`, `docker compose logs` y lectura de archivos. Puede reintentarse automáticamente hasta dos veces.

### IDEMPOTENT

Puede modificar o regenerar, pero repetirlo no debería duplicar efectos. Ejemplos: `npm run check`, `npm run build`, tests, `docker compose config` y `git fetch`. Puede reintentarse una vez después de diagnosticar y limpiar exclusivamente el proceso hijo iniciado por el ejecutor.

### STATEFUL

Puede haber modificado estado aunque no haya devuelto una respuesta clara. Ejemplos: `git push`, migraciones, deploy, backups, escritura DB, órdenes, commits y cambios remotos. Nunca reintentar ciegamente.

Después de timeout o salida incierta:

1. Consultar el estado real.
2. Determinar si la operación terminó.
3. Continuar si ya terminó.
4. Reintentar solo la parte pendiente.
5. No duplicar la operación.

## Timeouts mínimos orientativos

- lectura local o Git básico: 120 segundos;
- `git fetch` o `git push`: 300 segundos;
- conexión SSH: `ConnectTimeout=10`;
- comandos read-only en VPS: 300 segundos;
- tests específicos: 900 segundos;
- suite completa: 1800 segundos;
- `npm run build`: 1200 segundos;
- backup o migraciones: 1200 segundos;
- docker build/deploy app-only: 1800 segundos;
- validación visual o Network: control por pasos, nunca una espera infinita.

Estos tiempos pueden ampliarse una sola vez cuando exista progreso real demostrado.

## Heartbeat

Mientras un comando siga vivo, mostrar cada 30 segundos el comando, PID, tiempo transcurrido, timeout y último progreso conocido. La ausencia de nueva salida no implica fallo inmediato, pero no puede superar el timeout sin diagnóstico.

## Al producirse timeout

1. Registrar comando, PID, duración, stdout, stderr, último progreso y tipo.
2. Terminar únicamente el árbol de procesos iniciado por ese comando.
3. No terminar todos los procesos Node, Docker, Git, SSH o PowerShell del sistema.
4. Comprobar que el proceso hijo terminó.
5. Analizar la causa, actualizar NEXT_ACTION y aplicar la estrategia correspondiente.

## Recuperación READ_ONLY

1. Esperar 5 segundos y reintentar.
2. Si vuelve a fallar, esperar 15 segundos y ejecutar un segundo y último reintento.
3. Si falla, usar un comando read-only alternativo.
4. Continuar con tareas independientes.
5. Solo declarar HARD_BLOCKER si el dato obligatorio no puede obtenerse por ninguna vía segura.

## Recuperación IDEMPOTENT

1. Terminar únicamente el proceso hijo.
2. Revisar salida y recursos.
3. Corregir la causa probable y reintentar una sola vez.
4. Si vuelve a fallar, usar una alternativa equivalente segura.
5. No repetir indefinidamente; continuar con validaciones independientes y volver al requisito pendiente.

## Recuperación STATEFUL

Nunca reintentar directamente tras un timeout. Aplicar primero una comprobación de estado.

### Git push

- Ejecutar `git fetch origin`.
- Comparar `HEAD` y `origin/main`.
- Si coinciden, el push terminó.
- Si no coinciden, revisar el error y reintentar solo cuando sea seguro.

### Migraciones

- Consultar el ledger oficial y comprobar schema.
- Determinar qué migración se aplicó.
- No volver a ejecutar DDL/DML manual.
- Usar únicamente el runner oficial para lo pendiente.

### Deploy

- Comprobar hash del VPS, imagen, contenedor y `docker compose ps`.
- Revisar logs.
- Si el contenedor correcto está Up, no repetir deploy.
- Si no terminó, reanudar únicamente la parte necesaria.

### Backup

- Comprobar existencia, timestamp, tamaño, contenido e integridad básica.
- No crear duplicados innecesarios si ya terminó correctamente.

### Commit

- Comprobar `git log`, HEAD, staged y working tree.
- No crear un segundo commit equivalente.

## SSH

Usar inicialmente:

`ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no root@5.250.184.18`

Ante timeout de conexión: reintentar una vez tras 5 segundos, comprobar conectividad y usar el fallback autorizado solo ante negociación criptográfica. No repetir SSH indefinidamente ni cambiar configuraciones permanentes del servidor.

## Comandos que esperan interacción

No ejecutar comandos que puedan esperar por contraseña, confirmación, editor, paginador, menú o prompt. Usar `BatchMode`, `--yes` solo cuando sea seguro, `--no-pager`, `GIT_PAGER=cat`, flags no interactivos y entrada previamente validada. No usar respuestas automáticas destructivas.

## Command Awaiting Approval

Una aprobación física de Windsurf no puede evitarse. Antes del comando, guardar NEXT_ACTION; informar que solo falta aprobación técnica, sin informe parcial ni HARD_BLOCKER. Tras aprobarse, comprobar si se ejecutó y continuar automáticamente desde NEXT_ACTION sin volver a pedir autorización conceptual.

## Fallo de una vía concreta

El fallo de un comando no equivale al fallo de la tarea. Antes de detenerse: probar una forma segura equivalente, una fuente alternativa de evidencia, comprobar estado real, continuar acciones independientes y volver al requisito pendiente, registrando todos los intentos.

## Límite de reintentos

- READ_ONLY: máximo 2 reintentos.
- IDEMPOTENT: máximo 1 reintento.
- STATEFUL: comprobación de estado antes de cualquier reintento.
- Nunca repetir una orden de trading, escritura DB, migración o deploy ciegamente.

## Continuidad

Después de recuperar un comando, actualizar LAST_COMPLETED_ACTION, LAST_VALIDATION y NEXT_ACTION; continuar con la tarea. Solo marcar HARD_BLOCKER cuando todas las alternativas seguras fallen, el resultado sea obligatorio, exista evidencia técnica y la causa sea externa no corregible.
