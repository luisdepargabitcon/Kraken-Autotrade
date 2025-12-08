# Despliegue de KrakenBot en QNAP NAS

Este bot de trading autónomo se conecta a Kraken Exchange y ejecuta operaciones en tiempo real con notificaciones vía Telegram.

## 📋 Requisitos Previos

1. **QNAP NAS** con Container Station instalado
2. **Cuenta en Kraken** con API Keys generadas
3. **Bot de Telegram** creado con BotFather
4. Docker y Docker Compose instalados en el NAS

## 🚀 Instalación en QNAP NAS

### Opción 1: Usando Container Station (Recomendado)

1. **Abre Container Station** en tu QNAP
2. **Crea una nueva aplicación** desde "Create" > "Create Application"
3. **Copia y pega** el contenido de `docker-compose.yml` en el editor
4. **Modifica la contraseña** de la base de datos:
   ```yaml
   DB_PASSWORD: TuContraseñaSegura123!
   ```
5. **Haz clic en "Create"** para desplegar

### Opción 2: Usando SSH y Docker Compose

1. **Conecta por SSH** a tu QNAP:
   ```bash
   ssh admin@192.168.1.100
   ```

2. **Crea un directorio** para el proyecto:
   ```bash
   mkdir -p /share/Container/krakenbot
   cd /share/Container/krakenbot
   ```

3. **Copia los archivos** del proyecto al NAS (desde tu máquina local):
   ```bash
   scp -r * admin@192.168.1.100:/share/Container/krakenbot/
   ```

4. **Inicia los contenedores**:
   ```bash
   cd /share/Container/krakenbot
   docker-compose up -d
   ```

## ⚙️ Configuración

### 1. Accede a la Interfaz Web

Una vez desplegado, abre en tu navegador:
```
http://192.168.1.100:3000
```
(Reemplaza con la IP de tu NAS)

### 2. Configura las APIs

Ve a **AJUSTES** en el menú superior y configura:

#### Kraken API
1. Genera tus API Keys en: https://www.kraken.com/u/security/api
2. Permisos recomendados: `Query Funds`, `Create & Modify Orders`, `Query Open/Closed Orders`
3. Ingresa tu **API Key** y **API Secret** en la sección "API de Kraken"
4. Haz clic en **Conectar a Kraken**

#### Telegram Bot
1. Habla con [@BotFather](https://t.me/BotFather) en Telegram
2. Crea un nuevo bot con `/newbot`
3. Copia el **Bot Token** que te da BotFather
4. Obtén tu **Chat ID**:
   - Habla con [@userinfobot](https://t.me/userinfobot) para obtener tu ID
5. Ingresa ambos valores en "Notificaciones Telegram"
6. Haz clic en **Probar Conexión**

### 3. Activa el Bot

1. Ve al **PANEL** principal
2. En "CONTROL DEL SISTEMA", haz clic en **INICIAR**
3. El bot comenzará a operar según la estrategia configurada

## 🔧 Variables de Entorno

Si prefieres configurar las credenciales mediante variables de entorno, edita el `docker-compose.yml`:

```yaml
environment:
  KRAKEN_API_KEY: "tu-api-key"
  KRAKEN_API_SECRET: "tu-api-secret"
  TELEGRAM_BOT_TOKEN: "tu-bot-token"
  TELEGRAM_CHAT_ID: "tu-chat-id"
```

## 📊 Monitoreo

- **Logs en tiempo real**:
  ```bash
  docker-compose logs -f app
  ```

- **Estado de los contenedores**:
  ```bash
  docker-compose ps
  ```

- **Reiniciar el bot**:
  ```bash
  docker-compose restart app
  ```

## 🛑 Detener el Bot

Para detener el bot de forma segura:

```bash
docker-compose down
```

Para detener **y eliminar** todos los datos (incluyendo la base de datos):

```bash
docker-compose down -v
```

## 🔐 Seguridad

- ⚠️ **NUNCA** compartas tus API Keys
- Usa contraseñas fuertes para la base de datos
- Restringe el acceso a la interfaz web solo a tu red local
- Considera usar un reverse proxy con HTTPS (Nginx, Traefik)

## 📱 Notificaciones

El bot enviará notificaciones de Telegram para:
- ✅ Operaciones ejecutadas (compra/venta)
- ⚠️ Alertas de sistema
- 📊 Cambios de estado del bot

## 🆘 Soporte

Si encuentras problemas:

1. Revisa los logs: `docker-compose logs app`
2. Verifica la conectividad de red
3. Confirma que las API keys tienen los permisos correctos
4. Asegúrate de que el puerto 3000 no esté en uso

## 📝 Notas Importantes

- Este bot opera con **dinero real**. Pruébalo primero en modo paper trading de Kraken.
- Los mercados de criptomonedas son **altamente volátiles**.
- Nunca inviertas más de lo que puedas permitirte perder.
- El bot es una herramienta; **no garantiza ganancias**.

---

**¡Buena suerte con tu trading!** 🚀
