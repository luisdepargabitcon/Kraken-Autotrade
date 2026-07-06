# BITÁCORA — WINDSURF CHESTER BOT

> Documentación técnica y operativa unificada. Solo describe cómo funciona **ahora**.
> Última actualización: 2026-07-07

---

## 2026-07-07 — FIX Telegram: /api/telegram/channels 404 + legacy rules enabled (commit 1234870)

### Problema
- `/api/telegram/channels` devolvía 404 aunque `/api/telegram/chats` existía → UI no podía gestionar canales
- Migration 067 creó alert rules `enabled=true` para canales legacy importados (importedFromLegacy=true, needsUserReview=true)
- Esto incumplía la regla: "Legacy importado no se activa por defecto y no debe conservar alertas activas hasta revisión/configuración manual"

### Solución — FIX 1: /api/telegram/channels alias endpoints
- `routes.ts`: Añadidos endpoints alias que reutilizan la lógica de `/api/telegram/chats`:
  - `GET /api/telegram/channels` → `getTelegramChats()`
  - `POST /api/telegram/channels` → `createTelegramChat()` con validación tokenId
  - `PUT /api/telegram/channels/:id` → `updateTelegramChat()` con validación tokenId
  - `DELETE /api/telegram/channels/:id` → `deleteTelegramChat()`
- UI Telegram → Canales ahora puede añadir, editar, activar/inactivar, asignar token, probar y eliminar canales

### Solución — FIX 2: Legacy alert rules disabled
- Migration 067: INSERT con `CASE` para `enabled=false` cuando `importedFromLegacy=true` o `needsUserReview=true`
- Migration 068: `UPDATE` para desactivar reglas legacy existentes en staging
- `routes.ts`: migration 068 añadida al AutoMigrationRunner
- Resultado: chat_id 7 (Legacy API Config) y chat_id 8 (Legacy IDCA) tienen todas sus alert rules `enabled=false`

### Solución — FIX 3: Tests
- 42 tests en `telegram-refactor.test.ts` (40 originales + 2 nuevos legacy rules)
- Tests cubren: alert rule disabled blocking, legacy channel con `importedFromLegacy=true`

### Validación VPS staging
- Container `krakenbot-staging-app` Up, no reinicia
- Health: `{"status":"ok","schema":{"healthy":true,"migrationRan":true}}`
- `/api/telegram/channels` responde 200 con 3 canales
- `/api/telegram/audit` sin HIGH (WARNING x2, INFO x1)
- Legacy API Config (chat_id 7): `isActive=false`, todas las alert rules `enabled=false`
- Legacy IDCA (chat_id 8): `isActive=false`, todas las alert rules `enabled=false`
- FISCO (chat_id 6): `isActive=true`, alert rules `enabled=true`
- Logs sin `DATABASE_ERROR` ni `ERROR CRITICAL`

### Archivos modificados
- `server/routes.ts` — /api/telegram/channels endpoints + migration 068
- `db/migrations/067_telegram_alert_rules.sql` — INSERT con CASE para legacy
- `db/migrations/068_disable_legacy_alert_rules.sql` — UPDATE legacy rules disabled
- `server/services/__tests__/telegram-refactor.test.ts` — 2 tests legacy rules

---

## 2026-07-07 — Validación final UX Telegram staging — eab28fc

### Deploy
- Commit: `eab28fc` fix(telegram): permitir crear canal inactivo sin test de envío
- Commit previo: `ad2c683` feat(telegram): UX 1-7 — Canales/Tokens reales, Alertas en subpestañas, eliminar restos
- VPS: `cd /opt/krakenbot-staging && git pull && docker compose -f docker-compose.staging.yml up -d --build`
- Espera: 50s para app startup

### Validación API
- Health: `{"status":"ok","schema":{"healthy":true,"migrationRan":true}}` ✅
- `/api/telegram/channels`: 200 OK, 3 canales (FISCO activo, Legacy API Config inactivo, Legacy IDCA inactivo) ✅
- `/api/telegram/tokens`: 200 OK, tokens listados ✅
- `/api/telegram/alert-rules`: 200 OK, 15 reglas (5 por canal) ✅
- `/api/telegram/audit`: 0 HIGH, 2 WARNING, 1 INFO ✅
- `/api/telegram/commands`: 51 comandos, 7 required encontrados ✅
- `/api/telegram/grid-alert-catalog`: 20 alertas, 0 observerForbidden ✅

### Validación DB
- Tablas: `telegram_bot_tokens`, `telegram_alert_rules`, `telegram_chats`, `telegram_alert_events` ✅
- Columnas `telegram_chats`: `token_id`, `enabled_modes`, `enabled_alerts` ✅
- Columnas `telegram_alert_events`: `token_id`, `channel_id`, `chat_id`, `status`, `block_reason` ✅
- Canales:
  - ID 6 FISCO: activo, sin token, enabled_modes trading/idca/fiscal/smart_exit ✅
  - ID 7 Legacy API Config: inactivo, importedFromLegacy=true ✅
  - ID 8 Legacy IDCA: inactivo, importedFromLegacy=true ✅
- Alert rules:
  - FISCO: 5 reglas enabled=true ✅
  - Legacy API Config: 5 reglas enabled=false ✅
  - Legacy IDCA: 5 reglas enabled=false ✅
- Migrations: 066, 067, 068 aplicadas ✅

### Validación CRUD Canal Temporal
- POST `/api/telegram/channels` con `isActive=false`: creado ID=9 ✅
- PUT `/api/telegram/channels/9` editado nombre: OK ✅
- GET `/api/telegram/channels` verificado canal temporal: OK ✅
- DELETE `/api/telegram/channels/9`: OK ✅
- Verificación borrado: 0 canales restantes con chatId=-999999999001 ✅

### Validación Bundle/Frontend
- "Tokens" encontrado en bundle ✅
- "Añadir canal" encontrado en bundle ✅
- "SPOT Dry Run" encontrado en bundle ✅
- "Grid / Hybrid" encontrado en bundle ✅
- "Alertas por modo" encontrado solo como tab trigger (no como estructura principal) ✅
- "Configurar Grid Isolated" no encontrado en bundle ✅
- "Configurar alertas fiscales" no encontrado en bundle (solo en código fuente como link informativo) ✅

### Validación Logs
- Sin `DATABASE_ERROR` ✅
- Sin `ERROR CRITICAL` ✅
- Sin `NOT_FOUND` en telegram endpoints ✅
- Sin `token completo` en logs ✅

### Validación Código Fuente Local
- "Alertas por modo": solo en Telegram.tsx como tab trigger ✅
- "Configurar Grid Isolated": no encontrado ✅
- "Configurar alertas fiscales": solo en TelegramFiscoTab.tsx como link a /fiscal (aceptable) ✅
- "Añadir canal": en TelegramChannelsTab.tsx ✅
- "TelegramTokensTab": existe, importado y renderizado en Telegram.tsx ✅
- "SPOT Dry Run": en Telegram.tsx ✅
- "Grid / Hybrid": en Telegram.tsx ✅

### Tests Locales
- `npm run check`: OK ✅
- `npm run build`: OK ✅
- `telegram-refactor.test.ts`: 42/42 OK ✅

### Checklist Visual Esperada
- Tabs principales: General, Tokens, Canales, Alertas, Comandos, Auditoría ✅
- Tokens: botón Añadir token, lista tokens, token oculto ✅
- Canales: botón Añadir canal, Editar/Activar-Inactivar/Eliminar, legacy inactivos ✅
- Alertas: subpestañas SPOT Real, SPOT Dry Run, IDCA, Grid/Hybrid, Smart Exit, Fiscalidad, Sistema, IA/Shadow ✅
- Grid/Hybrid: 20 alertas configurables con enabled/severity/cooldown ✅

### Limitaciones Pendientes
- Ninguna crítica

### URL Final
http://5.250.184.18:3020/telegram?v=telegram-ux-final-eab28fc

---

## 2026-07-07 — UX 1: Auditoría frontend Telegram (en progreso)

### Tabla de auditoría

| Archivo | Resto UX encontrado | Problema | Acción aplicada |
|---------|---------------------|----------|-----------------|
| `client/src/pages/Telegram.tsx` | Alertas por modo usa Accordion | Debe usar subpestañas internas | Pendiente UX 4 |
| `client/src/components/telegram/TelegramChannelsTab.tsx` | Usa `/api/telegram/chats` | Debe usar `/api/telegram/channels` | Pendiente UX 2 |
| `client/src/components/telegram/TelegramChannelsTab.tsx` | Formulario incompleto (sin token, enabledModes, enabledAlerts) | Falta configuración completa | Pendiente UX 2 |
| `client/src/pages/InstitutionalDca.tsx` | TelegramTab con "Configurar en Telegram → IDCA" | Link fuera de /telegram | Pendiente UX 5 |
| `client/src/pages/Fisco.tsx` | Tab "Alertas Telegram" con "Configurar en Telegram → Fiscalidad" | Link fuera de /telegram | Pendiente UX 5 |
| `client/src/components/strategies/SmartExitTab.tsx` | "Configurar en Telegram → Smart Exit" | Link fuera de /telegram | Pendiente UX 5 |
| `client/src/pages/Telegram.tsx` | Falta subpestaña Tokens | No hay UI multi-token | Pendiente UX 3 |
| `client/src/components/telegram/*` | Tabs de alertas por modo incompletos | Grid sin 20 alertas configurables | Pendiente UX 4 |

### Pendiente
- UX 2: Canales formulario real funcional
- UX 3: Tokens UI real multi-bot
- UX 4: Alertas por modo en subpestañas
- UX 5: Eliminar restos Telegram fuera de /telegram
- UX 6: Conectar UI a endpoints correctos
- UX 7: Limpiar scripts temporales
- UX 8: Tests frontend/integración
- UX 9: Deploy y validación visual real
- UX 10: BITACORA.md con UX real final

---

## 2026-07-06 — Refactor Telegram FASE 6-10: Routing central + fix staging (commits 068c0fe → 1ed19e1)

### Problema
- TelegramNotificationCenter.send() usaba lógica legacy de broadcast a todos los chats activos
- No existía pipeline de routing token → canal → modo → alerta
- No había validación de alert rules, mode filtering, ni token resolution
- Audit no incluía tokenId para trazabilidad
- Comandos no validaban token del canal
- Migrations 066/067 no estaban registradas en AutoMigrationRunner → staging app reiniciando

