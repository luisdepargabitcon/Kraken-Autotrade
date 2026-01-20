#!/bin/bash
# Script de restauración de base de datos PostgreSQL para KrakenBot Staging
# Uso: ./restore-database.sh <nombre_backup>

set -e

# Configuración
BACKUP_DIR="/opt/krakenbot-staging/backups/database"
BACKUP_NAME="$1"

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

if [ -z "$BACKUP_NAME" ]; then
    echo -e "${RED}ERROR: Debe especificar el nombre del backup${NC}"
    echo "Uso: $0 <nombre_backup>"
    echo ""
    echo "Backups disponibles:"
    ls -1 "${BACKUP_DIR}" | grep ".sql.gz$" | sed 's/.sql.gz$//'
    exit 1
fi

BACKUP_FILE_COMPRESSED="${BACKUP_DIR}/${BACKUP_NAME}.sql.gz"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.sql"

if [ ! -f "$BACKUP_FILE_COMPRESSED" ]; then
    echo -e "${RED}ERROR: Backup no encontrado: ${BACKUP_FILE_COMPRESSED}${NC}"
    exit 1
fi

echo -e "${YELLOW}=== RESTAURACIÓN DE BASE DE DATOS KRAKENBOT STAGING ===${NC}"
echo "Fecha: $(date)"
echo "Backup: ${BACKUP_NAME}"
echo ""
echo -e "${RED}ADVERTENCIA: Esta operación eliminará todos los datos actuales${NC}"
echo -e "${RED}y los reemplazará con el backup seleccionado.${NC}"
echo ""
read -p "¿Está seguro de continuar? (escriba 'SI' para confirmar): " CONFIRM

if [ "$CONFIRM" != "SI" ]; then
    echo "Restauración cancelada"
    exit 0
fi

# Verificar que el contenedor de base de datos está corriendo
if ! docker ps | grep -q krakenbot-staging-db; then
    echo -e "${RED}ERROR: El contenedor krakenbot-staging-db no está corriendo${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/5] Descomprimiendo backup...${NC}"
gunzip -c "${BACKUP_FILE_COMPRESSED}" > "${BACKUP_FILE}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Backup descomprimido${NC}"
else
    echo -e "${RED}ERROR: Fallo al descomprimir backup${NC}"
    exit 1
fi

echo -e "${YELLOW}[2/5] Deteniendo aplicación...${NC}"
cd /opt/krakenbot-staging
docker compose -f docker-compose.staging.yml stop krakenbot-staging-app
echo -e "${GREEN}✓ Aplicación detenida${NC}"

echo -e "${YELLOW}[3/5] Restaurando base de datos...${NC}"
docker exec -i krakenbot-staging-db psql -U krakenstaging -d postgres < "${BACKUP_FILE}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Base de datos restaurada${NC}"
else
    echo -e "${RED}ERROR: Fallo al restaurar base de datos${NC}"
    echo "Intentando reiniciar aplicación..."
    docker compose -f docker-compose.staging.yml start krakenbot-staging-app
    exit 1
fi

echo -e "${YELLOW}[4/5] Limpiando archivo temporal...${NC}"
rm -f "${BACKUP_FILE}"
echo -e "${GREEN}✓ Archivo temporal eliminado${NC}"

echo -e "${YELLOW}[5/5] Reiniciando aplicación...${NC}"
docker compose -f docker-compose.staging.yml start krakenbot-staging-app
sleep 5
echo -e "${GREEN}✓ Aplicación reiniciada${NC}"

echo ""
echo -e "${GREEN}=== RESTAURACIÓN COMPLETADA EXITOSAMENTE ===${NC}"
echo ""
echo "Verificando estado de la aplicación..."
docker logs --tail=20 krakenbot-staging-app
