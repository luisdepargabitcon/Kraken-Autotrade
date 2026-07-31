# AUDITORIA GRID REV-C12 â€” Recomendaciones sin efecto y cero niveles

**Fecha:** 2026-07-30
**Veredicto:** A. BUG CONFIRMADO â€” CAMPOS FANTASMA Y GENERADOR DESCONECTADO
**RecomendaciÃ³n tÃ©cnica:** OPCION C â€” Eliminar la configuraciÃ³n de nÃºmero de niveles del flujo de recomendaciones.
**MigraciÃ³n necesaria:** No.

**Restricciones cumplidas durante la auditorÃ­a:**
- No se modificÃ³ cÃ³digo.
- No se modificÃ³ configuraciÃ³n.
- No se ejecutÃ³ ningÃºn POST.
- No se crearon rangos.
- No se generaron niveles manualmente.
- No se tocÃ³ la base de datos.
- No se crearon migraciones.
- No se hizo commit.
- No se hizo push.
- No se hizo deploy.

---

## 1. Estado del repositorio local

```text
Rama local:       review/ama-seed-v2-2-20260729
HEAD local:       9c86c148aecb980682e41ebc7719fbae3eaf7db9
origin/main:      44cd46ff3a6e195556987968a87c8e795d66cd02
git diff --check: limpio
working tree:     tracked limpio; untracked ajenos preservados
```

La rama activa no es `main`, pero los archivos de `server/services/gridIsolated/` y `client/src/components/grid/` son idÃ©nticos entre `HEAD` y `origin/main` (`git diff --name-only 44cd46f..HEAD` no devuelve diferencias en esas rutas). No se realizÃ³ checkout, reset, restore, clean, stash, rebase, add masivo, commit --amend ni push --force.

---

## 2. Estado del VPS (solo lectura)

```text
Host:     root@5.250.184.18
Ruta:     /opt/krakenbot-staging
Rama:     main
HEAD:     24518a1af91ddc64b338fffc3b250bf1414a72ec
Estado:   ?? backups/
```

**Hash desplegado en staging:** `24518a1af91ddc64b338fffc3b250bf1414a72ec`.

