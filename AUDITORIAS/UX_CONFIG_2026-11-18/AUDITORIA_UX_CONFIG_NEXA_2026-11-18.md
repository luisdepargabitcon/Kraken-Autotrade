# AUDITORÍA UX / CONFIGURACIONES / LEGACY / DATOS / APK — NEXA

**Issue:** Kraken-Autotrade #12  
**Fecha:** 2026-11-18 UTC  
**Tipo:** auditoría documental y solo lectura. **No se implementó ninguna solución.**  
**Auditor:** Devin/Cascade  
**Repositorio:** `luisdepargabitcon/Kraken-Autotrade`

## 0. Versiones auditadas

| Elemento | Valor confirmado |
|---|---|
| Rama realmente desplegada en VPS | `integration/staging-spot-v4` |
| SHA desplegado | `3ae18319b8c0b68c9374241db65f8ef9bdd39a57` |
| Commit desplegado | `fix(spot): remove unrelated AI and shared DB drift from V4 staging` |
| `origin/main` auditado | `3797cc99cd335b1a7f1bc0ae86079282486705a5` |
| Divergencia Git | `main` tiene 6 commits no presentes en runtime; runtime tiene 103 commits no presentes en `main` |
| Panel runtime | `http://5.250.184.18:3020` |
| Contenedores relevantes | `krakenbot-staging-app`, `krakenbot-staging-db`; también existen otros proyectos en el mismo host, fuera de alcance |
| Modos runtime observados | SPOT canónico `SHADOW`; IDCA `simulation`; Grid `SHADOW`; AMA `OFF/OBSERVING`; legacy normal bot `isActive=true` pero en supervisor-only según código desplegado |
| Exchanges | `tradingExchange=revolutx`, `dataExchange=kraken`, `activeExchange=revolutx` |

**Método:** inspección Git de `origin/main` y `origin/integration/staging-spot-v4`, endpoints HTTP `GET` de solo lectura, SSH de solo lectura para SHA/procesos/espacio, y revisión estática de UI/rutas/servicios. No se usaron `POST/PATCH/DELETE` operativos, no se consultó PostgreSQL en esta pasada y no se pulsaron controles mutables. La revisión visual fue estática/responsive inferida desde código; no se ejecutó automatización de navegador en esta sesión.

## 1. Resumen ejecutivo

NEXA ha crecido por acumulación de módulos y versiones: el VPS **no ejecuta `main`**, sino una rama de staging muy adelantada que contiene el motor SPOT canónico, Entry V4, research, Grid V3.1/V3.2, IDCA híbrido, AMA y una gran superficie de auditoría/exportación. `main` sigue teniendo rutas antiguas (`/trading`, `/terminal`, `/strategies`) mientras la rama desplegada redirige a `/spot` y elimina `Terminal.tsx`.

La principal oportunidad de simplificación no es “borrar pantallas”, sino **separar presentación de operación**: un modo Básico para estado, alertas, cartera y resultados; un modo Pro para diagnóstico, parámetros, backtests, logs, Grid/IDCA/AMA/FISCO. Ambos deben leer el mismo backend y los mismos valores efectivos.

Hallazgos principales:

