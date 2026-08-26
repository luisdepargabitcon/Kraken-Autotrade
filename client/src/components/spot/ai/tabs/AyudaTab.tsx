import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, Info, Database, Eye, Brain, ShieldCheck, BarChart3, AlertTriangle, Lock, GitBranch } from "lucide-react";

export function AyudaTab() {
  const steps = [
    { badge: "1", title: "Recopilación automática", desc: "El SpotEngine captura snapshots de cada ciclo Forward Twin en SHADOW mode. No requiere acción manual.", icon: Database },
    { badge: "2", title: "Verificar dataset", desc: "En la pestaña Datos, revisa que los snapshots crezcan, los pares estén presentes y la calidad sea 100/100.", icon: BarChart3 },
    { badge: "3", title: "Esperar trades etiquetados", desc: "Los labels se calculan tras el cierre de cada trade. Necesitas mínimo 100 trades etiquetados para entrenar.", icon: Eye },
    { badge: "4", title: "Entrenar modelo (manual)", desc: "Cuando haya 100+ trades, pulsa Entrenar en Modelos. El training guard bloquea si no hay suficientes.", icon: Brain },
    { badge: "5", title: "Revisar modelo candidato", desc: "El modelo se registra como CANDIDATE. Revisa métricas en Validación antes de promoverlo.", icon: BarChart3 },
    { badge: "6", title: "Promover a ACTIVE_ADVISORY", desc: "Si las métricas son buenas, el modelo puede promoverse a advisory. Solo genera predicciones, no opera.", icon: ShieldCheck },
    { badge: "7", title: "Observar predicciones", desc: "En Predicciones, revisa las recomendaciones del modelo. Comparalas con lo que realmente pasó.", icon: Eye },
    { badge: "8", title: "Auditar todo", desc: "En Auditoría, verifica versiones, runs de entrenamiento, git SHA y salud del collector.", icon: GitBranch },
    { badge: "9", title: "Reentrenar periódicamente", desc: "Con más datos, reentrena para mejorar. Cada versión es nueva — nunca sobrescribe la anterior.", icon: Brain },
    { badge: "10", title: "Mantener seguro", desc: "La IA NUNCA controla trading. No activar auto-retrain. No mezclar datos legacy. Siempre advisory-only.", icon: AlertTriangle },
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-blue-400" />
            Tutorial: Centro de Inteligencia IA Forward Twin
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Sigue estos 10 pasos para usar el sistema de IA Forward Twin de forma segura.
          </p>
          <div className="space-y-2">
            {steps.map((step, idx) => {
              const Icon = step.icon;
              return (
                <div key={idx} className="flex gap-3 items-start p-2 rounded-lg bg-white/5 border border-white/10">
                  <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                    <span className="text-[10px] font-bold font-mono text-primary">{step.badge}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Icon className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-semibold">{step.title}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-400" />
            Conceptos Clave
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Concept title="Forward Twin Snapshot" desc="Estructura JSON capturada en cada ciclo del SpotEngine. Contiene estado de mercado, regime, signal, intent, sizing, capital y position. Se almacena en spot_forward_twin_snapshots." />
          <Concept title="Feature extraction" desc="Función pura que lee el snapshot y extrae 30+ features numéricas y categóricas. Sin lookahead — solo usa datos disponibles en el momento de la predicción." />
          <Concept title="Label computation" desc="Calculada tras el cierre del trade. Incluye reached_0_5R, reached_1R, reached_2R, final_net_profitable, MFE_R, MAE_R, time_to_exit, giveback_pct." />
          <Concept title="Group split" desc="Todos los snapshots del mismo trade (lotId) van al mismo split (train/validation/test). Evita leakage entre splits." />
          <Concept title="Temporal split" desc="60% train, 20% validation, 20% test — en orden cronológico. Sin shuffle aleatorio." />
          <Concept title="Training guard" desc="Bloquea entrenamiento si labeledTrades < 100. Preferido: 200. Sin labels sintéticos." />
          <Concept title="Model registry" desc="Append-only. Cada versión es nueva. Estados: NOT_TRAINED → CANDIDATE → VALIDATED → ACTIVE_ADVISORY → RETIRED." />
          <Concept title="Advisory-only" desc="La IA genera predicciones pero NO puede operar. Sin control de trading, sin auto-activación, sin mezcla legacy." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Lock className="h-4 w-4 text-green-400" />
            Reglas Inquebrantables
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-1.5">
            {[
              "La IA Forward Twin es advisory-only — nunca controla trading",
              "No se mezclan datos legacy con datos Forward Twin",
              "No se entrena con menos de 100 trades etiquetados",
              "No se crean labels sintéticos",
              "No se activa auto-retrain",
              "No se modifican estrategias, policies, sizing ni ejecución",
              "No se toca GRID, IDCA, AMA, Telegram ni Fiscal",
              "Cada modelo es versionado y auditado con git SHA",
              "El dataset proviene exclusivamente de spot_forward_twin_snapshots",
              "Las features se validan con validateNoLookahead()",
            ].map((rule, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded bg-green-500/[0.06] border border-green-500/20">
                <ShieldCheck className="h-3 w-3 text-green-400 flex-shrink-0" />
                <span className="text-xs text-muted-foreground">{rule}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Concept({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="p-2 rounded-lg bg-white/5 border border-white/10">
      <p className="text-xs font-semibold mb-0.5">{title}</p>
      <p className="text-[11px] text-muted-foreground">{desc}</p>
    </div>
  );
}