Las respuestas de los endpoints `GET` se guardaron temporalmente en `C:\tmp\kraken-rev-c12-staging\` y no en el repositorio.

---

## 3. ConfiguraciÃ³n runtime actual (staging)

Fragmentos extraÃ­dos de `GET /api/grid-isolated/config`:

```json
{
  "mode": "SHADOW",
  "executionPolicy": "MAKER_ONLY",
  "isActive": true,
  "netProfitTargetPct": 0.8,
  "gridStepAtrMultiplier": 0.96,
  "gridStepMinPct": 0.15,
  "gridStepMaxPct": 3.0,
  "enforceCompactRange": true,
  "gridRangeMaxPct": 2.50,
  "gridRangeControlMode": "adaptive_smart",
  "adaptiveRangeEnabled": true,
  "adaptiveRangeMinViableLevels": 8,
  "adaptiveRangeTargetFullLevels": true,
  "adaptiveRangeProfile": "balanced",
  "adaptiveRangeMinPct": 1.50,
  "adaptiveRangeMaxPct": 7.00,
  "adaptiveRangeLowVolMaxPct": 3.0,
  "adaptiveRangeNormalMaxPct": 5.5,
  "adaptiveRangeHighVolMaxPct": 7.0,
  "circuitBreakerOpen": false,
  "pumpDumpState": "normal"
}
```

**ObservaciÃ³n crÃ­tica:** `buyLevels` y `sellLevels` no existen en el objeto de configuraciÃ³n runtime.

Fragmentos de `GET /api/grid-isolated/status`:

```json
{
  "mode": "SHADOW",
  "activeRangeVersionId": null,
  "openLevels": 0,
  "plannedLevelsCount": 0,
  "activeOrdersCount": 0,
  "realOpenOrdersCount": 0,
  "historicalLevelsCount": 141,
  "isActive": true,
  "isRunning": true,
  "lastTickAt": "2026-07-31T00:36:37.833Z",
  "lastTickReason": "Condiciones de mercado no validas para Grid: Precio en banda superior â€” tendencia alcista fuerte, grid arriesgado",
  "professionalGeneratorExecuted": false,
  "marketSnapshotAvailable": true,
  "bandSnapshotAvailable": true,
  "walletAvailable": true,
  "capitalAvailable": true,
  "blockedByNoRange": true,
  "blockedByExistingLevels": true,
  "blockedByUnsuitableMarket": false
}
```

La instancia estÃ¡ en SHADOW, con 0 Ã³rdenes reales, sin rango activo y sin niveles generados en el Ãºltimo tick.

---

## 4. Eventos de recomendaciones aplicadas

Se consultaron:
- `GET /api/grid-isolated/events?limit=300`
- `GET /api/grid-isolated/export/json`
- `GET /api/grid-isolated/monitor/audit`

**Resultado:** no se encontrÃ³ ningÃºn evento `GRID_RECOMMENDATION_APPLIED` en las fuentes consultadas. Tampoco se encontraron `GRID_PROFESSIONAL_GENERATOR_COMPACT`, `GRID_PROFESSIONAL_GENERATOR_NOT_VIABLE`, `GRID_SHADOW_NO_VIABLE_RANGE`, `GRID_RANGE_PROPOSED` ni `GRID_RANGE_ACTIVATED` en la ventana de 300 eventos.

SÃ­ se encontraron eventos `EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE` con `reasonCode: EXECUTION_MARKET_CONSTRAINTS_UNAVAILABLE` y `source: REVOLUT_X_UNAVAILABLE` a intervalos de ~1 minuto, bloqueando explÃ­citamente BUY, rebuild y rangos nuevos. Ejemplo:

```json
{
  "eventType": "EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE",
  "pair": "BTC/USD",
  "message": "Precios de ejecucion no disponibles: se conservan salidas abiertas y se bloquean BUY, rebuild y rangos nuevos.",
  "metadataJson": {
    "reasonCode": "EXECUTION_MARKET_CONSTRAINTS_UNAVAILABLE",
    "source": "REVOLUT_X_UNAVAILABLE",
    "allowCycleExits": true
  },
  "createdAt": "2026-07-31T00:37:38.361Z"
}
```

Esto confirma que, ademÃ¡s del bug de configuraciÃ³n, el gate de Revolut X estÃ¡ activo y no permite construir un rango nuevo aunque la configuraciÃ³n cambiara.

---

## 5. Veredictos de hipÃ³tesis H1â€“H6

### H1 â€” CAMPOS FANTASMA: CONFIRMADO

- `RECOMMENDATION_APPLY_ALLOWLIST` contiene `buyLevels` y `sellLevels` (`server/services/gridIsolated/gridRecommendationService.ts:858-867`).
- `GridIsolatedConfig` no contiene `buyLevels` ni `sellLevels` (`server/services/gridIsolated/gridIsolatedTypes.ts:535-631`).
- `DEFAULT_GRID_CONFIG` no los contiene (`gridIsolatedTypes.ts:633-719`).
- `loadConfig()` no asigna esos campos a `this.config` (`gridIsolatedEngine.ts:187-284`); el mapeo es exhaustivo y no incluye `buyLevels`/`sellLevels`.
- `saveConfig()` no persiste esos campos (`gridIsolatedEngine.ts:736-839`); el objeto `values` es exhaustivo y no los incluye.
- El esquema `gridIsolatedConfigs` en `shared/schema.ts:1656-1747` no tiene columnas `buyLevels`/`sellLevels`.
- `applyRecommendationPatchAtomically` los aÃ±ade como propiedades dinÃ¡micas a `currentConfig` (`gridRecommendationService.ts:1025-1028`), pero `saveConfig()` los ignora.
- Tras `loadConfig()` o reinicio, las propiedades desaparecen.

### H2 â€” GENERADOR DESCONECTADO: CONFIRMADO

- `buildRangeProposal()` no consume `config.buyLevels`/`config.sellLevels`.
- Llama a `gridCapitalAllocator.allocate(..., 10, ...)` y luego fija:
  ```ts
  configuredBuyLevels: Math.floor(allocation.levelsCount / 2),
  configuredSellLevels: Math.floor(allocation.levelsCount / 2),
  ```
  (`gridIsolatedEngine.ts:1213-1239`).
- Con `levelsCount=10` y `profile.maxLevelsPerRange` que en capital profiles suele ser alto, entran 5 BUY + 5 SELL.
- `generateProfessionalGridLevels` usa `configuredBuyLevels`/`configuredSellLevels` del input, que provienen del allocator, no de la config.
- Cambiar `config.buyLevels=1`/`config.sellLevels=1` no altera lo que `buildRangeProposal` pasa al generador.

### H3 â€” CONTRADICCIÃ“N STRICT: CONFIRMADO

- `buildRangeProposal` invoca `generateProfessionalGridLevels` con `minLevelsForViableGrid: 4` y `gridViabilityMode: "strict"` (`gridIsolatedEngine.ts:1244-1252`).
- `classifyGridViability` define:
  - `0` niveles â†’ `not_viable`
  - `1` a `minLevelsForViableGrid-1` â†’ `compact`
  - `>= minLevelsForViableGrid` â†’ `viable`
  (`gridSpacingCalculator.ts:1035-1065`).
- Si caben 1 BUY + 1 SELL, `totalViableLevels=2`.
- `2 < 4` produce `status="compact"`.
- `gridViabilityMode === "strict"` convierte compact en `levels: []` (`gridSpacingCalculator.ts:608-617`).
- `buildRangeProposal` rechaza con `reasonCode: "PROFESSIONAL_GENERATOR_COMPACT"` (`gridIsolatedEngine.ts:1269-1274`).

Por tanto, la alternativa A que propone 1+1 y `expectedAfter.totalLevels=2` es incompatible con el mÃ­nimo estricto de 4.

### H4 â€” Ã‰XITO DE GUARDADO NO GARANTIZADO: CONFIRMADO

- `applyRecommendationPatchAtomically` asume que `saveConfig()` lanza un error si falla (`gridRecommendationService.ts:1031-1038`).
- `saveConfig()` en el engine captura el error, lo loguea y no lo relanza (`gridIsolatedEngine.ts:836-838`).
- El endpoint `POST /api/grid-isolated/recommendation/apply` marca `markApplied` si `applyResult.success` (`gridIsolated.routes.ts:1112-1113`), pero `applyResult.success` es `true` aunque `saveConfig` haya fallado silenciosamente.

### H5 â€” APLICAR NO ANALIZA: CONFIRMADO

- El endpoint `POST /api/grid-isolated/recommendation/apply` solo modifica `currentConfig` y llama `saveConfig`.
- No invoca `tick()`, `shadowValidate()`, `proposeRangeVersion()` ni `buildRangeProposal`.
- La respuesta JSON dice explÃ­citamente:
  `"El rango vigente y sus niveles no se han modificado."` (`gridIsolated.routes.ts:1128`).
- "Analizar mercado ahora" es la acciÃ³n separada `POST /api/grid-isolated/analyze`.

### H6 â€” GATE REVOLUT X: CONFIRMADO

- `buildRangeProposal` requiere `executionMarketSnapshot.verified && executionMarketSnapshot.fresh` y `pairConstraints.verified` (`gridIsolatedEngine.ts:1209-1210`).
- Los eventos del motor en staging muestran `EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE` con `source: REVOLUT_X_UNAVAILABLE`, bloqueando BUY, rebuild y rangos nuevos.
- El panel `GridMarketPanel.tsx` muestra si el snapshot es "Fresco" o "Desactualizado", pero no indica explÃ­citamente que el gate `verified` de `executionMarketSnapshot` y `pairConstraints` impide construir un rango.
- El diagnÃ³stico `GET /api/grid-isolated/shadow-open-cycles/diagnose` tampoco expone el estado `pairConstraints.verified` como elemento de bloqueo.

---

## 6. ReproducciÃ³n exacta local

Se ejecutÃ³ un script temporal fuera del repositorio (`C:\tmp\rev-c12-repro.mjs`) con los siguientes datos representativos:

- Banda: 3.68 %
- Rango compacto: 2.50 % â†’ semi-rango 1.25 %
- Objetivo neto: 0.80 %
- Entrada: 1.03 %
- MÃ­nimo rentable: 1.29 %
- 4 BUY + 4 SELL solicitados
- `minLevelsForViableGrid` = 4

Salida del script:

```text
A. Recommendation service: 4 BUY + 4 SELL solicitados
   Resultado: { buyCount: 1, sellCount: 1, total: 2 } viability: compact

