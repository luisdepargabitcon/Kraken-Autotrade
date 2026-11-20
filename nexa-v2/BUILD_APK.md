# Compilación del APK NEXA V2 (local, offline)

**APK:** `nexa-v2/dist/app-debug.apk` (copia de `D:\nexa-build\app\outputs\apk\debug\app-debug.apk`)
**SHA-256:** `7a31a017b191fb1015b6eef00fd2404d96ae1596960ff785990c445d73e2afa8`
**Tamaño:** 4.158.384 bytes · **package:** `com.nexa.autotrade.v2` · **label:** NEXA V2
**Permisos:** solo `INTERNET` (+ receiver dinámico). Sin credenciales, sin operaciones reales.
**Min SDK:** 24 · **Compile/Target SDK:** 36.

## Contexto

El disco `C:` estaba al 100% durante la construcción, por lo que el build se hizo
**completamente offline** reutilizando la caché Gradle existente en `~/.gradle`
(procedente de builds Android anteriores en esta máquina) y redirigiendo las
salidas de compilación a `D:/nexa-build` (ver `android/build.gradle`).

## Versiones usadas (ajustadas a lo disponible en caché local)

| Componente | Pin original (template Capacitor 6) | Usado (caché local) |
|---|---|---|
| Gradle wrapper | 8.2.1-all | **8.14.3-all** |
| AGP | 8.2.1 | **8.13.0** |
| google-services | 4.4.0 | **4.4.4** |
| Kotlin BOM (módulo capacitor-android) | 1.9.10 | **1.8.22** |
| cordova framework | 10.1.1 | **14.0.1** |
| androidx (activity/appcompat/core/fragment/webkit/coordinator/splashscreen) | 1.x antiguos | versiones cacheadas (ver `variables.gradle`) |
| compileSdk/targetSdk/minSdk | 34/34/22 | **36/36/24** (platform única instalada; minSdk 24 por cordova 14) |

Los cambios de `node_modules/@capacitor/android/capacitor/build.gradle` y de
`android/capacitor-cordova-android-plugins/build.gradle` (AGP/google-services/Kotlin)
son locales y no versionados (`node_modules/`); `cap sync` regenera el archivo de
cordova-plugins y hay que volver a aplicar los reemplazos.

## Reproducción

```bash
cd nexa-v2
npm install                      # @capacitor/{core,cli,android}@6
npx cap sync android             # copia web/ -> assets/public
# Re-aplicar en android/capacitor-cordova-android-plugins/build.gradle y
# node_modules/@capacitor/android/capacitor/build.gradle:
#   AGP 8.2.1 -> 8.13.0 ; google-services 4.4.0 -> 4.4.4 ; kotlin 1.9.10 -> 1.8.22
cd android
JAVA_HOME="C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot" \
ANDROID_HOME="%LOCALAPPDATA%\Android\Sdk" \
./gradlew assembleDebug --offline
```

Si el disco dispone de espacio y red, basta `npx cap add android && gradlew assembleDebug`
con las versiones por defecto del template.

## Estado de verificación

- `assembleDebug`: OK (`BUILD SUCCESSFUL`).
- Manifest inspeccionado con aapt2: permisos limpios.
- Contenido `assets/public` verificado (incluye correcciones INC-004/005/006).
- **Instalación/arranque en emulador `qa34`: BLOQUEADA** — el emulador exige espacio
  en `C:` (FATAL `not enough disk space to run avd`). Pendiente hasta liberar ~3 GB.
