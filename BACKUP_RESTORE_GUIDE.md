# 🔒 GUÍA DE BACKUP Y RESTAURACIÓN - KRAKENBOT STAGING

## 📋 ÍNDICE

1. [Introducción](#introducción)
2. [Scripts Disponibles](#scripts-disponibles)
3. [Backup Completo](#backup-completo)
4. [Backup de Base de Datos](#backup-de-base-de-datos)
5. [Backup de Código](#backup-de-código)
6. [Restauración](#restauración)
7. [Automatización](#automatización)
8. [Mejores Prácticas](#mejores-prácticas)

---

## 📖 INTRODUCCIÓN

Este sistema de backup permite crear copias de seguridad completas del bot de trading, incluyendo:
- **Base de datos PostgreSQL**: Todos los trades, posiciones, configuración
- **Código fuente**: Aplicación completa con configuración

---

## 🛠️ SCRIPTS DISPONIBLES

| Script | Descripción | Uso |
|--------|-------------|-----|
| `backup-full.sh` | Backup completo (DB + código) | `./backup-full.sh [nombre]` |
| `backup-database.sh` | Solo base de datos | `./backup-database.sh [nombre]` |
| `backup-code.sh` | Solo código | `./backup-code.sh [nombre]` |
| `restore-database.sh` | Restaurar base de datos | `./restore-database.sh <nombre>` |

---

## 🎯 BACKUP COMPLETO

### **Crear Backup Completo**

```bash
cd /opt/krakenbot-staging/scripts
chmod +x *.sh
./backup-full.sh
```

Esto creará:
- `/opt/krakenbot-staging/backups/database/db_full_YYYYMMDD_HHMMSS.sql.gz`
- `/opt/krakenbot-staging/backups/code/code_full_YYYYMMDD_HHMMSS.tar.gz`

### **Backup con Nombre Personalizado**

```bash
./backup-full.sh pre_deploy_phantom_fix
```

Esto creará:
- `db_pre_deploy_phantom_fix.sql.gz`
- `code_pre_deploy_phantom_fix.tar.gz`

---

## 💾 BACKUP DE BASE DE DATOS

### **Crear Backup de DB**

```bash
cd /opt/krakenbot-staging/scripts
./backup-database.sh
```

### **Qué Incluye**

- Todas las tablas: `trades`, `open_positions`, `applied_trades`, `bot_config`, etc.
- Estructura completa de la base de datos
- Índices y constraints
- Datos históricos completos

### **Características**

- ✅ Compresión automática con gzip
- ✅ Verificación de integridad
- ✅ Limpieza automática de backups antiguos (>7 días)
- ✅ Estadísticas de tablas incluidas
- ✅ Validación de espacio en disco

### **Ubicación**

```
/opt/krakenbot-staging/backups/database/
├── backup_20260120_181500.sql.gz
├── backup_20260119_120000.sql.gz
└── db_pre_deploy_phantom_fix.sql.gz
```

---

## 📦 BACKUP DE CÓDIGO

### **Crear Backup de Código**

```bash
cd /opt/krakenbot-staging/scripts
./backup-code.sh
```

### **Qué Incluye**

- Todo el código fuente
- Archivos de configuración
- Docker compose files
- Scripts y migraciones
- Documentación

### **Qué Excluye**

- `node_modules/` (se puede reinstalar con npm)
- `dist/` y `build/` (se regeneran en build)
- `.git/` (historial de git)
- `backups/` (evita recursión)
- `*.log` (archivos de log)
- `.env.local` (credenciales locales)

### **Metadata Incluida**

Cada backup incluye:
- Branch de Git activo
- Commit hash
- Fecha y hora del backup
- Hostname del servidor

### **Ubicación**

```
/opt/krakenbot-staging/backups/code/
├── code_20260120_181500.tar.gz
├── code_20260119_120000.tar.gz
└── code_pre_deploy_phantom_fix.tar.gz
```

---

## 🔄 RESTAURACIÓN

### **Restaurar Base de Datos**

```bash
cd /opt/krakenbot-staging/scripts
./restore-database.sh db_pre_deploy_phantom_fix
```

**⚠️ ADVERTENCIA**: Esto eliminará todos los datos actuales y los reemplazará con el backup.

**Proceso**:
1. Solicita confirmación (escribir "SI")
2. Descomprime el backup
3. Detiene la aplicación
4. Restaura la base de datos
5. Reinicia la aplicación
6. Muestra logs de verificación

### **Restaurar Código**

```bash
# 1. Detener aplicación
cd /opt/krakenbot-staging
docker compose -f docker-compose.staging.yml down

# 2. Mover código actual (backup de seguridad)
cd /opt
mv krakenbot-staging krakenbot-staging.old

# 3. Extraer backup
tar -xzf /opt/krakenbot-staging.old/backups/code/code_pre_deploy_phantom_fix.tar.gz

# 4. Rebuild y restart
cd /opt/krakenbot-staging
docker compose -f docker-compose.staging.yml up -d --build

# 5. Verificar logs
docker logs --tail=50 krakenbot-staging-app
```

---

## ⏰ AUTOMATIZACIÓN

### **Backup Diario Automático con Cron**

```bash
# Editar crontab
crontab -e

# Agregar línea para backup diario a las 3:00 AM
0 3 * * * /opt/krakenbot-staging/scripts/backup-full.sh >> /opt/krakenbot-staging/backups/cron.log 2>&1

# Backup de DB cada 6 horas
0 */6 * * * /opt/krakenbot-staging/scripts/backup-database.sh >> /opt/krakenbot-staging/backups/cron.log 2>&1
```

### **Verificar Cron**

```bash
# Ver cron jobs activos
crontab -l

# Ver logs de cron
tail -f /opt/krakenbot-staging/backups/cron.log
```

---

## 📚 MEJORES PRÁCTICAS

### **1. Frecuencia de Backups**

| Tipo | Frecuencia Recomendada | Razón |
|------|------------------------|-------|
| **Base de datos** | Cada 6 horas | Datos críticos de trading |
| **Código** | Antes de cada deploy | Rollback rápido si falla |
| **Completo** | Diario (3:00 AM) | Snapshot completo del sistema |

### **2. Antes de Cambios Críticos**

**SIEMPRE** crear backup antes de:
- Deploys de código nuevo
- Migraciones de base de datos
- Cambios en configuración
- Actualizaciones de dependencias
- Cambios en estrategias de trading

```bash
# Ejemplo: Backup antes de deploy
./backup-full.sh pre_deploy_$(date +%Y%m%d_%H%M%S)
```

### **3. Retención de Backups**

- **Automáticos**: 7 días (limpieza automática)
- **Manuales/Pre-deploy**: Mantener indefinidamente
- **Críticos**: Copiar a almacenamiento externo

### **4. Verificación de Backups**

```bash
# Verificar backups recientes
ls -lh /opt/krakenbot-staging/backups/database/ | tail -5
ls -lh /opt/krakenbot-staging/backups/code/ | tail -5

# Verificar integridad de un backup específico
gzip -t /opt/krakenbot-staging/backups/database/backup_20260120_181500.sql.gz
tar -tzf /opt/krakenbot-staging/backups/code/code_20260120_181500.tar.gz > /dev/null
```

### **5. Almacenamiento Externo**

**Copiar backups críticos a NAS o almacenamiento externo:**

```bash
# Ejemplo: Copiar a NAS
scp /opt/krakenbot-staging/backups/database/db_pre_deploy_phantom_fix.sql.gz \
    user@nas:/backups/krakenbot/

# O usar rsync para sincronización
rsync -avz /opt/krakenbot-staging/backups/ \
    user@nas:/backups/krakenbot/
```

---

## 🚨 ESCENARIOS DE RECUPERACIÓN

### **Escenario 1: Deploy Fallido**

```bash
# 1. Restaurar código anterior
cd /opt/krakenbot-staging/scripts
./restore-code.sh code_pre_deploy_phantom_fix

# 2. Rebuild
cd /opt/krakenbot-staging
docker compose -f docker-compose.staging.yml up -d --build
```

### **Escenario 2: Datos Corruptos**

```bash
# 1. Restaurar base de datos
cd /opt/krakenbot-staging/scripts
./restore-database.sh db_backup_20260120_030000
```

### **Escenario 3: Desastre Completo**

```bash
# 1. Reinstalar desde backups
cd /opt
tar -xzf /backups/code_pre_deploy_phantom_fix.tar.gz

# 2. Iniciar servicios
cd /opt/krakenbot-staging
docker compose -f docker-compose.staging.yml up -d

# 3. Restaurar base de datos
cd scripts
./restore-database.sh db_pre_deploy_phantom_fix
```

---

## 📊 MONITOREO DE BACKUPS

### **Script de Verificación de Backups**

```bash
#!/bin/bash
# check-backups.sh - Verificar estado de backups

BACKUP_DIR="/opt/krakenbot-staging/backups"

echo "=== ESTADO DE BACKUPS ==="
echo ""

# Último backup de DB
echo "Último backup de base de datos:"
ls -lth ${BACKUP_DIR}/database/*.sql.gz | head -1

# Último backup de código
echo ""
echo "Último backup de código:"
ls -lth ${BACKUP_DIR}/code/*.tar.gz | head -1

# Espacio usado
echo ""
echo "Espacio usado por backups:"
du -sh ${BACKUP_DIR}/*

# Backups en últimas 24 horas
echo ""
echo "Backups creados en últimas 24 horas:"
find ${BACKUP_DIR} -type f -mtime -1 -ls
```

---

## ✅ CHECKLIST DE BACKUP

### **Antes de Deploy**

- [ ] Crear backup completo con nombre descriptivo
- [ ] Verificar integridad de backups
- [ ] Confirmar espacio disponible en disco
- [ ] Documentar cambios a realizar
- [ ] Tener plan de rollback listo

### **Después de Deploy**

- [ ] Verificar aplicación funciona correctamente
- [ ] Revisar logs por errores
- [ ] Confirmar trading operativo
- [ ] Crear nuevo backup post-deploy
- [ ] Documentar cambios realizados

---

## 🔗 COMANDOS RÁPIDOS

```bash
# Backup completo ahora
/opt/krakenbot-staging/scripts/backup-full.sh

# Backup solo DB
/opt/krakenbot-staging/scripts/backup-database.sh

# Listar backups disponibles
ls -lh /opt/krakenbot-staging/backups/database/
ls -lh /opt/krakenbot-staging/backups/code/

# Restaurar último backup de DB
LAST_DB=$(ls -t /opt/krakenbot-staging/backups/database/*.sql.gz | head -1 | xargs basename | sed 's/.sql.gz//')
/opt/krakenbot-staging/scripts/restore-database.sh $LAST_DB

# Ver espacio usado
du -sh /opt/krakenbot-staging/backups/*
```

---

## 📞 SOPORTE

Para problemas con backups o restauración:
1. Verificar logs de los scripts
2. Confirmar permisos de archivos
3. Verificar espacio en disco
4. Revisar estado de contenedores Docker

**Logs de backup**: `/opt/krakenbot-staging/backups/cron.log`