1. **CONFIRMADO EN RUNTIME:** versión desplegada distinta de `main`; cualquier mejora debe decidir primero la rama de verdad.
2. **CONFIRMADO EN RUNTIME/CÓDIGO:** panel API accesible sin autenticación y publicación de puertos; prerrequisito P0 para APK/panel remoto.
3. **CONFIRMADO EN CÓDIGO:** múltiples capas de configuración coexisten: `bot_config`, `api_config`, `trading_config`/presets, `institutional_dca_*`, `grid_isolated_configs`, `market_metrics_config`, `smart_exit_config`, `time_stop_config`, `telegram_*`, `portfolio_*`, tablas AMA y FISCO.
4. **CONFIRMADO EN CÓDIGO:** hay parámetros duplicados o solapados: riesgo global en `bot_config` y `trading_config`; capital por motor en IDCA/Grid/AMA/portfolio; comisiones en Grid, SmartExit, IDCA simulation y fee model de SPOT; spreads en `bot_config` y `exchangeConfigSchema`.
5. **CONFIRMADO EN CÓDIGO:** existen pantallas legacy (`Dashboard`, `Terminal` en `main`, `Strategies`, `Notifications` redirect, `AiMl.tsx.backup`) y rutas ocultas no enlazadas (`/dashboard-legacy`, tabs IDCA sin trigger visible).
6. **CONFIRMADO EN RUNTIME:** Grid está SHADOW pero con 1 ciclo histórico abierto/review y bloqueo actual por precio en banda inferior; IDCA está en simulación con capital asignado y dos pares habilitados; SPOT está SHADOW con todos los pares activos pero bloqueado por macro 4h bearish en el último scan observado.
7. **CONFIRMADO EN CÓDIGO/RUNTIME PREVIO:** el bucle OOM de `spotAiDurableTrainingStore` seguía siendo el principal riesgo de estabilidad; en esta sesión `/api/health` mostró uptime de ~123 s, compatible con reinicios recientes.
8. **HIPÓTESIS:** la complejidad UX se debe a que cada motor añadió su propio panel completo antes de existir un design system y una SSOT de configuración.
9. **RECOMENDACIÓN:** no unificar cálculos distintos; unificar primero **fuente de verdad, visibilidad del valor efectivo y navegación**, dejando parámetros específicos por motor en Pro.
10. **APK:** viable, pero solo después de autenticación/sesiones/2FA y API estable; la opción más razonable es PWA responsive primero y, si se justifica distribución nativa, TWA/Capacitor sobre el mismo frontend.

## 2. Inventario de pantallas y rutas

### 2.1 Mapa actual desplegado (`integration/staging-spot-v4 @ 3ae18319`)

| Ruta | Página | Función real | Estado | Problema UX principal | Propuesta |
|---|---|---|---|---|---|
| `/` | `NexaHome` | Tarjetas a DCA, SPOT, FISCAL, AMA, GRID + enlaces sistema | Activa | “Trading Activo” enlaza a `/trading` que redirige a `/spot`; métricas mezclan motores | Renombrar a Motores y mostrar estado por motor real |
| `/dca`, `/institutional-dca` | `InstitutionalDca` | Panel IDCA con tabs Panel/Ciclos/Config/Hybrid/Historial/Alertas/Ayuda + tabs legacy ocultos | Activa | Muchos subajustes y tabs ocultos; duplicidad con Telegram IDCA | Básico: estado/ciclos; Pro: configuración avanzada |
| `/spot` | `Spot` | Motor SPOT canónico: Resumen, Contexto, Pares, Posiciones, Historial, Intents, Auditoría, Actividad, Terminal, IA Forward Twin | Activa | Muy densa; mezcla operación, terminal, IA y auditoría | Básico: salud/posiciones/resultados; Pro: terminal/intents/auditoría/IA |
| `/grid-isolated` | `GridIsolated` | Config, estado, niveles, ciclos, monitor/audit, backtest, exports | Activa | Muchos controles técnicos y acciones powerful | Básico: modo/estado/bloqueo; Pro: parámetros/diagnóstico |
| `/ama` | `Ama` | AMA Lab/Shadow/Real/Monitor/Events/Ledger/Help | Activa pero motor OFF | Superficie grande para un motor inactivo | Ocultar en Básico salvo estado “inactivo” |
| `/fiscal`, `/fisco` | `FiscoDashboard` | Informes, operaciones, alertas, rebuild, conciliación | Activa, dominio protegido | Muy compleja y sensible | Separar con permiso reforzado; fuera del modo Básico normal |
| `/dashboard-legacy` | `Dashboard` | Dashboard antiguo | Legacy accesible por enlace pequeño | Duplica estado y puede confundir | Mantener solo en Pro/archivo hasta validar consumidores |
| `/telegram` | `Telegram` | Config, tokens, canales, alertas por modo, comandos, auditoría | Activa | Enorme; solapa alertas de cada motor | Básico: solo estado de alertas; Pro: administración completa |
| `/settings` | `Settings` | Config global, feature flags, retención, IA/ML y ajustes | Activa | Mezcla ajustes globales con IA y mantenimiento | Crear centro único de ajustes con alcance visible |
| `/terminal` | redirect `/spot` | Ruta antigua | Redirect | Evita ruptura pero confunde a usuarios antiguos | Mantener redirect documentado |
| `/wallet` | `Wallet` | Balances exchanges + cartera global | Activa | Puede leerse como saldo total sin separar modos | Mostrar solo lectura consolidada; reservas por modo en Pro |
| `/integrations` | `Integrations` | API keys/conexiones exchange/Telegram | Activa | Riesgo si se expone en móvil sin auth | Restringir a Pro/seguro |
| `/notifications` | redirect `/telegram` | Alertas | Redirect | Duplica concepto Telegram | Unificar nombre “Alertas” |
| `/guide` | `Guide` | Documentación | Activa | Poca prioridad en operación diaria | Mover a Ayuda/Pro |
| `/monitor` | `Monitor` | Logs, eventos, market-data stats, rate limiter | Activa | Técnico y denso | Básico: incidentes; Pro: logs completos |
| `/backups` | `Backups` | Crear/restaurar backups | Activa | Acciones destructivas en UI | Pro + confirmación fuerte |
| `/ai` | `AiMl` | IA legacy/shadow | Activa | Solapa con Spot AI Forward Twin y Autotuning | Pro; evaluar legacy |
| `/autotuning` | `Autotuning` | Métricas, perfiles, propuestas | Activa | Proceso de ML poco visible en flujo principal | Pro |
| `/trading`, `/strategies` | redirects `/spot` | Compatibilidad | Redirect | Rutas legacy | Mantener por compatibilidad |

