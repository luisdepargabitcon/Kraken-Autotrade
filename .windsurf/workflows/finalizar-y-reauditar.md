# Finalizar y reauditar

1. Lee `AGENTS.md`.
2. Lee `BITACORA.md`.
3. Lee las instrucciones actuales del usuario.
4. Lee el plan y el checklist activos.
5. Continúa desde NEXT_ACTION cuando exista.
6. Completa todas las acciones pendientes autorizadas.
7. No entregues informes parciales.
8. Prepara un borrador interno.
9. Relee todas las instrucciones.
10. Reconcílialas una por una con evidencia real.
11. Si falta algo, continúa trabajando.
12. Realiza una tercera comprobación independiente.
13. Ejecuta `scripts/verify-cascade-completion.ps1` en modo Final cuando exista un checklist.
14. Solo entrega el informe con DONE=TRUE.
15. Solo detente antes con HARD_BLOCKER=TRUE y evidencia técnica concreta.

## Recuperación de comandos

- Aplicar `.windsurf/rules/01-recuperacion-comandos.md`.
- Ejecutar comandos largos con timeout.
- Ante timeout, clasificar la operación.
- Reintentar solo READ_ONLY o IDEMPOTENT dentro de sus límites.
- Verificar el estado antes de repetir STATEFUL.
- Después de recuperarse, continuar desde NEXT_ACTION.

## Verificación del plan persistente

Antes de declarar DONE=TRUE confirma:

- el plan persistente está actualizado;
- `RESUME_CHECK_REQUIRED` no permanece en `TRUE`;
- `LAST_COMMAND_RESULT` no permanece en `UNKNOWN`;
- `NEXT_ACTION` no contiene una acción pendiente;
- `DONE` solo pasa a `TRUE` después de resolver esos campos.
- Una aprobación física de Windsurf requiere intervención del usuario, pero no constituye finalización ni HARD_BLOCKER.
