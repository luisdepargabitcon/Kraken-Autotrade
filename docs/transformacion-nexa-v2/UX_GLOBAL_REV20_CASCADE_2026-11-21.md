# NEXA V2 — Rev20 · Inicio visual, BTC/ETH, posiciones globales y gestión IDCA
Fecha: 2026-11-21. Rama: feature/nexa-v2-transformacion-20261120. **NO DESPLEGADO, SIN APK NUEVA COMPILADA.**
Este documento complementa el plan maestro y su checklist; no los reemplaza.

## Realmente implementado y subido a GitHub
- nexa-v2/web/js/dashboard.js: inicio visual (no una tabla de configuraciones), tarjetas BTC/ETH con mini-gráficas derivadas SOLO de velas API, resumen de abiertas de los cuatro motores, últimos eventos y enlaces.
- Posiciones globales: IDCA / SPOT / GRID / AMA con identidad (motor, par, ciclo, modo). Solo se cuentan ciclos/posiciones incluidas en las lecturas. GRID precisa evidencia de BUY ejecutado. AMA precisa filledQty/executedQty; reservado, mandato y plan nunca se cuentan como posición.
- Ficha BTC/ETH: lectura API de cada par, gráfico OHLCV real si existe, posiciones activas, compras/ventas/ciclos, enlaces a inspector detallado universal, RSI/MACD/ADX/EMA/Bollinger/ATR/ATRP/volumen. GET del historial global jamás se atribuye automáticamente a SPOT.
- Correlación BTC/ETH: Pearson de rendimientos logarítmicos con velas sincronizadas de 15 minutos; si faltan datos comparables muestra «—» y la razón. No usar para inferir causalidad.
- Gestión del ciclo IDCA: resumen, ficha completa, órdenes/historial, pausa/reanudación/bloqueo, solo-salida (solo importados), TimeStop, registro de compra externa ya realizada mediante formulario obligatorio, cierre manual y eliminación (solo ciclos manuales). Control general IDCA: pausa global, pares, emergencia. Las acciones usan auth, permisos e idempotencia existentes; no se envía nada con solo abrir fichas.
- Auditoría de contratos contra server/routes/institutionalDca.routes.ts: PATCH solo-salida exige {soloSalida:boolean}; PATCH time-stop exige {disabled:boolean}; POST manual-buy es REGISTRO de compra externa (pair, price, quantity, notionalUsd, feesUsd, executedAt, exchange). Se corrigieron los payloads y se sustituyeron botones legacy equivocados por formulario.
- Archivos: dashboard.js, dashboard.css, app.js, index.html, actions.js, screens.js, inspector.js, tests/dashboard-global.test.mjs.

## Checklist obligatorio para Cascade / Devin
- [ ] Revisar PLAN_MAESTRO y checklist de paridad; **no omitir** motores, histórico, indicadores, panel fiscal ni controles.
- [ ] Rebasar solo si es seguro en rama de trabajo; no escribir en main ni tocar motores LIVE, DB, .env, trading ni VPS sin autorización.
- [ ] Ejecutar node --check/validación ESM de todos los JS, node --test nexa-v2/tests/*.test.mjs, comprobar integridad de provider.js, adapters.js y BFF.
- [ ] QA responsive en viewport 360, 393/Pixel 9, 480, 768 y 1920: safe areas, modales, jerarquía, menús, pie fijo, sin desbordes.
- [ ] Verificar Básico vs Pro: Básico prioriza situación y acceso directo; Pro muestra indicadores/fuentes/trazabilidad y sin pérdida de datos. No sustituir uno por el otro.
- [ ] Probar Inicio → BTC → compras/ventas/ciclos → inspector y regreso; repetir ETH, GRID, AMA, SPOT, cartera, actividad.
- [ ] Correlación con velas sincronizadas / no sincronizadas / insuficientes; sin cifras inventadas.
- [ ] Verificar PnL realizado ≠ no realizado, compra ≠ beneficio, venta bruta ≠ beneficio, capital reservado AMA ≠ ejecutado, historial global ≠ SPOT.
- [ ] Verificar filtros de posiciones globales y estado parcial de fuentes. No etiquetar 0 como ausencia demostrada si el GET falla.
- [ ] Verificar órdenes históricas y abiertas IDCA, incluyendo todas las compras, ventas, fees, motivo y resultado de ficha universal.
- [ ] Auditar la exactitud de los tres payloads IDCA reparados y validar con tests (no con operaciones LIVE).
- [ ] Probar que el BFF read-only de producción RECHAZA POST/PATCH/DELETE y que la interfaz no comunica éxito falso. Para habilitar control real, realizar diseño de gateway de escritura separado con permisos, CSRF, doble confirmación, auditoría e idempotencia; **requerirá autorización expresa** antes de tocar el VPS.
- [ ] Comprobar que no hay credenciales en APK, que PIN/biometría y sesión persistente siguen funcionando; no reintroducir login con usuario/contraseña.
- [ ] Integrar UI nueva en Capacitor, instalar herramientas de build si faltan, compilar APK firmada de prueba, instalar sobre release anterior con datos y verificar Pixel 9; no publicar como APROBADA sin QA de hardware.
- [ ] Subir APK y SHA-256 a GitHub Release prerelease SIN APROBAR, dejar enlace directo verificable, rama, commit, tests y capturas.
- [ ] Panel web publicado solo con autorización expresa; mientras tanto dar ruta preparada y URL existente claramente identificada como desactualizada.

## QA realizado ahora y NO realizado
- Comprobación sintáctica dinámica (V8) de dashboard.js/app.js/actions.js: PASS.
- Evaluación de render de dashboard/posiciones/BTC/gestión IDCA con datos sintéticos: PASS, 4 motores; reserva AMA excluida.
- Prototipo HTML autocontenido revisado en Chromium móvil 393x852: navegación Inicio→BTC→operación→modal→Posiciones→Gestión IDCA→confirmación→Básico/Pro, sin errores JS ni scroll horizontal. **Solo datos simulados**.
- PENDIENTE: tests node --test de toda la rama en checkout real, QA visual multi-viewport APK, compilación APK actualizada, prueba Pixel 9 físico, integración con BFF real y autorización de deploy. No declarar esos puntos como completados.

## Bloqueos operativos
La pasarela desplegada está diseñada deliberadamente como read-only; los controles de IDCA están preparados en el frontend, pero NO estarán operativos remotamente sin un gateway específico autorizado. No abrir escrituras ni exponer /3020 público como solución improvisada. No tocar VPS/trading bajo esta orden.