### 2.2 Diferencias `main` vs runtime

| Elemento | `main @ 3797cc9` | Runtime `3ae18319` |
|---|---|---|
| `/spot` | No existe página/ruta SPOT canónica | Existe `client/src/pages/Spot.tsx` y muchos componentes `spot/*` |
| `/terminal` | Página `Terminal.tsx` activa | Eliminada; redirect a `/spot` |
| `/trading`, `/strategies` | Página `Strategies.tsx` activa | Redirect a `/spot` |
| Motor SPOT canónico | Ausente en `main` | Presente (`server/services/spot/*`) |
| SPOT AI Forward Twin | Ausente | Presente (`spotAiForwardTwin/*`, rutas `/api/spot/ai/*`) |
| Grid V3.1/V3.2 | No desplegado en `main` | Presente en runtime |
| Documentación reciente | Incluye órdenes VPS→Google y auditorías nuevas | Basada en septiembre; no incluye docs de noviembre |

**Conclusión:** `main` no representa el producto desplegado. Cualquier PR documental debe declarar esta divergencia; no mezclar cambios de runtime con `main` sin una decisión de integración.

## 3. Mapa de navegación actual y propuesto

### Actual

`HOME → mundos DCA/SPOT/FISCAL/AMA/GRID → sistema Telegram/APIs/Settings/Backups/Guide`. Mobile bottom bar solo muestra Home, DCA, SPOT, Fiscal, Sistema. El resto queda detrás del menú hamburguesa o enlaces secundarios.

### Propuesto conceptual

**Modo Básico — 5 apartados:**
1. **Inicio:** estado global, alertas críticas, PnL real vs simulado separado, última decisión explicada.
2. **Motores:** SPOT, IDCA, Grid, AMA como tarjetas con modo, salud, bloqueo y última acción.
3. **Cartera:** balances por exchange, reservas por modo, exposición y reconciliación resumida.
4. **Operaciones:** historial unificado con filtros por motor/modo/resultado/motivo.
5. **Alertas:** bloqueos, errores, avisos Telegram y explicación en lenguaje sencillo.

**Modo Pro — conserva todo:** Terminal, Contexto, Intents, Auditoría, Actividad, IA Forward Twin, Grid niveles/backtest/export, IDCA config avanzada, AMA Lab/Real/Shadow, Monitor logs, Autotuning, Integraciones, Backups y FISCO con permiso reforzado.