### Solución — FASE 6: Routing central token → canal → modo → alerta
- `TelegramNotificationCenter.send()` reescrito con pipeline de 16 pasos:
  1. global kill switch → 2. silent mode → 3. severity filter → 4. quiet hours →
  5. alert rule lookup → 6. dedupe → 7. rate limit → 8. active channels →
  9. channel resolution (rule.chatId → compatible → default) →
  10. mode validation (enabledModes) → 11. alert validation (enabledAlerts) →
  12. legacy shouldSendToChat → 13. token resolution (chat.tokenId → default) →
  14. token active validation → 15. send → 16. audit with tokenId/channelId
- Nuevos block reasons: `blocked_by_token_disabled`, `blocked_by_alert_rule_disabled`,
  `blocked_by_no_matching_channel`, `blocked_by_channel_mode_not_allowed`,
  `blocked_by_channel_alert_not_allowed`, `blocked_by_missing_token`
- `sendToSpecificChat()` actualizado con token resolution y audit con tokenId
- `shared/schema.ts`: `tokenId` añadido a `telegramAlertEvents`
- Migration 066: `ALTER TABLE telegram_alert_events ADD COLUMN IF NOT EXISTS token_id`

### Solución — FASE 7: Comandos por token/canal
- `authorizeCommand()` ahora resuelve token del canal y valida que esté activo
- Retorna `tokenId` en el resultado para audit
- `registerCommandsWithTelegram()` usa catálogo de TelegramNotificationCenter (no-deprecated only)
- `handleRefreshCommands()` usa catálogo nuevo en lugar de TELEGRAM_COMMANDS legacy
- Alias deprecated resueltos a comando canonical en authorizeCommand

### Solución — FASE 8: Validación UI no duplicados
- Verificado: todas las páginas fuera de /telegram tienen controles Telegram read-only
- Notifications.tsx: display only con link a /telegram
- InstitutionalDca.tsx TelegramTab: read-only con link a /telegram
- Integrations.tsx: card con link a /telegram
- TimeStopConfigPanel.tsx: sin referencias Telegram
- No se requirieron cambios

### Solución — FASE 9: Tests
- 40 tests en `telegram-refactor.test.ts` (26 originales + 14 nuevos FASE 6/7)
- Tests cubren: alert rule disabled, rule-specified channel routing, channel mode/alert blocking,
  token missing/disabled, token resolution from channel tokenId, audit with tokenId/channelId,
  sendToSpecificChat token resolution, authorizeCommand with tokenId, deprecated alias resolution

### Solución — FASE 10: Deploy staging + fix migrations
- **Causa**: migrations 066/067 no estaban en la lista del AutoMigrationRunner en `routes.ts`
- **Fix 1**: Añadidas 066 y 067 al runner automático
- **Fix 2**: Idempotencia — `CREATE INDEX IF NOT EXISTS` y `CREATE TRIGGER` envuelto en `DO $$` block
- **Fix 3**: Migration 067 INSERT con `CROSS JOIN VALUES` en lugar de `unnest` de arrays con longitudes distintas (producía NULLs en columna NOT NULL)
- **Validación VPS staging**:
  - Container `krakenbot-staging-app` Up, no reinicia
  - Health OK: `{"status":"ok","schema":{"healthy":true,"migrationRan":true}}`
  - `telegram_bot_tokens` table existe
  - `telegram_alert_rules` table existe (15 reglas por defecto insertadas)
  - `telegram_chats` tiene `token_id`, `enabled_modes`, `enabled_alerts`
  - `telegram_alert_events` tiene `token_id`
  - `/api/telegram/tokens` responde (`[]`)
  - `/api/telegram/alert-rules` responde (15 reglas)
  - `/api/telegram/commands` responde (51 comandos)
  - `/api/telegram/grid-alert-catalog` responde (20 entradas)
  - Logs sin `DATABASE_ERROR` ni `ERROR CRITICAL`

### Archivos modificados
- `server/services/TelegramNotificationCenter.ts` — Routing pipeline, helper functions, audit con tokenId
- `server/services/telegram.ts` — registerCommandsWithTelegram y handleRefreshCommands con nuevo catálogo
- `server/routes.ts` — Migrations 066/067 añadidas al AutoMigrationRunner
- `shared/schema.ts` — tokenId en telegramAlertEvents
- `db/migrations/066_telegram_bot_tokens.sql` — Idempotencia (IF NOT EXISTS, DO $$ trigger)
- `db/migrations/067_telegram_alert_rules.sql` — Idempotencia + fix INSERT CROSS JOIN VALUES
- `server/services/__tests__/telegram-refactor.test.ts` — 40 tests
- `scripts/deploy_validate_telegram.sh` — Script de deploy/validación VPS

---

## 2026-07-06 — Refactor Telegram FASE D/E/G/H/I/J (commit d8b6852)

### Problema
- Configuración Telegram dispersa en múltiples páginas (Notifications, IDCA, FISCO, SmartExit) con duplicados editables
- Legacy chat IDs detectados por auditoría sin mecanismo seguro de importación
- Catálogo de comandos mezclaba comandos nuevos y legacy sin distinción
- Falta catálogo completo de alertas Grid con regla de lenguaje observer_only
- UI Telegram con 12 subpestañas planas, difícil de navegar
- Envíos directos a Telegram sin pasar por NotificationCenter en algunos servicios

### Solución — FASE D: Centralización UI legacy (read-only)
**Archivos modificados:**
- `client/src/pages/Notifications.tsx` — Reescrito como resumen read-only con link a Telegram > Ajustes
- `client/src/pages/InstitutionalDca.tsx` — Tab Telegram reemplazado por resumen read-only link a Telegram > IDCA
- `client/src/pages/Fisco.tsx` — Sección alert config reemplazada por resumen read-only link a Telegram > Fiscalidad
- `client/src/components/strategies/SmartExitTab.tsx` — Toggles Telegram reemplazados por resumen read-only link a Telegram > Smart Exit
- `client/src/components/telegram/TelegramSmartExitTab.tsx` — Implementado config editable real migrado desde SmartExitTab

### Solución — FASE G: Importación segura de legacy chat IDs
**Archivos modificados:**
- `server/routes.ts` — POST `/api/telegram/audit/resolve` con acciones: `register_channel` (importa como INACTIVO con flags `importedFromLegacy=true`, `needsUserReview=true`), `clear_reference` (elimina referencia legacy), `ignore` (marca issue resuelto). Audit issues enriquecidos con `source`, `chatId`, `resolvable`. Severidad WARNING para legacy importado.
- `client/src/components/telegram/TelegramAuditTab.tsx` — Botones de acción para resolver issues, toast con mensaje claro sobre importación inactiva, estilos para severidad WARNING.

### Solución — FASE J: Rerouting completo a NotificationCenter
**Archivos modificados:**
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — `send()` rerouteado a `telegramNotificationCenter.sendToSpecificChat()`
- `server/services/institutionalDca/IdcaHybridAlertService.ts` — `sendTelegram()` rerouteado a `telegramNotificationCenter.sendToSpecificChat()`
- `server/services/FiscoTelegramNotifier.ts` — `sendTextReport()` rerouteado a `telegramNotificationCenter.sendToSpecificChat()`; `sendDocument()` mantiene directo (binario)
- `server/services/fisco/FiscoAutoSyncService.ts` — Todos los `sendMessage()` rerouteados a `telegramNotificationCenter.sendToSpecificChat()`
- `server/services/ErrorAlertService.ts` — `sendCriticalError()` rerouteado a `telegramNotificationCenter.sendToSpecificChat()`
- `server/services/__tests__/telegram-refactor.test.ts` — Test de regresión: legacy import como inactivo bloquea envíos, audita `blocked_by_channel_disabled`.

### Solución — FASE I: Catálogo de comandos rehecho
**Archivos modificados:**
- `server/services/TelegramNotificationCenter.ts` — `COMMAND_DEFINITIONS` expandido: comandos nuevos en inglés organizados por módulo (general, spot, idca, grid, fisco, system), comandos legacy en español marcados `deprecated: true` con `aliasOf` al comando nuevo, campo `requiresConfirmation` para acciones peligrosas.
- `server/services/telegram.ts` — Handlers nuevos: `/status`, `/help`, `/last_alerts`, `/pause_bot`, `/resume_bot`, `/telegram_status`, `/commands`, `/health`, `/version`, `/audit`. Handlers pending para comandos registrados pero sin implementación completa (`/spot_status`, `/idca_status`, etc.). Imports `readFileSync`, `join` para VERSION.
- `server/services/__tests__/telegram-refactor.test.ts` — Tests: `/grid_status` existe en catálogo, `/idca_status` existe, `/telegram_status` es read_only, `/estado` es deprecated con alias a `/status`, comandos peligrosos requieren confirmación, read-only no requieren confirmación.

### Solución — FASE H: Catálogo completo de alertas Grid
**Nuevos archivos:**
- `server/services/institutionalDca/GridAlertTypes.ts` — 20 tipos de alerta Grid definidos con: `type`, `label`, `defaultEnabled`, `defaultSeverity`, `defaultDedupeMinutes`, `maxMessagesPerHour`, `onlyOnStateChange`, `groupByCycle`, `observerOnlyType`, `naturalTemplate`. Función `buildGridAlertMessage()` que aplica regla de lenguaje: si `observerOnly=true`, nunca "ejecutado"/"orden creada"/"compra preparada" — siempre "simulado"/"informativo"/"sin orden real".
- `server/services/institutionalDca/__tests__/GridAlertTypes.test.ts` — 5 tests: 20 tipos definidos, observer-only no usa palabras prohibidas, sanitización de wording, wording real cuando observerOnly=false, lookup por tipo.

**Archivos modificados:**
- `server/routes.ts` — GET `/api/telegram/grid-alert-catalog` expone `GRID_ALERT_DEFINITIONS`.
- `client/src/components/telegram/TelegramIdcaHybridTab.tsx` — Muestra catálogo completo con badges de severidad, badge SIMULADO para observerOnly, dedupe y max/h.

### Solución — FASE E: Reorganización UI Telegram (5 grupos)
**Archivos modificados:**
- `client/src/pages/Telegram.tsx` — Reorganizado de 12 subpestañas planas a 5 grupos lógicos: 1) General (TelegramSettingsTab), 2) Canales (TelegramChannelsTab), 3) Alertas por modo (Accordion con 8 secciones: SPOT Real, SPOT Dry Run, IDCA, IDCA Hybrid/Grid, Smart Exit, Fiscalidad, Sistema, IA), 4) Comandos (TelegramCommandsTab), 5) Auditoría (TelegramAuditTab).

