#!/usr/bin/env bash
# NEXA: AUDITORÍA SOLAMENTE. Prohibido modificar procesos, servicios o archivos.
set -u
echo "=== NEXA READ-ONLY PREFLIGHT $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
echo "Host: $(hostname)"
echo "Free disk:"; df -h / /var 2>/dev/null | head -n 4 || true
echo "Node:"; node --version 2>/dev/null || echo "not found"
echo "Nginx:"; nginx -v 2>&1 || echo "not found"
echo "Certbot:"; certbot --version 2>&1 || echo "not found"
echo "Ports 22/80/443/3000/3020/3101:"
ss -lntp 2>/dev/null | grep -E ':(22|80|443|3000|3020|3101)\b' || true
for port in 3000 3020; do
  code=$(curl --max-time 4 --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$port/api/health" || true)
  echo "GET http://127.0.0.1:$port/api/health => ${code:-UNREACHABLE}"
done
echo "Git status in bot (if known):"
for dir in /srv/kraken-autotrade /opt/Kraken-Autotrade /var/www/Kraken-Autotrade; do
  if [ -d "$dir/.git" ]; then git -C "$dir" status --short --branch 2>/dev/null || true; fi
done
echo "No secrets, tokens or environment values should be displayed."
echo "=== END PREFLIGHT — NOTHING CHANGED ==="
