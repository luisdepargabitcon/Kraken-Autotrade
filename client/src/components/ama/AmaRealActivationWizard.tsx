import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, ShieldCheck, AlertTriangle, CheckCircle2, X, XCircle } from "lucide-react";

interface ReadinessCheck {
  ok: boolean;
  detail?: string;
}

interface Readiness {
  ready: boolean;
  checks?: Record<string, ReadinessCheck>;
  blockers?: string[];
}

/**
 * Etiquetas humanas para cada check de preparación Real. Nunca se muestra la
 * clave técnica cruda (p.ej. "marketFresh") ni el `detail` interno del
 * backend directamente: solo una explicación en español.
 */
const CHECK_LABELS: Record<string, { label: string; explain: string }> = {
  featureFlag: {
    label: "Capacidad de operación real habilitada",
    explain: "Este servidor debe tener habilitada la operación real.",
  },
  killSwitch: {
    label: "Sin parada de emergencia activa",
    explain: "No puede activarse Real mientras la parada de emergencia esté activa.",
  },
  schema: {
    label: "Base de datos preparada",
    explain: "Las tablas necesarias deben existir y estar accesibles.",
  },
  marketFresh: {
    label: "Datos de mercado recientes",
    explain: "El precio de mercado debe estar actualizado.",
  },
  validPrice: {
    label: "Precio de mercado válido",
    explain: "Debe existir un precio de análisis válido.",
  },
  hwm: {
    label: "Máximo de referencia calculado",
    explain: "El sistema necesita haber calculado el máximo de referencia (HWM).",
  },
  mandateActive: {
    label: "Mandato activo",
    explain: "Debe existir un mandato aprobado y activo.",
  },
  policyActive: {
    label: "Política activa",
    explain: "Debe existir una política de ejecución activa.",
  },
  portfolioBudget: {
    label: "Capital presupuestado",
    explain: "Debe existir capital asignado al presupuesto.",
  },
  freeCapital: {
    label: "Capital libre disponible",
    explain: "Debe existir capital libre para operar.",
  },
  reconciliation: {
    label: "Sin reconciliaciones pendientes",
    explain: "No debe haber reconciliaciones sin resolver.",
  },
  realStateCompatible: {
    label: "Estado Real compatible",
    explain: "El estado operativo actual debe permitir una nueva activación.",
  },
};

function checkLabel(key: string): { label: string; explain: string } {
  return CHECK_LABELS[key] ?? { label: key, explain: "" };
}

interface AmaRealActivationWizardProps {
  onClose: () => void;
  onActivated: () => void;
}

type Step = 1 | 2 | 3 | 4;

/**
 * Asistente de 4 pasos para activar Real limitado. NUNCA cambia el modo
 * backend salvo en el paso final, tras confirmación explícita del usuario,
 * y solo si el servidor confirma éxito (POST /api/ama/real/activate).
 */