### Validación
- TypeScript: sin errores
- Build: exitoso (client 2605 módulos, server 3.9mb)
- Tests Telegram: 31/31 passing (26 refactor + 5 GridAlertTypes)
- Deploy staging: `git push` + `docker compose up -d --build` exitoso
- Commit: d8b6852

---

## 2026-07-06 — Refactor Telegram FASE A/B/C (commits 0a59cb3, bb98f61, b6098e2)

### Problema
El sistema Telegram tenía múltiples problemas:
- Mensajes fantasma (phantom) enviados a chat IDs legacy de `api_config` cuando no había canales activos
- FISCO enviaba por dual-path (HTML + texto) causando duplicados
- IDCA no validaba si el chat ID estaba activo en `telegram_chats`
- ErrorAlertService generaba HTML malformado (tag `<span>` sin clase `tg-spoiler`)
- Sin kill switch global para bloquear todos los envíos
- Sin deduplicación ni rate-limiting centralizado
- Comandos sin autorización por chat
- Sin auditoría de alertas enviadas/bloqueadas/fallidas
- Configuración Telegram dispersa en múltiples páginas (Integrations, Notifications, IDCA, FISCO, SmartExit)

### Solución — FASE A: Infraestructura backend (commit 0a59cb3)

**Nuevos archivos:**
- `server/services/TelegramNotificationCenter.ts` — Autoridad central para routing de alertas
- `server/services/__tests__/telegram-refactor.test.ts` — 19 tests
- `db/migrations/065_telegram_global_config.sql` — Tablas `telegram_global_config`, `telegram_alert_events`, `telegram_command_log`

**Archivos modificados:**
- `shared/schema.ts` — Schema Drizzle para nuevas tablas
- `server/storage.ts` — Métodos storage para global config, alert events, command logs
- `server/routes.ts` — Endpoints API: `/api/telegram/global-config`, `/api/telegram/alert-events`, `/api/telegram/command-logs`, `/api/telegram/commands`
- `server/services/telegram.ts` — Eliminados fallbacks a `this.chatId` en `sendAlertWithSubtype`, `sendAlertToMultipleChats`, heartbeat, daily report; añadido guard de autorización en comandos
- `server/services/ErrorAlertService.ts` — HTML escaping en mensaje, contexto, código y stack trace; eliminada creación de instancia fallback de TelegramService
- `server/services/FiscoTelegramNotifier.ts` — Eliminado dual-path; validación de chat activo antes de enviar
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — Validación de chat activo en `telegram_chats`; channel authorization en `canSend()`
- `server/services/institutionalDca/IdcaHybridAlertService.ts` — Validación de chat activo antes de enviar

**Validación FASE A en VPS:**
- Health OK, Docker up, migración 065 aplicada
- 3 tablas creadas: `telegram_global_config`, `telegram_alert_events`, `telegram_command_log`
- Global config: `telegramGlobalEnabled: true`, `telegramSilentMode: false`, `telegramMinSeverity: LOW`
- 19 comandos con permisos correctos (read_only/action/admin)
- Sin errores CRITICAL en logs

### Solución — FASE B: UI Telegram unificada (commit bb98f61)

**Nuevos archivos:**
- `client/src/pages/Telegram.tsx` — Página principal con 12 subpestañas
- `client/src/components/telegram/TelegramSettingsTab.tsx` — Kill switch, token, silent mode, severity, dedupe, rate-limit, quiet hours, environment label
- `client/src/components/telegram/TelegramChannelsTab.tsx` — CRUD de `telegram_chats`, toggle active/inactive, alert preferences
- `client/src/components/telegram/TelegramCommandsTab.tsx` — Command definitions + command logs
- `client/src/components/telegram/TelegramSpotTab.tsx` — SPOT / Trading activo
- `client/src/components/telegram/TelegramSpotDryRunTab.tsx` — SPOT Dry Run
- `client/src/components/telegram/TelegramIdcaTab.tsx` — IDCA status + link a config detallada
- `client/src/components/telegram/TelegramIdcaHybridTab.tsx` — IDCA Hybrid/Grid (Grid Observer = "Grid simulado")
- `client/src/components/telegram/TelegramSmartExitTab.tsx` — Smart Exit notificaciones
- `client/src/components/telegram/TelegramFiscoTab.tsx` — FISCO alertas
- `client/src/components/telegram/TelegramSystemTab.tsx` — Sistema / errores críticos
- `client/src/components/telegram/TelegramAiTab.tsx` — IA / Shadow Mode / Autoafinación
- `client/src/components/telegram/TelegramAuditTab.tsx` — Auditoría / Historial (alert events + diagnostic)

**Archivos modificados:**
- `client/src/App.tsx` — Ruta `/telegram`
- `client/src/components/dashboard/Nav.tsx` — Link "TELEGRAM" en sección SISTEMA
- `client/src/components/mobile/MobileTabBar.tsx` — `/telegram` en aliases
- `client/src/pages/Integrations.tsx` — Sección Telegram reemplazada con link a `/telegram`
- `client/src/pages/Notifications.tsx` — Link a `/telegram` en header

**Validación FASE B en VPS:**
- Build OK, deploy OK, health OK
- API endpoints funcionando: global-config, commands, alert-events, command-logs

### Solución — FASE C: Saneamiento legacy + telegram:audit + ENV policy (commit b6098e2)

**Archivos modificados:**
- `server/routes.ts` — Nuevo endpoint `GET /api/telegram/audit` que detecta:
  - Chat IDs legacy en `api_config` no registrados en `telegram_chats`
  - Chat IDs de IDCA/FISCO no registrados o inactivos
  - ENV fallback (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) presente pero ignorado correctamente
  - Canales huérfanos inactivos no referenciados por ningún módulo
- `server/services/telegram.ts` — `sendMessage()` ahora respeta kill switch global (ENV fallback policy)
- `client/src/components/telegram/TelegramAuditTab.tsx` — UI de diagnóstico con badges de severidad y recomendaciones

**Validación FASE C en VPS:**
- `GET /api/telegram/audit` responde correctamente
- Detecta 3 issues HIGH: chat IDs de api_config, IDCA y FISCO no registrados en `telegram_chats`
- ENV fallback: política correcta (ignorado si global OFF o sin canales activos)
- `sendMessage()` respeta kill switch global

### Estado final
- **3 fases completadas y validadas en VPS staging**
- **19/19 tests passing**
- **3 commits pushed a origin/main**: `0a59cb3`, `bb98f61`, `b6098e2`
- **Pendiente**: Registrar los chat IDs legacy (`-1002639300934`, `-10024116945102`, `-1003504297101`) en `telegram_chats` o eliminarlos de las configs de cada módulo

---

## 2026-07-06 — Fix: gridAllocationMode no se guardaba en DB (commit 9405cba)

### Problema
Al cambiar "Modo de reparto de capital" en la UI (Cartera → Configuración de Capital), el valor seleccionado (uniform, progressive_conservative, progressive_aggressive, adaptive_market) no persistía. Al refrescar la página volvía a "uniform".

### Causa raíz
El método `saveConfig()` en `server/services/gridIsolated/gridIsolatedEngine.ts` no incluía los 5 campos de capital allocation en el objeto `values` que se persiste a la DB:
- `gridAllocationMode`
- `gridCapitalDeploymentMode`
- `gridProgressiveIntensity`
- `gridMaxLevelPct`
- `gridMinLevelUsd`

El endpoint `POST /api/grid-isolated/config` sí los aceptaba en `allowedFields` y los guardaba en `this.config` en memoria, pero al llamar `saveConfig()` los campos no se escribían a la fila de `grid_isolated_configs`. Al recargar, `loadConfig()` leía la DB (donde el valor seguía siendo el default `uniform`) y el cambio se perdía.

### Corrección
Añadidos los 5 campos al objeto `values` en `saveConfig()`:
```typescript
gridAllocationMode: this.config.gridAllocationMode,
gridCapitalDeploymentMode: this.config.gridCapitalDeploymentMode,
gridProgressiveIntensity: this.config.gridProgressiveIntensity.toFixed(2),
gridMaxLevelPct: this.config.gridMaxLevelPct.toFixed(2),
gridMinLevelUsd: this.config.gridMinLevelUsd.toFixed(2),
```

### Archivo modificado
- `server/services/gridIsolated/gridIsolatedEngine.ts` — líneas 233-238

### Validaciones
- `npx tsc --noEmit`: OK
- `npx vitest run` (3 suites, 127 tests): 127/127 pass
- Bug confirmado en staging antes del fix: POST config con `gridAllocationMode=adaptive_market` devolvía `null`
- Pendiente: deploy a staging + validación API curl

### Estado final
- El fix está committed y pushed (`9405cba`)
- **No desplegado en staging** — pendiente aprobación de deploy

### Notas
- No se tocaron IDCA, FISCO, REAL, órdenes reales, niveles, ciclos ni DB manualmente
- Cambiar `gridAllocationMode` solo afecta a futuras generaciones de niveles, no regenera niveles existentes

---

## 2026-07-05 — Rebuild seguro de niveles planned antiguos (commit 9b09435)

### Problema

Tras el deploy del fix `208ea3d`, los niveles planned antiguos en DB seguían mostrando SELL=$60 (creados antes del fix). El código nuevo solo afectaría a nuevos rangos/niveles.

### Por qué no se usó SQL manual

- Riesgo de incoherencias entre rango activo, levelsSummary, eventos de auditoría, export ChatGPT, UI e histórico filled/replaced.
- Se decidió usar el motor para regenerar niveles de forma segura.

### Método seguro usado

Se implementó endpoint interno `POST /api/grid-isolated/rebuild-planned-levels` (commit `9b09435`):

**Método en `GridIsolatedEngine.rebuildPlannedLevels()`:**
1. Validar mode = OFF o SHADOW (nunca REAL)
2. Validar `realOpenOrdersCount = 0`
3. Validar `openCycles = 0`
4. Validar no hay niveles con `exchangeOrderId`
5. Validar no hay niveles `filled` en rango activo
6. Marcar rango activo como `replaced`
7. Marcar niveles planned antiguos como `replaced`
8. Generar nuevo rango + niveles con código actualizado (`proposeRangeVersion`)
9. Emitir eventos: `GRID_LEVELS_REPLACED`, `GRID_LEVELS_REBUILT`, `GRID_RANGE_REBUILT_MANUAL`

**Archivos nuevos/modificados:**
- `server/services/gridIsolated/gridIsolatedEngine.ts` — método `rebuildPlannedLevels()`
- `server/routes/gridIsolated.routes.ts` — endpoint `POST /api/grid-isolated/rebuild-planned-levels`
- `server/services/gridIsolated/gridIsolatedTypes.ts` — `GRID_RANGE_REBUILT_MANUAL` en `GridEventType`
- `server/services/gridIsolated/gridActivityFormatter.ts` — mapping para `GRID_RANGE_REBUILT_MANUAL`

