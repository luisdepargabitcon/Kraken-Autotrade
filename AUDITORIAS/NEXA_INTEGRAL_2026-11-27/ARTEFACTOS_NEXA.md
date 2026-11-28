# Artefactos NEXA v2 — web ZIP y APK debug

Fecha de generación: 2026-11-28
Commit de referencia: `4a57fdd`
Estado: **SIN APROBAR — no publicado, no subido a GitHub, no validado por el propietario en Pixel/dispositivo real.**

`<REPO>` representa el worktree del repositorio. `<ARTIFACTS>` representa la carpeta local de artefactos fuera del repositorio. `<BUILD_TMP>` representa la carpeta temporal local de build. No se incluyen rutas privadas absolutas, hosts, IP ni credenciales.

## 1. Artefactos generados

| Artefacto | Ubicación lógica | SHA-256 | Tamaño |
|---|---|---:|---:|
| ZIP web reproducible | `<ARTIFACTS>/nexa-v2-web-4a57fdd.zip` | `7ee3280c1752dcc1229b34866841a0ea48619e4d9b4a2be8f9bf9ffc3b8470fd` | 181.822 bytes |
| APK Android debug/QA | `<ARTIFACTS>/nexa-v2-debug-4a57fdd.apk` | `55380d789b4afb87bc6add528369894468c01939783d402d61f288ae90bd2316` | 7.247.703 bytes |

Los binarios **no fueron añadidos al repositorio** ni subidos a ningún servicio externo.

## 2. ZIP web

### Contenido

- 35 ficheros estáticos desde `<REPO>/nexa-v2/web`.
- Incluye `index.html`, `manifest.webmanifest`, `sw.js`, CSS y JS estáticos.
- No incluye `node_modules`, tests, BFF, configuración de build ni secretos locales.
- Entradas ordenadas y mtime fijado a `1980-01-01T00:00:00Z`.
- Se construyó una segunda vez como comprobación; el segundo ZIP tuvo el mismo SHA-256 y tamaño.

### Verificación de secretos

Escaneo del ZIP con patrones de:

- claves privadas PEM;
- asignaciones literales de `apiKey`/`secret`/`password`/`token`;
- bearer tokens literales;
- claves tipo AWS;
- `NXV2_BOOTSTRAP_CODE` con valor.

Resultado: **0 coincidencias** en 35 entradas.

Nota de alcance: el escaneo detecta patrones comunes, no prueba imposibilidad absoluta de secretos con formatos desconocidos.

### Contrato API observado

- La base validada del cliente termina en `/api`.
- Las operaciones de pairing/sesión/logout llaman rutas `/v2/...` bajo esa base, es decir `/api/v2/...`.
- Las lecturas de datos usan las rutas autorizadas del backend bajo `/api`.
- No se observó en el ZIP una ruta hardcodeada incompatible con el contrato `/api/v2` de autenticación actual.

### Tests NEXA v2

Comando ejecutado desde `<REPO>/nexa-v2`:

```bash
node --test tests/*.test.mjs
```

Resultado:

```text
tests:      177
pass:       177
fail:         0
cancelled:    0
skipped:      0
todo:         0
duration: ~0,97 s
```

## 3. APK Android

### Versión e identidad

Cambio versionado en `nexa-v2/android/app/build.gradle`:

```text
versionCode 27
versionName "0.11.1"
```

`applicationId` base verificado:

```text
com.nexa.autotrade.v2
```

Sin embargo, la variante `debug` existente aplica `applicationIdSuffix ".qa"` y `versionNameSuffix "-qa"`. El APK generado quedó por tanto como:

```text
package:     com.nexa.autotrade.v2.qa
versionCode: 27
versionName: 0.11.1-qa
minSdk:      24
targetSdk:   36
```

Consecuencia importante: este APK debug/QA **no es una actualización del paquete release `com.nexa.autotrade.v2`**. Es un paquete paralelo `.qa`, además de estar firmado con certificado debug. No debe distribuirse como release ni como actualización del APK de publicación del propietario.

### Build

Se siguió `BUILD_APK.md` en modo offline en lo posible:

```bash
cd <REPO>/nexa-v2
npm ci --offline --no-audit --no-fund
npx cap sync android
# ajuste local no versionado de node_modules/capacitor-cordova:
# AGP 8.2.1 -> 8.13.0
cd android
JAVA_HOME=<JDK21> ANDROID_HOME=<ANDROID_SDK> NEXA_BUILD_DIR=<BUILD_TMP>   ./gradlew assembleDebug --offline --no-daemon
```

Resultado final:

```text
BUILD SUCCESSFUL
123 actionable tasks: 121 executed, 2 up-to-date
```

### Desviación respecto a BUILD_APK.md

El primer intento offline falló porque el documento indicaba Kotlin BOM `1.8.22`, pero esa versión **no estaba en caché Gradle**:

```text
No cached version of org.jetbrains.kotlin:kotlin-bom:1.8.22 available for offline mode
```

La caché local sí contenía `org.jetbrains.kotlin:kotlin-bom:1.9.10`. Se revirtió únicamente ese ajuste local no versionado a `1.9.10` y el build offline terminó correctamente. Por tanto, la tabla de versiones de `BUILD_APK.md` está parcialmente desactualizada respecto a la caché real disponible en esta máquina.

Estado de disco observado antes del build:

- unidad `C:` tenía aproximadamente 4,9 GiB libres;
- unidad `D:` existía pero tenía aproximadamente 210 MiB libres y estaba al 100 % de uso;
- por eso el build se redirigió a `<BUILD_TMP>` en la unidad con espacio suficiente, no a `D:`.

