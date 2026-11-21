# NEXA V2 — implementación definitiva web + APK (Revisión 7)

**Una sola versión definitiva. No crear ni publicar maquetas, previews DEMO ni APK de demostración como entregables del proyecto.** La aplicación web de gestión y la APK Android comparten lógica, modelos y acceso seguro al bot existente; Básico/Pro son solo niveles de presentación.

- [Plan maestro F0–F6: producto definitivo](PLAN_MAESTRO_2026-11-20.md)
- [Orden operativa Rev. 7 para Cascade](ORDEN_CASCADE_F0_F1_F2_2026-11-20.md)
- [Checklist ejecutivo C001–C086 que debe cumplimentar Cascade](CHECKLIST_PARIDAD_TOTAL_IDCA_SPOT_GRID_AMA_2026-11-20.md)
- [Contraauditoría canónica 22 hallazgos](../auditorias/2026-11-20/03-contraauditoria-final-nexa-v2.md)
- [Diseño de referencia original](https://github.com/luisdepargabitcon/Kraken-Autotrade/tree/design/nexa-apk-web-basico-pro-20261120/design/nexa-apk-web)
- [Drive privado de transformación](https://drive.google.com/drive/folders/1z24z4lZQKnkPFxPXwIm00KcqvHPg7W72)
- [Issue de ejecución #17](https://github.com/luisdepargabitcon/Kraken-Autotrade/issues/17)

**Rama única** `feature/nexa-v2-transformacion-20261120`. `main` intacta. No se autoriza acceso VPS, DB real, trading LIVE, despliegue ni merge por este documento.

El panel definitivo tendrá una URL HTTPS protegida **solo tras autorización del despliegue**. La APK definitiva se entrega mediante GitHub Release descargable tras superar QA. Tests y fixtures son herramientas internas, no producto de demostración. Cascade mantiene sus propios registros en `seguimiento/` y marca cada control con evidencia.

## Diseño y autenticación Rev. 8
- [Rediseño UX de NEXA y acceso PIN/Huella/Rostro sin usuario o contraseña](REDISENO_UX_REV8_PIN_BIOMETRIA_SIN_PASSWORD.md)
- Cascade es responsable de checks C001–C102 y de compilar/probar nueva APK de verdad. Sin VPS/DB/trading/merge.

- [Referencia visual Rev.10: Revolut X, Kraken Pro, Coinbase Advanced y especificación por pantalla](REFERENCIAS_UX_REV10_REVOLUT_KRAKEN_COINBASE.md). La experiencia Pro NO puede seguir siendo un acordeón del panel antiguo.

- [Conexión autorizada de solo lectura NEXA → VPS, IP HTTPS, emparejamiento y rollback](CONEXION_VPS_SOLO_LECTURA_2026-11-21.md). Nunca habilitar acciones LIVE con esta pasarela.

- [Corrección Rev12: Ajustes visibles sin vincular, códigos de 24 caracteres y compilación APK pendiente](FIX_AJUSTES_VINCULACION_REV12_2026-11-21.md)

- [Rev13: Ajustes permanente en cabecera, 5 pestañas y conexión de un campo](UX_VINCULACION_SIMPLE_REV13_2026-11-21.md) — sustituye la presentación Rev12 de 6 pestañas.

- [Rev13 — Ajustes en cabecera y vinculación minimalista, con checklist Cascade](FIX_UX_REV13_AJUSTES_HEADER_Y_VINCULACION_SIMPLE_2026-11-21.md)

- [Rev14 — Alta única por código y renovación automática de sesiones para uso diario](REV14_VINCULACION_PERMANENTE_SESIONES_AUTOMATICAS_2026-11-21.md)