Regla: cambiar Básico↔Pro es solo `presentationMode`; no toca `spot_execution_mode`, `mode` IDCA, `mode` Grid, autorización AMA, capital ni `REAL/SHADOW/SIMULATION`.

## 4. Diez defectos UX de mayor impacto

| # | Defecto | Evidencia | Riesgo | Reproducción conceptual |
|---|---|---|---|---|
| 1 | No hay modo Básico/Pro; toda la complejidad es visible | `App.tsx`, `Nav.tsx`, páginas densas | Usuario normal no distingue operación de diagnóstico | Abrir `/` en móvil y ver 15 rutas de sistema |
| 2 | `NexaHome` muestra “Trading Activo” pero lleva a `/trading`→`/spot` | `NexaHome.tsx`, `App.tsx` | Expectativa rota | Pulsar tarjeta Trading Activo |
| 3 | SPOT mezcla 10 tabs: resumen, contexto, pares, posiciones, historial, intents, auditoría, actividad, terminal, IA | `Spot.tsx` | Sobrecarga y scroll horizontal | Abrir `/spot` en 360px |
| 4 | IDCA tiene tabs visibles + tabs legacy ocultos (`simulation`, `events`, `legend`, `guide`) | `InstitutionalDca.tsx` | Funciones invisibles o confusas | Revisar tabs sin trigger |
| 5 | Config global, feature flags, IA/ML y retención comparten `/settings` | `Settings.tsx`, `config.ts` | Difícil saber qué gobierna cada valor | Abrir Sistema |
| 6 | Grid muestra controles técnicos sin una “razón única de bloqueo” por tick | `GridIsolated.tsx`, `gridIsolated.routes.ts`, auditoría previa | Usuario no sabe por qué no opera | Grid status `lastTickReason` técnico |
| 7 | Telegram central contiene alertas por modo de todos los motores | `Telegram.tsx` y tabs | Duplicidad con alertas dentro de cada motor | Comparar `/telegram` con tabs IDCA/Grid |
| 8 | Wallet muestra balances pero no separa claramente reservas/modos | `Wallet.tsx`, portfolio routes | Riesgo de interpretar capital disponible | Abrir `/wallet` |
| 9 | Existen rutas legacy y archivos backup (`AiMl.tsx.backup`, `Dashboard`, `Terminal` en main) | `App.tsx`, tree | Confusión de versión y mantenimiento | Comparar main/runtime |
| 10 | Mensajes técnicos/estados mezclan español e inglés y términos internos | componentes `reasonCode`, labels AMA/Grid | Baja comprensibilidad | Revisar estados `SHADOW`, `MAKER_ONLY`, `NOT_VIABLE` |

## 5. Auditoría maestra de configuraciones — resumen

La matriz completa está en `MATRIZ_CONFIGURACIONES_NEXA_2026-11-18.csv`. Resumen por dominio:

| Dominio | Persistencia principal | Controles UI principales | Valor runtime no sensible | Categoría dominante | Decisión propuesta |
|---|---|---|---|---|---|
| Global legacy bot | `bot_config` | `/settings`, `/strategies` en main | `isActive=true`, `dryRunMode=true`, `riskLevel=high`, spreads y gates activos | COMPARTIDO/LEGACY | Mantener como fuente legacy supervisada; no usar como única verdad |
| Config versionada | `trading_config`, `config_preset`, `config_change` | `/api/config/*`, posible Config Dashboard | `hasActiveConfig=true`; feature flags parcialmente activos | DUPLICADO/NO CLARAMENTE CONSUMIDO | Auditar consumo real antes de unificar |
| Exchanges/API | `api_config` | `/integrations`, `/settings` | `tradingExchange=revolutx`, `dataExchange=kraken` | ÚNICO pero sensible | Mantener separado; nunca en APK |
| SPOT canónico | `bot_config.spot_*`, toggles por par, constantes V4 | `/spot` | `SHADOW`, capital shadow 10.000 USD, 5 pares activos, Entry V4 activo score≥0.30 | ÚNICO + parámetros fijos en código | Mantener motor; exponer solo modo/pares en UI |
| IDCA | `institutional_dca_config`, `institutional_dca_asset_configs`, `trading_engine_controls` | `/dca` | `enabled=true`, `mode=simulation`, capital 2.000 USD, BTC/ETH activos | COMPARTIDO + muchos JSON | Unificar pantalla; mantener semántica por par |
| Grid | `grid_isolated_configs` | `/grid-isolated` | `SHADOW`, `MAKER_ONLY`, capital profile aggressive, BTC/USD | ÚNICO pero denso | Básico/Pro; reason-code único propuesto |
| AMA | tablas AMA + mandate/policy | `/ama` | `OFF/OBSERVING`, sin capital desplegado | INACTIVO/LAB | Mantener Pro; no mostrar en Básico |
| Market metrics | `bot_config.market_metrics_config` | `/ai`, `/settings`, tabs MarketMetrics | enabled, modo activo, applyToBuy/Sell, sensibilidad conservador | COMPARTIDO dudoso | Verificar consumidores antes de unificar |
| SmartExit legacy | `bot_config.smart_exit_config` | `/ai`, `/settings`, Telegram SmartExit | enabled=true, master custom, thresholds | LEGACY/compartido con motor viejo | No unificar con SPOT canónico sin prueba |
| TimeStop | `time_stop_config` | `/settings`, componentes TimeStop | reglas por par BTC/ETH/SOL/XRP | ÚNICO pero solapa adaptiveExit | Mantener independiente hasta mapear consumidores |
| Telegram | `telegram_*`, `api_config.telegram_*`, IDCA/Grid/FISCO toggles | `/telegram`, tabs por motor | conectado=true; chat IDs ocultos | DUPLICADO real de superficie | Unificar centro de alertas sin fusionar reglas |
| Portfolio | `portfolio_*`, `strategy_capital_reservations` | `/wallet`, `/api/portfolio/*` | mayormente vacío según auditoría previa | INCOMPLETO/SSOT candidata | Proponer SSOT conceptual, no aplicar |
| FISCO | `fisco_*` | `/fiscal` | dominio protegido; no auditado en profundidad | PROTEGIDO | Separar y no tocar |

### Categorización transversal

- **ÚNICO:** modo SPOT, capital shadow SPOT, configuración Grid, mandatos AMA, reglas FISCO.
- **COMPARTIDO:** balances/exchanges, market data, Telegram global, portfolio/reservas.
- **DUPLICADO REAL:** controles de alertas Telegram por motor vs centro Telegram; posibles capitales por motor sin cartera consolidada.
- **MISMO NOMBRE OTRA SEMÁNTICA:** `trailing`, `stop`, `capital`, `mode`, `simulation` varían por motor.
- **OBSOLETO PROBABLE:** `Dashboard`, `Terminal` en `main`, `AiMl.tsx.backup`, rutas `/trading`/`/strategies` como destino real en `main`.
- **SIN EFECTO / NO VERIFICADO:** parte de `trading_config`, autotuning profiles/proposals, algunos tabs ocultos IDCA, exportaciones no consumidas.

## 6. Fuentes de datos e indicadores

### Dataflow actual resumido

```text
Kraken public market ─┐
Revolut X market ──────┼─> ExchangeFactory (trading/data exchange)
DB market_candles ─────┘        │
                                v
                    MarketDataService cache TTL
                    - getCandles(pair, tf)
                    - getCandlesFinalizedAware(pair, tf) [SPOT]
                    - getPrice/getTicker/getFreshTickerSnapshot
                                │
        ┌───────────────────────┼────────────────────────┐
        v                       v                        v
 SPOT canonical          IDCA / IDCA Hybrid        Grid Isolated
 buildSpotMarketContext  MarketDataService         getFreshTickerSnapshot + OHLC
 closedCandleContract    IdcaOHLC cache             band/regime/projection
 V4 Entry / Exit         VWAP anchors               maker/taker policy
        │                       │                        │
        v                       v                        v
 trades/order_intents   institutional_dca_*      grid_isolated_*
 spot_forward_twin_*    simulation wallet        events/levels/cycles
        │
        v
 Spot AI Forward Twin / research / replay
```

