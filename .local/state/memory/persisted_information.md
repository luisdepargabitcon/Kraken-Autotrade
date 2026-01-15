# KrakenBot - Estado Actual (15 Dic 2025)

## TAREAS COMPLETADAS

### 1. Unificación de métricas de diagnóstico IA
- Añadido `lastBackfillDiscardReasonsJson` a ai_config
- `getDiagnostic()` devuelve `discardReasonsDataset` y `lastBackfillDiscardReasons`
- Traducción de claves legacy inglés→castellano via LEGACY_KEY_MAP
- Invariancia: qtyRemaining <= epsilon → isClosed=true

### 2. Fix UI /settings
- Actualizado interface AiDiagnostic con nuevos campos
- Cambiado `discardReasons` → `discardReasonsDataset || {}`

### 3. Actualización de replit.md
- Añadida sección AI Filter Module completa
- Documentados discard reasons en castellano
- Añadida sección Recent Changes (Dec 2025)

## Estado actual
- Build: OK
- APIs: OK (diagnostic, config, open-positions)
- UI: Necesita hard refresh del navegador (Ctrl+Shift+R) por JS cacheado
- Motor de trading: Funcionando normalmente

## Pendiente usuario
- Hard refresh en navegador para limpiar cache de JS viejo
- Validar en NAS: GET→POST backfill→GET
- Autorizar publicación cuando confirme que todo funciona

## Archivos clave modificados
- shared/schema.ts
- server/storage.ts  
- server/services/aiService.ts
- client/src/pages/Settings.tsx
- replit.md
