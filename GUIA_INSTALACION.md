# 🤖 GUÍA COMPLETA: KrakenBot en tu QNAP NAS

**Bot de Trading Autónomo para Kraken Exchange**

Esta guía te lleva paso a paso desde cero hasta tener el bot funcionando.

---

# 📋 ANTES DE EMPEZAR

## Lo que vas a necesitar:

| Cosa | Para qué |
|------|----------|
| NAS QNAP | Donde correrá el bot 24/7 |
| Cuenta Kraken | Para hacer trading |
| Cuenta Telegram | Para recibir notificaciones |
| 30 minutos | Tiempo aproximado de instalación |

---

# PASO 1: PREPARAR TU NAS

## 1.1 Instalar Container Station

1. Abre la interfaz web de tu NAS: `http://TU_IP_NAS:8080`
2. Inicia sesión con tu usuario administrador
3. Abre el **App Center** (icono de bolsa de compras)
4. Busca: `Container Station`
5. Haz clic en **Instalar**
6. Espera 5-10 minutos a que termine

## 1.2 Crear la carpeta del proyecto

1. Abre **File Station** en tu NAS
2. Navega a: `Container`
3. Crea una nueva carpeta llamada: `krakenbot`
4. Ruta final: `/share/Container/krakenbot/`

---

# PASO 2: DESCARGAR Y COPIAR EL PROYECTO

## 2.1 Descargar el proyecto

1. En Replit, haz clic en los **tres puntos (⋮)** arriba del explorador de archivos
2. Selecciona **"Download as zip"**
3. Guarda el archivo ZIP en tu ordenador

## 2.2 Copiar al NAS

1. Descomprime el ZIP en tu ordenador
2. Abre **File Station** en tu NAS
3. Navega a: `/share/Container/krakenbot/`
4. Arrastra y suelta TODOS los archivos dentro

### Estructura final:
```
/share/Container/krakenbot/
├── 📁 client/
├── 📁 server/
├── 📁 shared/
├── 📄 docker-compose.yml
├── 📄 Dockerfile
├── 📄 package.json
└── 📄 ... (resto de archivos)
```

---

# PASO 3: OBTENER API KEYS DE KRAKEN

## 3.1 Crear cuenta en Kraken (si no tienes)

1. Ve a: **https://www.kraken.com**
2. Haz clic en **Crear cuenta**
3. Completa el registro
4. **Importante:** Verifica tu identidad (KYC)

## 3.2 Generar las API Keys

1. Inicia sesión en Kraken
2. Haz clic en tu nombre (arriba a la derecha)
3. Ve a: **Seguridad** → **API**
4. Haz clic en **Crear clave API**

## 3.3 Configurar permisos

Marca SOLO estas opciones:
- ✅ Query Funds
- ✅ Query Open Orders & Trades
- ✅ Query Closed Orders & Trades
- ✅ Create & Modify Orders

**⚠️ NUNCA marques:**
- ❌ Withdraw Funds (Retirar fondos)

## 3.4 Guardar las claves

Haz clic en **Generar clave** y copia:

| Dato | Ejemplo | Guárdalo en un lugar seguro |
|------|---------|----------------------------|
| API Key | `xAbCdEfGhIjK...` | ✅ |
| Private Key (Secret) | `aBcDeFgHiJkL...` | ✅ |

**⚠️ El Secret solo se muestra UNA VEZ. Si lo pierdes, crea una nueva API Key.**

---

# PASO 4: CREAR BOT DE TELEGRAM

## 4.1 Crear el Bot

1. Abre **Telegram** en tu móvil o PC
2. Busca: `@BotFather`
3. Escribe: `/newbot`
4. Nombre del bot: `KrakenBot Alertas`
5. Username: `MiKrakenBot_bot` (debe terminar en `bot`)
6. **Copia el Token** que te da:
   ```
   7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
   ```

## 4.2 Obtener tu Chat ID

1. En Telegram, busca: `@userinfobot`
2. Envíale cualquier mensaje
3. **Copia el número de "Id"**: `123456789`

## 4.3 Resumen de datos de Telegram

| Dato | Ejemplo |
|------|---------|
| Bot Token | `7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw` |
| Chat ID | `123456789` |

---

# PASO 5: CONFIGURAR LA CONTRASEÑA

## 5.1 Editar docker-compose.yml

1. En File Station, navega a: `/share/Container/krakenbot/`
2. Haz clic derecho en `docker-compose.yml`
3. Selecciona **Abrir con editor de texto**
4. Busca estas dos líneas:
   ```yaml
   POSTGRES_PASSWORD: TuPasswordSegura123!
   ```
   y
   ```yaml
   DATABASE_URL: postgres://krakenbot:TuPasswordSegura123!@postgres:5432/krakenbot
   ```
5. Cambia `TuPasswordSegura123!` por tu propia contraseña **en ambas líneas**
6. Guarda el archivo

---

# PASO 6: INICIAR EL BOT

## Opción A: Desde Container Station (Recomendado)

1. Abre **Container Station** en tu NAS
2. Ve a **Aplicaciones** (o "Applications")
3. Haz clic en **Crear** (o "Create")
4. Nombre: `krakenbot`
5. En "Ruta YAML" selecciona: `/share/Container/krakenbot/docker-compose.yml`
6. Haz clic en **Crear**
7. Espera 3-5 minutos mientras se instala todo

