# NEXA · Referencia de diseño para APK y panel web

Diseño aceptado por el usuario el 20 de noviembre de 2026. Este paquete conserva el prototipo y el código para consultarlos al comenzar la transformación del bot.

## Abrir y reconstruir

Abrir index.html en Chrome. Contiene estilos, código y datos embebidos y funciona offline.
Los botones APK/Web cambian la presentación y Básico/Pro cambian el nivel de detalle.
Reconstruir el HTML desde las fuentes ejecutando python3 build.py.

## Decisiones de producto

- Fondo negro y azules. Básico usa azul claro y Pro incorpora acentos rojos.
- Verde para resultados positivos, rojo para negativos y azul como color de navegación.
- Básico presenta resumen, gráfica y métricas principales. Pro añade operaciones y detalle.
- Navegación móvil inferior y panel web adaptable.
- Grid aislado con diseño propio, compra y venta vinculadas por ciclo.
- Conservar los modos de ejecución de cada motor y mejorar la claridad de sus controles.
- Retirar la experiencia y documentación de despliegue QNAP.
- Mantener los estados de desconexión y la fecha de la última lectura.
- Las pantallas auxiliares actuales representan la intención del diseño y requieren implementación funcional durante la transformación.

## Datos incorporados

Grid continuo, adaptativo e híbrido, escenarios base y estrés, periodo 1 agosto–18 noviembre 2026. Resultados archivados de investigación con 10.000 USDT iniciales.
Archivo reproducible https://drive.google.com/file/d/1S--xzVf8yLtrBUivu0NYicWMnb5WpnbK/view
SHA256 b544c87dee9caee1b6a86debff3fe0dbc6510fd911c1910aac41f44b47695b6b

AMA BTC/ETH ejecutado offline sobre 3.384 cierres horarios por activo, julio–18 noviembre 2026. Cada activo parte de 10.000 USDT. La gráfica muestra agosto–noviembre. Se ejecutó amaReplayService.ts del commit 47d79db3f7065e0e54481447129f2f88e9225fe2, sustituyendo las funciones de persistencia por funciones vacías.
Resultados finales BTC 8.157,185651 USDT y ETH 7.158,721814 USDT.
El servicio fija capital en 10.000, omite costes, selecciona tramos usando el índice de la vela y acumula compras. Estas limitaciones deben resolverse antes de usar ese replay para valorar una estrategia.
research/ama-results.json conserva compras, cantidades, efectivo y evolución. research/amaReplayService.ts conserva la fuente ejecutada.

Velas Binance Spot, cotización USDT.
Archivo https://drive.google.com/file/d/1mabq79pmGblzj5PACEXy-5Yn4AQUTZT_/view
SHA256 e5c70c68c0052783abc9ddc37be7a21e9ac3bddd00e6f8f996018121be68fb7f
Las pantallas accesibles mediante «Explorar maqueta de operaciones» contienen ejemplos ficticios del diseño.

## Para comenzar la transformación

Leer AGENTS.md y las secciones pertinentes de BITACORA.md. Revisar CORRECCIONES_Y_ACTUALIZACIONES.md si existe en la revisión de trabajo. En el checkout utilizado ese archivo estaba ausente y AGENTS.md indicaba que no se recreara.

Usar este diseño como referencia visual. Mapear cada control al campo, endpoint y motor propietario. Resolver duplicidades en el editor propietario. Revisar especialmente la conservación de ciclos y salidas al cambiar el estado de IDCA.

## Verificación realizada

Se comprobaron navegación, selección Básico/Pro, cambio BTC/ETH, escenarios de coste, operaciones y conciliación de resultados mediante DOM automatizado. La revisión visual final en Pixel 9 sigue pendiente.

## Entregas

HTML en Drive https://drive.google.com/file/d/1TrRGggK2vFxIqqYakOAYmYfNMiecZuWg/view