### Guardas verificadas antes del rebuild

- mode = SHADOW ✅ (no REAL)
- realOpenOrdersCount = 0 ✅
- openCycles = 0 ✅
- exchangeOrderId = NULL en todos los niveles planned ✅
- No niveles filled en rango activo ✅

### Resultado del rebuild

| Métrica | Antes | Después |
|---|---|---|
| Rango activo | `5221cfca-...` | `e7ad49bc-...` |
| Niveles planned antiguos | 10 (replaced) | — |
| Niveles planned nuevos | — | 10 |
| BUY total | $600.00 | $600.00 |
| Cada BUY | $120.00 | $120.00 |
| SELL total | $300.00 (5 × $60) | $626.42 (5 × ~$125) |
| Cada SELL | $60.00 | $125.04–$125.53 |
| Capital USD necesario | $600.00 | $600.00 |
| Notional bruto visual | $900.00 | $1,226.42 |
| SELL computa USD | No | No |

### Validación post-rebuild

- `mode = OFF` ✅ (restaurado)
- `isActive = false` ✅
- `isRunning = false` ✅
- `realOpenOrdersCount = 0` ✅
- `openCycles = 0` ✅
- `exchangeOrderId = NULL` en nuevos planned ✅
- Niveles filled históricos no tocados ✅
- Niveles replaced históricos no tocados ✅
- Eventos de auditoría emitidos: `GRID_LEVELS_REPLACED`, `GRID_LEVELS_REBUILT`, `GRID_RANGE_REBUILT_MANUAL` ✅
- `capitalAllocationSummary`:
  - `plannedBuyUsd = 600` ✅
  - `plannedSellNotionalUsd = 626.42` ✅ (suma real, no artificial)
  - `grossVisualNotionalUsd = 1226.42` ✅
  - `usdActuallyNeededForBuyLevels = 600` ✅
  - `usdNotNeededBecauseSellLevelsDoNotConsumeUsd = 626.42` ✅
- `tsc --noEmit`: ✅
- `vitest`: 127/127 ✅
- Logs sin errores ✅

### Estado final

- Grid OFF ✅
- No IDCA ✅
- No FISCO ✅
- No REAL ✅
- No órdenes reales ✅
- BITACORA.md actualizado ✅

---

## 2026-07-05 — Fix semántica SELL en tabla de niveles y capitalAllocationSummary

### Problema detectado visualmente

En la tabla de Niveles se observaba:
- SELL #1-#5 con "Capital" = $60 cada uno
- BUY #6-#10 con "Capital" = $120 cada uno

Esto generaba confusión porque:
1. BUY sí consume USD ($120 correcto)
2. SELL no consume USD, pero mostraba $60 sin contexto
3. La columna se llamaba "Capital", pero en SELL no es capital real
4. `capitalAllocationSummary` decía `plannedSellNotionalUsd = $600` (artificial: 5 × $120)
5. La tabla/DB mostraba SELL total = $300 (5 × $60 real)
6. **Divergencia confirmada entre audit ($600) y DB/UI ($300)**

### Causa raíz

1. `gridCapitalAllocator.allocate()` calcula `capitalPerLevelUsd = $600 / 10 = $60` (divide entre todos los niveles)
2. `generateGeometricLevels()` crea 5 BUY + 5 SELL, **todos** con `notionalUsd = $60`
3. `applyWeightsToGeneratedLevels()` redistribuye **solo BUY** → cada BUY pasa a $120
4. **SELL nunca se actualiza** → se queda con $60 residual de la generación inicial
5. `buildCapitalAllocationSummary()` calcula `plannedSellNotionalUsd = sellLevelsCount × firstBuy.notionalUsd` = 5 × $120 = $600 (artificial)

### Fórmula final aplicada para SELL

```
SELL notionalUsd = pairedBuy.quantity × sell.price
```

- Cada SELL vende la cantidad de BTC que el BUY correspondiente compraría
- El precio del SELL es mayor que el del BUY → SELL notional > BUY notional
- SELL incluye implícitamente el beneficio objetivo
- SELL sigue sin consumir USD (`capitalImpactType = requires_base_asset_not_usd`)

### Correcciones aplicadas

**Archivo: `server/services/gridIsolated/gridAllocationEngine.ts`**

1. `applyWeightsToGeneratedLevels()`: después de redistribuir BUY, actualiza cada SELL:
   - `notionalUsd = pairedBuy.quantity × sell.price`
   - `quantity = pairedBuy.quantity` (misma cantidad de BTC)
   - `netProfitTargetUsd`, `feeEstimateUsd`, `taxReserveUsd` recalculados
   - `capitalImpactType = requires_base_asset_not_usd`
   - `allocationReason = "SELL teórico: no consume USD; requiere BTC/inventario"`

2. `buildCapitalAllocationSummary()`:
   - Nuevo parámetro `sellNotionalTotal` en `BuildSummaryParams`
   - `plannedSellNotionalUsd` ahora usa el valor real (suma de SELL notionalUsd)
   - Fallback a cálculo anterior solo si `sellNotionalTotal = 0`

**Archivo: `server/routes/gridIsolated.routes.ts`**

3. Audit endpoint: pasa `sellNotionalTotal` real (suma de `sellLevels[].notionalUsd`) al summary
4. ChatGPT export: texto actualizado con explicación de emparejamiento BUY-SELL y notional visual vs capital real

**Archivo: `client/src/components/grid/GridLevelsPanel.tsx`**

5. Columna "Capital" → "Importe / Notional"
6. Celda: BUY en ámbar ("Consume USD si se ejecuta."), SELL en azul ("No consume USD. Requiere BTC/inventario.")
7. Cards de resumen encima de la tabla:
   - Capital USD en BUY
   - Notional visual SELL
   - Capital USD necesario
   - Notional bruto visual
   - SELL computa USD: No
8. Disclaimer: "Los SELL no consumen USD. Son objetivos teóricos de venta..."
9. Modal: "Capital USD asignado" (BUY) / "Notional visual venta" (SELL)
10. Modal: explicaciones específicas BUY/SELL

### Tests

**Archivo: `server/services/__tests__/gridWeightedLevels.test.ts`**

- Test "SELL levels retain visual notionalUsd" → actualizado a "SELL levels have visual notionalUsd derived from paired BUY quantity × SELL price"
- 10 tests nuevos en bloque "SELL notional consistency: $600 budget, 5 BUY, 5 SELL, uniform":
  - BUY total = 600
  - Cada BUY = 120
  - SELL capitalImpactType correcto
  - BUY capitalImpactType correcto
  - plannedSellNotionalUsd = suma real (no artificial)
  - grossVisualNotionalUsd = plannedBuyUsd + plannedSellNotionalUsd
  - usdActuallyNeededForBuyLevels = plannedBuyUsd
  - usdNotNeededBecauseSellLevelsDoNotConsumeUsd = plannedSellNotionalUsd
  - SELL notional > paired BUY notional
  - SELL quantity = paired BUY quantity

### Validaciones

- `tsc --noEmit`: ✅ sin errores
- `vitest gridIsolatedRoutes`: ✅ 66/66
- `vitest gridAllocationEngine`: ✅ 26/26
- `vitest gridWeightedLevels`: ✅ 35/35 (10 tests nuevos)
- **Total: 127/127 ✅**

### Valores ejemplo (uniform, $600 budget)

| Concepto | Valor |
|---|---|
| BUY total | $600.00 |
| Cada BUY | $120.00 |
| SELL notional visual total | ~$607-610 (ligeramente > $600) |
| Cada SELL | ~$121-122 (pairedBuy.qty × sell.price) |
| Capital USD realmente necesario | $600.00 |
| Notional bruto visual | ~$1,207-1,210 |
| SELL computa USD | No |

### Estado final

- BUY no se rompió: sigue $120 cada uno, $600 total ✅
- Hard cap $600 no se rompió ✅
- Tabla, audit y export coinciden ✅
- No IDCA · No FISCO · No REAL · No órdenes reales
- Grid sigue OFF
- **NO se ha hecho deploy** (pendiente aprobación)

---

## 2026-07-05 — api1: Campos fecha/duración en audit/export ChatGPT

### Objetivo

Exponer los mismos datos de fechas/duración que se ven en UI en los endpoints API:
- `/api/grid-isolated/monitor/audit`
- `/api/grid-isolated/export/chatgpt`
- `/api/grid-isolated/export/json`

### Cambios realizados

**Archivo:** `server/routes/gridIsolated.routes.ts`

**Nuevas funciones helper** (puras, sin side effects):

| Función | Descripción |
|---|---|
| `fmtDateEs(v)` | Formatea fecha a es-ES DD/MM/YYYY HH:mm:ss |
| `durationLabel(fromMs, toMs, suffix)` | Calcula duración "duró Xh Ym" / "abierto hace Xh Ym" |
| `getLevelFinishedAt(level)` | Devuelve Date según status: filled→filledAt, cancelled→cancelledAt/updatedAt, replaced→replacedAt/updatedAt |
| `getLevelFinishedReason(status)` | "Pendiente" / "Ejecutado" / "Reemplazado" / "Cancelado" / "Expirado" |
| `enrichLevelTiming(level)` | Añade: createdAt, finishedAt, finishedReason, durationMs, durationLabel, statusLabel, capitalImpactType |
| `getCycleOpenedAt(cycle)` | openedAt → buyFilledAt → createdAt |
| `getCycleClosedAt(cycle)` | closedAt → completedAt → sellFilledAt → updatedAt (si cerrado) |
| `enrichCycleTiming(cycle)` | Añade: openedAt, closedAt, durationMs, durationLabel, statusLabel |

**Endpoints enriquecidos:**

1. `/monitor/audit`:
   - `levels[]`: cada nivel con timing completo
   - `cycles[]`: cada ciclo con timing completo
   - `levelsSummary.currentLevels[]`: enriquecidos con timing
   - `levelsSummary.historicalLevels[]`: enriquecidos con timing

2. `/export/chatgpt`:
   - Por cada nivel (primeros 5): "Nivel BUY creado el 05/07/2026 14:32:10. Sigue pendiente desde hace 1h 12m."
   - Por cada ciclo (primeros 5): "Ciclo #1 abierto el 05/07/2026 14:35:00 y cerrado el 05/07/2026 15:10:00. Cerrado, duró 35m."

