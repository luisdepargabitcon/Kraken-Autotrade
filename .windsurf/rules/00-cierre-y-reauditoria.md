---
trigger: always_on
---

# Cierre de tareas

- Ejecutar únicamente las validaciones relevantes para el alcance real.
- Revisar una vez `git diff --check`, `git diff` y `git status`.
- No exigir una segunda o tercera auditoría automática.
- No repetir tests que ya pasaron si el código afectado no cambió.
- Un fallo debe diagnosticarse y corregirse de forma acotada.
- Si el fallo no pertenece al alcance, registrarlo sin intentar corregir otro módulo.
- Se permite entregar un informe de bloqueo concreto cuando no puede avanzarse.
- El Workflow `/finalizar-y-reauditar` se aplica una sola vez al final.
- No declarar éxito si fallan validaciones directamente relacionadas con la tarea.