B. generateProfessionalGridLevels con strict y min 4
   Caben: 2 => viability: compact => strict produce levels=[] si compact/not_viable

C. buildRangeProposal ignora config.buyLevels: usa levelsCount fijo desde capital allocator
   buildRangeProposal pasa Math.floor(levelsCount/2)=5 BUY + 5 SELL a generateProfessionalGridLevels en lugar de config.buyLevels=1

D. Efecto real de configurar buyLevels=1, sellLevels=1
   Con 1+1 caben: { buyCount: 1, sellCount: 1, total: 2 } viability: compact
   Pero el generador en buildRangeProposal sigue usando 5+5 de allocator â†’ 0 niveles por compact/strict.

E. Efecto despuÃ©s de reload de configuraciÃ³n
   saveConfig() no persiste buyLevels/sellLevels (no columnas en schema); loadConfig() no los carga.
   Tras reinicio, config.buyLevels undefined â†’ recommendation service vuelve a default 4+4 y repite la misma recomendaciÃ³n.
```

El script se eliminÃ³ inmediatamente despuÃ©s de ejecutarse.

---

## 7. Por quÃ© continÃºan cero niveles

La cadena causal ordenada por gravedad es:

1. **buildRangeProposal no consume `config.buyLevels`/`config.sellLevels`.** Siempre pasa 5 BUY + 5 SELL (o lo que derive de `allocation.levelsCount/2`) al generador, independientemente de la recomendaciÃ³n aceptada.
2. **El generador profesional estÃ¡ en modo `strict` con `minLevelsForViableGrid=4`.** Con el rango compacto 2.50 % y un spacing de ~1.03 %, solo caben 1 BUY + 1 SELL, lo cual lo clasifica como `compact`.
3. **`strict` convierte `compact` en 0 niveles.** `buildRangeProposal` rechaza con `PROFESSIONAL_GENERATOR_COMPACT`, por lo que el rango no se activa y no hay niveles.
4. **El gate Revolut X estÃ¡ caÃ­do.** Incluso si se resolviera lo anterior, `EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE` bloquea construir cualquier rango nuevo en staging.
5. **La persistencia de `buyLevels`/`sellLevels` es fantasma.** Aunque se aceptara la recomendaciÃ³n, no se guardarÃ­an en la base de datos; el cambio es solo en memoria hasta el prÃ³ximo reinicio.

---

## 8. Por quÃ© la recomendaciÃ³n reaparece

`buildConfigurationRecommendation` calcula `configuredBuyLevels = toNum(config?.buyLevels) ?? 4` y `configuredSellLevels = toNum(config?.sellLevels) ?? 4` (`gridRecommendationService.ts:483-484`). Dado que `config` nunca contiene `buyLevels`/`sellLevels` (no se cargan ni persisten), cada vez se parte de 4+4. El cÃ³mputo `computeSpacingAndLevels` vuelve a dar 1+1 y la alternativa A vuelve a proponer `buyLevels: 1` y `sellLevels: 1`. Como `safeToApply` solo exige `>= 1` en cada lado (`gridRecommendationService.ts:546-547`), no bloquea la oferta.

AdemÃ¡s, la alternativa A pasa `currentCalc.buyLevels`/`currentCalc.sellLevels` al cÃ³mputo `aCalc`, lo que tiende a reproducir el mismo `1+1` y el mismo `expectedAfter.totalLevels=2`, reforzando el bucle.

---

## 9. Por quÃ© los tests no lo detectaron

Matriz de cobertura frente a los defectos encontrados:

| Defecto | Tests que faltan |
|---|---|
| `buyLevels`/`sellLevels` son campos allowlist pero no existen en `GridIsolatedConfig` ni schema | No existe test de allowlist âŠ‚ configKeys âˆª schemaColumns. |
| `loadConfig`/`saveConfig` no manejan `buyLevels`/`sellLevels` | No hay test de round-trip de campos recomendados. |
| `buildRangeProposal` no consume `config.buyLevels`/`config.sellLevels` | No hay test que pase `buyLevels: 1` y verifique que el generador reciba 1+1. |
| Aplicar y recargar conserva los valores | El test `applyRecommendationPatchAtomically` usa `saveConfig` mock; no verifica persistencia real. |
| RecomendaciÃ³n 1+1 con `minLevelsForViableGrid=4` produce cero niveles | No se testea `expectedAfter.totalLevels` frente a `adaptiveRangeMinViableLevels`/`minLevelsForViableGrid`. |
| Una alternativa `safeToApply` nunca produce cero niveles | No se verifica que `safeToApply` implique `expectedAfter.totalLevels >= minLevelsForViableGrid`. |
| `saveConfig` relanza fallos de persistencia | El test de rollback usa `throw`, pero `saveConfig` real no relanza. |
| La recomendaciÃ³n no se marca `applied` si persistencia falla | El test `gridRecommendationApply` mockea `saveConfig` como `resolve(undefined)`, sin simular fallo silencioso. |
| UI explica que falta anÃ¡lisis explÃ­cito | No hay test de UI que valide el mensaje post-apply. |
| Gate Revolut X aparece en diagnÃ³stico | No hay test de `GridMarketPanel`/`diagnose` que exponga `pairConstraints.verified` o `executionMarketSnapshot.verified`. |
| No se vuelve a ofrecer recomendaciÃ³n idÃ©ntica despuÃ©s de apply real | `gridRecommendationRegistry.isApplied` se mockea, pero no se prueba con persistencia real. |

Consecuencia: el flujo `recomendaciÃ³n â†’ apply â†’ persistencia â†’ recarga â†’ siguiente recomendaciÃ³n` nunca se probÃ³ de punta a punta con los campos `buyLevels`/`sellLevels`.

---

## 10. Gate Revolut X

En staging el gate estÃ¡ bloqueado. Eventos recurrentes `EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE` con `source: REVOLUT_X_UNAVAILABLE` impiden `buildRangeProposal`. Esto es independiente del bug de configuraciÃ³n, pero es la razÃ³n operativa inmediata por la que no puede generarse rango nuevo ahora mismo.

La UI muestra "Fresco"/`Desactualizado` en `GridMarketPanel.tsx:136-138`, pero no el estado `verified`/`verified` de `executionMarketSnapshot` y `pairConstraints` que bloquea la construcciÃ³n. El diagnÃ³stico `shadow-open-cycles/diagnose` tampoco lo incluye.

---

## 11. Opciones de correcciÃ³n

### OPCION A â€” Mantener strict mÃ­nimo 4

- **Cambios:**
  - Eliminar `buyLevels` y `sellLevels` de `RECOMMENDATION_APPLY_ALLOWLIST`.
  - Bloquear alternativa A cuando `aCalc.buyLevels + aCalc.sellLevels < minLevelsForViableGrid`.
  - No mostrar la alternativa como â€œRecomendadoâ€; mostrar mensaje de espera o sugerir ampliar rango.
  - `buildConfigurationRecommendation` sigue con `configuredBuyLevels` default 4.
  - No se toca el esquema ni `GridIsolatedConfig`.
- **Schema/migraciÃ³n:** ninguna.
- **Riesgo:** bajo. Mantiene strict y rompe el ciclo de ofrecer 1+1.
- **Compatibilidad:** rompe las alternativas de ajuste de niveles, pero esas alternativas ya no tienen efecto.
- **Tests:** validar que `buyLevels`/`sellLevels` no estÃ¡n en allowlist, que alternativa A se bloquea si caben < 4 niveles, y que no se ofrece safeToApply con total < 4.
- **Efecto staging:** las recomendaciones futuras no ofrecerÃ­an 1+1; se seguirÃ­a sin rango mientras el gate Revolut X estÃ© caÃ­do.
- **Efecto ciclos histÃ³ricos:** ninguno; no se modifica DB.
- **Efecto SHADOW/MAKER_ONLY:** solo cambia recomendaciones, no ejecuciÃ³n.

### OPCION B â€” Soporte real para 1 BUY + 1 SELL

- **Cambios:**
  - Crear campos persistidos `requestedBuyLevels` y `requestedSellLevels`.
  - AÃ±adirlos a `GridIsolatedConfig`, `DEFAULT_GRID_CONFIG`, `loadConfig`, `saveConfig` y `grid_isolated_configs`.
  - MigraciÃ³n aditiva en `shared/schema.ts`.
  - Hacer que `buildRangeProposal` consuma `config.requestedBuyLevels`/`config.requestedSellLevels` en lugar del fijo 5+5 del allocator.
  - Definir interacciÃ³n con `adaptiveRangeMinViableLevels` y `minLevelsForViableGrid`.
  - 1+1 solo vÃ¡lido si la polÃ­tica mÃ­nima configurada lo permite.
  - No cambiar el mÃ­nimo de 4 a 2 sin decisiÃ³n explÃ­cita.
- **Schema/migraciÃ³n:** sÃ­, dos columnas integer y `drizzle-kit push`.
- **Riesgo:** alto. Cambia el esquema, el runtime y la semÃ¡ntica de generaciÃ³n. Requiere validar interacciÃ³n allocator/requested.
- **Compatibilidad:** alto impacto en tests y en producciÃ³n; exige migraciÃ³n atÃ³mica.
- **Tests:** round-trip load/save, generador con requested, coherencia con mÃ­nimos, persistencia real del apply.
- **Efecto staging:** requiere migraciÃ³n en DB staging; riesgo de dejar config inconsistente.
- **Efecto ciclos histÃ³ricos:** ninguno si los campos defaultean a 4.
- **Efecto SHADOW/MAKER_ONLY:** mayor flexibilidad, pero tambiÃ©n mayor riesgo de configurar un grid inviable.

### OPCION C â€” Eliminar configuraciÃ³n de nÃºmero de niveles

- **Cambios:**
  - Eliminar `buyLevels`/`sellLevels` de `RECOMMENDATION_APPLY_ALLOWLIST`.
  - Eliminar recomendaciones que propongan ajuste de `buyLevels`/`sellLevels`.
  - `buildConfigurationRecommendation` deja de usar `configuredBuyLevels`/`configuredSellLevels`; el recommendation service puede reportar `currentCalc` para informaciÃ³n, pero no ofrecerlo como parÃ¡metro configurable.
  - El allocator continÃºa siendo la Ãºnica fuente de `levelsCount`.
  - Recomendar Ãºnicamente campos reales: `gridRangeMaxPct`, `gridStepAtrMultiplier`, `gridStepMinPct`, `gridStepMaxPct`, `netProfitTargetPct`.
  - No se tocan `GridIsolatedConfig`, schema, `loadConfig` ni `saveConfig`.
- **Schema/migraciÃ³n:** ninguna.
- **Riesgo:** bajo/medio. Simplifica el modelo mental y elimina campos fantasma. Puede requerir ajustar textos de UI/tests.
- **Compatibilidad:** media. Rompe tests de `buyLevels`/`sellLevels` que se basan en recomendaciones que se eliminarÃ¡n.
- **Tests:** quitar asserts de buyLevels/sellLevels, aÃ±adir tests de que solo campos reales son allowlisted y recomendados.
- **Efecto staging:** inmediato si se despliega; no requiere migraciÃ³n.
- **Efecto ciclos histÃ³ricos:** ninguno.
- **Efecto SHADOW/MAKER_ONLY:** elimina un parÃ¡metro inoperante; el sistema se vuelve mÃ¡s predecible.

---

## 12. RecomendaciÃ³n tÃ©cnica

**Elegir OPCION C.**

JustificaciÃ³n:
- `buyLevels`/`sellLevels` no estÃ¡n implementados como parÃ¡metros reales del generador ni se persisten.
- Mantenerlos en allowlist y recomendaciones (Opcion A) sigue generando confusiÃ³n sin efecto prÃ¡ctico.
- Implementar persistencia real y cambiar el generador (Opcion B) es correcto conceptualmente, pero introduce una migraciÃ³n de esquema y un rediseÃ±o de la relaciÃ³n allocator/solicitado que escapa al alcance del bug y aumenta el riesgo en staging.
- La Opcion C elimina el campo fantasma, deja que el allocator sea la Ãºnica fuente de verdad y recomienda solo parÃ¡metros que sÃ­ afectan el grid. Es la correcciÃ³n mÃ¡s segura y mÃ­nima.

---

## 13. MigraciÃ³n necesaria

**No.** La Opcion C no requiere cambios en esquema ni en base de datos. Es una correcciÃ³n pura de cÃ³digo y tests.

---

## 14. Plan de tests

1. Eliminar tests que asumen `buyLevels`/`sellLevels` en allowlist/recomendaciÃ³n.
2. AÃ±adir test: `RECOMMENDATION_APPLY_ALLOWLIST` solo contiene claves que existen en `GridIsolatedConfig` y en `gridIsolatedConfigs`.
3. AÃ±adir test: `buildConfigurationRecommendation` no propone `buyLevels`/`sellLevels` ni los incluye en `changedFields`.
4. AÃ±adir test: `buildRangeProposal` deriva `configuredBuyLevels`/`configuredSellLevels` del allocator, no de `config`.
5. AÃ±adir test: alternativa `safeToApply` implica `expectedAfter.totalLevels >= min(adaptiveRangeMinViableLevels, minLevelsForViableGrid)`.
6. AÃ±adir test: `saveConfig` real relanza el error o `applyRecommendationPatchAtomically` detecta fallo silencioso.
7. AÃ±adir test: UI `GridRecommendationDialog` no muestra alternativas de ajuste de niveles tras la correcciÃ³n.
8. AÃ±adir test de integraciÃ³n: secuencia `recomendaciÃ³n â†’ apply â†’ recarga` no repite la misma recomendaciÃ³n.

---

## 15. Riesgos

- **Riesgo de UX:** los usuarios esperaban poder â€œajustarâ€ el nÃºmero de niveles. Eliminar la opciÃ³n requiere comunicar que el allocator y el rango controlan el nÃºmero real.
- **Riesgo residual H6:** aunque se corrija el bug de configuraciÃ³n, el gate Revolut X sigue bloqueando rangos en staging. Es un problema operativo externo al alcance de esta correcciÃ³n.
- **Riesgo de tests rotos:** mÃºltiples tests existen con `buyLevels`/`sellLevels`; deben actualizarse antes de que la suite vuelva a verde.
- **Riesgo de H4:** `saveConfig` del engine sigue sin relanzar errores; aunque la Opcion C elimina los campos fantasma, el patrÃ³n catch-silencioso podrÃ­a afectar otros campos. Se recomienda abordarlo como tarea separada.

---

## 16. Confirmaciones finales

- **No se realizaron cambios en el cÃ³digo fuente.**
- **No se ejecutÃ³ ninguna peticiÃ³n `POST`, `PUT`, `PATCH` ni `DELETE` en staging.**
- **No se ejecutÃ³ SQL ni se modificÃ³ la base de datos.**
- **No se crearon migraciones de base de datos.**
- **No se generaron niveles ni rangos reales.**
- **No se hizo commit.**
- **No se hizo push.**
- **No se hizo deploy.**
- Los archivos temporales de staging en `C:\tmp\kraken-rev-c12-staging\` pueden eliminarse a discreciÃ³n del operador; no forman parte del repositorio.

---

## 17. Informe final Ãºnico

**Veredicto:** A. BUG CONFIRMADO â€” CAMPOS FANTASMA Y GENERADOR DESCONECTADO.

**Causas ordenadas por gravedad:**
1. `buildRangeProposal` ignora `config.buyLevels`/`config.sellLevels` y usa 5+5 fijos del allocator.
2. El generador profesional en `strict` con `minLevelsForViableGrid=4` convierte 2 niveles viables en 0 niveles.
3. `buyLevels`/`sellLevels` estÃ¡n en la allowlist pero no en el tipo, default, carga, guardado ni esquema; son propiedades fantasma.
4. `buildConfigurationRecommendation` parte siempre de 4+4, reproduce la misma oferta 1+1 y la vuelve a presentar.
5. `saveConfig` no relanza errores, por lo que un apply puede parecer exitoso sin persistencia.
6. El gate Revolut X (`executionMarketSnapshot`/`pairConstraints`) estÃ¡ bloqueado en staging y no permite construir rango nuevo.

**Valores exactos de staging:**
- Modo: `SHADOW`
- `executionPolicy`: `MAKER_ONLY`
- `realOpenOrdersCount`: 0
- `openLevels`: 0
- `activeRangeVersionId`: null
- `gridRangeMaxPct`: 2.50 %
- `adaptiveRangeMinViableLevels`: 8
- `gridStepAtrMultiplier`: 0.96
- `netProfitTargetPct`: 0.8 %
- `buyLevels`/`sellLevels`: ausentes en config

**Evidencia de eventos:**
- Eventos `EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE` recurrentes con `source: REVOLUT_X_UNAVAILABLE` en staging.
- Ausencia de `GRID_RECOMMENDATION_APPLIED` en ventanas de 300 eventos, export y audit.

**OpciÃ³n recomendada:** Opcion C.

**Archivos que requerirÃ­a la correcciÃ³n:**
- `server/services/gridIsolated/gridRecommendationService.ts` (allowlist y lÃ³gica de alternativas).
- `server/services/gridIsolated/gridRecommendationRegistry.ts` (posiblemente fingerprints).
- `client/src/components/grid/GridRecommendationDialog.tsx` (textos y alternativas).
- `server/services/__tests__/gridRecommendationService.test.ts`
- `server/services/__tests__/gridRecommendationValidation.test.ts`
- `server/services/__tests__/applyRecommendationPatchAtomically.test.ts`
- `server/routes/__tests__/gridRecommendationApply.test.ts`
- `client/src/components/grid/GridRecommendationDialog.test.tsx`

**Necesidad de migraciÃ³n:** No.

**Tests necesarios:** ver Plan de tests, secciÃ³n 14.

**Riesgos:** ver secciÃ³n 15.

**ConfirmaciÃ³n de cero modificaciones:** ver secciÃ³n 16.
