# IMPACTO DE LAS CORRECCIONES DE INDICADORES — medición sobre datos públicos

**Reproducir:** `npx tsx scripts/measure_indicator_impact.ts` (offline si existe el snapshot de `data_public/`). Resultados completos en `IMPACTO_INDICADORES.json`; hashes en `data_public/MANIFEST.json`.

## Datos y límites (leer antes de interpretar)

- Fuente: API **pública** de Kraken (OHLC 1h, sin claves). 2 peticiones totales: BTC/USD y ETH/USD, 720 velas cada una (2026-10-28T21:00Z → 2026-11-27T20:00Z, ~30 días). SHA-256 de cada serie en el manifest.
- **No es un replay** de ciclos IDCA, **no demuestra rentabilidad** y **no establece causalidad** con compras reales. Las ventanas deslizantes se solapan (no son muestras independientes). Una sola ventana temporal de ~30 días, un solo régimen de mercado.
- `OLD` replica fielmente el cálculo previo de `performEntryCheck` (EMA50 de BTC := EMA20 desplazada un paso, volumen fijado a 1/1, semilla EMA legacy, contexto BTC por defecto 60). `NEW` invoca la función real del motor `evaluateEntryMarketScoreQuality` (EMA estricta con warm-up de 2×periodo, volumen relativo causal, estado de calidad). Pesos = los de la configuración por defecto (15/10/10/10/15/10/15/15). `localHigh` = máximo de los últimos 60 cierres en ambos cálculos (el precio base real del motor no es reproducible fuera de él).

## 1. Indicadores técnicos (último valor y ventanas)

| Par | MACD completo | MACD truncado (100 velas) | Dif. abs. | Desacuerdo de signo del histograma | ATR SMA | ATR Wilder | SMA − Wilder |
|---|---:|---:|---:|---:|---:|---:|---:|
| BTC/USD | −261,5923 | −261,9541 | 0,3618 | 0,15 % (1/660 ventanas) | 583,1357 | 524,8938 | +11,10 % |
| ETH/USD | −9,8315 | −9,8417 | 0,0101 | 0,15 % (1/660 ventanas) | 18,0621 | 16,8271 | +7,34 % |

- **MACD:** con datos reales la variante truncada difiere poco del estándar (el 30 % de desviación del fixture sintético inicial **no** se reproduce en datos reales). El desacuerdo de signo es marginal (1 de 660 ventanas por par). No hay motivo estadístico, en esta muestra, para migrar el MACD productivo de forma automática: decisión del propietario tras una comparación en SHADOW (ver `INDICADORES_DIVERGENCIAS.md`).
- **Series planas:** 0 transiciones planas en cierres horarios reales → la política del RSI para serie plana (100 histórico vs neutral/no fiable) no afecta a estos datos; sigue siendo un caso límite a definir por seguridad, no por impacto observado.
- **ATR:** la convención SMA infla el ATR entre ~7 % y ~11 % respecto a Wilder en esta muestra. No se cambia ninguna convención (cada consumidor la fija explícitamente); impacto potencial en TP/trailing dinámicos a evaluar con replay, no con esta medición.

## 2. Score BTC→ETH: cálculo antiguo vs nuevo, por longitud de historia disponible

Ventanas deslizantes de L velas que terminan en cada vela posible.

| L (velas) | Ventanas | Estado NEW | Δ medio (nuevo−antiguo) | Máx. \|Δ\| | Cruces antiguo<50→nuevo≥50 | Cruces antiguo≥50→nuevo<50 |
|---:|---:|---|---:|---:|---:|---:|
| 60 | 661 | 661 degradadas | −0,11 | 13 | 15 | 20 |
| 80 | 641 | 641 degradadas | −0,13 | 13 | 16 | 16 |
| 100 | 621 | 621 ok | −0,43 | 6 | 14 | 13 |
| 200 | 521 | 521 ok | −0,54 | 6 | 10 | 7 |

- **Con historia insuficiente (<100 velas)** el nuevo motor marca el score como *degradado* (EMA50 sin warm-up) y, con la política por defecto (`allowDegradedMarketScore=false`), **bloquea nuevas entradas**; antes calculaba un EMA50 de periodo reducido y no lo señalaba. En L=60/80 el Δ solo se muestra sobre el score renormalizado, que no se usa para decidir.
- **Con historia suficiente (L≥100):** el score medio baja ~0,4–0,5 puntos y cambia de lado del umbral 50 en 17–27 de 521–621 ventanas (≈3–4 %), en ambas direcciones. Es un efecto pequeño y simétrico en esta muestra; no puede interpretarse como cambio de compras reales.

## 3. Ablation del volumen relativo (EMA estricta fija, L=200, 521 ventanas con baseline OK)

| Variante frente a volumen real | Cambios de lado del umbral 50 | Hacia entrada (≥50) | Hacia no-entrada (<50) | Δ medio | Máx. \|Δ\| |
|---|---:|---:|---:|---:|---:|
| Volumen 1/1 (comportamiento antiguo) | 17 | 7 | 10 | +0,62 | 6 |
| Componente excluido y renormalizado | 17 | 7 | 10 | +1,50 | 9 |

- Ambas variantes sesgan el score al alza en media (+0,62 y +1,50 puntos) respecto al volumen real: sustituir un volumen real por 1/1 o excluirlo **tiende a favorecer ligeramente las entradas** en esta muestra, aunque las inversiones de lado del umbral son pocas (17/521 ≈ 3,3 %) y de ambos signos.
- La coincidencia exacta de los conteos 7/10 entre ambas variantes es casual (las medias difieren) y se verificó que los scores no son idénticos.
- Esta es la justificación empírica de la política por defecto (bloquear con score degradado en vez de renormalizar): la renormalización desplaza el score de forma no neutral.
- El estado "NO OK" no aparece en la variante excluida porque se modela poniendo peso 0 con el dato disponible; en producción la exclusión por indisponibilidad marca `degraded` y bloquea por defecto.

## 4. Conclusiones acotadas

1. La corrección de EMA50 y del volumen cambia el score de forma pequeña y simétrica con historia suficiente; su efecto principal es **exigir calidad de datos** (warm-up) y **no fabricar** componentes.
2. La asimetría observada (excluir/neutralizar volumen sube el score) respalda el bloqueo fail-closed por defecto.
3. Las conclusiones sobre MACD/ATR/RSI requieren replay con datos privados autorizados antes de cualquier cambio de convención productiva; esta medición solo descarta un impacto grande en la muestra pública.