3. `/export/json`:
   - `levels[]` y `cycles[]` enriquecidos con timing

**Reglas de `capitalImpactType`:**
- BUY → `consumes_usd`
- SELL → `requires_base_asset_not_usd`

**Reglas de `finishedAt`:**
- `filled` → `filledAt`
- `cancelled` → `cancelledAt` (fallback `updatedAt`)
- `replaced` → `replacedAt` (fallback `updatedAt`)
- `planned`/`open`/`active` → `null`

### Tests añadidos

**Archivo:** `server/routes/__tests__/gridIsolatedRoutes.test.ts`

| Test | Verifica |
|---|---|
| `monitor/audit levels include timing fields` | createdAt, finishedAt, finishedReason, durationMs, durationLabel, statusLabel, capitalImpactType en todos los niveles |
| `levelsSummary.currentLevels include timing fields` | statusLabel, capitalImpactType, durationLabel |
| `levelsSummary.historicalLevels include timing fields` | statusLabel, capitalImpactType |
| `monitor/audit cycles include timing fields` | openedAt, closedAt, durationMs, durationLabel, statusLabel |
| `export chatgpt handles empty levels/cycles gracefully` | No rompe sin datos |
| `export/json includes enriched levels with timing fields` | statusLabel, capitalImpactType, durationLabel en levels y cycles |

### Validaciones

- `tsc --noEmit`: ✅ sin errores
- `vitest gridIsolatedRoutes`: ✅ 66/66 (6 tests nuevos)
- `vitest gridAllocationEngine`: ✅ 26/26
- `vitest gridWeightedLevels`: ✅ 25/25
- **Total: 117/117 ✅**

### Estado final

- No se añadieron columnas a DB
- No IDCA · No FISCO · No REAL · No órdenes reales
- Grid sigue OFF

---

## 2026-07-05 — val1: Validación capitalAllocationSummary con SHADOW temporal

### Procedimiento

1. Guardado estado inicial: `mode=OFF, isActive=false`
2. Cambiado a `SHADOW` + `isActive=true`
3. Ejecutado `shadow-validate` (tick de simulación)
4. Consultado `/monitor/audit` para inspeccionar `capitalAllocationSummary`
5. Desactivado motor: `isActive=false`
6. Devuelto a `OFF`

### Resultados con budget $600 (uniform)

| Campo | Valor esperado | Valor real | OK |
|---|---|---|---|
| `buyLevelsCount` | > 0 | 5 | ✅ |
| `sellLevelsCount` | > 0 | 5 | ✅ |
| `plannedBuyUsd` | > 0 | 600 | ✅ |
| `plannedSellNotionalUsd` | > 0 | 600 | ✅ |
| `usdActuallyNeededForBuyLevels` | = plannedBuyUsd | 600 | ✅ |
| `usdNotNeededBecauseSellLevelsDoNotConsumeUsd` | = plannedSellNotionalUsd | 600 | ✅ |
| `grossVisualNotionalUsd` | = plannedBuyUsd + plannedSellNotionalUsd | 1200 | ✅ |
| `perLevelAllocations` | no vacío | 5 entradas | ✅ |
| BUY `capitalImpactType` | `consumes_usd` | `consumes_usd` | ✅ |
| SELL `capitalImpactType` | `requires_base_asset_not_usd` | `requires_base_asset_not_usd` | ✅ |

### Per-level allocations (uniform, $600 budget)

| Level | Side | Weight | Allocation | Reason |
|---|---|---|---|---|
| 0 | BUY | 1 | $120 | Uniforme |
| 1 | BUY | 1 | $120 | Uniforme |
| 2 | BUY | 1 | $120 | Uniforme |
| 3 | BUY | 1 | $120 | Uniforme |
| 4 | BUY | 1 | $120 | Uniforme |

5 × $120 = **$600** = budget ✅

### Estado final tras validación

```json
{
  "mode": "OFF",
  "isActive": false,
  "isRunning": false,
  "plannedLevelsCount": 45,
  "realOpenOrdersCount": 0
}
```

- Grid devuelto a OFF ✅
- Motor desactivado ✅
- 0 órdenes reales ✅
- No IDCA · No FISCO · No REAL

---

## 2026-07-05 — Limpieza doc + Fechas en tablas Niveles/Ciclos

### 1. Eliminación de CORRECCIONES_Y_ACTUALIZACIONES.md

`CORRECCIONES_Y_ACTUALIZACIONES.md` eliminado del repositorio. Era fuente paralela obsoleta; todo su contenido estaba ya en commits o en esta `BITACORA.md`.

**Comprobación post-eliminación:**
```
grep -R "CORRECCIONES_Y_ACTUALIZACIONES" . --exclude-dir=node_modules --exclude-dir=.git
→ Solo referencias históricas en docs/*.md de auditoría (no código fuente)
```

**Única fuente oficial: `BITACORA.md`**

### 2. Tabla de Niveles — nuevas columnas Creado / Finalizado / Duración

**Archivo:** `client/src/components/grid/GridLevelsPanel.tsx`

Columnas añadidas a la tabla (sin migración DB — usan campos ya existentes):

| Columna | Fuente | Lógica |
|---|---|---|
| **Estado final** | `status` | Localizado: Planificado / Activo / Ejecutado / Reemplazado / Cancelado |
| **Capital** | `notionalUsd` | Desplazado a posición más visible |
| **Beneficio objetivo** | `netProfitTargetUsd` | Compactado a `+X $` |
| **Creado** | `createdAt` | DD/MM/YYYY HH:mm:ss (es-ES) |
| **Finalizado** | `filledAt` si filled / `cancelledAt` si cancelled|replaced / "Pendiente" si planned | Calculado en UI, sin columna nueva |
| **Duración** | `createdAt` → `filledAt`/`cancelledAt`/`Date.now()` | "duró Xh Ym" o "hace Xh Ym" |

Nuevas funciones helpers (puras, sin side effects):
- `fmtDate(v)` — formatea cualquier fecha a es-ES DD/MM/YYYY HH:mm:ss
- `durationLabel(fromMs, toMs, suffix)` — calcula duración en Xh Ym
- `getLevelFinishedAt(level)` — devuelve Date|null según status
- `getLevelFinishedLabel(level)` — texto "Pendiente" / fecha formateada
- `getLevelStatusLabel(status)` — etiqueta natural española

**Modal de nivel** actualizado con:
- Fila "Creado" con fecha formateada
- Fila "Finalizado" (verde si terminado, gris si pendiente)
- Fila "Duración" (azul, "abierto hace..." / "duró...")
- Fila "Estado natural" en español
- Fila "Impacto capital": BUY → "Consume USD 💵" / SELL → "Requiere BTC/inventario 🔷"
- Textos obligatorios diferenciados BUY/SELL

### 3. Tabla de Ciclos — Reescritura completa GridCyclesPanel.tsx

**Archivo:** `client/src/components/grid/GridCyclesPanel.tsx` (reescrito completamente)

Columnas añadidas a la tabla:

| Columna | Fuente | Lógica |
|---|---|---|
| **Apertura** | `openedAt` → `buyFilledAt` → `createdAt` | Preferencia en orden |
| **Cierre** | `closedAt` → `completedAt` → `sellFilledAt` → `updatedAt` si closed | Fallback encadenado |
| **Duración** | Apertura → Cierre (o ahora si abierto) | "duró Xh Ym" / "hace Xh Ym" |
| **Estado** | `status` | Localizado: Abierto / Compra ejecutada / Cerrado / Cancelado |

Añadido:
- Paginación (10/25/50 por página)
- `showViewAll` prop para botón "Ver todos"
- Modal de detalle con: ID, par, estado, BUY/SELL precios, cantidad, capital usado, PnL bruto/fees/fiscal/neto, apertura, cierre, duración, BUY/SELL filledAt, holdTimeMinutes, levelIds, orderIds

No se añadieron columnas a DB. Toda la lógica de fechas se calcula en UI usando campos existentes (`createdAt`, `filledAt`, `cancelledAt`, `sellFilledAt`, `completedAt`, `updatedAt`).

### Validaciones

- `tsc --noEmit`: ✅ sin errores
- `vitest gridAllocationEngine`: ✅ 26/26
- `vitest gridWeightedLevels`: ✅ 25/25
- `vitest gridIsolatedRoutes`: ✅ 60/60
- **Total: 111/111 ✅**

### Estado final

- Grid en OFF durante todo el proceso
- No IDCA · No FISCO · No REAL · No órdenes reales
- `BITACORA.md` = única fuente oficial

---

## 2026-07-01 — Grid Capital Allocation Refactor

**Objetivo:** Refactorizar completamente la lógica de reparto de capital del Grid Aislado. Corregir el bug donde `gridMaxCapitalPerCycleUsd` era ignorado por el allocator. Añadir modos de reparto (uniform, progressive_conservative, progressive_aggressive, adaptive_market). Exponer un resumen canónico BUY/SELL en la API y la UI. Aclarar que los niveles SELL no consumen USD.

### Auditoría: fórmula real de $86.35

La fórmula que producía `$86.35/nivel` en staging era:

```
totalBalance = $3,454
Perfil: balanced → maxCapitalPctOfBalance = 25%, reservePct = 20%, maxLevels = 12, minNotional = $30, maxNotional = $800

reservedAmount = $3,454 × 20% = $690.80
availableForGrid = $3,454 − $690.80 = $2,763.20
maxGridCapital = $3,454 × 25% = $863.50
finalBudget = min($2,763.20, $863.50) = $863.50

effectiveLevels = min(10, 12) = 10
capitalPerLevel = $863.50 / 10 = $86.35  ← sin clamp

5 BUY × $86.35 = $431.75 USD realmente necesarios
5 SELL × $86.35 = $431.75 notional VISUAL — NO consume USD (requiere BTC/inventario)
```

**Bug corregido:** `gridMaxCapitalPerCycleUsd = 600` era almacenado en DB pero **nunca se aplicaba** como cap al allocator. Ahora se pasa como hard cap vía `constraints.maxCapitalPerCycleUsd`.

### Regla canónica BUY/SELL

- **Niveles BUY**: consumen USD real. `plannedBuyUsd = buyLevelsCount × notionalUsd`.
- **Niveles SELL**: objetivos de salida. Requieren BTC/inventario, **NO consumen USD**. El campo `notionalUsd` en SELL es visual.
- **Notional bruto** (BUY + SELL) ≠ capital USD necesario.
- **Presupuesto no usado**: es normal si el modo es `capped` (conservador por diseño).

### Archivos nuevos

