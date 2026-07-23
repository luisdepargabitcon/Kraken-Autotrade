---
trigger: always_on
---

# Continuidad entre modelos y sesiones

- Usar un plan persistente únicamente en tareas largas, de más de 30 minutos,
  o cuando el usuario lo solicite expresamente.
- Actualizar el plan solo en hitos importantes:
  - inicio de fase;
  - final de fase;
  - antes y después de commit;
  - antes y después de push;
  - antes y después de migración;
  - antes y después de deploy;
  - al producirse una interrupción real.
- No actualizar el plan antes y después de cada lectura, búsqueda, test o
  comando pequeño.
- No releer todas las Rules en cada respuesta.
- No releer BITACORA.md repetidamente si no ha cambiado.
- Utilizar `/reanudar-tarea` solo después de una interrupción, cambio de modelo
  o cuando el usuario lo invoque.
- Al reanudar, comprobar Git y la última operación Stateful antes de continuar.
- No repetir operaciones que ya estén confirmadas.
- El cambio de modelo no obliga a reiniciar la tarea.

## Campos mínimos del plan

DONE
HARD_BLOCKER
TASK_STATUS
NEXT_ACTION
LAST_COMPLETED_ACTION
LAST_VALIDATION
CURRENT_HEAD
ORIGIN_HEAD
EXPECTED_DEPLOY_HASH
DEPLOYED_HASH
UPDATED_AT

Los campos LAST_COMMAND y RESUME_CHECK_REQUIRED solo son necesarios cuando una
operación Stateful quedó realmente interrumpida.