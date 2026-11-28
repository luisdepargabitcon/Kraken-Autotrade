# Diagnóstico estático de reinicios reportados

Fecha: 2026-11-27  
Alcance: análisis estático/read-only del repositorio. **No se ejecutó nada en VPS, no se consultó la instancia real, no se purgó ni modificó dato alguno.** El número de 17.529 reinicios procede del informe operativo #20; aquí no se atribuye causa.

## 1. Lo que sí está probado por el código

### 1.1 Docker reinicia automáticamente los servicios

`docker-compose.yml`:

- `docker-compose.yml:7` — postgres usa `restart: unless-stopped`.
- `docker-compose.yml:30` — app usa `restart: unless-stopped`.

`docker-compose.staging.yml`:

- `docker-compose.staging.yml:5` — DB staging usa `restart: unless-stopped`.
- `docker-compose.staging.yml:28` — app staging usa `restart: unless-stopped`.

Consecuencia: cualquier salida del proceso Node —crash, OOM kill, fallo durante arranque o cierre no controlado— produce un nuevo arranque del contenedor sin intervención manual. Por sí sola, esta política no explica la causa raíz; explica que una causa repetida pueda convertirse en miles de reinicios acumulados.

### 1.2 La aplicación no declara healthcheck propio en compose principal

En `docker-compose.yml` hay healthcheck para postgres en `docker-compose.yml:16-21`, pero el servicio `app` (`docker-compose.yml:29-68`) no declara `healthcheck` ni `depends_on` basado en salud de la propia app.

La aplicación sí expone un endpoint HTTP de salud:

- `server/routes.ts:122` — `GET /api/health`.
- `server/routes.ts:119-121` — el comentario indica que está pensado para monitores/load balancers y devuelve 503 en errores de schema.

Consecuencia: Docker no puede distinguir “proceso Node vivo pero aplicación degradada/no lista” de “aplicación sana”. Esto no reinicia el contenedor por sí mismo, porque no hay healthcheck de app, pero reduce la evidencia operativa disponible y puede impedir detectar ventanas de arranque defectuoso.

### 1.3 Cada arranque ejecuta instalación/build/migraciones dentro del contenedor principal

En `docker-compose.yml:56-63`, el comando del servicio app ejecuta secuencialmente:

1. `apk add --no-cache docker-cli git`
2. `npm install --include=dev`
3. `npx tsx script/build.ts`
4. `npx tsx script/migrate.ts`
5. `npm start`

Consecuencia: cada reinicio repite trabajo pesado antes de servir tráfico. Esto hace plausibles estas categorías de fallo:

- consumo alto de memoria/CPU durante `npm install` o build;
- latencia larga hasta que el servidor escucha;
- fallos transitorios de red/descarga;
- repetición de migraciones o scripts de arranque;
- presión de disco por cachés/node_modules, aunque hay volumen dedicado.

No se puede afirmar que esto causara los reinicios sin logs/exit codes, pero es una diferencia operativa relevante frente a una imagen ya construida.

### 1.4 El contenedor monta el socket de Docker

- `docker-compose.yml:54` — `/var/run/docker.sock:/var/run/docker.sock`.
- `docker-compose.staging.yml:46` — también presente en staging.

Consecuencia: procesos dentro del contenedor tienen capacidad técnica para interactuar con Docker si usan esa vía. No implica que lo hagan ni que provoquen reinicios; es una superficie operativa a auditar si aparecen reinicios externos no explicados por crashes de Node.

## 2. Manejo de errores del proceso Node

Búsqueda estática de handlers:

- `server/index.ts:141` — `SIGTERM` llama a `gracefulShutdown`.
- `server/index.ts:142` — `SIGINT` llama a `gracefulShutdown`.

No se encontraron handlers globales de `process.on('uncaughtException')` ni `process.on('unhandledRejection')` en `server/`.

Consecuencia: una excepción no capturada o una promesa rechazada no manejada puede terminar el proceso según el comportamiento de Node 20. En Node moderno, un `unhandledRejection` puede ser fatal. Al no existir handler central, no hay una clasificación uniforme tipo `FATAL_UNCAUGHT`/`FATAL_UNHANDLED` antes de morir. Esto hace plausible la categoría “error no capturado”, pero no la confirma.

El shutdown sí fuerza salida si el cierre se cuelga:

- `server/index.ts:139` — `setTimeout(() => process.exit(1), 10_000)` dentro de `gracefulShutdown`.

Esto puede producir exit code 1 durante un SIGTERM/SIGINT si `httpServer.close()` no termina. Es esperable como mecanismo defensivo y no debe confundirse con crash espontáneo sin la ventana temporal de señal.