| Archivo | Descripción |
|---|---|
| `server/services/gridIsolated/gridAllocationEngine.ts` | Funciones puras: pesos, distribución, summary |
| `server/services/__tests__/gridAllocationEngine.test.ts` | 26 tests unitarios |

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `shared/schema.ts` | +5 columnas: `grid_allocation_mode`, `grid_capital_deployment_mode`, `grid_progressive_intensity`, `grid_max_level_pct`, `grid_min_level_usd` |
| `server/storage.ts` | +5 migraciones automáticas `ADD COLUMN IF NOT EXISTS` |
| `server/services/gridIsolated/gridIsolatedTypes.ts` | +`AllocationMode`, `CapitalDeploymentMode`, `CapitalAllocationSummary`, `PerLevelAllocation`; +5 campos en `GridIsolatedConfig` y `DEFAULT_GRID_CONFIG` |
| `server/services/gridIsolated/gridCapitalAllocator.ts` | `allocate()` acepta `GridCapitalConstraints`; aplica `maxCapitalPerCycleUsd` como hard cap |
| `server/services/gridIsolated/gridIsolatedEngine.ts` | `loadConfig()` mapea los 5 nuevos campos; `proposeRangeVersion()` pasa constraints al allocator |
| `server/routes/gridIsolated.routes.ts` | `allowedFields` +5 campos; `levelsSummary.capitalAllocationSummary` en audit; ChatGPT export con BUY/SELL breakdown |
| `client/src/components/grid/GridCarteraDashboard.tsx` | Panel "Reparto real de capital del Grid" con cards BUY/SELL, barra de uso, explicación, tabla per-level, selector de modo |
| `client/src/components/grid/GridAjustesPanel.tsx` | +`auditData` prop → pasa a `GridCarteraDashboard` |
| `client/src/pages/GridIsolated.tsx` | Pasa `auditData` a `GridAjustesPanel` |
| `server/routes/__tests__/gridIsolatedRoutes.test.ts` | +3 tests: capitalAllocationSummary en audit, chatgpt crash check |

### Modos de reparto implementados

| Modo | Comportamiento |
|---|---|
| `uniform` | Igual capital por nivel BUY (default) |
| `progressive_conservative` | Peso_i = 1 + intensity × i (conservative, default intensity=0.20) |
| `progressive_aggressive` | Peso_i = 1 + intensity × i (aggressive, default intensity=0.45) |
| `adaptive_market` | Peso por distancia al precio actual × factor régimen |

### Modos de uso de presupuesto

| Modo | Comportamiento |
|---|---|
| `capped` | Hasta el máximo configurado, sin forzar gasto total (default) |
| `target_budget` | Intenta aproximarse al máximo; el sobrante es mínimo |

### Validaciones

- `tsc --noEmit`: ✅ sin errores
- `vitest gridAllocationEngine`: ✅ 26/26
- `vitest gridIsolatedRoutes`: ✅ 60/60

### Aplicación de pesos reales en generación de niveles (r12 — completado)

**Problema:** `generateGeometricLevels()` asignaba `capitalPerLevelUsd` uniforme a todos los niveles BUY, ignorando el modo de reparto configurado.

**Solución implementada (2 pasos, sin migración DB):**

**Paso 1 — `gridGeometricLevels.ts`:**
- Nuevo tipo `CapitalImpactType = "consumes_usd" | "requires_base_asset_not_usd"`
- `GeneratedLevel` ahora incluye: `capitalImpactType`, `allocationWeight`, `allocationReason`
- BUY defaults: `capitalImpactType = "consumes_usd"`, weight = 1.0
- SELL defaults: `capitalImpactType = "requires_base_asset_not_usd"`, weight = 0

**Paso 2 — `gridAllocationEngine.ts`:**
- Nueva función `applyWeightsToGeneratedLevels(levels, effectiveBuyBudget, allocationMode, ...)`
- Muta los niveles BUY en-place: actualiza `notionalUsd`, `quantity`, `netProfitTargetUsd`, `feeEstimateUsd`, `taxReserveUsd`
- Marca los niveles SELL con los metadatos correctos
- El `notionalUsd` resultante queda persistido en DB con el valor correcto ponderado

**Paso 3 — `gridIsolatedEngine.ts` `proposeRangeVersion()`:**
- Llama a `applyWeightsToGeneratedLevels` DESPUÉS de `generateGeometricLevels` y ANTES de la inserción en DB
- Los niveles se persisten con el `notionalUsd` real ponderado

**Nuevo archivo de tests — `gridWeightedLevels.test.ts` (25 tests):**
- Invariantes de `capitalImpactType` por lado
- Cap de presupuesto BUY
- Floor `minLevelUsd`
- Modo uniform: todos iguales
- Modo progressive_conservative: BUY[0] < BUY[1] < ... (monotonía)
- Modo progressive_aggressive: pendiente más pronunciada
- Ejemplo real: $3454 balance, perfil balanced, cap $600
  - `computeEffectiveBuyBudget(863.5, 600, "capped", 5, 30) = 600` ✅
  - Uniform: 5 BUY × $120 = $600 total ✅
  - Progressive: suma ≈ $600, nivel más profundo > $120 ✅
  - SELL: visual, `capitalImpactType = "requires_base_asset_not_usd"` ✅
- Adaptive market: pesos por distancia
- Edge cases: budget 0, banda muy estrecha

**Validaciones finales:**
- `tsc --noEmit`: ✅ sin errores
- `vitest gridAllocationEngine`: ✅ 26/26
- `vitest gridWeightedLevels`: ✅ 25/25
- `vitest gridIsolatedRoutes`: ✅ 60/60
- **Total: 111/111 ✅**

### Pendiente

- Deploy staging: requiere aprobación explícita.

---

## 2026-04-27 — Refactor IDCA Telegram Alerts (Sliders UI + Anti-spam)

**Objetivo:** Eliminar spam en alertas Telegram IDCA, proporcionar información accionable, y permitir configuración vía UI con sliders profesionales.

**Commits:**
- **C** (aa9ea5b): Schema + sliders + derivación
  - `entryUiJson` + `telegramUiJson` en institutional_dca_config (nullable JSONB)
  - Migración 031_idca_slider_config.sql
  - `IdcaSliderConfig.ts` con defaults profesionales (BTC dip 4.20%, ETH dip 4.60%, rebote 0.55%/0.65%)
  - `IdcaEngine.ts` usa `getEffectiveEntryConfig` en lugar de hardcoded
  - 32 tests nuevos

- **D** (b6fbb96): UI sliders entrada + alertas Telegram IDCA
  - ConfigTab: sub-pestaña "Entrada" (por defecto) con 4 sliders + resumen calculado
  - TelegramTab: card "ALERTAS IDCA" con 3 sliders reemplaza panel complejo de toggles
  - Helpers client-side `lerpUI`, `deriveEntryPreview`, `deriveAlertPreview`

- **E** (af616c8): Cooldowns dinámicos desde sliders
  - `IdcaTelegramAlertPolicy.ts`: `resolveTrailingBuyPolicyWithSliders`
  - `IdcaTrailingBuyTelegramState.ts`: `watchingMinIntervalMs` opcional
  - `IdcaTelegramNotifier.ts`: WATCHING y TRACKING usan cooldowns dinámicos

- **F** (98ff9e9): Digest usa cooldowns dinámicos
  - `IdcaEngine.ts`: digest usa `resolveTrailingBuyPolicyWithSliders`

- **Fix** (7c928a0): Auto-migración 031 en storage.ts
  - Añadido `entryUiJson` y `telegramUiJson` a `runSchemaMigration()`

**Archivos nuevos:**
- `server/services/institutionalDca/IdcaSliderConfig.ts` — Configuración slider con interpolación
- `db/migrations/031_idca_slider_config.sql` — Migración DB
- `server/services/__tests__/idcaSliderConfig.test.ts` — 32 tests

**Archivos modificados:**
- `shared/schema.ts` — entryUiJson + telegramUiJson
- `server/services/institutionalDca/IdcaEngine.ts` — usa getEffectiveEntryConfig
- `server/services/institutionalDca/IdcaTelegramAlertPolicy.ts` — resolveTrailingBuyPolicyWithSliders
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — WATCHING/TRACKING usan sliders
- `server/services/institutionalDca/IdcaTrailingBuyTelegramState.ts` — watchingMinIntervalMs opcional
- `server/storage.ts` — auto-migración 031
- `client/src/hooks/useInstitutionalDca.ts` — IdcaConfig interface
- `client/src/pages/InstitutionalDca.tsx` — UI sliders entrada + alertas

**Validación:**
- npm run check: 
- npm run build: 
- vitest: 98/98 tests pasando

**Deploy VPS:**
```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build
```
La migración 031 se aplica automáticamente al arrancar via `storage.ts::runSchemaMigration()`.

---

## ARQUITECTURA GENERAL

┌──────────────────────────────────────────────────────────────────┐
│                     ExchangeFactory (singleton)                   │
│                  Kraken  ←→  RevolutX                             │
│     Trading exchange / Data exchange (configurable)               │
└────────────┬─────────────────────────────────┬───────────────────┘
             │                                 │
             ▼                                 ▼
┌────────────────────────┐     ┌──────────────────────────────────┐
│  MarketDataService     │     │  tradingEngine (Modo Normal)     │
│  (cache unificado)     │     │  SmartGuard + Momentum + Candles │
│  TTLs: 15m/1h/1d/spot │     │  + ExitManager + FillWatcher     │
└────────┬───────────────┘     └──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│                     IdcaEngine (Modo IDCA)                        │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────┐ │
│  │IdcaSmartLayer│  │TrailingBuyMgr  │  │IdcaMessageFormatter  │ │
│  │(VWAP,rebound │  │(trailing stop  │  │(mensajes humanos +   │ │
│  │ ATR,basePrice│  │ buy inverso)   │  │ técnicos Telegram)   │ │
│  │ safetyOrders)│  │                │  │                      │ │
│  └──────────────┘  └────────────────┘  └──────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Exchanges soportados
- **Kraken**: API completa (OHLC, ticker, balance, orders, fills). Rate limiter FIFO con backpressure + estado degradado.
- **RevolutX**: Orders, fills, balances. Sin ticker/OHLC → usa Kraken como data source. `pendingFill` → FillWatcher monitorea.

### Modos de operación
- **NORMAL**: SmartGuard (BE + trailing + scale-out + time-stop)
- **IDCA**: Institutional DCA (ciclos, safety orders, TP dinámico, VWAP)
- **DRY_RUN**: Simulación sin órdenes reales (ambos modos)

---

