# CRITERIOS DE PROMOCIÓN A REAL — SPOT CANONICAL ENGINE

**Fecha:** 2026-08-12
**Policy Version:** SPOT-1.0.0-20260812
**Estado:** NOT_AUTHORIZED

> Este documento define los criterios objetivos y cuantitativos que deben cumplirse
> antes de considerar la activación del modo REAL en el motor SPOT canónico.
> La promoción a REAL requiere autorización explícita del usuario.

---

## 1. PRECONDICIONES OBLIGATORIAS

1. **REAL_ACTIVATION_ALLOWED = true** en configuración del sistema.
2. **SPOT_POLICY_VERSION** congelada y registrada en todos los trades SHADOW.
3. **DB migrada** — FASE 15 completada (tablas SPOT creadas, datos migrados).
4. **Deploy staging** — FASE 24 completada, app funcionando en staging.
5. **Validación visual staging** — FASE 25 completada, UI verificada.
6. **Observabilidad SHADOW** — FASE 26 completada, logs y métricas activos.

---

## 2. CRITERIOS CUANTITATIVOS (SHADOW → REAL)

### 2.1 Volumen mínimo en SHADOW

| Métrica | Umbral | Justificación |
|---------|--------|---------------|
| Trades SHADOW | ≥ 50 | Muestra estadísticamente significativa |
| Días en SHADOW | ≥ 30 | Cubrir al menos un ciclo de mercado |
| Pares operados | ≥ 3 | Diversificación mínima |
| Max drawdown SHADOW | ≤ 15% | No degradar capital antes de REAL |

### 2.2 Rendimiento

| Métrica | Umbral | Justificación |
|---------|--------|---------------|
| Win rate | ≥ 40% | Mínimo viable para LONG ONLY |
| Profit factor | ≥ 1.3 | Ganancias superan pérdidas |
| Avg R-multiple | ≥ 0.3 | Expectativa positiva por trade |
| Profit capture (avg) | ≥ 50% | Capturar al menos la mitad del MFE |
| Best trade | ≤ 10× risk | No depender de outliers |
| Worst trade | ≥ -1R | Stop funciona correctamente |

### 2.3 Robustez (Walk-Forward)

| Métrica | Umbral | Justificación |
|---------|--------|---------------|
| OOS win rate vs IS | ≤ 15% diff | No overfitting |
| OOS profit factor | > 0.5 | No colapso fuera de muestra |
| OOS avg R vs IS | ≤ 0.5 diff | Consistencia |
| Ventanas 100% loss | 0 | No hay períodos catastróficos |

### 2.4 Auditoría

| Métrica | Umbral | Justificación |
|---------|--------|---------------|
| EXCELLENT + GOOD | ≥ 40% | Calidad de salidas |
| BAD | ≤ 30% | No perder oportunidades sistemáticamente |
| Exit reason distribution | Sin dominancia > 60% | Diversificación de salidas |
| Emergency stops | ≤ 10% | SL no se dispara con frecuencia |

---

## 3. CRITERIOS CUALITATIVOS

1. **Sin bugs críticos** en SHADOW durante el período de evaluación.
2. **Telegram** funcionando (alertas de entrada/salida llegan correctamente).
3. **UI SPOT** muestra datos coherentes (positions, history, audit coinciden con DB).
4. **Paridad SHADOW vs legacy DRY** demostrada (FASE 1 divergencias resueltas).
5. **Fees reales** confirmados (Revolut X 0.09% taker, no fallback Kraken).
6. **No auto-optimización** post-deploy (FASE 27 completada).

---

## 4. PROCESO DE ACTIVACIÓN

1. Verificar todos los criterios cuantitativos y cualitativos.
2. Generar informe de promoción con evidencia de cada criterio.
3. Solicitar autorización explícita del usuario.
4. Cambiar `REAL_ACTIVATION_ALLOWED` a `true`.
5. Cambiar `ExecutionMode` a `REAL` via API.
6. Monitorear primer trade REAL con atención.
7. Kill switch disponible en cualquier momento.

---

## 5. CRITERIOS DE REVERSIÓN (REAL → SHADOW)

Si cualquiera de estos ocurre, revertir inmediatamente a SHADOW:

- Drawdown > 10% en modo REAL
- 3 trades consecutivos con Emergency Stop
- Profit factor < 0.8 en ventana de 20 trades
- Cualquier bug en execution adapter
- Discrepancia entre fill real y fill esperado > 0.5%
- Error de conectividad con Revolut X no recuperado en 5 min

---

## 6. ESTADO ACTUAL

- **REAL_PROMOTION_STATUS:** NOT_AUTHORIZED
- **SHADOW trades acumulados:** 0 (motor no desplegado)
- **Días en SHADOW:** 0
- **Próxima revisión:** Tras FASE 26 (observabilidad SHADOW en staging)

> La promoción a REAL no es un objetivo de esta refactorización. El objetivo
> es construir un motor canónico sólido que opere en SHADOW y acumule evidencia.
> La decisión de promoción a REAL es del usuario, basada en los criterios aquí definidos.
