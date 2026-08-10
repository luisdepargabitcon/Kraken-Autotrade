/**
 * AmaTrajectoryChart — Gráfico SVG ligero de trayectoria de precio con
 * marcadores de compras (y ventas, si existen). No usa ninguna librería de
 * gráficos nueva: SVG puro, igual que AmaFallMiniChart.
 *
 * Todos los puntos y marcadores provienen de datos reales devueltos por el
 * backend (precio simulado/histórico por tramo o evento). Nunca se inventan
 * puntos: si no hay datos, el llamador debe mostrar "Gráfico no disponible".
 */
interface TrajectoryPoint {
  x: number; // posición secuencial (índice de tramo o evento)
  price: number;
}

interface TrajectoryMarker extends TrajectoryPoint {
  label?: string;
}

interface AmaTrajectoryChartProps {
  points: TrajectoryPoint[];
  buyMarkers?: TrajectoryMarker[];
  sellMarkers?: TrajectoryMarker[];
  height?: number;
}

export function AmaTrajectoryChart({ points, buyMarkers = [], sellMarkers = [], height = 160 }: AmaTrajectoryChartProps) {
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground border border-border/20 rounded-md" style={{ height }}>
        Gráfico no disponible
      </div>
    );
  }

  const width = 100; // viewBox unit, escala con el contenedor (preserveAspectRatio=none)
  const prices = points.map((p) => p.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const rangeX = maxX - minX || 1;

  const toSvgX = (x: number) => ((x - minX) / rangeX) * width;
  const toSvgY = (price: number) => height - ((price - minPrice) / range) * (height - 16) - 8;

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toSvgX(p.x).toFixed(2)} ${toSvgY(p.price).toFixed(2)}`)
    .join(" ");

  return (
    <div className="border border-border/20 rounded-md bg-muted/5 p-2">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        <path d={pathD} fill="none" stroke="currentColor" strokeWidth="1" className="text-primary/70" vectorEffect="non-scaling-stroke" />
        {buyMarkers.map((m, i) => (
          <circle key={`buy-${i}`} cx={toSvgX(m.x)} cy={toSvgY(m.price)} r="1.6" className="fill-green-400" />
        ))}
        {sellMarkers.map((m, i) => (
          <circle key={`sell-${i}`} cx={toSvgX(m.x)} cy={toSvgY(m.price)} r="1.6" className="fill-red-400" />
        ))}
      </svg>
      {(buyMarkers.length > 0 || sellMarkers.length > 0) && (
        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
          {buyMarkers.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" /> Compras ({buyMarkers.length})
            </span>
          )}
          {sellMarkers.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" /> Ventas ({sellMarkers.length})
            </span>
          )}
        </div>
      )}
    </div>
  );
}
