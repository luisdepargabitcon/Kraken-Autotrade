# Guía de Despliegue VPS IONOS - KrakenBot Staging

**VPS:** 5.250.184.18  
**Usuario:** root  
**Puerto:** 3020  
**Fecha:** 2026-01-08

---

## FASE 1: Preparar archivos en Replit

### 1.1 Descargar ZIP de Replit
- Click en los 3 puntos (⋮) en el panel de archivos
- Seleccionar "Download as zip"
- Guardar como `krakenbot.zip`

---

## FASE 2: Subir al VPS

### 2.1 Desde tu máquina local
```bash
# Descomprimir
unzip krakenbot.zip -d krakenbot-staging

# Subir al VPS
scp -r krakenbot-staging root@5.250.184.18:/opt/krakenbot-staging
```

---

## FASE 3: Configurar en el VPS

### 3.1 Conectar al VPS
```bash
ssh root@5.250.184.18
cd /opt/krakenbot-staging
```

### 3.2 Crear archivo .env
```bash
cat > .env << 'EOF'
POSTGRES_USER=krakenstaging
POSTGRES_PASSWORD=Kr4k3n_St4g1ng_2026!
POSTGRES_DB=krakenbot_staging
DATABASE_URL=postgresql://krakenstaging:Kr4k3n_St4g1ng_2026!@krakenbot-staging-db:5432/krakenbot_staging
NODE_ENV=production
EOF
```

### 3.3 Crear docker-compose.staging.yml
```bash
cat > docker-compose.staging.yml << 'EOF'
version: '3.8'

services:
  krakenbot-staging-db:
    image: postgres:15-alpine
    container_name: krakenbot-staging-db
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - pgdata_staging:/var/lib/postgresql/data
    ports:
      - "5435:5432"
    networks:
      - krakenbot-staging-net

  krakenbot-staging-app:
    build: .
    container_name: krakenbot-staging-app
    restart: unless-stopped
    depends_on:
      - krakenbot-staging-db
    env_file:
      - .env
    ports:
      - "3020:5000"
    networks:
      - krakenbot-staging-net

volumes:
  pgdata_staging:

networks:
  krakenbot-staging-net:
    driver: bridge
EOF
```

### 3.4 Crear Dockerfile
```bash
cat > Dockerfile << 'EOF'
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 5000

CMD ["npm", "run", "start"]
EOF
```

---

## FASE 4: Copiar Base de Datos del NAS

### 4.1 En el NAS (192.168.1.104)
```bash
docker exec kraken-bot-db pg_dump -U krakenbot -d krakenbot > /tmp/krakenbot_backup.sql
```

### 4.2 Copiar al VPS (desde tu máquina o NAS)
```bash
# Opción A: Desde el NAS directamente
scp /tmp/krakenbot_backup.sql root@5.250.184.18:/tmp/

# Opción B: Desde tu máquina (primero bajar del NAS)
scp usuario@192.168.1.104:/tmp/krakenbot_backup.sql ./
scp krakenbot_backup.sql root@5.250.184.18:/tmp/
```

---

## FASE 5: Construir e Iniciar

### 5.1 Construir contenedores
```bash
cd /opt/krakenbot-staging
docker compose -f docker-compose.staging.yml up -d --build
```

### 5.2 Verificar que están corriendo
```bash
docker ps
```

Deberías ver:
- `krakenbot-staging-db` (postgres)
- `krakenbot-staging-app` (node)

---

## FASE 6: Importar Base de Datos

### 6.1 Copiar backup al contenedor
```bash
docker cp /tmp/krakenbot_backup.sql krakenbot-staging-db:/tmp/
```

### 6.2 Importar datos
```bash
docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -f /tmp/krakenbot_backup.sql
```

### 6.3 Forzar DRY RUN (IMPORTANTE - seguridad)
```bash
docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "UPDATE bot_config SET dry_run_mode = true WHERE id = 1;"
```

---

## FASE 7: Verificar

### 7.1 Acceder al panel
```
http://5.250.184.18:3020
```

### 7.2 Verificar en Ajustes
- DRY RUN debe estar **ACTIVADO** (amarillo)
- Si no lo está, activarlo manualmente

### 7.3 Ver logs
```bash
docker logs -f krakenbot-staging-app
```

---

## FASE 8: Probar Revolut X

1. Ir a **Integraciones**
2. Ingresar credenciales de Revolut X
3. Conectar
4. Verificar que el bot opera en modo simulación

---

## Comandos útiles

```bash
# Ver logs en tiempo real
docker logs -f krakenbot-staging-app

# Reiniciar app
docker restart krakenbot-staging-app

# Parar todo
docker compose -f docker-compose.staging.yml down

# Reconstruir
docker compose -f docker-compose.staging.yml up -d --build

# Entrar a la DB
docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging

# Desactivar DRY RUN (cuando estés listo para producción)
docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "UPDATE bot_config SET dry_run_mode = false WHERE id = 1;"
```

---

## Puertos en uso

| Servicio | Puerto |
|----------|--------|
| Bot NAS (producción) | 3000 |
| Bot existente VPS | 3010 |
| **KrakenBot Staging** | **3020** |
| PostgreSQL Staging | 5435 |

---

## Checklist final

- [ ] Contenedores corriendo
- [ ] Panel accesible en :3020
- [ ] DRY RUN activado
- [ ] Datos del NAS importados
- [ ] Credenciales Revolut X configuradas
- [ ] Bot operando en simulación