## 3. Trabajos que se ejecutan al arrancar

Las rutas de arranque cargan o inicializan múltiples subsistemas. Las evidencias principales son:

- `server/routes.ts` zona de `AutoMigrationRunner` alrededor de `server/routes.ts:240-257` — ejecuta migraciones registradas al arrancar.
- `server/routes.ts` alrededor de `server/routes.ts:263-269` — `ensureFiscoV2Schema()` como refuerzo de schema.
- `server/routes.ts:270` — inicialización de `ExchangeFactory`.
- `server/routes.ts:284` — inicialización de credenciales Kraken si existen.
- `server/routes.ts:291` — inicialización Telegram si existe.
- `server/routes.ts:363` — scheduler de sync diario RevolutX.
- `server/routes.ts:385` — `FiscoKrakenRetryWorker.initialize()`.
- `server/routes.ts:393` — `LogRetentionScheduler.initialize()`.
- `server/routes.ts:446` — `IdcaEngine.startScheduler()` si el módulo está activo.
- `server/services/institutionalDca/IdcaEngine.ts:1013` — `reconcilePendingIntents()` en arranque del scheduler IDCA.
- `server/routes.ts:1886-1890` — `initializeGridShadowAtStartup()` si migraciones Grid completaron.
- `server/routes.ts:1914` — `fiscoScheduler.initialize()`.
- `server/routes.ts:1939` — cron de Market Metrics.
- `server/routes.ts:1949-1955` — primer `marketMetricsService.refreshIfDue()` diferido 30 segundos.
- `server/routes.ts:1970` — `tradeMetricsTracker.startScheduler(...)`.
- `server/routes.ts:1992-1995` — `storage.rebuildPnlForAllSells()` diferido 10 segundos.
- `server/routes.ts:2003-2005` — `runIdcaHistoricalDuplicateCleanupOnce()` diferido 15 segundos.
- `server/index.ts` alrededor del arranque — `MarketDataService.cleanupOldCandles()` con throttle interno.
- `server/index.ts` tras `listen` — arranque de scheduler AMA y reconciliación durable.

Consecuencia: tras cada reinicio hay una ráfaga de inicialización, queries, jobs diferidos y posibles llamadas externas. Si el proceso muere antes de completar o mientras estos jobs corren, el siguiente arranque vuelve a lanzarlos. Esto puede amplificar carga. No demuestra por sí solo duplicación dañina: hay jobs con controles internos.

### 3.1 Consultas amplias/sin límite explícito en trabajos de arranque

No son prueba de OOM, pero sí hacen plausible que el coste de arranque crezca con el histórico:

- `server/storage.ts:708-715` — `rebuildPnlForAllSells()` selecciona todos los trades `filled` ordenados para reconstrucción FIFO; no se observa `LIMIT` en esa consulta. Este trabajo se lanza diferido en cada arranque (`server/routes.ts:1992-1995`).
- `server/services/institutionalDca/IdcaLiveOrderReconciler.ts:103` — `DrizzleIdcaIntentStore.listPending()` selecciona todos los intents pendientes/no aplicados sin `LIMIT` explícito. Se invoca en arranque IDCA (`server/services/institutionalDca/IdcaEngine.ts:1013`).

Ambas consultas pueden ser pequeñas en operación normal; la cuestión diagnóstica es que su coste no está acotado por paginación en el código citado. Confirmar impacto requiere métricas reales de memoria/CPU y tamaño de tablas, no solo lectura estática.

## 4. Evidencia de idempotencia ya acotada en tests

La auditoría añadió/valida tests que simulan arranques repetidos sin DB real ni red:

- `server/services/marketMetrics/__tests__/marketMetricsStartupIdempotence.test.ts` — tres arranques consecutivos de `refreshIfDue`; si el primer arranque persiste snapshot reciente, los dos siguientes no repiten fetch de providers.
- `server/services/institutionalDca/__tests__/idcaStartupReconciliationIdempotence.test.ts` — tres reconciliaciones consecutivas de un intent pendiente ya recuperado; la contabilidad y los fills no se duplican y no hay reenvío de orden.

Limitación: estos tests prueban idempotencia lógica aislada con stores/mocks. No prueban concurrencia entre dos procesos/contenedores vivos ni locking distribuido en DB real.

## 5. Categorías plausibles de causa, sin atribución

