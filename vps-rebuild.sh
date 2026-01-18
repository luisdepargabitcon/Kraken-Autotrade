#!/bin/bash
# Script para rebuild completo en VPS eliminando cache de build

set -e

echo "=== VPS Rebuild Script ==="
echo "Limpiando build cache..."

# Borrar dist/ para forzar rebuild completo
rm -rf dist/

echo "Pulling latest code..."
git pull origin main

echo "Building Docker image (no cache)..."
docker compose -f docker-compose.staging.yml build --no-cache krakenbot-staging-app

echo "Restarting services..."
docker compose -f docker-compose.staging.yml up -d

echo "Waiting for services to start..."
sleep 5

echo "Checking status..."
docker compose -f docker-compose.staging.yml ps

echo ""
echo "=== Rebuild complete ==="
echo "Test with: curl -i http://localhost:3020/api/health"