## 🏗️ ESTRUCTURA DEL PROYECTO

```
server/
  services/
    tradingEngine.ts          ← Motor principal (modo Normal)
    exitManager.ts            ← SL/TP/BE/Trailing/Scale-out/Time-stop
    FillWatcher.ts            ← Reconciliación de fills pendientes
    MarketDataService.ts      ← Cache unificado velas+precios (TTL)
    strategies.ts             ← momentumCandlesStrategy
    telegram.ts               ← Multi-chat, alertas, polling
    ErrorAlertService.ts      ← Alertas críticas (instancia inyectada)
    botLogger.ts              ← Eventos + retención configurable
    kraken.ts                 ← Kraken API wrapper
    BackupService.ts          ← DB + code backups
    exchanges/
      ExchangeFactory.ts      ← Singleton multi-exchange
      RevolutXService.ts      ← RevolutX API
      IExchangeService.ts     ← Interfaz común
    institutionalDca/
      IdcaEngine.ts           ← Motor IDCA (ciclos, scheduler)
      IdcaSmartLayer.ts       ← VWAP, ATR, rebound, base price, safety orders
      IdcaTypes.ts            ← Interfaces (SafetyOrderLevel, VwapEntryContext, etc.)
      IdcaMessageFormatter.ts ← Mensajes humanos + técnicos
      IdcaReasonCatalog.ts    ← Catálogo de bloqueos con templates
      TrailingBuyManager.ts   ← Trailing stop buy inverso (in-memory)
  routes/
    config.ts                 ← Config REST API (15 endpoints)
    institutionalDca.routes.ts← IDCA REST API
    fiscoAlerts.routes.ts     ← Alertas FISCO
  utils/
    krakenRateLimiter.ts      ← FIFO + backpressure + degraded state
shared/
  schema.ts                   ← Drizzle schema (todas las tablas)
client/src/
  pages/
    InstitutionalDca.tsx      ← UI IDCA completa
    Terminal.tsx               ← Posiciones + historial
    Monitor.tsx                ← Eventos tiempo real
    Notifications.tsx          ← Preferencias alertas Telegram
  components/
    idca/IdcaEventCards.tsx    ← Cards con humanMessage + chips técnicos
  hooks/
    useInstitutionalDca.ts    ← React Query hooks IDCA
db/migrations/                ← SQL migrations (001-028)
script/migrate.ts             ← Migration runner (deploy automático)
```

---

## 📊 TABLAS DB PRINCIPALES

| Tabla | Propósito |
|-------|-----------|
| `bot_config` | Config global (SmartGuard, pares, dry_run, log retention) |
| `api_config` | Credenciales Kraken + RevolutX + Telegram |
| `open_positions` | Posiciones abiertas (solo bot-managed, nunca creadas por sync) |
| `trades` | Historial de trades (origin: engine/manual/sync) |
| `trade_fills` | Fills individuales por exchange |
| `order_intents` | Órdenes enviadas con tracking de estado |
| `institutional_dca_config` | Config global IDCA + scheduler + recovery |
| `institutional_dca_asset_configs` | Config por par (dip, rebound, VWAP, safety, TP, sliders) |
| `institutional_dca_cycles` | Ciclos activos/cerrados con base_price, TP, fees |
| `institutional_dca_orders` | Órdenes de ciclo (base_buy, safety_buy, take_profit) |
| `institutional_dca_events` | Eventos con humanMessage + technicalSummary + payload |
| `time_stop_config` | TTL por activo con multiplicadores régimen |
| `market_metrics_snapshots` | Snapshots de métricas (Fear&Greed, etc.) |
| `market_metrics_evaluations` | Evaluaciones por par (score, bias, action) |
| `fisco_operations` | Operaciones fiscales (Kraken + RevolutX) |
| `fisco_lots` | Lotes FIFO para cálculo fiscal |
| `fisco_disposals` | Ventas con cost basis y gain/loss EUR |
| `training_trades` | Pipeline ML (backfill + labeling) |
| `regime_state` | Estado régimen por par (TRANSITION, BULL, BEAR, RANGE) |
| `telegram_chats` | Multi-chat con preferencias granulares |

---

## 🔄 FLUJO DE DATOS

### Modo Normal (scan loop ~60s)
```
1. exitManager.checkStopLossTakeProfit() → SL/TP/BE/Trailing siempre
2. KrakenRL.getState() → actualizar marketDataDegraded
3. Por cada par:
   a. shouldPollForNewCandle() → fetch vela si nueva (con catch-up cap)
   b. Si CANDLE_NEW + !marketDataDegraded:
      - analyzeWithCandleStrategy() → señal BUY/SELL/HOLD
      - Si BUY: gate reentrada + anti-burst + exposure → executeTrade
      - Si SELL: SmartGuard filter → safeSell
   c. Si CANDLE_SAME: skip (timing invariant guard)
```

### Modo IDCA (scheduler adaptativo)
```
1. getCurrentPrice(pair) via MarketDataService
2. updateOhlcvCache(pair) via MarketDataService (1h + 1d)
3. checkEntryConditions():
   a. computeHybridV2() → base price
   b. entryDipPct = (basePrice - currentPrice) / basePrice
   c. Si dip >= minDip + marketScore OK + rebound OK:
      - computeVwapAnchored() → zona VWAP
      - Retorna IdcaEntryCheckResult con vwapContext
4. Si entry allowed: crear ciclo + base buy + safety levels
5. Monitor ciclos activos: safety buys + exit management
```

---

## 🔐 REGLAS INVARIANTES

1. **`open_positions` = solo posiciones del bot** — Reconcile/sync nunca crea posiciones, solo `trades`
2. **Salidas siempre ejecutan** — `marketDataDegraded` bloquea entradas, nunca salidas
3. **Migraciones idempotentes** — `ADD COLUMN IF NOT EXISTS` en ambos paths (deploy + startup)
4. **IDCA allowed pairs** — Solo `["BTC/USD", "ETH/USD"]` (constante en `shared/schema.ts`)
5. **Telegram single instance** — ErrorAlertService usa instancia inyectada, nunca crea la suya
6. **DRY_RUN gate en memoria** — Contadores de slots y cooldown usan Maps en memoria, no DB

---

## 🚀 DEPLOY

```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build
```

Migraciones ejecutan automáticamente:
- `script/migrate.ts` (pre-start en Docker) — aplica SQL files de `db/migrations/`
- `storage.runSchemaMigration()` (startup app) — ALTER TABLE inline como redundancia

### Verificación post-deploy
```bash
docker logs krakenbot-staging-app --tail 50
# Buscar: [migrate] Migration completed successfully!
# Buscar: [startup] Auto-migration: added ...
# Buscar: [startup] ExchangeFactory initialized
```

---

