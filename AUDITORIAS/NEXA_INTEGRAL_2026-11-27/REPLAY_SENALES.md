# REPLAY DE SEÑALES IDCA CON VELAS PÚBLICAS (orden #22 §7 / #19 §2) — NO CONCLUYENTE

**Reproducir:** `npx tsx scripts/idca_signal_replay.ts` (offline sobre el snapshot de `data_public/replay/`; `--fetch` vuelve a descargar ≈12 peticiones públicas a Bitstamp). Resultados completos: `REPLAY_SENALES_RESULTADOS.json`. Hashes SHA-256 de ambas series en el propio JSON.

## 0. Qué es y qué NO es (leer primero)

- **Es** un replay a nivel de **señal de entrada**: con las mismas condiciones simplificadas se comparan las variantes técnicas de rebote (A1a/A1b/A1c) y del score de mercado (A2) frente al comportamiento actual (A0), midiendo lo que ocurre **después** de cada señal (retorno a 24/72/168 h, MAE y MFE a 168 h).
- **No es** replay de ciclos: sin configuración real, capital, niveles, safety/PLUS/recovery, TP/trailing/stop, comisiones, slippage, cartera ni utilización. **No hay PnL real, drawdown de cartera ni capital inmovilizado.** El replay con la copia **privada** autorizada (ciclos, órdenes y configuración histórica de #19) **sigue pendiente**: en este entorno solo existe un puntero vacío (4 KB) y ninguna exportación de ciclos; se solicita únicamente acceso por canal privado a la copia ya existente.
- Las ramas **B (confluencia), C (rebote/trailing canónico) y D (safety/ATRP)** requieren la configuración y el estado reales del motor: **no son replicables a nivel de señal con datos públicos** y no se han medido aquí (sus tests de comportamiento están en los paquetes WP7b/WP7c).
- **No se aprueba ninguna estrategia** y no se afirma rentabilidad. Todo lo experimental sigue OFF por defecto y solo se aplica en simulación bajo política versionada.

## 1. Datos y reglas del replay

- **Fuente:** Bitstamp USD 1h (proxy de la serie Kraken; divergencia media de cierre ≈0,01–0,02 % en `ESTUDIO_FUENTES_SECUNDARIAS.md`). BTC/USD y ETH/USD, 6.000 velas cada una (2026-03-22T23:00Z → 2026-11-27T22:00Z, ≈250 días), contiguas (0 huecos), sin interpolar. Señales sobre ETH/USD con contexto BTC.
- **Reloj determinista:** el instante de decisión es el **cierre** de la vela *i*; solo se usan velas cerradas ≤ *i*. La entrada hipotética es la **apertura de la vela *i*+1** (latencia de 1 vela; no se ejecuta al cierre ya conocido). Señales sin horizonte completo quedan **censuradas** y se cuentan aparte.
- **Condición de entrada simplificada (proxy):** caída ≥ X % desde el máximo de 7 días (X ∈ {2, 3, 5}) **y** score de mercado ≥ 50 **y** rebote (según brazo). *Cooldown* idéntico de 24 h por brazo. Warm-up de 200 velas.
- **Brazos:** A0 = rebote legacy + score ANTIGUO (réplica del cálculo previo); A1a = geometría de mecha corregida; A1b = desaceleración con caída real; A1c = ambas + confirmación (`recovery && (mecha || desaceleración)`); A2 = score NUEVO (EMA50 real con warm-up, volumen relativo causal, estado de calidad; `degraded/unavailable` ⇒ no entra) con rebote legacy; A1c+A2.
- **Constantes entre brazos:** mismos datos, mismo umbral de caída, mismo cooldown, misma latencia y mismos horizontes. No se ajustó ningún parámetro sobre los resultados.
- **Periodos:** primer 60 % (calibración, solo descriptivo) y último 40 % (validación cronológica); no se optimizó sobre ninguno.
- **Incertidumbre:** IC bootstrap al 95 % de la diferencia de retorno medio a 72 h frente a A0 (semilla fija). Las señales se solapan y son dependientes: **los IC son orientativos y optimistas.**

## 2. Comprobación de cordura del replay (sobre las 5.800 velas evaluables)

- El rebote **legacy** es verdadero en **4.172 de 5.800 velas (72 %)**: el filtro actual es muy permisivo.
- La corrección de mecha (A1a) cambia la *razón* «mecha» en 1.862 velas pero el **resultado** del rebote solo en **7 velas (0,12 %)**: casi siempre ya confirma la condición de recuperación. Por eso A1a produce **las mismas señales que A0** en este conjunto (0 evitadas, 0 añadidas).
- A1b cambia el resultado en 205 velas (3,5 %); A1c en 2.297 (40 %) porque exige confirmación con recuperación y apoyo.

## 3. Resultados (caída mínima 3 %; los de 2 % y 5 % están en el JSON y son cualitativamente iguales)

| Brazo | Señales | Cens. | Retorno medio 72 h | Mediana 72 h | % ganadoras 72 h | MAE medio 168 h | MFE medio 168 h | Calibración (n / media 72 h) | Validación (n / media 72 h) |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| A0 legacy | 151 | 5 | −0,14 % | +0,21 % | 53,4 % | −6,06 % | +5,38 % | 83 / +0,18 % | 68 / −0,55 % |
| A1a mecha | 151 | 5 | −0,14 % | +0,21 % | 53,4 % | −6,06 % | +5,38 % | 83 / +0,18 % | 68 / −0,55 % |
| A1b desaceleración | 151 | 5 | −0,14 % | +0,21 % | 53,4 % | −6,06 % | +5,38 % | 83 / +0,18 % | 68 / −0,55 % |
| A1c combinado | 129 | 4 | −0,24 % | +0,12 % | 52,0 % | −6,13 % | +5,44 % | 73 / +0,40 % | 56 / −1,15 % |
| A2 score nuevo | 155 | 5 | +0,05 % | +0,28 % | 54,0 % | −5,94 % | +5,44 % | 88 / +0,68 % | 67 / −0,84 % |
| A1c + A2 | 133 | 4 | −0,35 % | -0,03 % | 49,6 % | −6,10 % | +5,22 % | 75 / +0,17 % | 58 / −1,06 % |

Frente a A0 (caída 3 %), IC bootstrap 95 % de la diferencia de retorno medio a 72 h:

| Brazo | Evitadas | Añadidas* | Mantenidas | IC95 % diferencia media 72 h |
|---|---:|---:|---:|---|
| A1a | 0 | 0 | 146 | [−0,98 ; +0,98] |
| A1b | 1 | 1 | 145 | [−0,98 ; +0,98] |
| A1c | 105 | 84 | 41 | [−1,15 ; +0,90] |
| A2 | 71 | 75 | 75 | [−0,90 ; +1,25] |
| A1c + A2 | 119 | 102 | 27 | [−1,24 ; +0,84] |

\* «Añadidas» incluye señales que aparecen por el desplazamiento temporal del *cooldown*, no solo señales nuevas por mejor criterio.

## 4. Lectura honesta

1. **Ninguna variante muestra una diferencia estadísticamente distinguible de A0**: todos los IC incluyen el cero y son anchos (≈±1 punto porcentual) con 100–150 señales dependientes.
2. **A1a y A1b son correcciones matemáticas de bajo impacto** (7 y 205 velas de 5.800; 0–5 señales); no hay evidencia de efecto económico, ni a favor ni en contra.
3. **A1c reduce las señales ≈15 %** (151 → 129) y cambia la composición, pero en este conjunto no mejora el retorno medio (−0,24 % vs −0,14 %) ni reduce el MAE de forma relevante: **es un cambio de política sustancial sin beneficio demostrado → se mantiene OFF.**
4. **A2** (score con calidad) deja un número parecido de señales con composición distinta (71 evitadas / 75 añadidas); su retorno medio es algo mejor pero dentro del ruido. Su valor principal es de **calidad y honestidad de datos** (no fabricar EMA50/volumen), no de rentabilidad demostrada.
5. **Dependencia de régimen:** todos los brazos son ligeramente positivos en el primer 60 % y negativos en el último 40 % (retornos medios a 72 h entre −0,55 % y −1,15 %): el resultado depende del régimen de mercado de la ventana, lo que refuerza que una sola ventana de ≈250 días no permite concluir.
6. **Conclusión: NO CONCLUYENTE.** Se conservan las correcciones técnicas probadas (A1a, A1b, A2) como candidatas desactivadas por defecto y la política económica actual; no se activa ninguna variante. Los siguientes pasos que requieren autorización/datos privados: replay de ciclos completos con configuración histórica, fees reales y calibración/validación fuera de muestra con el dataset autorizado (#19).
