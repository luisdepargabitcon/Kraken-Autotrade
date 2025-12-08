# 🚀 GUÍA COMPLETA: Instalar KrakenBot en tu QNAP NAS

Esta guía te llevará paso a paso desde cero hasta tener el bot funcionando en tu NAS.

---

## 📋 PASO 0: Lo que necesitas antes de empezar

### En tu ordenador:
- [ ] Navegador web (Chrome, Firefox, etc.)
- [ ] Acceso a la red local donde está tu NAS

### En tu NAS QNAP:
- [ ] Container Station instalado (lo instalamos en el Paso 1)
- [ ] Al menos 2GB de RAM libre
- [ ] Al menos 5GB de espacio en disco

### Cuentas que necesitas crear:
- [ ] Cuenta en Kraken (https://www.kraken.com)
- [ ] Cuenta de Telegram (si no la tienes)

---

## 🔧 PASO 1: Preparar tu QNAP NAS

### 1.1 Accede a tu NAS
1. Abre tu navegador web
2. Escribe la IP de tu NAS: `http://192.168.1.XXX:8080`
   - (Cambia XXX por los números de tu NAS)
3. Inicia sesión con tu usuario y contraseña de administrador

### 1.2 Instala Container Station
1. Abre el **App Center** (icono de bolsa de compras)
2. En el buscador, escribe: `Container Station`
3. Haz clic en **Instalar**
4. Espera a que termine (puede tardar 5-10 minutos)
5. Una vez instalado, abre **Container Station**

---

## 🔑 PASO 2: Obtener tus API Keys de Kraken

### 2.1 Crear cuenta en Kraken (si no la tienes)
1. Ve a: https://www.kraken.com
2. Haz clic en **Crear cuenta**
3. Completa el registro y verifica tu email
4. **IMPORTANTE:** Completa la verificación de identidad (KYC)

### 2.2 Generar las API Keys
1. Inicia sesión en Kraken
2. Haz clic en tu nombre (arriba a la derecha)
3. Ve a **Seguridad** → **API**
4. Haz clic en **Crear clave API**

### 2.3 Configurar permisos de la API Key
Marca SOLO estas opciones:
- [x] **Query Funds** - Ver tu balance
- [x] **Query Open Orders & Trades** - Ver órdenes
- [x] **Query Closed Orders & Trades** - Ver historial
- [x] **Create & Modify Orders** - Crear operaciones

**NO marques:**
- [ ] Withdraw Funds (Retirar fondos) - ¡NUNCA!

5. Haz clic en **Generar clave**
6. **¡IMPORTANTE!** Copia y guarda en un lugar seguro:
   - **API Key:** algo como `xAbCdEfGhIjKlMnOpQrStUvWxYz`
   - **Private Key (Secret):** algo como `aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789=`

⚠️ **El Secret solo se muestra UNA VEZ. Si lo pierdes, debes crear una nueva API Key.**

---

## 📱 PASO 3: Crear tu Bot de Telegram

### 3.1 Crear el Bot
1. Abre Telegram en tu móvil o PC
2. Busca: `@BotFather`
3. Inicia una conversación y escribe: `/newbot`
4. BotFather te preguntará el nombre, escribe: `KrakenBot Alertas`
5. Te pedirá un username único, escribe algo como: `MiKrakenBot_bot`
   - (Debe terminar en `_bot` o `bot`)
6. **Copia el Token** que te da, es algo como:
   ```
   7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
   ```

### 3.2 Obtener tu Chat ID
1. En Telegram, busca: `@userinfobot`
2. Inicia una conversación
3. El bot te responderá con tu información
4. **Copia el número de "Id"**, es algo como: `123456789`

---

## 🐳 PASO 4: Desplegar el Bot en tu NAS

### 4.1 Abrir Container Station
1. En tu NAS, abre **Container Station**
2. En el menú lateral, haz clic en **Aplicaciones** (o "Applications")

### 4.2 Crear la Aplicación
1. Haz clic en **+ Crear** (o "Create")
2. Selecciona **Crear Aplicación** (o "Create Application")
3. Ponle un nombre: `krakenbot`

### 4.3 Pegar la Configuración
En el editor que aparece, **borra todo** y pega esto:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: kraken-bot-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: krakenbot
      POSTGRES_PASSWORD: MiContraseñaSegura123!
      POSTGRES_DB: krakenbot
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - krakenbot-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U krakenbot"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    image: node:20-alpine
    container_name: kraken-bot-app
    restart: unless-stopped
    working_dir: /app
    ports:
      - "3000:5000"
    environment:
      NODE_ENV: production
      PORT: 5000
      DATABASE_URL: postgres://krakenbot:MiContraseñaSegura123!@postgres:5432/krakenbot
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - krakenbot-network
    command: >
      sh -c "
        apk add --no-cache git &&
        git clone https://github.com/TU_USUARIO/krakenbot.git . &&
        npm install &&
        npm run build &&
        npm start
      "

networks:
  krakenbot-network:
    driver: bridge

volumes:
  postgres_data:
    driver: local
```

⚠️ **IMPORTANTE:** Cambia `MiContraseñaSegura123!` por una contraseña segura que elijas tú.

### 4.4 Iniciar la Aplicación
1. Haz clic en **Crear** (o "Create")
2. Espera a que se descarguen las imágenes (puede tardar 5-10 minutos)
3. Verás el estado cambiar a **Running** (verde)

---

## 🌐 PASO 5: Configurar el Bot desde la Web

### 5.1 Acceder al Panel de Control
1. Abre tu navegador
2. Ve a: `http://TU_IP_NAS:3000`
   - Ejemplo: `http://192.168.1.100:3000`
3. Verás el dashboard del bot

### 5.2 Ir a Ajustes
1. En el menú superior, haz clic en **AJUSTES**

### 5.3 Conectar Kraken
1. En la sección **"API de Kraken"**:
   - **API Key:** Pega la API Key que copiaste en el Paso 2
   - **API Secret:** Pega el Private Key/Secret que copiaste
2. Haz clic en **Conectar a Kraken**
3. Si todo está bien, verás: ✅ CONECTADO

### 5.4 Conectar Telegram
1. En la sección **"Notificaciones Telegram"**:
   - **Bot Token:** Pega el token que te dio BotFather
   - **Chat ID:** Pega tu número de ID
2. Haz clic en **Probar Conexión**
3. **Mira tu Telegram** - deberías recibir un mensaje de prueba

---

## ▶️ PASO 6: Activar el Bot

### 6.1 Volver al Panel Principal
1. Haz clic en **PANEL** en el menú superior

### 6.2 Configurar la Estrategia
1. En el panel **"CONTROL DEL SISTEMA"**:
   - Elige tu **ESTRATEGIA** (empieza con MOMENTUM_ALPHA_V2)
   - Elige el **NIVEL DE RIESGO** (empieza con BAJO)

### 6.3 Iniciar el Bot
1. Haz clic en el botón verde **INICIAR**
2. El indicador cambiará a 🟢 **EN LÍNEA**
3. Recibirás una notificación en Telegram confirmando que está activo

---

## 📊 PASO 7: Monitorear el Bot

### Desde la Web (Panel de Control):
- **Balance Total:** Tu dinero en USD
- **Gráfica:** Rendimiento de tu portafolio
- **Registro de Operaciones:** Todas las compras/ventas

### Desde Telegram:
Recibirás alertas automáticas cuando:
- 🟢 El bot compre alguna cripto
- 🔴 El bot venda alguna cripto
- ⚠️ Haya algún error o alerta

---

## 🛑 PASO 8: Pausar o Detener el Bot

### Para pausar temporalmente:
1. Ve al Panel de Control
2. Haz clic en el botón rojo **PARAR**
3. El bot dejará de operar pero seguirá funcionando

### Para detener completamente:
1. Ve a Container Station en tu NAS
2. Busca la aplicación `krakenbot`
3. Haz clic en **Detener**

---

## ❓ SOLUCIÓN DE PROBLEMAS

### "No puedo acceder a la web del bot"
- Verifica que la IP de tu NAS es correcta
- Asegúrate de usar el puerto 3000: `http://IP:3000`
- Comprueba que los contenedores están "Running" en Container Station

### "Error al conectar con Kraken"
- Verifica que copiaste bien la API Key y el Secret
- Asegúrate de que la API Key tiene los permisos correctos
- Comprueba que tu cuenta Kraken está verificada

### "No recibo notificaciones en Telegram"
- Verifica que el Bot Token es correcto
- Asegúrate de haber iniciado una conversación con tu bot
- Comprueba que el Chat ID es tu número personal, no el del bot

### "El bot no aparece en Container Station"
- Prueba a recargar la página
- Revisa los logs haciendo clic en el contenedor
- Verifica que tienes suficiente espacio en disco

---

## 🔒 CONSEJOS DE SEGURIDAD

1. **NUNCA** compartas tus API Keys con nadie
2. **NUNCA** actives el permiso de "Withdraw" en Kraken
3. Usa una **contraseña fuerte** para la base de datos
4. Empieza con **cantidades pequeñas** hasta que confíes en el sistema
5. Revisa el bot **regularmente** 
6. Mantén una copia de seguridad de tus credenciales en un lugar seguro

---

## 📞 RESUMEN DE DATOS QUE NECESITAS

Guarda esta información en un lugar seguro:

| Dato | Dónde obtenerlo | Ejemplo |
|------|-----------------|---------|
| IP del NAS | Router o NAS | 192.168.1.100 |
| Kraken API Key | kraken.com > Seguridad > API | xAbCdEf... |
| Kraken Secret | kraken.com > Seguridad > API | aBcDeF... |
| Telegram Bot Token | @BotFather | 712345:AAHd... |
| Telegram Chat ID | @userinfobot | 123456789 |
| URL del Panel | IP:3000 | http://192.168.1.100:3000 |

---

**¡Listo! Tu bot de trading está funcionando en tu NAS.** 🎉

Recuerda: Los mercados de criptomonedas son volátiles. Nunca inviertas más de lo que puedas permitirte perder.
