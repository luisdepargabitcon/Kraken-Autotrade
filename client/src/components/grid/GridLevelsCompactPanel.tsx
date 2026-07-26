import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Layers, Target, History, Search, Info, AlertCircle } from "lucide-react";

interface GridLevelsCompactPanelProps {
  operational?: any;
}

type LevelFilter = "entradas" | "rungs" | "targets" | "historico";

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("es-ES", { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

function levelLabel(side: string, isTargetOfOpenCycle: boolean): string {
  if (side === "BUY") return "BUY entrada";
  if (isTargetOfOpenCycle) return "SELL objetivo de ciclo";
  return "SELL referencia";
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
            {levelLabel(level.side, level.targetOfOpenCycle)}
          </Badge>
          {level.targetOfOpenCycle && (
            <Badge variant="outline" className="text-cyan-400 border-cyan-500/30 bg-cyan-500/10 text-xs">
              <Target className="h-3 w-3 mr-1" />
              Vinculado a ciclo
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
  const all = operational?.levels ?? {};
  const market = operational?.market ?? {};
  const entryRange = market.entryRange ?? {};
  const levelDiagnostic = entryRange.levelDiagnostic ?? null;
  const actualLevels = entryRange.actualLevels ?? null;
  const requestedLevels = entryRange.requestedLevels ?? null;
  const levelsMismatch = actualLevels != null && requestedLevels != null && actualLevels < requestedLevels;
  const defaultFilter: LevelFilter =
    (all.entryLevels?.length ?? 0) === 0 && (all.legacyTargetLevels?.length ?? 0) > 0
      ? "targets"
      : "entradas";
  const [filter, setFilter] = useState<LevelFilter>(defaultFilter);
  const [search, setSearch] = useState("");
  const [historyLimit, setHistoryLimit] = useState(20);

  const levels = useMemo(() => {
    if (filter === "entradas") return (all.entryLevels ?? []) as any[];
    if (filter === "rungs") return (all.referenceRungs ?? []) as any[];
    if (filter === "targets") return (all.legacyTargetLevels ?? []) as any[];
    return ((all.historicalLevels ?? []) as any[]).slice(0, historyLimit);
  }, [all, filter, historyLimit]);

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
    { key: "entradas", label: "Entradas (BUY)", count: (operational?.levels?.entryLevels ?? []).length },
    { key: "rungs", label: "Rungs SELL de referencia", count: (operational?.levels?.referenceRungs ?? []).length },
    { key: "targets", label: "Targets de ciclo", count: (operational?.levels?.legacyTargetLevels ?? []).length },
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
        {/* Level count diagnostic */}
        {levelsMismatch && levelDiagnostic && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <p className="font-medium text-amber-400">
                {actualLevels} niveles activos en lugar de {requestedLevels} solicitados
              </p>
              <p className="text-muted-foreground">
                Rango efectivo: {levelDiagnostic.effectiveRangePct?.toFixed(2)}% · Separación mínima: {levelDiagnostic.minSpacingPct?.toFixed(2)}% · Máx. por lado: {levelDiagnostic.maxLevelsPerSide}
              </p>
            </div>
          </div>
        )}

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

        {filter === "entradas" && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2 text-xs text-emerald-400">
            Niveles BUY del rango activo. V3 genera un ciclo aislado por cada ejecución.
          </div>
        )}

        {filter === "rungs" && (
          <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-2 text-xs text-indigo-400">
            Rungs SELL de referencia del rango activo. No son ejecuciones propias; cada ciclo V3 tiene su target canónico separado.
          </div>
        )}

        {filter === "targets" && (
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2 text-xs text-cyan-400">
            Targets SELL vinculados a ciclos abiertos (legacy o V3 cycle-owned). Cada uno pertenece a un único ciclo.
          </div>
        )}

        {filter === "historico" && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-400">
            Los niveles históricos son solo de referencia; no se reconstruye la banda original.
          </div>
        )}

        <div className="space-y-3">
          {filteredLevels.length > 0 ? (
            <>
              {filteredLevels.map((level, i) => <LevelRow key={level.id || i} level={level} index={i} />)}
              {filter === "historico" && (all.historicalLevels?.length ?? 0) > historyLimit && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs h-8"
                  onClick={() => setHistoryLimit((l) => l + 20)}
                >
                  Mostrar más ({(all.historicalLevels?.length ?? 0) - historyLimit} restantes)
                </Button>
              )}
            </>
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