### Hallazgos de datos

1. `MarketDataService` ya es un gateway parcial con TTL, single-flight, fallback a `market_candles` y provenance `KRAKEN_MARKET_DATA`; es la base correcta para una SSOT.
2. SPOT usa `getCandlesFinalizedAware` para no usar vela en formación en señales; IDCA/Grid usan rutas propias de velas/cache. La diferencia es legítima, pero debe documentarse como contrato por consumidor.
3. Grid runtime usa Kraken como fuente de ticker fresco aunque `tradingExchange=revolutx`; esto es correcto para datos vs ejecución, pero debe mostrarse en UI.
4. Existen proveedores externos de market metrics y régimen separados; no se verificó equivalencia numérica entre indicadores de SPOT/IDCA/Grid. No deben unificarse cálculos sin evidencia.
5. `market_candles`, `idca_price_context_*`, `idca_ohlcv_cache`, `spot_forward_twin_snapshots` y `candles` de forward twin pueden duplicar datos derivados; proponer contratos versionados y retención, no borrado.
6. No mezclar fill real de Revolut X con cotización Kraken ni sumar SHADOW con REAL; la cartera propuesta debe etiquetar `executionMode` y `dataSource` en cada cifra.

## 7. Legacy, duplicidades y módulos posiblemente muertos

| Candidato | Estado | Evidencia | Recomendación |
|---|---|---|---|
| `client/src/pages/Dashboard.tsx` + `/dashboard-legacy` | Legacy accesible | `App.tsx`, `Dashboard.tsx` | Mantener en Pro/archivo; no borrar sin consumidores |
| `client/src/pages/Terminal.tsx` en `main` | Activo en main, eliminado en runtime | diff App/tree | Clasificar como legacy de main; no portar a runtime |
| `client/src/pages/Strategies.tsx` en `main` | Activo en main, redirect en runtime | diff App/tree | Igual |
| `client/src/pages/AiMl.tsx.backup` | Archivo backup versionado | tree | Candidato a archivo reversible, no borrar |
| IDCA tabs sin trigger (`simulation`, `events`, `legend`, `guide`) | Ocultos pero montados | `InstitutionalDca.tsx` | Proponer retirar de navegación o convertir en Pro explícito |
| `trading_config`/presets/feature flags | Persistencia y endpoints completos; consumo parcial por `TradingEngine`/feature flags | `config.ts`, `config-schema.ts` | NO VERIFICADO como fuente efectiva para SPOT canónico; auditar antes de unificar |
| `autotuning` profiles/proposals | Endpoints y UI completos; autoapply OFF | `autotuning.routes.ts`, `Autotuning.tsx` | Mantener Pro; posible módulo experimental |
| `test.routes.ts` | Endpoints `/api/test/*` y `/api/debug/*` registrados | `routes.ts`, `test.routes.ts` | Riesgo de superficie; proponer desactivar en producción tras inventario |
| `backfill.ts` router | Archivo de rutas no claramente montado | `server/routes/backfill.ts` | NO VERIFICADO; candidato a archivo si no se monta |
| AMA scheduler/servicios | OFF/OBSERVING pero scheduler inicia | `amaSchedulerRunner`, runtime | Mantener OFF; revisar costo/riesgo sin activar |
| Spot AI Forward Twin durable store | Activo en runtime y causa OOM conocida | `spotAiDurableTrainingStore.ts`, uptime corta | P0 estabilidad; no tocar en esta auditoría |
| FISCO | Protegido | Issue/rutas | No auditar cambios ni proponer borrado |

## 8. Rediseño conceptual Básico/Pro

### Principios