export function AmaRealActivationWizard({ onClose, onActivated }: AmaRealActivationWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [realEnabled, setRealEnabled] = useState<boolean | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(true);

  const [form, setForm] = useState({
    authorizedBy: "",
    maxCapitalUsd: "1000",
    maxSingleTrancheUsd: "200",
    maxTranchesPerCycle: "5",
    reason: "",
  });
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    fetch("/api/ama/real/readiness")
      .then((r) => r.json())
      .then((json) => {
        setReadiness(json.data ?? null);
        setRealEnabled(json?.data?.checks?.featureFlag?.ok ?? false);
      })
      .catch(() => setRealEnabled(false))
      .finally(() => setLoadingReadiness(false));
  }, []);

  async function handleActivate() {
    if (submitting) return; // evita doble clic
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/ama/real/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorizedBy: form.authorizedBy,
          maxCapitalUsd: Number(form.maxCapitalUsd),
          maxSingleTrancheUsd: Number(form.maxSingleTrancheUsd),
          maxTranchesPerCycle: Number(form.maxTranchesPerCycle),
          confirm: true,
          reason: form.reason || "Activación vía asistente",
        }),
      });
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        setSubmitError("Respuesta inválida del servidor.");
        return;
      }
      if (!res.ok || !json?.success) {
        setSubmitError(json?.error || "No se pudo activar el modo Real.");
        return;
      }
      setActivated(true);
      onActivated();
    } catch {
      setSubmitError("No se pudo conectar con el servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  const canGoLimits = !loadingReadiness && realEnabled !== false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-orange-400" /> Activar modo Real — Paso {step} de 4
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {step === 1 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Preparación</h3>
              {loadingReadiness ? (
                <div className="text-sm text-muted-foreground">Comprobando estado del sistema...</div>
              ) : (
                <>
                  {realEnabled === false && (
                    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-muted-foreground flex items-start gap-2">
                      <Lock className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <span>
                        Este servidor no tiene habilitada todavía la capacidad de operación real.
                        Puedes revisar la configuración y las comprobaciones, pero no puedes armar
                        AMA Real en este entorno.
                      </span>
                    </div>
                  )}
                  {readiness?.checks && (
                    <div className="space-y-1.5">
                      {Object.entries(readiness.checks).map(([key, check]) => {
                        const { label, explain } = checkLabel(key);
                        return (
                          <div
                            key={key}
                            className="flex items-start gap-2 rounded-md border border-border/20 bg-muted/5 px-2.5 py-1.5 text-xs"
                          >
                            {check.ok ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-400 flex-shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                            )}
                            <div>
                              <div className={check.ok ? "text-foreground/90" : "text-red-300"}>
                                {check.ok ? "Preparado" : "Bloqueado"} — {label}
                              </div>
                              {!check.ok && explain && (
                                <div className="text-muted-foreground mt-0.5">{explain}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {readiness?.ready && (
                    <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 text-sm text-muted-foreground flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0 mt-0.5" />
                      <span>El sistema puede iniciar el proceso de activación de Real limitado.</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Límites de operación</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Autorizado por</Label>
                  <Input value={form.authorizedBy} onChange={(e) => setForm({ ...form, authorizedBy: e.target.value })} placeholder="admin" />
                </div>
                <div>
                  <Label className="text-xs">Capital máximo USD</Label>
                  <Input type="number" value={form.maxCapitalUsd} onChange={(e) => setForm({ ...form, maxCapitalUsd: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Tramo máximo USD</Label>
                  <Input type="number" value={form.maxSingleTrancheUsd} onChange={(e) => setForm({ ...form, maxSingleTrancheUsd: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Tramos por ciclo</Label>
                  <Input type="number" value={form.maxTranchesPerCycle} onChange={(e) => setForm({ ...form, maxTranchesPerCycle: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Confirmación</h3>
              <div className="rounded-md border border-border/30 bg-muted/10 p-3 text-xs space-y-1">
                <div>Autorizado por: <strong>{form.authorizedBy || "—"}</strong></div>
                <div>Capital máximo: <strong>${form.maxCapitalUsd}</strong></div>
                <div>Tramo máximo: <strong>${form.maxSingleTrancheUsd}</strong></div>
                <div>Tramos por ciclo: <strong>{form.maxTranchesPerCycle}</strong></div>
              </div>
              <div className="flex items-start gap-2">
                <input
                  id="wizard-confirm"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <label htmlFor="wizard-confirm" className="text-xs text-muted-foreground cursor-pointer">
                  Entiendo que esto activa el modo <strong>Real limitado</strong>. El sistema quedará
                  armado, pero no se crearán órdenes hasta que exista una señal válida.
                </label>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Activación</h3>
              {activated ? (
                <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-400 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Real limitado activado. El sistema está armado.
                </div>
              ) : (
                <>
                  {realEnabled === false ? (
                    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-muted-foreground flex items-start gap-2">
                      <Lock className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <span>Este servidor no tiene habilitada todavía la capacidad de operación real.</span>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Pulsa activar para confirmar y enviar la solicitud al servidor.
                    </div>
                  )}
                  {submitError && (
                    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-400 flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" /> {submitError}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border/30 px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as Step))}
            disabled={submitting}
          >
            {step === 1 ? "Cancelar" : "Atrás"}
          </Button>

          {step < 4 && (
            <Button
              size="sm"
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={
                (step === 1 && !canGoLimits) ||
                (step === 2 && !form.authorizedBy) ||
                (step === 3 && !confirmed)
              }
            >
              Siguiente
            </Button>
          )}

          {step === 4 && !activated && (
            <Button
              size="sm"
              className="bg-orange-500/80 hover:bg-orange-500"
              onClick={handleActivate}
              disabled={submitting || realEnabled === false || !confirmed}
            >
              {submitting ? "Activando..." : "Activar Real limitado"}
            </Button>
          )}

          {step === 4 && activated && (
            <Button size="sm" onClick={onClose}>
              Cerrar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
