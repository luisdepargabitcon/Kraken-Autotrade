# Market Metrics — propuesta de retención futura

Fecha: 2026-11-27  
Alcance: propuesta documental. No se ejecutan purgas, migraciones registradas ni cambios destructivos.

## Estado implementado en WP6a

- La inserción de snapshots evita duplicados lógicos por observación usando `source + metric + asset + ts_provider` mediante `INSERT ... SELECT ... WHERE NOT EXISTS`.
- La carga de últimos snapshots está acotada a una ventana de 24 horas y `LIMIT 200`.
- La carga histórica para open interest está acotada por ventana y `LIMIT` configurable interno.
- El refresh de arranque se omite si ya existe un snapshot más joven que la ventana de seguridad, evitando tormentas al reiniciar.
- Entre proveedores se aplica un pequeño jitter escalonado.

## Propuesta no aplicada

1. Crear en una migración futura un índice único sobre observación lógica:
   `(source, metric, COALESCE(asset, ''), COALESCE(ts_provider, 'epoch'::timestamptz))` o una columna normalizada equivalente.
2. Antes de crear ese índice, ejecutar una deduplicación histórica controlada y revisable.
3. Retener snapshots crudos de alta frecuencia durante 30 días.
4. Agregarlos en resúmenes horarios/diarios antes de cualquier purga.
5. Conservar resúmenes agregados durante 13 meses para análisis estacional y fiscal/técnico.
6. Excluir de purga cualquier snapshot referenciado por una evaluación persistida o incidente operativo.

## Motivo de no aplicar ahora

La tabla puede contener datos operativos existentes y no hay autorización para ejecutar migraciones o purgas. Además, crear un índice único sin deduplicar primero puede fallar o bloquear escritura en producción. Por eso WP6a solo introduce deduplicación idempotente en escritura y consultas acotadas.
