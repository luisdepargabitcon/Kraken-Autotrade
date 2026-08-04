# Validación PostgreSQL Desechable — Migración 080 AMA

**Fecha:** 2026-07-30
**Solicitud:** CORRECCIÓN PREMERGE AMA V2.2-R2, Sección 9
**Estado:** BLOCKED_NO_SAFE_ENVIRONMENT

## R2 — Intento de detección de entorno seguro

### Comando ejecutado

```powershell
docker version
```

### Resultado

```
docker : El término 'docker' no se reconoce como nombre de un cmdlet,
función, archivo de script o programa ejecutable.
```

### Conclusión

Docker no está instalado ni disponible en PATH en la máquina de desarrollo local.

## Bloqueo confirmado

No existe PostgreSQL temporal disponible en el entorno local de desarrollo:

- `psql` no está instalado ni en PATH
- `docker` no está disponible (Docker Desktop no instalado o no en PATH)
- `docker compose` no está disponible
- No se puede crear contenedor temporal ni base de datos local

## Lo que NO se hizo

- No se inventó un resultado de validación
- No se ejecutó la migración 080 contra ninguna base de datos
- No se usó la base de datos del VPS, staging, ni producción
- No se omitió la validación silenciosamente

## Lo que SÍ se hizo

El script `scripts/ama_migration_validate.mjs` fue corregido para:
- Exigir configuración explícita de PostgreSQL temporal
- Rechazar DB del VPS (`krakenbot`, `krakenbot_staging`)
- Rechazar DBs protegidas (`postgres`, `template0`, `template1`)
- Crear base de datos temporal con prefijo `ama_disposable_test_`
- Aplicar migración 080 dos veces (idempotencia)
- Validar tablas, índices, CHECK, UNIQUE, FK
- Probar datos válidos e inválidos
- Comprobar aislamiento BTC/ETH
- Destruir solo el entorno temporal

## Estado R2

```text
POSTGRESQL_DISPOSABLE = BLOCKED_NO_SAFE_ENVIRONMENT
MIGRACION_080 = NOT_REGISTERED, NOT_AUTOAPPLY
```

No afirmar simultáneamente "sin entorno PostgreSQL" y "PostgreSQL validado actualmente".

## Pendiente

Para completar esta validación se requiere:

1. Instalar Docker Desktop O PostgreSQL local en la máquina de desarrollo
2. Ejecutar `node scripts/ama_migration_validate.mjs` con variables de entorno:
   - `PG_HOST=localhost`
   - `PG_PORT=5432`
   - `PG_USER=postgres`
   - `PG_PASSWORD=<password_local>`
3. Verificar que el script crea y destruye la DB temporal correctamente
4. Documentar resultados reales en este archivo

**Veredicto:** BLOCKED_NO_SAFE_ENVIRONMENT

---

## R8A — Actualización (2026-08-03)

**Estado R8A:** VALIDADOR_ENDURECIDO_Y_CI_CONFIGURADA

### Cambios R8A

- Helpers canónicos migrados a `scripts/ama_migration_validation_helpers.mjs` (JS puro, 15 exports)
- `scripts/ama_migration_validate.mjs` — main module guard, imports desde .mjs, no ejecuta en import
- CI: `.github/workflows/ama-postgres-080-validation.yml` — PostgreSQL 16 desechable, `npm run check` + `validate:ama:postgres`
- npm script: `validate:ama:postgres` → `node scripts/ama_migration_validate.mjs`
- Tests unitarios: 46/46 PASS (validación de helpers sin conexión PostgreSQL)

### Estado actual

- PostgreSQL local = NO DISPONIBLE (sin Docker ni PG local)
- CI GitHub Actions = CONFIGURADA (PostgreSQL 16 service container, DB desechable)
- Validador = LISTO para ejecución runtime cuando exista entorno PG
- Smoke test import = OK (sin conexión PG en import)
- Migración 080 = NOT_REGISTERED, NOT_AUTOAPPLY

**Veredicto R8A:** VALIDADOR_LISTO_CI_CONFIGURADA_EJECUCION_RUNTIME_PENDIENTE
