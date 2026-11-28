# EVIDENCIA DE REGRESIÓN baseline/candidato (saneada)

Método: suite completa `vitest run --reporter=json` en el mismo entorno aislado sin DB, comparación por (fichero, nombre de test) con normalización. Los JSON completos permanecen en el entorno de ejecución (contienen rutas de máquina); sus hashes y conteos se publican aquí para verificación.

## WP10/11/13/14 (HEAD 5b94ff8+)

| métrica | WP8 anterior | WP10+ actual |
|---|---|---|
| total tests | 7402 | 7435 |
| passed | 7323 | 7356 |
| failed | 43 | 43 |
| pending | 36 | 36 |
| regresiones nuevas | — | **NINGUNA** (43/43 fallos idénticos, mismos tests preexistentes: dependencia PostgreSQL, ficheros sin suite, exports ausentes) |
| tests nuevos | — | +33 (15 matriz/validación + 13 PGlite atomicidad/reservas + 5 idempotencia durable), todos verdes |

sha256 salidas json (ficheros en el entorno de ejecución, no publicados por contener rutas de máquina): suite_wp10 `c89e81f3b4fd52e2d544fcf66f688969b35dd35d7962272a563b94d348a7d6bf`, suite_wp8 `701c53854fd94109ead12f5fa90c12f82191fda5cc29433cefcae6234e6c1800` — disponibles para TANGO por canal privado.

- `tsc --noEmit`: exit 0 tras WP10+WP11.
- Build APK reproducible: SHA-256 bit a bit idéntico en dos construcciones limpias independientes (ver ARTEFACTOS_NEXA.md adenda WP13).
- NEXA `node --test`: 177/177 (sin cambios en cliente desde entonces).