| Categoría | Evidencia estática que la hace plausible | Qué la confirmaría o descartaría |
|---|---|---|
| OOM o límite de memoria/CPU | No hay límites `mem_limit`/`deploy.resources` en compose principal; cada arranque ejecuta install/build (`docker-compose.yml:56-63`) | `docker inspect` con `OOMKilled`, `State.OOMKilled`, `RestartCount`, `ExitCode`; uso de memoria previo al reinicio |
| Error JS no capturado/unhandled rejection | No hay handlers globales `uncaughtException`/`unhandledRejection`; solo SIGTERM/SIGINT (`server/index.ts:141-142`) | líneas inmediatamente anteriores al reinicio en `docker logs`; stack trace Node |
| Fallo durante build/install/migraciones de arranque | install/build/migrate dentro del comando (`docker-compose.yml:56-63`) | logs que terminen antes de `serving on port`, errores npm/tsx/migración repetidos |
| Carga de jobs de arranque | jobs listados en sección 3, algunos diferidos 10-30 s | correlación temporal: reinicio tras picos de CPU/memoria o errores en esos logs |
| Reinicio externo/supervisor Docker | `restart: unless-stopped` y socket Docker montado (`docker-compose.yml:30,54`) | eventos Docker (`docker events`), audit logs del host, comandos de recreación/update |
| Shutdown limpio convertido en exit 1 por timeout | `server/index.ts:139` fuerza `process.exit(1)` si close tarda >10 s | presencia de `[shutdown] SIGTERM/SIGINT received` seguido de ausencia de `[shutdown] HTTP server closed` |
| Instancia legacy/configuración duplicada | compose principal y staging conviven como archivos separados | listado real de contenedores y compose projects; no asumir desde el repo |
| Reingesta/retención intensiva | cleanup/rebuild/duplicate cleanup diferidos | logs de esos jobs coincidiendo con picos o reinicios |

## 6. Evidencia read-only adicional que debería recopilar el propietario

No se ejecutó ninguno de estos comandos. Deben ejecutarse solo con autorización y en la ventana temporal adecuada.

### 6.1 Estado/exit de contenedores

```bash
docker ps -a --no-trunc
docker inspect kraken-bot-app --format '{{json .State}}'
docker inspect kraken-bot-app --format 'RestartCount={{.RestartCount}} ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} StartedAt={{.State.StartedAt}} FinishedAt={{.State.FinishedAt}}'
docker inspect kraken-bot-staging-app --format 'RestartCount={{.RestartCount}} ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} StartedAt={{.State.StartedAt}} FinishedAt={{.State.FinishedAt}}'
```

Buscar: `OOMKilled=true`, `ExitCode` 1/137/139, fechas repetidas, contenedor efectivamente usado.

### 6.2 Últimas líneas antes de cada reinicio

```bash
docker logs --timestamps --tail 300 kraken-bot-app
docker logs --timestamps --since 24h kraken-bot-app
```

Si hay múltiples arranques, pedir ventana acotada alrededor de `FinishedAt`/`StartedAt` observado en inspect. Buscar: últimas líneas antes de `BUILD_COMMIT`/`serving on port` del siguiente arranque.

### 6.3 Eventos Docker

```bash
docker events --since '2026-11-26T00:00:00' --until '2026-11-27T00:00:00'
```

Ajustar fechas. Buscar `die`, `oom`, `kill`, `restart`, `destroy`, `create`, `start` y si hay actor externo.

### 6.4 Recursos

```bash
docker stats --no-stream
df -h
free -m
```

Esto es una instantánea; no sustituye histórico. Sirve para detectar presión actual.

### 6.5 Comprobación de salud HTTP

```bash
curl -i --max-time 5 http://127.0.0.1:3000/api/health
```

En staging/panel puede ser otro puerto según despliegue. El endpoint existe (`server/routes.ts:122`), pero compose no lo usa como healthcheck.

## 7. Qué NO se concluye

1. No se concluye que Docker causara los 17.529 reinicios; solo que reiniciaría automáticamente cualquier salida.
2. No se concluye OOM sin `OOMKilled` o evidencia de memoria.
3. No se concluye un unhandled rejection sin stack/log temporal.
4. No se concluye que los jobs de arranque sean dañinos; varios tienen guards/throttles y ahora hay tests de idempotencia aislada.
5. No se concluye manipulación externa por el socket Docker montado; es superficie a auditar, no prueba.
6. No se propone purgar, recrear DB, tocar backups ni acceder al VPS.

## 8. Acciones defensivas candidatas, no aplicadas

Solo como propuesta para decisión posterior:

- declarar healthcheck del servicio app usando `/api/health`;
- separar build/install/migración del arranque recurrente mediante imagen preconstruida;
- añadir handlers de observación `uncaughtException`/`unhandledRejection` con logging estructurado antes de salir, sin ocultar fallos;
- definir límites/alertas de memoria adecuados tras medir;
- recopilar `RestartCount`, `OOMKilled` y logs por ventana antes de cualquier cambio operativo.
