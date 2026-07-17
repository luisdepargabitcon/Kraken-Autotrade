import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Layers, Target, History, Search } from "lucide-react";

interface GridLevelsCompactPanelProps {
  operational?: any;
}

type LevelFilter = "vigentes" | "ciclos" | "historico";

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("es-ES", { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

function statusColor(status: string): string {
  switch (status) {
    case "planned":
      return "bg-muted/10 text-muted-foreground border-border/50";
    case "open":
    case "active":
      return "text-cyan-400 border-cyan-500/30 bg-cyan-500/10";
    case "filled":
      return "text-green-400 border-green-500/30 bg-green-500/10";
    case "replaced":
    case "expired":
      return "text-muted-foreground border-border/50 bg-muted/10";
    case "cancelled":
      return "text-red-400 border-red-500/30 bg-red-500/10";
    default:
      return "text-muted-foreground border-border/50 bg-muted/10";
  }
}

interface LevelRowProps {
  level: any;
  index: number;
}

function LevelRow({ level, index }: LevelRowProps) {
  return (
    <div className="rounded-lg border border-border/50 p-3 text-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={statusColor(level.status)}>
            {level.side}
          </Badge>
          {level.targetOfOpenCycle && (
            <Badge variant="outline" className="text-cyan-400 border-cyan-500/30 bg-cyan-500/10 text-xs">
              <Target className="h-3 w-3 mr-1" />
              Objetivo de venta activo
            </Badge>
          )}
          {level.rangeRelation === "previous" && !level.targetOfOpenCycle && (
            <Badge variant="outline" className="text-muted-foreground text-xs">
              Histórico
            </Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">#{index + 1}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Precio</span>
          <span className="font-mono text-foreground">{fmtPrice(level.price)}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Cantidad</span>
          <span className="font-mono text-foreground">{fmtQty(level.quantity)}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Estado</span>
          <span className="text-foreground">{level.statusLabel}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Ciclo asociado</span>
          <span className="text-foreground">{level.cycleNumber != null ? `#${level.cycleNumber}` : "—"}</span>
        </div>
      </div>

      {level.estimatedNetProfit != null && (
        <div className="mt-2 text-xs">
          <span className="text-muted-foreground">Resultado estimado:</span>{" "}
          <span className={level.estimatedNetProfit >= 0 ? "text-green-400" : "text-red-400"}>
            {level.estimatedNetProfit >= 0 ? "+" : ""}${level.estimatedNetProfit.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground transition-colors">Detalle técnico</summary>
        <div className="mt-1 space-y-0.5 font-mono text-[10px]">
          <p>ID: {level.id}</p>
          <p>Rango: {level.rangeRelation === "current" ? "Vigente" : "Anterior"}</p>
          {level.rangeVersionId && <p>rangeVersionId: {level.rangeVersionId}</p>}
          {level.cycleId && <p>cycleId: {level.cycleId}</p>}
          {level.createdAt && <p>Creado: {new Date(level.createdAt).toLocaleString("es-ES")}</p>}
        </div>
      </details>
    </div>
  );
}

export function GridLevelsCompactPanel({ operational }: GridLevelsCompactPanelProps) {
  const [filter, setFilter] = useState<LevelFilter>("vigentes");
  const [search, setSearch] = useState("");

  const levels = useMemo(() => {
    const all = operational?.levels ?? {};
    if (filter === "vigentes") return (all.activeRangeLevels ?? []) as any[];
    if (filter === "ciclos") return (all.openCycleTargetLevels ?? []) as any[];
    return (all.historicalLevels ?? []) as any[];
  }, [operational?.levels, filter]);

  const filteredLevels = useMemo(() => {
    if (!search.trim()) return levels;
    const q = search.trim().toLowerCase();
    return levels.filter((l) =>
      (l.side ?? "").toLowerCase().includes(q) ||
      String(l.price ?? "").includes(q) ||
      String(l.cycleNumber ?? "").includes(q) ||
      (l.statusLabel ?? "").toLowerCase().includes(q)
    );
  }, [levels, search]);

  const FILTER_LABELS: { key: LevelFilter; label: string; count: number }[] = [
    { key: "vigentes", label: "Vigentes", count: (operational?.levels?.activeRangeLevels ?? []).length },
    { key: "ciclos", label: "Ciclos abiertos", count: (operational?.levels?.openCycleTargetLevels ?? []).length },
    { key: "historico", label: "Histórico", count: (operational?.levels?.historicalLevels ?? []).length },
  ];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Niveles
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col md:flex-row gap-2 md:items-center justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTER_LABELS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "default" : "outline"}
                className="text-xs h-7"
                onClick={() => setFilter(f.key)}
              >
                {f.label} ({f.count})
              </Button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="pl-7 pr-3 py-1 text-xs rounded-md border border-border/50 bg-background outline-none focus:ring-1 focus:ring-primary w-full md:w-56"
            />
          </div>
        </div>

        {filter === "ciclos" && (
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2 text-xs text-cyan-400">
            Los niveles SELL asociados a ciclos abiertos se marcan como &quot;Objetivo de venta activo&quot;, aunque pertenezcan a un rango anterior.
          </div>
        )}

        <div className="space-y-3">
          {filteredLevels.length > 0 ? (
            filteredLevels.map((level, i) => <LevelRow key={level.id || i} level={level} index={i} />)
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No hay niveles en esta categoría.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
