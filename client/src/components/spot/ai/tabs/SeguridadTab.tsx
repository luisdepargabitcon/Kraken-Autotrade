import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Lock, AlertTriangle, Info, Ban } from "lucide-react";
import type { SpotAiStatus } from "../spotAiTypes";

export function SeguridadTab({ status }: { status: SpotAiStatus }) {
  return (
    <div className="space-y-3">
      {/* Advisory-only guarantee */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-green-400" />
            Garantías de Seguridad
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SecurityItem
              icon={<ShieldCheck className="h-4 w-4 text-green-400" />}
              title="AI Trading Control"
              value={status.aiTradingControl}
              good={status.aiTradingControl === "NONE"}
              goodLabel="NINGUNO — La IA no controla trading"
              badLabel="Control activo — revisar configuración"
            />
            <SecurityItem
              icon={<Lock className="h-4 w-4 text-green-400" />}
              title="Auto-retrain"
              value={status.autoRetrain ? "Activado" : "Desactivado"}
              good={!status.autoRetrain}
              goodLabel="Desactivado — entrenamiento solo manual"
              badLabel="Activado — debería estar desactivado"
            />
            <SecurityItem
              icon={<Info className="h-4 w-4 text-green-400" />}
              title="Legacy data mixed"
              value={status.legacyDataMixed ? "Sí" : "No"}
              good={!status.legacyDataMixed}
              goodLabel="No — dataset 100% Forward Twin"
              badLabel="Sí — datos legacy detectados"
            />
            <SecurityItem
              icon={<ShieldCheck className="h-4 w-4 text-green-400" />}
              title="Feature Schema"
              value={`v${status.featureSchemaVersion}`}
              good={true}
              goodLabel="Schema versionado y validado"
              badLabel=""
            />
          </div>
        </CardContent>
      </Card>

      {/* Forbidden actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Ban className="h-4 w-4 text-red-400" />
            Acciones Prohibidas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {[
              "Colocar órdenes reales o simuladas",
              "Bloquear o permitir entradas",
              "Forzar salidas o mover stops",
              "Cambiar sizing o capital asignado",
              "Modificar parámetros del SpotEngine",
              "Activar modelos automáticamente",
              "Mezclar datos legacy con Forward Twin",
              "Crear labels sintéticos",
              "Entrenar con < 100 trades etiquetados",
              "Acceder a API keys o credenciales",
            ].map((action, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-red-500/[0.06] border border-red-500/20">
                <Ban className="h-3 w-3 text-red-400 flex-shrink-0" />
                <span className="text-xs text-muted-foreground">{action}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Training guard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Training Guard
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Trades etiquetados actuales</span>
              <span className="text-lg font-bold font-mono">{status.labeledTrades}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Mínimo requerido</span>
              <span className={`text-sm font-bold font-mono ${status.labeledTrades >= status.minTradesToTrain ? "text-green-400" : "text-amber-400"}`}>
                {status.minTradesToTrain}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Preferido</span>
              <span className="text-sm font-bold font-mono text-blue-400">{status.preferredTradesToTrain}</span>
            </div>
          </div>
          <div className={`p-3 rounded-lg border ${status.labeledTrades >= status.minTradesToTrain ? "bg-green-500/10 border-green-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
            <div className="flex items-center gap-2">
              {status.labeledTrades >= status.minTradesToTrain ? (
                <><ShieldCheck className="h-4 w-4 text-green-400" /><span className="text-sm font-semibold text-green-400">Entrenamiento permitido</span></>
              ) : (
                <><Lock className="h-4 w-4 text-amber-400" /><span className="text-sm font-semibold text-amber-400">Entrenamiento bloqueado</span></>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {status.labeledTrades >= status.minTradesToTrain
                ? "Hay suficientes trades etiquetados para iniciar entrenamiento manual."
                : `Faltan ${status.minTradesToTrain - status.labeledTrades} trades para alcanzar el mínimo de ${status.minTradesToTrain}.`}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Data isolation */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-400" />
            Aislamiento de Datos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>El dataset Forward Twin proviene <strong className="text-white">exclusivamente</strong> de <code className="text-primary">spot_forward_twin_snapshots</code>.</p>
            <p>No se utilizan tablas legacy (<code className="text-muted-foreground">training_trades</code>, <code className="text-muted-foreground">ai_shadow_decisions</code>, <code className="text-muted-foreground">ai_config</code>).</p>
            <p>Los features se extraen con <strong className="text-white">validateNoLookahead()</strong> que verifica que ningún feature contenga información futura.</p>
            <p>Los labels se calculan <strong className="text-white">solo tras el cierre</strong> del trade, nunca antes.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SecurityItem({ icon, title, value, good, goodLabel, badLabel }: {
  icon: React.ReactNode;
  title: string;
  value: string;
  good: boolean;
  goodLabel: string;
  badLabel: string;
}) {
  return (
    <div className={`p-3 rounded-lg border ${good ? "bg-green-500/10 border-green-500/20" : "bg-red-500/10 border-red-500/20"}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-semibold">{title}</span>
      </div>
      <div className="text-sm font-bold font-mono">{value}</div>
      <div className={`text-[10px] mt-1 ${good ? "text-green-400" : "text-red-400"}`}>{good ? goodLabel : badLabel}</div>
    </div>
  );
}