## Opción B: Desde terminal/SSH

### En Windows:
1. Abre **PowerShell**
2. Escribe:
   ```
   ssh admin@192.168.1.XXX
   ```
   (cambia XXX por la IP de tu NAS)
3. Introduce tu contraseña del NAS
4. Ejecuta:
   ```bash
   cd /share/Container/krakenbot
   docker-compose up -d
   ```

### En Mac/Linux:
1. Abre **Terminal**
2. Escribe:
   ```bash
   ssh admin@192.168.1.XXX
   cd /share/Container/krakenbot
   docker-compose up -d
   ```

## Ver el progreso de instalación:
```bash
docker-compose logs -f app
```

Verás algo como:
```
🚀 Instalando dependencias...
🔨 Compilando aplicacion...
📦 Sincronizando base de datos...
✅ Iniciando KrakenBot...
```

---

# PASO 7: CONFIGURAR EL BOT DESDE LA WEB

## 7.1 Acceder al Panel de Control

1. Abre tu navegador
2. Ve a: `http://TU_IP_NAS:3000`
   - Ejemplo: `http://192.168.1.100:3000`
3. Verás el dashboard del bot

## 7.2 Ir a Ajustes

1. En el menú superior, haz clic en **AJUSTES**

## 7.3 Conectar Kraken

1. En la sección **"API de Kraken"**:
   - **API Key:** Pega tu API Key de Kraken
   - **API Secret:** Pega tu Private Key/Secret
2. Haz clic en **Conectar a Kraken**
3. Debe aparecer: ✅ **CONECTADO**

## 7.4 Conectar Telegram

1. En la sección **"Notificaciones Telegram"**:
   - **Bot Token:** Pega el token que te dio BotFather
   - **Chat ID:** Pega tu número de ID
2. Haz clic en **Probar Conexión**
3. **Revisa Telegram** - deberías recibir un mensaje de prueba

---

# PASO 8: ACTIVAR EL BOT

1. Haz clic en **PANEL** en el menú superior
2. En **"CONTROL DEL SISTEMA"**:
   - Elige una **Estrategia** (empieza con MOMENTUM_ALPHA_V2)
   - Elige **Nivel de Riesgo** (empieza con BAJO)
3. Haz clic en el botón **INICIAR**
4. El indicador cambiará a 🟢 **EN LÍNEA**
5. Recibirás una notificación en Telegram

---

# ✅ ¡LISTO!

Tu bot de trading está funcionando en tu NAS 24/7.

---

# 📖 COMANDOS ÚTILES

Conecta por SSH a tu NAS y usa estos comandos:

| Acción | Comando |
|--------|---------|
| Ver logs en tiempo real | `docker-compose logs -f app` |
| Reiniciar el bot | `docker-compose restart app` |
| Parar el bot | `docker-compose down` |
| Iniciar el bot | `docker-compose up -d` |
| Ver estado | `docker-compose ps` |

---

# ❓ SOLUCIÓN DE PROBLEMAS

## "No puedo acceder a http://IP:3000"
- Verifica que la IP es correcta
- Espera 5 minutos (la primera instalación tarda)
- Revisa los logs: `docker-compose logs -f app`

## "Error al conectar con Kraken"
- Revisa que copiaste bien la API Key y el Secret
- Verifica que la API Key tiene los permisos correctos
- Asegúrate que tu cuenta Kraken está verificada

## "No recibo notificaciones en Telegram"
- Envía un mensaje a tu bot primero (cualquier cosa)
- Verifica que el Chat ID es correcto
- Comprueba que el Token es correcto

## "El contenedor no arranca"
- Revisa los logs: `docker-compose logs app`
- Verifica que la contraseña es igual en las dos líneas del docker-compose.yml
- Asegúrate que hay espacio en disco

---

# 🔒 SEGURIDAD

1. **NUNCA** compartas tus API Keys
2. **NUNCA** actives permisos de retiro en Kraken
3. Usa contraseñas seguras
4. El bot solo tiene acceso a tu red local
5. Empieza con cantidades pequeñas

---

# 📊 RESUMEN DE DATOS

Guarda esta tabla en un lugar seguro:

| Dato | Valor | Dónde se usa |
|------|-------|--------------|
| IP del NAS | `192.168.1.___` | Acceder al panel |
| URL del Panel | `http://IP:3000` | Navegador |
| Kraken API Key | `____________` | Ajustes → Kraken |
| Kraken Secret | `____________` | Ajustes → Kraken |
| Telegram Token | `____________` | Ajustes → Telegram |
| Telegram Chat ID | `____________` | Ajustes → Telegram |
| Password BD | `____________` | docker-compose.yml |

---

# ⚠️ ADVERTENCIA LEGAL

- Este bot opera con **dinero real**
- Los mercados de criptomonedas son **muy volátiles**
- **Nunca inviertas** más de lo que puedas perder
- El bot es una herramienta, **no garantiza ganancias**
- Tú eres el único responsable de tus operaciones

---

**¡Buena suerte con tu trading!** 🚀
