#!/usr/bin/env sh
# Script de backup completo (base de datos + código) para KrakenBot Staging
# Uso: ./backup-full.sh [nombre_backup_opcional]

set -eu

# Configuración
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="${1:-full_${TIMESTAMP}}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  BACKUP COMPLETO - KRAKENBOT STAGING                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Fecha: $(date)"
echo "Nombre: ${BACKUP_NAME}"
echo ""

# Verificar que los scripts de backup existen
if [ ! -f "${SCRIPT_DIR}/backup-database.sh" ]; then
    echo -e "${RED}ERROR: Script backup-database.sh no encontrado${NC}"
    exit 1
fi

if [ ! -f "${SCRIPT_DIR}/backup-code.sh" ]; then
    echo -e "${RED}ERROR: Script backup-code.sh no encontrado${NC}"
    exit 1
fi

# Hacer ejecutables los scripts
chmod +x "${SCRIPT_DIR}/backup-database.sh"
chmod +x "${SCRIPT_DIR}/backup-code.sh"

echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}PASO 1/2: BACKUP DE BASE DE DATOS${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""

"${SCRIPT_DIR}/backup-database.sh" "db_${BACKUP_NAME}"

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Fallo el backup de base de datos${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}PASO 2/2: BACKUP DE CÓDIGO${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""

"${SCRIPT_DIR}/backup-code.sh" "code_${BACKUP_NAME}"

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Fallo el backup de código${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  BACKUP COMPLETO FINALIZADO EXITOSAMENTE                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✓ Base de datos: /opt/krakenbot-staging/backups/database/db_${BACKUP_NAME}.sql.gz${NC}"
echo -e "${GREEN}✓ Código: /opt/krakenbot-staging/backups/code/code_${BACKUP_NAME}.tar.gz${NC}"
echo ""
echo "Para restaurar este backup completo:"
echo "  1. Restaurar código: ./restore-code.sh code_${BACKUP_NAME}"
echo "  2. Restaurar base de datos: ./restore-database.sh db_${BACKUP_NAME}"
