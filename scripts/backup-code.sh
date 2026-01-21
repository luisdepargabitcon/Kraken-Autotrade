#!/usr/bin/env sh
# Script de backup de código y configuración para KrakenBot Staging
# Uso: ./backup-code.sh [nombre_backup_opcional]

set -eu

# Configuración
BACKUP_DIR="/opt/krakenbot-staging/backups/code"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="${1:-code_${TIMESTAMP}}"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"
PROJECT_DIR="/opt/krakenbot-staging"

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== BACKUP DE CÓDIGO KRAKENBOT STAGING ===${NC}"
echo "Fecha: $(date)"
echo "Backup: ${BACKUP_NAME}"
echo ""

# Crear directorio de backups si no existe
mkdir -p "${BACKUP_DIR}"

echo -e "${YELLOW}[1/4] Verificando espacio en disco...${NC}"
AVAILABLE_SPACE=$(df -BG /opt | tail -1 | awk '{print $4}' | sed 's/G//')
if [ "$AVAILABLE_SPACE" -lt 1 ]; then
    echo -e "${RED}ADVERTENCIA: Menos de 1GB disponible en disco${NC}"
fi

echo -e "${YELLOW}[2/4] Obteniendo información de Git...${NC}"
cd "${PROJECT_DIR}"
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_STATUS=$(git status --porcelain 2>/dev/null | wc -l)

echo "Branch: ${GIT_BRANCH}"
echo "Commit: ${GIT_COMMIT}"
echo "Archivos modificados: ${GIT_STATUS}"

# Crear archivo de metadata
cat > "${PROJECT_DIR}/.backup_metadata" <<EOF
BACKUP_DATE=$(date -Iseconds)
BACKUP_NAME=${BACKUP_NAME}
GIT_BRANCH=${GIT_BRANCH}
GIT_COMMIT=${GIT_COMMIT}
GIT_STATUS=${GIT_STATUS}
HOSTNAME=$(hostname)
EOF

echo -e "${YELLOW}[3/4] Creando archivo comprimido...${NC}"
tar -czf "${BACKUP_FILE}" \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='build' \
    --exclude='.git' \
    --exclude='backups' \
    --exclude='*.log' \
    --exclude='.env.local' \
    -C "$(dirname ${PROJECT_DIR})" \
    "$(basename ${PROJECT_DIR})"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Backup creado exitosamente${NC}"
else
    echo -e "${RED}ERROR: Fallo al crear backup${NC}"
    exit 1
fi

# Limpiar metadata temporal
rm -f "${PROJECT_DIR}/.backup_metadata"

echo -e "${YELLOW}[4/4] Verificando backup...${NC}"
BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "Tamaño del backup: ${BACKUP_SIZE}"

# Verificar integridad del archivo comprimido
if tar -tzf "${BACKUP_FILE}" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Integridad del backup verificada${NC}"
else
    echo -e "${RED}ERROR: El archivo comprimido está corrupto${NC}"
    exit 1
fi

# Listar backups existentes
echo ""
echo -e "${YELLOW}=== BACKUPS DE CÓDIGO DISPONIBLES ===${NC}"
ls -lh "${BACKUP_DIR}" | grep -v "^total" | tail -5

# Limpiar backups antiguos (mantener últimos 3 días, NUNCA eliminar maestros)
echo ""
echo -e "${YELLOW}[Limpieza] Eliminando backups automáticos antiguos (>3 días)...${NC}"
# Solo eliminar backups automáticos (code_backup_*), NUNCA los que empiezan con code_pre_, code_golden_, code_master_
find "${BACKUP_DIR}" -name "code_backup_*.tar.gz" -type f -mtime +3 -delete
DELETED_COUNT=$(find "${BACKUP_DIR}" -name "code_backup_*.tar.gz" -type f -mtime +3 2>/dev/null | wc -l)
echo "Backups automáticos antiguos eliminados: ${DELETED_COUNT}"
echo -e "${GREEN}✓ Backups maestros y manuales protegidos (nunca se eliminan automáticamente)${NC}"

echo ""
echo -e "${GREEN}=== BACKUP DE CÓDIGO COMPLETADO EXITOSAMENTE ===${NC}"
echo "Archivo: ${BACKUP_FILE}"
echo "Tamaño: ${BACKUP_SIZE}"
echo "Branch: ${GIT_BRANCH}"
echo "Commit: ${GIT_COMMIT}"
echo ""
echo "Para restaurar este backup:"
echo "  ./restore-code.sh ${BACKUP_NAME}"