- Una sola fuente de estado por motor: `mode`, `health`, `lastDecision`, `blockReason`, `lastActionAt`.
- El valor efectivo mostrado debe indicar origen: `global`, `exchange`, `motor`, `par`, `override seguridad`.
- Básico nunca muestra parámetros que no puede explicar; Pro los muestra con trazabilidad.
- Las acciones peligrosas (`REAL`, kill-switch, restore backup, FISCO commit, purgas) requieren confirmación, rol y auditoría.
- Offline: solo última lectura cacheada; nunca encolar órdenes.

### Tres tareas simuladas

**Usuario Básico — “¿El bot está bien?”**
1. Abrir Inicio → ve 4 motores, 1 alerta amarilla IDCA simulación, SPOT/Grid en SHADOW, AMA OFF.
2. Toca Alertas → lee “Grid no crea rango porque precio en banda inferior” en lenguaje simple.
3. Abre Motores → ve PnL real vs simulado separado; no ve parámetros.

**Usuario Pro — “¿Por qué IDCA no compra?”**
1. Abre Pro → IDCA → Config efectiva → ve sliders fuente vs legacy ignorados.
2. Abre Eventos/Entry diagnostics → filtra `no_rebound_confirmed`, `vwap_weekly_trend_bearish`, `insufficient_dip`.
3. Compara `marketScore`, VWAP anchor, trailing state y últimas decisiones sin mutar.

**Usuario Pro — “Auditar Grid”**
1. Abre Grid → Monitor/audit → ve reason codes, band snapshot, price freshness, planning context.
2. Revisa niveles/ciclos históricos y export JSON/CSV si procede.
3. No pulsa activate/reconcile; solo lectura.

### Métricas propuestas

- Reducción de rutas visibles en móvil de ~15 a 5 en Básico.
- Tiempo hasta entender “por qué no opera” < 60 s con reason principal.
- Cero cambios de modo/riesgo al alternar presentación.
- 100% de acciones Pro sensibles con confirmación y audit log.

## 9. ESTUDIO APK NEXA — MODO BÁSICO Y PRO + PANEL WEB

### Opciones comparadas

| Enfoque | Reutilización | Complejidad | Seguridad | UX Android | Cuándo elegirlo |
|---|---|---|---|---|---|
| PWA responsive instalable | Máxima: mismo React/Vite | Baja | Depende de HTTPS/auth API | Buena si responsive es excelente | **Primera opción recomendada** |
| APK híbrida Capacitor + React | Alta: reutiliza frontend | Media | WebView + API auth | Buena; permite plugins | Si se necesita APK directa/Play |
| TWA | Alta: frontend web en Chrome | Media | Mejor integración Android | Muy buena | Si el sitio es PWA y se quiere Play sin duplicar UI |
| APK nativa | Baja: UI duplicada | Alta | Control total | Máxima | Solo si PWA/Capacitor no bastan |

### Recomendación

1. **Ahora:** convertir la web actual en PWA instalable y responsive con modo Básico/Pro; no crear APK todavía.
2. **Después:** si se requiere presencia en Android/Play, usar **TWA** sobre la PWA o **Capacitor** si se necesitan plugins nativos.
3. **No recomendado hoy:** APK nativa, porque duplicaría UI, lógica de presentación y mantenimiento sin aportar al motor.

### Arquitectura conceptual

```text
Android Pixel 9 / Navegador
   |  PWA o TWA/Capacitor
   v
Panel Web NEXA (Básico/Pro)
   | HTTPS + sesión segura + CSRF/Origin checks
   v
Backend API única (/api/*)
   | authN/authZ, roles, rate limit, audit
   v
Motores/SPOT/IDCA/Grid/AMA/FISCO/DB/Exchanges
```

### Seguridad obligatoria antes de APK

- Autenticación central para HTTP y WebSocket; hoy no hay auth visible en rutas API.
- Sesiones revocables, expiración, PIN local solo como desbloqueo de dispositivo, nunca como autorización.
- Roles: `viewer`, `operator_basic`, `operator_pro`, `admin_fisco` separados.
- 2FA/TOTP o passkey para acciones sensibles; confirmación explícita para REAL/kill-switch/restore.
- CSP, HTTPS, HSTS, protección de `/api`, rate limiting, secretos solo en backend.
- Offline: última lectura cacheada; cero órdenes offline.
- Auditoría de cada cambio de configuración y modo.

