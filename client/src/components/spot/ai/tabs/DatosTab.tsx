import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Database, ScanLine, Eye, Zap, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { DatasetOverview, DatasetQuality, FeatureInfo, PairDistribution, RegimeDistribution } from "../spotAiTypes";

export function DatosTab() {
  const { data: dataset } = useQuery<DatasetOverview>({
    queryKey: ["/api/spot/ai/dataset"],
    queryFn: async () => { const r = await fetch("/api/spot/ai/dataset"); if (!r.ok) throw new Error("fetch"); return r.json(); },
    refetchInterval: 30000,
  });
  const { data: quality } = useQuery<DatasetQuality>({
    queryKey: ["/api/spot/ai/dataset/quality"],
    queryFn: async () => { const r = await fetch("/api/spot/ai/dataset/quality"); if (!r.ok) throw new Error("fetch"); return r.json(); },
    refetchInterval: 30000,
  });
  const { data: features } = useQuery<{ features: FeatureInfo[]; schemaVersion: number }>({
    queryKey: ["/api/spot/ai/features"],
    queryFn: async () => { const r = await fetch("/api/spot/ai/features"); if (!r.ok) throw new Error("fetch"); return r.json(); },
  });
  const { data: pairs } = useQuery<{ pairs: PairDistribution[] }>({
    queryKey: ["/api/spot/ai/dataset/pairs"],
    queryFn: async () => { const r = await fetch("/api/spot/ai/dataset/pairs"); if (!r.ok) throw new Error("fetch"); return r.json(); },
    refetchInterval: 30000,
  });
  const { data: regimes } = useQuery<{ regimes: RegimeDistribution[] }>({
    queryKey: ["/api/spot/ai/dataset/regimes"],
    queryFn: async () => { const r = await fetch("/api/spot/ai/dataset/regimes"); if (!r.ok) throw new Error("fetch"); return r.json(); },
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-3">
      {/* Dataset overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-400" />
            Dataset — Resumen General
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dataset ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <KpiBox icon={<Database className="h-3 w-3" />} label="Total snapshots" value={dataset.totalSnapshots} />
              <KpiBox icon={<ScanLine className="h-3 w-3" />} label="SCAN" value={dataset.scanCount} />
              <KpiBox icon={<Eye className="h-3 w-3" />} label="SUPERVISOR" value={dataset.supervisorCount} />
              <KpiBox icon={<Zap className="h-3 w-3" />} label="FILL" value={dataset.fillCount} />
              <KpiBox icon={<Database className="h-3 w-3" />} label="Trades etiquetados" value={dataset.labeledTrades} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Cargando dataset...</p>
          )}
        </CardContent>
      </Card>

      {/* Quality checks */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            Calidad del Dataset
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {quality ? (
            <>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Score global:</span>
                <Badge className={quality.score >= 80 ? "bg-green-500/20 text-green-400" : quality.score >= 50 ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"}>
                  {quality.score}/100
                </Badge>
                <span className="text-xs text-muted-foreground">Schema v{quality.featureSchemaVersion}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <QualityCheck label="Lookahead" value={quality.checks.lookaheadFeatures} good={quality.checks.lookaheadFeatures === 0} />
                <QualityCheck label="Legacy mixto" value={quality.checks.legacyMixed ? "Sí" : "No"} good={!quality.checks.legacyMixed} />
                <QualityCheck label="Labels sintéticos" value={quality.checks.syntheticLabels ? "Sí" : "No"} good={!quality.checks.syntheticLabels} />
                <QualityCheck label="Duplicados" value={quality.checks.duplicateTrades} good={quality.checks.duplicateTrades === 0} />
                <QualityCheck label="Features missing" value={quality.checks.missingFeatures} good={quality.checks.missingFeatures === 0} />
                <QualityCheck label="Snapshots inválidos" value={quality.checks.invalidSnapshots} good={quality.checks.invalidSnapshots === 0} />
                <QualityCheck label="Supervisor huérfanos" value={quality.checks.orphanSupervisor} good={quality.checks.orphanSupervisor === 0} />
                <QualityCheck label="Fills huérfanos" value={quality.checks.orphanFills} good={quality.checks.orphanFills === 0} />
                <QualityCheck label="Trades incompletos" value={quality.checks.incompleteTrades} good={quality.checks.incompleteTrades === 0} />
                <QualityCheck label="Schema mismatch" value={quality.checks.schemaVersionMismatches} good={quality.checks.schemaVersionMismatches === 0} />
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Cargando calidad...</p>
          )}
        </CardContent>
      </Card>

      {/* Features table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Database className="h-4 w-4 text-purple-400" />
            Features Extraídas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {features ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Feature</TableHead>
                    <TableHead className="text-xs">Tipo</TableHead>
                    <TableHead className="text-xs">Origen</TableHead>
                    <TableHead className="text-xs">Timeframe</TableHead>
                    <TableHead className="text-xs text-right">Missing %</TableHead>
                    <TableHead className="text-xs text-right">Versión</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {features.features.map((f) => (
                    <TableRow key={f.name}>
                      <TableCell className="text-xs font-mono">{f.name}</TableCell>
                      <TableCell className="text-xs">{f.type}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{f.origin}</TableCell>
                      <TableCell className="text-xs">{f.timeframe}</TableCell>
                      <TableCell className="text-xs text-right">{f.missingPct}%</TableCell>
                      <TableCell className="text-xs text-right">v{f.version}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Cargando features...</p>
          )}
        </CardContent>
      </Card>

      {/* Pair distribution */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan-400" />
            Distribución por Par
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pairs && pairs.pairs.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Par</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                    <TableHead className="text-xs text-right">SCAN</TableHead>
                    <TableHead className="text-xs text-right">SUP</TableHead>
                    <TableHead className="text-xs text-right">FILL</TableHead>
                    <TableHead className="text-xs text-right">Trades</TableHead>
                    <TableHead className="text-xs text-right">Win Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pairs.pairs.map((p) => (
                    <TableRow key={p.pair}>
                      <TableCell className="text-xs font-mono font-semibold">{p.pair}</TableCell>
                      <TableCell className="text-xs text-right">{p.total}</TableCell>
                      <TableCell className="text-xs text-right">{p.scans}</TableCell>
                      <TableCell className="text-xs text-right">{p.supervisors}</TableCell>
                      <TableCell className="text-xs text-right">{p.fills}</TableCell>
                      <TableCell className="text-xs text-right">{p.trades}</TableCell>
                      <TableCell className="text-xs text-right">{p.winRate !== null ? `${(p.winRate * 100).toFixed(1)}%` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{pairs ? "Sin datos por par" : "Cargando..."}</p>
          )}
        </CardContent>
      </Card>

      {/* Regime distribution */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Database className="h-4 w-4 text-amber-400" />
            Distribución por Regime
          </CardTitle>
        </CardHeader>
        <CardContent>
          {regimes && regimes.regimes.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {regimes.regimes.map((r, i) => (
                <div key={i} className="p-2 rounded-lg bg-white/5 border border-white/10">
                  <div className="text-xs font-mono font-semibold">{r.regime}</div>
                  <div className="text-[10px] text-muted-foreground">{r.direction}</div>
                  <div className="text-sm font-bold">{r.count}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{regimes ? "Sin datos de regime" : "Cargando..."}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-1">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-xl font-bold font-mono">{value}</div>
    </div>
  );
}

function QualityCheck({ label, value, good }: { label: string; value: string | number; good: boolean }) {
  return (
    <div className={`p-2 rounded-lg border ${good ? "bg-green-500/10 border-green-500/20" : "bg-red-500/10 border-red-500/20"}`}>
      <div className="flex items-center gap-1">
        {good ? <CheckCircle2 className="h-3 w-3 text-green-400" /> : <AlertTriangle className="h-3 w-3 text-red-400" />}
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <div className={`text-sm font-mono font-bold ${good ? "text-green-400" : "text-red-400"}`}>{value}</div>
    </div>
  );
}
