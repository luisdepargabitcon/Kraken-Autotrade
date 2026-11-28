# H-025 — Diseño de reconciliación de ventas IDCA sin `exchange_order_id`

Fecha: 2026-11-27  
Estado: diseño + matcher puro implementado. **No se ha ejecutado contra datos reales**, no se ha accedido al VPS y no se ha modificado ningún histórico.

## Alcance y principio de seguridad

H-025 trata ventas IDCA persistidas sin `exchange_order_id` o con trazabilidad insuficiente. El objetivo no es reescribir el pasado, sino producir una clasificación auditable:

- `verified`: una venta casa de forma inequívoca con un fill o con el conjunto completo de fills de una orden;
- `unmatched`: no existe candidato dentro de tolerancias;
- `ambiguous`: hay más de una asignación posible o un fill podría pertenecer a varias ventas; no se asigna.

El matcher implementado en `server/services/institutionalDca/IdcaSellReconciliationMatcher.ts` es puro: sin I/O, sin DB, sin red, sin reloj externo y sin efectos contables.

## Consulta privada de solo lectura propuesta

El propietario, si lo autoriza y lo ejecuta en su entorno privado, puede extraer primero las ventas live candidatas y sus ciclos. Esta consulta es solo lectura y no incluye credenciales ni secretos:

```sql
SELECT
  o.id,
  o.cycle_id,
  o.pair,
  o.mode,
  o.order_type,
  o.side,
  o.price,
  o.quantity,
  o.executed_quantity,
  o.avg_fill_price,
  o.gross_value_usd,
  o.fees_usd,
  o.net_value_usd,
  o.exchange_order_id,
  o.execution_status,
  o.executed_at,
  c.status AS cycle_status,
  c.cycle_type,
  c.parent_cycle_id
FROM institutional_dca_orders o
JOIN institutional_dca_cycles c ON c.id = o.cycle_id
WHERE o.mode = 'live'
  AND o.side = 'sell'
  AND COALESCE(o.voided_reason, '') = ''
  AND (
    o.exchange_order_id IS NULL
    OR o.exchange_order_id = ''
    OR o.execution_status IN ('needs_verification', 'execution_unknown_pending_reconciliation')
  )
ORDER BY o.executed_at ASC, o.id ASC;
```

Complemento de contexto, también solo lectura:

```sql
SELECT
  id,
  pair,
  mode,
  status,
  cycle_type,
  parent_cycle_id,
  total_quantity,
  capital_used_usd,
  realized_cost_basis_usd,
  realized_pnl_usd,
  started_at,
  closed_at,
  close_reason
FROM institutional_dca_cycles
WHERE id IN (
  SELECT DISTINCT cycle_id
  FROM institutional_dca_orders
  WHERE mode = 'live'
    AND side = 'sell'
);
```

En paralelo, el propietario podría consultar en el venue el endpoint privado de fills/ejecuciones para el mismo rango temporal y pares implicados. La respuesta debe permanecer en el entorno privado; para compartir resultado bastaría una versión agregada/redactada con cantidades, precios medios, tiempos, fees y hashes/opcionalmente identificadores truncados. **No se ejecuta desde este trabajo.**

## Algoritmo implementado

1. Normaliza ventas y fills a cantidad, precio, tiempo, par, fee e identificador textual.
2. Ordena canónicamente por tiempo, par, cantidad, precio e id. Por tanto el resultado no depende del orden de entrada.
3. Construye unidades candidatas:
   - cada fill individual;
   - el grupo completo de fills que comparten `orderId`, cuando hay más de uno.
4. Para cada venta evalúa candidatos dentro de tolerancias de cantidad, precio y ventana temporal. Si ambos lados declaran par, deben coincidir.
5. Un resultado solo es `verified` si:
   - la venta tiene exactamente una unidad candidata;
   - esa unidad no casa con varias ventas;
   - ninguno de sus fills participa en otro emparejamiento prospectivo.
6. Los fills asignados no se reutilizan. Si un fill individual y el grupo de su orden podrían cubrir ventas distintas, ambas quedan `ambiguous`, no se hace first-wins.
7. La evidencia devuelta incluye cantidad agregada, precio medio ponderado, diferencias de cantidad/precio/tiempo y fee cuando exista.

## Tolerancias por defecto

Los valores por defecto son conservadores y configurables:

- cantidad relativa: `0.2 %`;
- paso absoluto de cantidad: `1e-8` unidades base;
- precio relativo: `0.3 %`;
- ventana temporal: `10 minutos`;
- fee: se reporta como evidencia; solo actúa como gate si el llamador configura `feeRelTolerancePct`.

Justificación: estas tolerancias buscan absorber redondeos de 8 decimales, pequeñas diferencias entre precio medio registrado y fills, y latencia de persistencia. No intentan aceptar diferencias económicas materiales. El propietario puede endurecerlas al disponer de datos privados reales.

## Qué NO hace

- No reconstruye PnL real.
- No corrige ni modifica ciclos, órdenes ni eventos históricos.
- No inserta `exchange_order_id`.
- No marca automáticamente una venta como válida en DB.
- No consulta el venue ni la base de datos.
- No usa datos reales en tests: los fixtures son sintéticos y están etiquetados como tales.

## Procedimiento privado recomendado

1. El propietario ejecuta las consultas de solo lectura en su entorno autorizado.
2. Descarga fills del venue para el rango mínimo necesario.
3. Ejecuta localmente el matcher con esos datos, sin exponer secretos ni respuestas completas.
4. Revisa manualmente todos los `ambiguous`; no se fuerza asignación.
5. Solo si el propietario decide una corrección contable, la prepara como migración/script separado, revisado y con backup. Eso está fuera de WP8.

## Tests

`server/services/institutionalDca/__tests__/idcaSellReconciliationMatcher.test.ts` cubre con fixtures sintéticos explícitos:

- match exacto;
- suma de fills parciales de una orden;
- ambigüedad por duplicados;
- un fill compatible con varias ventas;
- fuera de ventana;
- cantidad fuera de tolerancia;
- no reutilización de fills compartidos;
- determinismo frente al orden de entrada;
- entradas vacías.