### Estimación comparativa

| Fase | PWA | Capacitor/TWA |
|---|---|---|
| Diseño responsive Básico/Pro | M | M |
| Auth/sesiones/roles backend | L | L |
| Empaquetado Android | S | M |
| Notificaciones/push | M | M |
| Mantenimiento | S | M |
| Coste inicial razonable | Bajo-medio | Medio |

## 10. Decisiones de producto prioritarias (máx. 12)

| # | Prioridad | Decisión | Tipo | Riesgo | Esfuerzo | Beneficio |
|---|---|---|---|---|---|---|
| 1 | P0 | Resolver autenticación y exposición del panel antes de cualquier APK/panel remoto | Seguridad | Alto si no se hace | L | Desbloquea uso móvil seguro |
| 2 | P0 | Estabilizar bucle OOM/reinicios del runtime | Estabilidad | Alto | M | Fiabilidad de todos los motores |
| 3 | P1 | Elegir rama de verdad: promover runtime a main o crear rama de release documentada | Release | Medio | M | Evita auditorías sobre versión equivocada |
| 4 | P1 | Implementar `presentationMode` Básico/Pro sin tocar motores | UX | Bajo | M | Simplifica sin perder Pro |
| 5 | P1 | Crear “Centro de ajustes” con valor efectivo, origen y confirmación | Config | Medio | L | Reduce duplicidad percibida |
| 6 | P1 | Exigir reason-code único y legible por motor para bloqueos | UX/ops | Bajo | M | Explica “por qué no opera” |
| 7 | P1 | Separar visualmente REAL/SHADOW/SIMULATION y PnL por universo | UX/riesgo | Medio | M | Evita sumar cifras incompatibles |
| 8 | P2 | Unificar navegación de alertas Telegram sin fusionar reglas de motor | UX | Bajo | M | Menos duplicidad |
| 9 | P2 | Inventariar y archivar legacy de forma reversible | Higiene | Medio | M | Menos confusión |
| 10 | P2 | Definir SSOT conceptual de cartera/reservas/presupuestos | Datos | Alto | L | Evita doble exposición futura |
| 11 | P2 | Convertir web en PWA responsive antes de APK | Producto | Bajo | M | Móvil instalable sin duplicar código |
| 12 | P3 | Evaluar TWA/Capacitor solo tras auth y PWA estables | APK | Medio | M | Distribución Android si se justifica |

### Lo que NO conviene unificar

- Reglas de entrada/salida específicas de SPOT V4, IDCA, Grid y AMA.
- Constraints maker/taker por exchange y por motor.
- FISCO/AEAT: dominio protegido, sin cambios.
- `REAL`, `SHADOW`, `SIMULATION`, `OFF` como estados equivalentes entre motores.
- Fill real de exchange vs cotización de mercado de otro origen.
- Parámetros que solo comparten nombre pero no semántica (`trailing`, `mode`, `capital`).

## 11. Verificación de no intervención

- No se modificaron motores, estrategias, configuración, PostgreSQL, Docker, servicios ni credenciales.
- No se ejecutaron órdenes ni endpoints mutables.
- No se desplegó nada.
- Escrituras autorizadas: únicamente documentos pequeños en rama Git documental, copia local, directorio VPS privado si existe garantía y Google Drive privado si hay acceso verificado.

## 12. Limitaciones y no verificado

- No se hizo revisión visual real con navegador emulado en esta sesión; la UX móvil es inferencia estática + endpoints.
- No se consultó PostgreSQL en esta pasada; valores runtime provienen de API GET y evidencia previa.
- No se verificó cada consumidor de `trading_config`, autotuning ni algunos endpoints legacy.
- Google Drive depende de credencial `rclone` existente; si no está disponible, se documenta impedimento.
- La rama `main` y runtime divergen masivamente; conclusiones de `main` no aplican automáticamente al VPS.
