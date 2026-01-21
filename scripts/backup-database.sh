#!/usr/bin/env sh
# Script de backup de base de datos PostgreSQL para KrakenBot Staging
# Uso: ./backup-database.sh <backup_id>

set -eu

# Validar que se pasó un nombre
if [ -z "${1:-}" ]; then
    echo "ERROR: Falta nombre de backup"
    echo "Uso: $0 <backup_id>"
    exit 1
fi

# Configuración - usar env variable o fallback
BACKUP_BASE_DIR="${BACKUP_DIR:-/app/backups}"
BACKUP_DIR="${BACKUP_BASE_DIR}/database"
BACKUP_NAME="$1"
BACKUP_FILE="${BACKUP_DIR}/db_${BACKUP_NAME}.sql"
BACKUP_FILE_COMPRESSED="${BACKUP_FILE}.gz"

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== BACKUP DE BASE DE DATOS KRAKENBOT STAGING ===${NC}"
echo "Fecha: $(date)"
echo "Backup: ${BACKUP_NAME}"
echo ""

# Crear directorio de backups si no existe
mkdir -p "${BACKUP_DIR}"

# Verificar que el contenedor de base de datos está corriendo
if ! docker ps | grep -q krakenbot-staging-db; then
    echo -e "${RED}ERROR: El contenedor krakenbot-staging-db no está corriendo${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/4] Verificando espacio en disco...${NC}"
AVAILABLE_SPACE=$(df -BG /opt | tail -1 | awk '{print $4}' | sed 's/G//')
if [ "$AVAILABLE_SPACE" -lt 1 ]; then
    echo -e "${RED}ADVERTENCIA: Menos de 1GB disponible en disco${NC}"
fi

echo -e "${YELLOW}[2/4] Creando dump de base de datos...${NC}"
docker exec krakenbot-staging-db pg_dump \
    -U krakenstaging \
    -d krakenbot_staging \
    --clean \
    --if-exists \
    --create \
    --verbose \
    > "${BACKUP_FILE}" 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Dump creado exitosamente${NC}"
else
    echo -e "${RED}ERROR: Fallo al crear dump${NC}"
    exit 1
fi

echo -e "${YELLOW}[3/4] Comprimiendo backup...${NC}"
gzip -f "${BACKUP_FILE}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Backup comprimido exitosamente${NC}"
else
    echo -e "${RED}ERROR: Fallo al comprimir backup${NC}"
    exit 1
fi

echo -e "${YELLOW}[4/4] Verificando backup...${NC}"
BACKUP_SIZE=$(du -h "${BACKUP_FILE_COMPRESSED}" | cut -f1)
echo "Tamaño del backup: ${BACKUP_SIZE}"

# Verificar integridad del archivo comprimido
if gzip -t "${BACKUP_FILE_COMPRESSED}" 2>/dev/null; then
    echo -e "${GREEN}✓ Integridad del backup verificada${NC}"
else
    echo -e "${RED}ERROR: El archivo comprimido está corrupto${NC}"
    exit 1
fi

# Mostrar estadísticas de la base de datos
echo ""
echo -e "${YELLOW}=== ESTADÍSTICAS DE LA BASE DE DATOS ===${NC}"
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    n_live_tup as rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
" 2>/dev/null || echo "No se pudieron obtener estadísticas"

# Listar backups existentes
echo ""
echo -e "${YELLOW}=== BACKUPS DISPONIBLES ===${NC}"
ls -lh "${BACKUP_DIR}" | grep -v "^total" | tail -5

# Limpiar backups antiguos (mantener últimos 3 días, NUNCA eliminar maestros)
echo ""
echo -e "${YELLOW}[Limpieza] Eliminando backups automáticos antiguos (>3 días)...${NC}"
# Solo eliminar backups automáticos (backup_*), NUNCA los que empiezan con db_, pre_, golden_, master_
find "${BACKUP_DIR}" -name "backup_*.sql.gz" -type f -mtime +3 -delete
DELETED_COUNT=$(find "${BACKUP_DIR}" -name "backup_*.sql.gz" -type f -mtime +3 2>/dev/null | wc -l)
echo "Backups automáticos antiguos eliminados: ${DELETED_COUNT}"
echo -e "${GREEN}✓ Backups maestros y manuales protegidos (nunca se eliminan automáticamente)${NC}"

echo ""
echo -e "${GREEN}=== BACKUP COMPLETADO EXITOSAMENTE ===${NC}"
echo "Archivo: ${BACKUP_FILE_COMPRESSED}"
echo "Tamaño: ${BACKUP_SIZE}"
echo ""
echo "Para restaurar este backup:"
echo "  ./restore-database.sh ${BACKUP_NAME}"
