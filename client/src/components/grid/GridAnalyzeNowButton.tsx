import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, FlaskConical } from "lucide-react";

export interface GridAnalyzeNowButtonProps {
  onAuditRefreshed?: () => void;
  size?: "sm" | "default";
  variant?: "outline" | "default";
  label?: string;
  disabled?: boolean;
}

export function GridAnalyzeNowButton({
  onAuditRefreshed,
  size = "default",
  variant = "outline",
  label = "Analizar mercado ahora",
  disabled = false,
}: GridAnalyzeNowButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string>("");

  const handleClick = async () => {
    setState("loading");
    setMsg("");
    try {
      // Run both validations sequentially. Both are read-only and safe.
      const shadowResp = await fetch("/api/grid-isolated/shadow-validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!shadowResp.ok) {
        const err = await shadowResp.json().catch(() => ({}));
        throw new Error(err.message || err.reason || `Shadow HTTP ${shadowResp.status}`);
      }

      const proResp = await fetch("/api/grid-isolated/professional-generator/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!proResp.ok) {
        const err = await proResp.json().catch(() => ({}));
        throw new Error(err.message || err.reason || `Professional HTTP ${proResp.status}`);
      }

      // Ask the parent to refresh the audit data so the UI shows the new diagnostic.
      if (onAuditRefreshed) onAuditRefreshed();
      setState("ok");
      setMsg("Análisis completado. El diagnóstico se ha actualizado.");
      setTimeout(() => setState("idle"), 3000);
    } catch (err: any) {
      setState("error");
      setMsg(err.message || "Error de conexión");
    }
  };

  const icon =
    state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> :
    state === "ok" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> :
    state === "error" ? <XCircle className="h-4 w-4 text-red-500" /> :
    <FlaskConical className="h-4 w-4" />;

  const text =
    state === "loading" ? "Analizando..." :
    state === "ok" ? "Análisis completado" :
    state === "error" ? "Reintentar análisis" :
    label;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={handleClick}
        disabled={disabled || state === "loading"}
      >
        {icon}
        <span className="ml-2">{text}</span>
      </Button>
      {msg && state === "error" && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-2 text-xs text-red-700 dark:text-red-300">
          {msg}
        </div>
      )}
      {msg && state === "ok" && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-2 text-xs text-green-700 dark:text-green-300">
          {msg}
        </div>
      )}
    </div>
  );
}
