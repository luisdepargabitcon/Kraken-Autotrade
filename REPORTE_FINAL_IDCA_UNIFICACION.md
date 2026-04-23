# Reporte Final - Unificación IDCA (Corregido)

## 1. Método exacto de arranque backend que sí funciona

```powershell
$env:DATABASE_URL="postgres://krakenbot:KrakenBot2024Seguro@localhost:5432/krakenbot"
node dist/index.cjs
```

**Nota:** `npm start` no carga .env correctamente en PowerShell. Usar DATABASE_URL explícito.

---

## 2. Resultado real de los 4 endpoints IDCA

Todos responden 200 con JSON real:

- `/api/institutional-dca/asset-configs` → 200 (BTC enabled: True)
- `/api/institutional-dca/market-context/preview/BTCUSD` → 200
- `/api/institutional-dca/ladder/preview/BTCUSD?profile=balanced&sliderIntensity=50` → 200
- `/api/institutional-dca/validation/status` → 200

---

## 3. Validación real del cambio ancla vs banda

**Código IdcaEngine.ts (líneas 2321-2325):**
```typescript
// ── Effective base price: anchorPrice (frozen anchor or current swing high) ──
// Referencia principal: caída desde ancla
// VWAP se usa solo como confirmación, no como base de cálculo
const effectiveBasePrice = basePriceResult.price;
const basePriceMethod = "anchor_price";
```

**Mensaje evento (línea 1023):**
```
Mín dip efectivo: ${minDip.toFixed(2)}% desde ancla ($${effectiveBasePrice.toFixed(2)})
```

**Conclusión:** El trigger de entrada se calcula desde anchorPrice, no desde VWAP lowerBand1.

---

## 4. Validación del parche anti-duplicados del ladder

**Código IdcaLadderAtrpService.ts (línea 163):**
```typescript
const minDipForLevel = i === 0 ? config.minDipPct : (levels[i - 1].dipPct + 0.5);
```

**Resultados reales por perfil:**

- **balanced (sliderIntensity=50):** 0.8%, 1.3%, 1.8%, 2.3% (monotónico, cada 0.5% mayor)
- **aggressive (sliderIntensity=80):** 0.5%, 1.0%, 1.5%, 2.0%, 2.5% (monotónico, cada 0.5% mayor)
- **conservative (sliderIntensity=30):** 1.0%, 1.5%, 2.0%, 2.5% (monotónico, cada 0.5% mayor)

**Proporcionalidad con ATRP:** Se mantiene (atrpMultiplier aumenta con cada nivel)

**Conclusión:** El parche +0.5 resuelve duplicados sin romper monotonicidad ni proporcionalidad.

---

## 5. Estado final real

**COMPILA Y VALIDA PARCIAL EN LOCAL**

**Validación:**
- ✅ TSC sin errores
- ✅ vite build exitoso
- ✅ Backend arranca con DATABASE_URL explícito
- ✅ 4 endpoints IDCA responden 200 con JSON real
- ✅ Parche anti-duplicados funciona (validado en 3 perfiles)
- ✅ Cambio lógica ancla vs banda validado en código
- ❌ UI no validada visualmente (requiere navegador)

**Archivos modificados (10):**
1. IdcaLadderAtrpService.ts - Añadido atrpMultiplier a preview, parche +0.5 anti-duplicados
2. IdcaEngine.ts - Corregido lógica ancla vs banda -1σ
3. EntradasTab.tsx - Eliminado fallback "N/A", corregido typo "Rebounce" → "Rebound"
4. SalidasTab.tsx - Eliminados sliders duplicados, marcado failSafe como solo lectura
5. EjecucionTab.tsx - Añadido banner ROADMAP, botón guardar deshabilitado
6. AvanzadoTab.tsx - Eliminados duplicados, añadidas alertas
7. IdcaEventCards.tsx - Corregido texto "banda -1σ" → "ancla"
8. InstitutionalDca.tsx - Añadido banner LEGACY, imports Alert
9. REPORTE_FINAL_IDCA_UNIFICACION.md - Este reporte

**Limitaciones conocidas:**
- EjecucionTab es roadmap/preview (sin endpoint backend)
- failSafe sliders en SalidasTab son solo lectura (no existe DB, hardcoded)
- UI no validada visualmente en navegador

**Estado:** LISTO PARA DEPLOY TÉCNICO EN LOCAL (validación backend completa, pendiente validación UI visual)
