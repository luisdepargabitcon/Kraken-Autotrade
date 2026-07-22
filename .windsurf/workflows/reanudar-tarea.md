# Reanudar tarea

1. Lee AGENTS.md.
2. Lee BITACORA.md.
3. Lee todas las Rules always_on.
4. Localiza el plan activo más reciente que contenga:
   - DONE: FALSE
   - TASK_STATUS: IN_PROGRESS
5. Lee íntegramente el plan y su checklist.
6. Comprueba Git real:
   - rama;
   - status;
   - HEAD;
   - origin/main.
7. Revisa:
   - LAST_COMMAND;
   - LAST_COMMAND_TYPE;
   - LAST_COMMAND_RESULT;
   - RESUME_CHECK_REQUIRED;
   - NEXT_ACTION.
8. Si una operación STATEFUL quedó incierta, verifica primero su estado.
9. No repitas ciegamente commits, pushes, backups, migraciones o deploys.
10. Actualiza CURRENT_HEAD, ORIGIN_HEAD y NEXT_ACTION.
11. Continúa desde la primera acción realmente pendiente.
12. Aplica `.windsurf/rules/01-recuperacion-comandos.md`.
13. No entregues informes parciales.
14. Antes del cierre aplica el Workflow finalizar-y-reauditar.
15. Solo entrega informe con DONE=TRUE o HARD_BLOCKER=TRUE demostrado.