## 📡 ENDPOINTS CLAVE

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/api/market-data/stats` | GET | Cache stats de MarketDataService |
| `/api/exchange-diagnostics` | GET | Nonce, rate limiter, estado exchanges |
| `/api/portfolio` | GET | Balances + precios + P&L |
| `/api/open-positions` | GET | Posiciones abiertas |
| `/api/events` | GET | Eventos con filtros temporales |
| `/api/test/critical-alert` | POST | Test alerta Telegram |
| `/api/idca/*` | CRUD | Config, ciclos, órdenes, eventos IDCA |
| `/api/fisco/*` | CRUD | Operaciones, lotes, sync fiscal |

---

## ⚙️ MODO NORMAL — DETALLE TÉCNICO

### Motor de señales
- `momentumCandlesStrategy()`: EMA10/20, RSI, MACD, Bollinger, volumen, engulfing. Score ponderado con umbral configurable.
- `analyzeWithCandleStrategy()`: Multi-timeframe analysis + hybrid guard watches + anti-cresta + volume overrides + early momentum.

### SmartGuard (gestión de posiciones)
- **Break-even progresivo**: Activa stop a entry cuando P&L >= `sg_be_at_pct`
- **Trailing stop**: Arranca a `sg_trail_start_pct`, distancia `sg_trail_distance_pct`, steps `sg_trail_step_pct`
- **Scale-out**: Venta parcial (`sg_scale_out_pct`) al alcanzar `sg_scale_out_threshold`
- **TP fijo**: Opcional, a `sg_tp_fixed_pct`
- **Time-stop**: TTL por activo con multiplicadores por régimen (table `time_stop_config`)

### Protecciones
- **KrakenRL backpressure**: Cola FIFO con `KRAKEN_MAX_QUEUE_SIZE` (default 60). Queue overflow → rechazo inmediato.
- **Market Data Degraded**: Histéresis (entrada: queue>30 OR waitedMs>15s OR 3+ errores; salida: 3 ticks limpios). Bloquea entradas, no salidas.
- **Catch-up cap**: Max 1 poll catch-up/30s por par. Si desfase >4 intervalos → reset sync.
- **Anti-burst DRY_RUN**: Gate reentrada + cooldown 120s usando contadores en memoria.

### Telegram dedup
- SELL_BLOCKED: Cooldown 15 min por par
- Circuit breaker: Cooldown 15 min por lotId
- DRY_RUN: Max 1 mensaje simulación por par+tipo cada 15 min
- Market data degraded: Cooldown 10 min por par

---

## 📈 MODO IDCA — DETALLE TÉCNICO

### MarketDataService (singleton)
Cache TTL unificado para velas y precios. Sirve a ambos modos.

| Timeframe | TTL |
|-----------|-----|
| 15m | 20 min |
| 1h | 90 min |
| 1d | 6 horas |
| Spot price | 30 seg |

### Base Price (computeHybridV2)
Precio de referencia determinístico:
- Ventanas: 24h, 48h, 72h, 7d, 30d
- Candidatos: Swing highs (pivot detection) + P95
- Outlier guard: ATR-based
- Tolerancias dinámicas por par: Swing BTC [6%-18%], ETH [8%-25%]; Cap 7d BTC [6%-20%], ETH [8%-25%]; Cap 30d BTC 20%, ETH 25%

### VWAP Anchored + Bandas
- `computeVwapAnchored()`: VWAP desde timestamp del base price, bandas ±1σ y ±2σ
- `getVwapBandPosition()`: Zona → `below_lower2` / `below_lower1` / `between_bands` / `above_upper1` / `above_upper2`
- Per-pair toggle: `vwapEnabled` (default OFF)

### Dynamic Safety Orders
- `adjustSafetyOrdersWithVwap()`: Ajusta `dipPct` según zona VWAP (deep value → tighten, overextended → widen)
- Per-pair toggle: `vwapDynamicSafetyEnabled` (default OFF)

### Rebound Detection
- 3 condiciones OR: lower wick >40% range, bounce > `reboundMinPct` desde local low, bearish momentum decelerating
- `reboundMinPct`: Configurable por par (default 0.30%)

### TrailingBuyManager
Trailing stop inverso para entradas:
1. `arm(pair)` → empieza tracking
2. `update(pair, price)` → dispara buy cuando bounce >= 0.5% desde local low
3. Expira después de 4h. Estado efímero (in-memory)

### Ciclos
- **Main**: Compra base + safety orders escalonados
- **Plus**: Compra adicional en ciclo existente
- **Recovery**: Ciclo secundario cuando main está en drawdown

### Exit (3 sliders por par)
1. **Protección**: Stop-loss a `protectionActivationPct`
2. **Trailing**: Arranca a `trailingActivationPct`, margen `trailingMarginPct`
3. **Close**: Rompe trailing → venta

### Mensajes humanos
- `humanTitle` + `humanMessage` en castellano natural
- `technicalSummary` como chips coloreados en UI
- Composición inteligente multi-bloqueo
- Signo semántico: positivo = "Caída X%", negativo = "Precio sobre ancla X%"

---

## 🔌 IDCA ASSET CONFIG — COLUMNAS

| Columna | Tipo | Default |
|---------|------|---------|
| `pair` | TEXT | — |
| `enabled` | BOOLEAN | true |
| `min_dip_pct` | DECIMAL | 2.00 |
| `dip_reference` | TEXT | hybrid |
| `require_rebound_confirmation` | BOOLEAN | true |
| `rebound_min_pct` | DECIMAL | 0.30 |
| `trailing_buy_enabled` | BOOLEAN | true |
| `vwap_enabled` | BOOLEAN | false |
| `vwap_dynamic_safety_enabled` | BOOLEAN | false |
| `safety_orders_json` | JSONB | [{2%,25%},...] |
| `max_safety_orders` | INTEGER | 4 |
| `take_profit_pct` | DECIMAL | 4.00 |
| `dynamic_take_profit` | BOOLEAN | true |
| `protection_activation_pct` | DECIMAL | 1.00 |
| `trailing_activation_pct` | DECIMAL | 3.50 |
| `trailing_margin_pct` | DECIMAL | 1.50 |
| `cooldown_minutes_between_buys` | INTEGER | 180 |
| `max_cycle_duration_hours` | INTEGER | 720 |

---

## 🛡️ GUARDS Y PROTECCIONES

| Guard | Descripción |
|-------|-------------|
| Market Data Degraded | Histéresis KrakenRL. Bloquea entradas, no salidas |
| Anti-burst | Cooldown 120s entre entradas (LIVE + DRY_RUN) |
| DRY_RUN double-sell | Previene SELL duplicado si lot ya cerrado |
| Queue overflow | Rechaza tareas KrakenRL si cola >= 60 |
| Catch-up cap | Max 1 poll catch-up/30s, reset si >4 intervalos |
| Timing invariant | Detecta desync reloj, resetea lastEvaluatedCandle |
| Fee cushion | Markup mínimo para cubrir comisiones |
| Anti-cresta | Filtro de señales en pico de momentum |
| MTF strict | Confirmación multi-timeframe |

---

## 💬 TELEGRAM

### Multi-chat con preferencias granulares
Cada chat configura qué subtipos recibe (trades, errores, sistema, balance, heartbeat).

### Subtipos de alerta
- `trade_buy_*`, `trade_sell_*`, `trade_entry_blocked_degraded`
- `system_market_data_degraded_on/off`
- `system_error_*`, `system_heartbeat`
- `idca_*` (cycle started, buy executed, entry blocked, cycle closed, etc.)

### ErrorAlertService
Usa instancia inyectada del TelegramService global. Severidad: 🟡 Medium / 🔴 High / 🚨 Critical

---

## 💰 FISCO

- Panel UI estilo Bit2Me: operaciones, lotes FIFO, disposals, P&L fiscal en EUR
- Sync Kraken + RevolutX con retry/rate-limit
- Cron diario 08:30 + sync manual
- Alertas Telegram configurables por canal
- Tablas: `fisco_operations`, `fisco_lots`, `fisco_disposals`, `fisco_sync_history`, `fisco_sync_retry`

---

## 📎 REFERENCIA RÁPIDA

### RevolutX endpoints funcionales
| Endpoint | Método |
|----------|--------|
| `/api/1.0/accounts` | GET |
| `/api/1.0/orders` | POST / DELETE / GET |
| `/api/1.0/fills` | GET |
| `/api/1.0/currencies` | GET |
| `/api/1.0/symbols` | GET |

No disponibles: ticker (404), orderbook (404)

### Significado de `origin` en trades
| Valor | Significado |
|-------|-------------|
| `engine` | Ejecutado por motor de trading |
| `manual` | Ejecutado via API/dashboard |
| `sync` | Importado desde exchange |

### Queries de verificación útiles
```sql
-- Posiciones con snapshot
SELECT pair, entry_mode, config_snapshot_json IS NOT NULL as has_snapshot
FROM open_positions ORDER BY pair;

-- Trades por origen
SELECT origin, COUNT(*) FROM trades GROUP BY origin;

-- Ciclos IDCA activos
SELECT id, pair, status, cycle_type, buy_count, capital_used_usd
FROM institutional_dca_cycles WHERE status = 'active';

-- IDCA asset configs
SELECT pair, enabled, min_dip_pct, vwap_enabled, rebound_min_pct
FROM institutional_dca_asset_configs;
```

---

## 2026-04-23 — Terminal IDCA: Subpestaña de Logs Técnicos en Tiempo Real

### Nuevos archivos
- `server/services/institutionalDca/idcaLog.ts` — Helper centralizado `idcaLog(level, message, meta)` para emitir logs técnicos IDCA a consola + `institutional_dca_events`
- `client/src/components/idca/IdcaTerminalPanel.tsx` — Componente React "Terminal" tipo consola con polling 5s, filtros, pausa/reanudar, exportar, copiar
- `server/services/__tests__/idcaTerminalLogs.test.ts` — 11 tests unitarios sin DB (truncación payload, mapeo, retención)

### Archivos modificados
- `server/routes/institutionalDca.routes.ts` — Añadido endpoint `GET /api/institutional-dca/terminal/logs` (filtros: pair, mode, level, q, from, to, limit). Retención cambiada de 7 → 30 días.
- `client/src/hooks/useInstitutionalDca.ts` — Añadido hook `useIdcaTerminalLogs` con polling cada 5s
- `client/src/pages/InstitutionalDca.tsx` — `EventsTab` actualizado con 3ª subpestaña "Terminal"
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — Corregido `config` no definido en `alertTrailingBuyTriggered`

### Diseño
- **Fuente de datos**: `institutional_dca_events` (sin crear tabla nueva). La Terminal muestra TODOS los eventos incluyendo técnicos que el feed visual oculta.
- **Retención**: 30 días (purga batch cada 6h)
- **Polling**: 5s en tiempo real, pausa manual disponible
- **Máx**: 1.000 logs por request, 1.000 en vista
- **Filtros**: par, modo, nivel, texto libre, rangos de fecha (1h/6h/24h/7d/30d/Custom)

### Validación
- `npm run check` — 0 errores TypeScript
- `npm run build` — OK (3785 módulos)
- `vitest run idcaTerminalLogs.test.ts` — 11/11 tests

---

## 2026-04-26 — Logs IDCA: Nueva Pestaña Estilo Monitor Normal

### Objetivo
Añadir una 4ª subpestaña "Logs IDCA" en IDCA → Eventos, con vista continua tipo consola idéntica al Monitor normal del bot principal. Sin eliminar la pestaña "Terminal" existente.

### Nuevos archivos
- `client/src/components/idca/IdcaLogsPanel.tsx` — Componente React "Logs IDCA" completo:
  - Fondo oscuro `zinc-950`, fuente monoespaciada
  - Líneas completas con timestamp, badge nivel, badge par, badge modo, mensaje expandible
  - Campos técnicos extraídos inline: score, caída, mínimo, bloqueos, precio ref, precio actual, zona, trigger, motivo
  - Click en línea expande RAW completo
  - Polling 5s en modo "En vivo", histórico REST en otros rangos
  - Filtros: rango (1h/6h/24h/7d/30d/En vivo), nivel (INFO/WARN/ERROR/DEBUG), par, modo (SIM/LIVE), tipo (entrada/VWAP/TrailingBuy/compra/salida/warning/sistema), búsqueda libre
  - Copiar TXT (incluye RAW + campos extraídos), Copiar JSON, Descargar TXT, Descargar JSON, Export API
- `server/services/__tests__/idcaLogs.test.ts` — 42 tests unitarios sin DB

### Archivos modificados
- `client/src/pages/InstitutionalDca.tsx`:
  - Import `IdcaLogsPanel`
  - `EventsTab` actualizado con 4ª subpestaña "Logs IDCA" (`BarChart3` icon)
  - Descripción contextual por subpestaña (Terminal vs Logs IDCA)

### Diseño
- **Fuente de datos**: `GET /api/logs?search=[IDCA]&source=app_stdout` → tabla `server_logs` (reutiliza infraestructura existente, sin endpoint nuevo)
- **Sin WebSocket**: Polling 5s para "En vivo"; histórico vía REST para rangos
- **Parseo frontend**: `parseIdcaLine()` extrae par, modo, nivel, tipo de evento y campos numéricos de la línea de texto
- **Export completo**: copiar/descargar incluye `RAW: [línea original completa]` + campos extraídos → no solo el mensaje visible
- **Terminal sigue intacto**: subpestaña "Terminal" con `IdcaTerminalPanel` no se modifica

### Diferencia funcional Terminal vs Logs IDCA
| | Terminal | Logs IDCA |
|---|---|---|
| Fuente | `institutional_dca_events` | `server_logs` vía `console.log` |
| Vista | Eventos enriquecidos (tarjetas) | Líneas continuas tipo consola |
| Necesita abrir evento | Sí | No — todo inline |
| Export | Eventos IDCA estructurados | Líneas RAW + campos extraídos |
| Tiempo real | Polling 5s | Polling 5s / histórico |

### Validación
- `npm run check` — 0 errores TypeScript
- `npm run build` — OK (3786 módulos)
- `vitest run idcaLogs.test.ts` — 42/42 tests
- `vitest run idcaTrailingBuyTelegramState idcaLadderAtrp idcaMessageFormatter idcaReasonCatalog idcaLogs` — 131/131 tests

---

*Última actualización: 2026-04-26*
*Mantenido por: Windsurf Cascade AI*