import { FormEvent, useEffect, useState } from "react";
import { ensureAuthV2Session, getAuthV2Session, pairAuthV2Device, obtainAuthV2Session, logoutAuthV2 } from "@/lib/authV2";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    ensureAuthV2Session().then(session => {
      if (!mounted) return;
      setAuthenticated(!!session);
      setReady(true);
    });
    const cleared = () => { setAuthenticated(false); setReady(true); };
    const updated = () => { setAuthenticated(!!getAuthV2Session()); setReady(true); };
    window.addEventListener("authv2-session-cleared", cleared);
    window.addEventListener("authv2-session-updated", updated);
    return () => {
      mounted = false;
      window.removeEventListener("authv2-session-cleared", cleared);
      window.removeEventListener("authv2-session-updated", updated);
    };
  }, []);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const paired = await pairAuthV2Device(code.trim());
      if (!paired.ok) {
        setError("No se pudo vincular el dispositivo. Comprueba que el código sea correcto y no haya caducado.");
        return;
      }
      const session = await obtainAuthV2Session();
      if (!session) {
        setError("El dispositivo quedó vinculado, pero no se pudo abrir la sesión. Inténtalo de nuevo.");
        return;
      }
      setAuthenticated(true);
    } catch {
      setError("No se pudo contactar con el servidor. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-foreground">Comprobando sesión…</div>;
  }
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
        <form onSubmit={submit} className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm space-y-4">
          <div>
            <h1 className="text-xl font-semibold">Vincular este dispositivo</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Introduce el código de vinculación emitido por el propietario del bot. No se solicita ningún código bootstrap en el navegador.
            </p>
          </div>
          <label className="block text-sm font-medium">
            Código de vinculación
            <input
              className="mt-2 w-full rounded-md border bg-background px-3 py-2 uppercase tracking-widest"
              value={code}
              onChange={ev => setCode(ev.target.value.toUpperCase())}
              autoComplete="one-time-code"
              autoFocus
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={busy || !code.trim()} className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
            {busy ? "Vinculando…" : "Vincular dispositivo"}
          </button>
        </form>
      </div>
    );
  }
  return <>{children}</>;
}

export function AuthLogoutButton() {
  return <button type="button" onClick={() => void logoutAuthV2()}>Cerrar sesión</button>;
}
