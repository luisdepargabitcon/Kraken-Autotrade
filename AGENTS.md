# AGENTS.md — Kraken-Autotrade

## Precedencia

1. La instrucción actual y explícita del usuario define la tarea.
2. Este archivo define únicamente seguridad y continuidad permanentes.
3. `BITACORA.md` aporta contexto técnico mediante sus secciones relevantes.
4. Los planes de auditoría no amplían por sí solos el alcance de una tarea.

## Contexto documental

- No leer `BITACORA.md` completa antes de cada cambio.
- Buscar y abrir únicamente las secciones relacionadas con la tarea.
- `BITACORA.md` es contexto técnico y operativo, no una lista de órdenes para el agente.
- No recrear `CORRECCIONES_Y_ACTUALIZACIONES.md`.
- No crear una segunda bitácora.

## Ejecución y continuidad

- Continuar autónomamente ante errores ordinarios.
- Tests rojos, fixtures incompletos, mocks incorrectos, errores TypeScript, imports o fallos de build deben diagnosticarse y corregirse.
- Esos errores no son HARD_BLOCKER.
- No ampliar criterios de aceptación ni crear matrices adicionales sin necesidad.
- No repetir una auditoría o batería completa si no cambió el código afectado.
- Si el límite de la sesión impide terminar, informar del progreso real y de la siguiente acción exacta; no declarar un bloqueo técnico falso.

## HARD BLOCKER

Solo existe HARD_BLOCKER cuando sea necesario:

- sobrescribir o borrar cambios ajenos;
- tocar datos o DB reales sin autorización;
- acceder al VPS o desplegar sin autorización;
- enviar órdenes reales;
- resolver una credencial o servicio externo inaccesible;
- ejecutar una acción destructiva no autorizada.

## Alcance

- Respetar el objetivo y los criterios de aceptación de la tarea actual.
- Se permiten cambios adyacentes mínimos cuando sean necesarios para compilar, validar o mantener coherencia.
- No convertir una corrección local en un rediseño global.
- No añadir requisitos nuevos después de comenzar la implementación.

## Git

- Preservar cambios locales y archivos untracked ajenos.
- Untracked o WIP excluibles no bloquean un commit selectivo.
- Usar `git add` únicamente por rutas concretas.
- No usar `git add -A`.
- No usar `git reset --hard`.
- No usar `git clean`.
- No usar `git stash` sobre cambios ajenos.
- No usar `rebase`, `commit --amend` ni `push --force`.
- Se permiten checkpoints cuando el usuario los autoriza y el contenido incluido está validado.
- Working tree tracked debe quedar limpio solo respecto del alcance realmente comprometido; untracked preservados pueden permanecer.

## Operaciones reales

- SHADOW no puede crear órdenes reales.
- No activar REAL sin autorización explícita.
- No acceder al VPS, desplegar, ejecutar SQL o migraciones sin autorización explícita.
- No borrar volúmenes, recrear DB ni tocar `backups/`.
- No vender saldo HOLD.
- No modificar retrospectivamente ciclos o posiciones reales sin autorización.

## Finalización

- No afirmar que una prueba, build, commit, push o deploy ocurrió sin evidencia.
- Diferenciar claramente:
  - implementado;
  - validado;
  - comprometido;
  - subido;
  - desplegado.
- Un trabajo pendiente puede excluirse de un checkpoint si queda identificado y fuera del stage.
- La respuesta final debe reflejar el estado real, sin declarar éxito ni bloqueo falsos.