### Inspección con aapt

Comando lógico:

```bash
aapt dump badging <ARTIFACTS>/nexa-v2-debug-4a57fdd.apk
```

Resultados principales:

```text
package: name='com.nexa.autotrade.v2.qa' versionCode='27' versionName='0.11.1-qa'
sdkVersion:'24'
targetSdkVersion:'36'
application-label:'NEXA V2'
```

Permisos observados:

```text
android.permission.INTERNET
android.permission.USE_BIOMETRIC
android.permission.USE_FINGERPRINT
com.nexa.autotrade.v2.qa.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
```

**La expectativa “solo INTERNET” NO se cumple.** El APK incluye además permisos biométricos y el permiso dinámico propio generado por la integración Android/Capacitor. No se modificó el cliente para ocultarlo ni para eliminar funciones. Esta discrepancia queda como motivo adicional para mantener el artefacto **SIN APROBAR** hasta decisión del propietario: aceptar esos permisos por la función biométrica o cambiar explícitamente el cliente/plugin.

### Contenido web empaquetado en el APK

Comprobación de assets dentro del APK:

```text
assets/public/js/auth.js      presente, contiene X-CSRF-Token
assets/public/js/adapters.js  presente, contiene lógica de salud/procedencia de datos
assets/public/js/premium.js   presente, contiene lógica de salud/procedencia de datos
assets/public/index.html      presente
```

### Firma

Verificación lógica:

```bash
apksigner verify --print-certs <ARTIFACTS>/nexa-v2-debug-4a57fdd.apk
```

Resultado:

```text
Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
SHA-256 cert: 153ecd2fd275eb0ccf8d2dd473afeeceae906136702c2f0cc3ee36dbf55e240e
SHA-1 cert:   4af2fd5f5ed87d8ad21b6f98138f4ddc0d229122
```

Esto confirma que es un APK **DEBUG** firmado con la clave debug estándar del entorno. **No está firmado con la clave de publicación del propietario.** Por tanto:

- no es un artefacto release;
- no es válido como actualización de una instalación firmada con otra clave;
- aunque el paquete base sea `com.nexa.autotrade.v2`, esta variante concreta además usa `.qa`;
- no se creó ni usó ninguna keystore nueva de publicación;
- no se expusieron contraseñas ni claves.

## 4. Límites y estado

1. Artefactos generados localmente y copiados solo a `<ARTIFACTS>`.
2. No publicados en GitHub ni en ningún release.
3. No instalados ni validados en Pixel/dispositivo del propietario.
4. No se accedió al VPS, DB real, credenciales ni servicios privados.
5. No se sincronizó ni modificó el repositorio local del propietario fuera del worktree autorizado.
6. El APK es debug/QA, no release.
7. Los permisos no cumplen la expectativa de “solo INTERNET”.
8. Estado final: **SIN APROBAR**.

---

## Adenda WP13 (2026-11-28): entrega verificable y build reproducible

### Entrega binaria verificable (canal autorizado GitHub)

Prerelease pública: `https://github.com/luisdepargabitcon/Kraken-Autotrade/releases/tag/nexa-v2-candidate-5b94ff8`

| artefacto | SHA-256 | enlace directo |
|---|---|---|
| APK debug `.qa` reproducible | `55380d789b4afb87bc6add528369894468c01939783d402d61f288ae90bd2316` | `…/releases/download/nexa-v2-candidate-5b94ff8/nexa-v2-debug-reproducible.apk` |
| ZIP web estático | `7ee3280c1752dcc1229b34866841a0ea48619e4d9b4a2be8f9bf9ffc3b8470fd` | `…/releases/download/nexa-v2-candidate-5b94ff8/nexa-v2-web-4a57fdd.zip` |
| SHA256SUMS | — | `…/releases/download/nexa-v2-candidate-5b94ff8/SHA256SUMS.txt` |

### Reproducibilidad verificada

Build desde estado limpio (`npm ci --offline` reinstalando node_modules completo + `npx cap sync android` regenerando cordova-plugins + `node scripts/apply-android-build-fixes.mjs` versionado + `gradlew assembleDebug --offline`): **BUILD SUCCESSFUL**, y el SHA-256 del APK resultante es **bit a bit idéntico** al artefacto previo (`55380d78…2316` en ambas construcciones independientes).

Correcciones versionadas que eliminan los ajustes manuales no versionados:
- `nexa-v2/scripts/apply-android-build-fixes.mjs` — reemplazos AGP 8.2.1→8.13.0 y google-services 4.4.0→4.4.4, idempotente, tras cada `cap sync`.
- `nexa-v2/android/variables.gradle` — `kotlin_version = '1.9.10'` fijada (disponible en caché Gradle; la referencia previa a 1.8.22 en BUILD_APK.md era incorrecta y se ha corregido).
- **BUILD_APK.md quedaba parcialmente desactualizado**: la columna "objetivo" de Kotlin BOM 1.8.22 no era correcta; la versión efectiva reproducible es 1.9.10.

### Límites que persisten (sin cambios)

- Firma **debug**, no de publicación; variante `.qa`; no es actualización de una instalación firmada con otra clave. Compatibilidad real de actualización y firma release: pendientes del propietario.
- Discrepancia de permisos biométricos (INTERNET + USE_BIOMETRIC/USE_FINGERPRINT) sigue abierta y documentada; no se modificó el cliente.
- Estado: **SIN APROBAR**.
