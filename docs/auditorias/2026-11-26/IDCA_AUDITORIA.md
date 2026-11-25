# IDCA — Investigación de calidad de entradas (26/11/2026)

Estado: investigación preliminar, SIN APROBAR. No se autoriza implementación ni despliegue.

Se analizaron exportaciones históricas del VPS y velas BTC/ETH. La hipótesis de continuidad bajista posterior a la compra merece investigación, pero retrasar indiscriminadamente las entradas no demostró mejorar el precio en el ensayo horario. Investigar un filtro selectivo de continuidad bajista, comparado con el IDCA actual y una variante fraccionada. No duplicar trailing ni confluencia existentes.

Limitaciones: muestra pequeña, órdenes pendientes de conciliación, cobertura insuficiente de velas 1m/5m y ausencia de backtest integral con comisiones. No atribuir la configuración de noviembre a compras anteriores. Los datos privados de ejecución y configuración se conservan en Drive, sin publicación de datos individuales en este repositorio público hasta confirmación expresa.

## Integridad de evidencias privadas
- IDCA_auditoria_entradas.csv: SHA256 d04a0cfb8179ac428473fddc233e2dca71cea05dbd68a97cf9e5d5c90fa48a04
- IDCA_velas_BTC_ETH_depuradas.csv.gz: SHA256 491a5491b49e194da65678fa2b32fb2f9373b46c537a48e11c71c609b6462d15

Sin cambios de código operativo, configuración o VPS.
