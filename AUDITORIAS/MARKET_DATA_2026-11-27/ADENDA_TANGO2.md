# ADENDA TANGO 2 — Issue #20

**Respuesta a la revisión independiente TANGO 2** (issuecomment-7222576267) sobre `ca94f74`. Documento breve y saneado: sin detalles de red, topología ni procedimientos operativos sensibles. No repite la auditoría general; solo completa pendientes y perfecciona el plan. Ningún acceso al VPS ni cambio operativo realizado para esta adenda.

## 1. Contingencias seguras de acceso y credencial (incorporado al plan)

PLAN_CORRECCION.md revisado:
- Ningún rollback restaura la exposición pública de la API ni permisos de trading prohibidos. El rollback de la Fase 1 es acceso solo-loopback hasta corregir el canal autenticado; el de la Fase 2 es una clave nueva con permisos mínimos de lectura, jamás la clave antigua con permisos excesivos.
- No se promete continuidad sin verificación: el corte del perímetro exige prueba E2E previa del canal autenticado sustituto, incluida gestión real de posiciones. Si la prueba falla, no se ejecuta el corte.

## 2. Guards de modo y confirmación de fills (incorporado al plan)

- **Guard estricto por igualdad exacta** (`mode === "live"`): cualquier valor inválido, vacío, corrupto o desconocido se trata como NO-live (fail-closed). Prohibida la lógica inversa.
- **Confirmación de fills:** ningún ciclo/posición se cierra por la mera presencia de un identificador de orden o una respuesta de aceptación. Se exige fill confirmado por el venue (filled/partial con cantidades) o evidencia en ledger. Estados pending/rechazado/expirado → estado intermedio explícito con alerta, nunca cerrado.
- **Matriz ruta × control** para todas las rutas de orden actuales y de la APK (Fase 3.9).

## 3. Calidad de Market Data (incorporado al plan)

Criterios concretos para **todos** los consumidores (no solo el repositorio de velas), en la Fase 5.1: procedencia trazable, frescura medida contra el timestamp del proveedor, prohibición de fallback cruzado silencioso, rechazo de precios inválidos, política explícita de velas cerradas vs en formación, warm-up mínimo por indicador y normalización única en ingesta.

## 4. Corrección sobre la APK — la afirmación anterior era incorrecta

La declaración previa "no hay APK en el repo" se refiere a `main` y era incompleta. **Corrección verificada:** existe la rama `feature/nexa-v2-transformacion-20261120` (SHA 2c8d6ef) con:

- **Shell Android Capacitor** (`nexa-v2/android/`, aplicación `com.nexa.autotrade.v2`, MainActivity, recursos de splash/iconos) más el cliente web (`nexa-v2/web/`) y documentación de transformación.
- **Modelo de autenticación v2 correcto:** sesión por challenge firmado con pairing de dispositivo, Bearer token, permisos por rol, PIN local con protección de intentos y biometría. El servidor decide permisos; el cliente solo prepara, confirma y muestra.
- **Acciones mutativas** (`nexa-v2/web/js/actions.js`) con permiso requerido, confirmación, doble confirmación en las peligrosas e idempotencia: `idca.pauseGlobal`, `idca.emergencyClose`, `idca.closeCycle`, `idca.manualBuy`, `grid.setMode` — **que acepta modos REAL_LIMITED/REAL_FULL** —, `grid.reconcile`, `ama.killSwitch`, `ama.analyzeNow`, `spot.closePosition` (ruta `/positions/:pair/close`, la misma con el guard asimétrico H-028).

Implicaciones para el plan:
1. El endurecimiento de autenticación (Fase 3.6) debe adoptar el modelo v2 para que la APK siga siendo un canal legítimo tras el corte del perímetro — la APK ya asume un backend que autentica y autoriza; hoy ese backend no existe en el servidor desplegado (incompatibilidad estructural a resolver en la convergencia de ramas, Fase 6).
2. La capacidad de la APK de activar modos REAL del GRID refuerza la urgencia de los guards de modo de la Fase 3.4/3.9: el control debe vivir en el servidor, no en el cliente.
3. Verificación E2E de cada acción de la APK contra el backend endurecido antes del corte (Fase 6.2).

Trazabilidad pendiente declarada: no se ha auditado en profundidad el resto de módulos de `nexa-v2/web/js` ni la integración con el backend de la rama nexa; queda como pendiente explícito de la convergencia, sin más lecturas de producción.

## 5. Matizaciones de caracterización aceptadas

- Los 17/17 de la batería numérica son **pruebas de caracterización** sobre copias parciales y datos sintéticos; algunas son solo informativas. No acreditan corrección ni impacto histórico.
- La desviación MACD (30,0289 %, signo distinto 16/66) reproducida independientemente por TANGO es caracterización sintética; antes de corregir se medirá el impacto real sobre datos históricos y consumidores (Fase 5.0.5).
- VWAP: el anclado básico quedó contrastado, pero bandas/periodos, datos inválidos y reloj de replay requieren pruebas sobre el módulo real (Fase 5.0.3).
- **RSI en serie plana:** ambas implementaciones devuelven 100 (avgLoss = 0 → división por cero absorbida). Comprobado también en la variante Wilder de IDCA. Se añade como caso explícito con comportamiento por definir (Fase 5.0.2).

## 6. Límites y sensibilidad

- Los riesgos operativos y detalles sensibles permanecen exclusivamente en canal privado. La decisión sobre el historial ya publicado y la visibilidad del repositorio corresponde al propietario (Fase 0.3).
- Pendientes de runtime declarados y no verificados (sin nuevas lecturas): permisos de la clave Kraken, exposición IPv6, causa de los 17 529 reinicios, reconciliación H-025, ventana histórica de logs.
- La contención urgente (Fases 1-2) se prioriza por autorización separada, sin esperar a investigaciones de rentabilidad.

**Estado: SIN APROBAR — plan preparado para autorización expresa del propietario, pendiente de nueva revisión TANGO.**
