---
trigger: always_on
---

# Recuperación de comandos

- Usar `invoke-command-with-recovery.ps1` únicamente para comandos que
  previsiblemente duren más de 60 segundos.
- No usar el wrapper para:
  - lectura de archivos;
  - `git status`;
  - `git diff`;
  - `git log`;
  - búsquedas;
  - `Get-Content`;
  - comandos simples;
  - tests individuales rápidos.
- Para comandos ReadOnly o Idempotent se permite como máximo un reintento
  después de un timeout real.
- Para comandos Stateful no realizar reintentos automáticos.
- Tras una operación Stateful incierta, comprobar primero su estado real.
- No crear archivos temporales solamente para poder leer una salida.
- No dividir archivos de instrucciones en numerosos fragmentos.
- Un timeout no constituye por sí solo un HARD_BLOCKER.
- Si un comando falla normalmente con exit code distinto de cero, analizar el
  error; no tratarlo como comando bloqueado.