import { useCallback, useRef, useState } from "react";

export type RequestActionStatus = "idle" | "loading" | "success" | "error";

interface RequestActionState {
  status: RequestActionStatus;
  error: string | null;
}

interface RunOptions {
  /** Mensaje de error humano si la petición falla sin error explícito del servidor. */
  fallbackError?: string;
  /** Ejecutado solo tras confirmación explícita de éxito del servidor (json.success). */
  onSuccess?: (data: any) => void | Promise<void>;
}

/**
 * Helper reutilizable para botones que llaman a la API de AMA.
 *
 * Contrato:
 * - Evita doble clic / llamadas concurrentes (ignora nuevas invocaciones
 *   mientras `status === "loading"`).
 * - Comprueba `response.ok` y `json.success` antes de considerar éxito.
 * - Nunca actualiza estado de forma optimista: el callback `onSuccess` solo
 *   se invoca tras confirmación real del backend.
 * - Preserva el mensaje de error humano devuelto por el servidor
 *   (`json.error`) o usa `fallbackError` si no hay uno explícito.
 */
export function useRequestAction() {
  const [state, setState] = useState<RequestActionState>({ status: "idle", error: null });
  const runningRef = useRef(false);

  const run = useCallback(
    async (url: string, init: RequestInit | undefined, opts: RunOptions = {}) => {
      if (runningRef.current) return false; // evita doble clic
      runningRef.current = true;
      setState({ status: "loading", error: null });
      try {
        const res = await fetch(url, init);
        let json: any = null;
        try {
          json = await res.json();
        } catch {
          const msg = "Respuesta inválida del servidor.";
          setState({ status: "error", error: msg });
          return false;
        }
        if (res.ok && json?.success) {
          setState({ status: "success", error: null });
          if (opts.onSuccess) await opts.onSuccess(json.data);
          return true;
        }
        const msg = json?.error || opts.fallbackError || "No se pudo completar la acción.";
        setState({ status: "error", error: msg });
        return false;
      } catch {
        const msg = opts.fallbackError || "No se pudo conectar con el servidor.";
        setState({ status: "error", error: msg });
        return false;
      } finally {
        runningRef.current = false;
      }
    },
    [],
  );

  const reset = useCallback(() => setState({ status: "idle", error: null }), []);

  return {
    status: state.status,
    error: state.error,
    isLoading: state.status === "loading",
    run,
    reset,
  };
}
