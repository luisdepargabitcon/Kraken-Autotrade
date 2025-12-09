# Guía de Despliegue a QNAP NAS

## Método 1: Actualización Rápida (Recomendado)

### Paso 1: Descargar el proyecto actualizado

En Replit, descarga el proyecto como ZIP:
1. Haz clic en los tres puntos (...) en la barra lateral
2. Selecciona "Download as zip"

### Paso 2: Subir al NAS

1. Abre File Station en tu QNAP
2. Navega a: `/share/ZFS37_DATA/share/Container/krakenbot`
3. Crea una carpeta de backup: `krakenbot_backup_FECHA`
4. Copia los archivos actuales a la carpeta de backup
5. Extrae el ZIP descargado y reemplaza los archivos (excepto `.env`)

### Paso 3: Reconstruir y reiniciar

Conecta por SSH a tu NAS y ejecuta:

```bash
cd /share/ZFS37_DATA/share/Container/krakenbot

# Detener el contenedor actual
docker-compose down

# Reconstruir la imagen con los nuevos cambios
docker-compose build --no-cache

# Iniciar de nuevo
docker-compose up -d

# Ver logs para confirmar que funciona
docker logs -f krakenbot
```

---

## Método 2: Git (Automatizado)

Si configuraste Git en el NAS:

```bash
cd /share/ZFS37_DATA/share/Container/krakenbot

# Guardar cambios locales
git stash

# Obtener actualizaciones
git pull origin main

# Restaurar cambios locales
git stash pop

# Reconstruir y reiniciar
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

---

## Método 3: Script Automático

1. Copia el archivo `scripts/update-nas.sh` a tu NAS
2. Dale permisos de ejecución: `chmod +x update-nas.sh`
3. Ejecuta: `./update-nas.sh`

---

## Archivos que NO debes sobreescribir

- `.env` - Contiene la configuración de base de datos
- `data/` - Si tienes datos persistentes fuera de PostgreSQL

## Verificación post-actualización

1. Abre http://192.168.1.104:3000
2. Verifica que Kraken está conectado (indicador verde)
3. Verifica que Telegram está conectado (indicador verde)
4. Revisa que las pestañas PANEL, ESTRATEGIAS, HISTORIAL, CARTERA y AJUSTES funcionan

## Solución de problemas

### El contenedor no inicia
```bash
docker logs krakenbot
```

### Error de base de datos
```bash
docker-compose down
docker volume rm krakenbot_postgres_data
docker-compose up -d
```
(Nota: Esto borrará todos los datos de la base de datos)

### Restaurar backup
```bash
docker-compose down
cp -r /share/ZFS37_DATA/share/Container/krakenbot_backups/BACKUP_NAME/* .
docker-compose up -d
```
