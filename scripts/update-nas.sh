#!/bin/bash

# Script de actualización para KrakenBot en QNAP NAS
# Uso: ./update-nas.sh

set -e

# Configuración - Ajusta según tu entorno
NAS_PATH="/share/ZFS37_DATA/share/Container/krakenbot"
CONTAINER_NAME="krakenbot"
BACKUP_DIR="/share/ZFS37_DATA/share/Container/krakenbot_backups"

echo "================================================"
echo "  KRAKENBOT - Script de Actualización para NAS"
echo "================================================"
echo ""

# Crear directorio de backups si no existe
mkdir -p "$BACKUP_DIR"

# Backup de la versión actual
BACKUP_NAME="krakenbot_backup_$(date +%Y%m%d_%H%M%S)"
echo "[1/5] Creando backup de la versión actual..."
if [ -d "$NAS_PATH" ]; then
    cp -r "$NAS_PATH" "$BACKUP_DIR/$BACKUP_NAME"
    echo "      Backup guardado en: $BACKUP_DIR/$BACKUP_NAME"
else
    echo "      No se encontró instalación previa, saltando backup..."
fi

# Detener el contenedor actual
echo ""
echo "[2/5] Deteniendo contenedor actual..."
docker stop "$CONTAINER_NAME" 2>/dev/null || echo "      Contenedor no estaba corriendo"

# Actualizar archivos (asume que los nuevos archivos están en el directorio actual)
echo ""
echo "[3/5] Actualizando archivos..."
# Preservar el .env y la base de datos
if [ -f "$NAS_PATH/.env" ]; then
    cp "$NAS_PATH/.env" /tmp/krakenbot_env_backup
fi

# Copiar nuevos archivos (ajusta la ruta origen según necesites)
# rsync -av --exclude='.env' --exclude='node_modules' --exclude='.git' ./ "$NAS_PATH/"

echo "      Archivos actualizados"

# Restaurar .env
if [ -f "/tmp/krakenbot_env_backup" ]; then
    cp /tmp/krakenbot_env_backup "$NAS_PATH/.env"
    echo "      Archivo .env restaurado"
fi

# Reconstruir imagen Docker
echo ""
echo "[4/5] Reconstruyendo imagen Docker..."
cd "$NAS_PATH"
docker-compose build --no-cache

# Reiniciar contenedor
echo ""
echo "[5/5] Iniciando contenedor actualizado..."
docker-compose up -d

echo ""
echo "================================================"
echo "  ¡Actualización completada!"
echo "================================================"
echo ""
echo "  El bot está disponible en: http://192.168.1.104:3000"
echo ""
echo "  Para ver los logs:"
echo "    docker logs -f $CONTAINER_NAME"
echo ""
echo "  En caso de problemas, restaurar backup:"
echo "    docker-compose down"
echo "    rm -rf $NAS_PATH/*"
echo "    cp -r $BACKUP_DIR/$BACKUP_NAME/* $NAS_PATH/"
echo "    docker-compose up -d"
echo ""
