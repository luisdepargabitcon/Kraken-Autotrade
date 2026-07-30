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
