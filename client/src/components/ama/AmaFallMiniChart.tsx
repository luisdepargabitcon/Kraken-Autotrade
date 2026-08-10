/**
 * Mini-gráfico SVG ligero (sin dependencia de charting library) que ilustra
 * la trayectoria aproximada de una prueba de caída: precio inicial, caída,
 * mínimo, y rebote/recuperación. Marca puntos donde AMA compraría (tramos).
 */
interface AmaFallMiniChartProps {
  dropPct: number;
  reboundPct?: number;
  tranches?: number;
  width?: number;
  height?: number;
}

export function AmaFallMiniChart({
  dropPct,
  reboundPct = dropPct * 0.4,
  tranches = 4,
  width = 240,
  height = 80,
}: AmaFallMiniChartProps) {
  const padding = 8;
  const w = width - padding * 2;
  const h = height - padding * 2;

  const startY = padding + h * 0.15;
  const lowY = padding + h * (0.15 + (dropPct / 60) * 0.75);
  const endY = Math.max(padding + h * 0.1, lowY - h * (reboundPct / 60) * 0.6);

  const points = [
    [padding, startY],
    [padding + w * 0.35, lowY],
    [padding + w * 0.55, lowY * 1.02],
    [padding + w, endY],
  ];

  const path = `M ${points[0][0]},${points[0][1]} ` +
    points.slice(1).map(([x, y]) => `L ${x},${y}`).join(" ");

  const trancheDots = Array.from({ length: Math.max(1, tranches) }, (_, i) => {
    const t = 0.35 + (i / Math.max(1, tranches - 1 || 1)) * 0.2;
    const x = padding + w * t;
    const y = startY + (lowY - startY) * (t / 0.55);
    return { x, y };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      className="rounded-md bg-muted/10"
      role="img"
      aria-label={`Trayectoria aproximada: caída del ${dropPct}%`}
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} className="text-red-400/70" />
      {trancheDots.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} className="fill-orange-400" />
      ))}
      <circle cx={points[0][0]} cy={points[0][1]} r={3} className="fill-muted-foreground" />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={3} className="fill-green-400" />
    </svg>
  );
}
