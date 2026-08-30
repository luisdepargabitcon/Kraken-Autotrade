# 🤖 WINDSURF CHESTER BOT

Bot de trading autónomo de criptomonedas para Kraken y Revolut X.

## 📚 Documentación

| Archivo | Contenido |
|---------|-----------|
| **[MANUAL_BOT.md](./MANUAL_BOT.md)** | Descripción funcional, arquitectura, configuración, operación |
| **[BITACORA.md](./BITACORA.md)** | Registro cronológico de cambios, incidentes, deploys |

## 🚀 Quick Start

```bash
# VPS/Staging
cd /opt/krakenbot-staging
docker compose -f docker-compose.staging.yml up -d --build

# Ver logs
docker logs -f krakenbot-staging-app

# Acceder al panel
```

## 📞 Soporte

- **Telegram**: Comandos `/estado`, `/balance`, `/ganancias`
- **Dashboard**: Panel web con monitorización en tiempo real
- **Logs**: `docker logs krakenbot-staging-app`

---

*Mantenido por Windsurf Cascade AI*
