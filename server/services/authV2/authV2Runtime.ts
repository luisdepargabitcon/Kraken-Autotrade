import { AuthV2Service, InMemoryAuthV2Store, type AuthV2Store } from "./authV2Service";
import { DrizzleAuthV2Store } from "./authV2DrizzleStore";

function isMissingAuthTable(err: unknown): boolean {
  const e = err as any;
  return e?.code === "42P01" || e?.code === "42703" || /nexa_auth_.*does not exist/i.test(String(e?.message || ""));
}

class ResilientAuthV2Store implements AuthV2Store {
  private degraded = false;
  constructor(private primary: AuthV2Store, private fallback: InMemoryAuthV2Store) {}
  private async call<T>(fn: (s: AuthV2Store) => Promise<T>): Promise<T> {
    if (this.degraded) return fn(this.fallback);
    try { return await fn(this.primary); }
    catch (err) {
      if (!isMissingAuthTable(err)) throw err;
      if (!this.degraded) {
        this.degraded = true;
        console.error("[AUTHV2] durable auth tables unavailable; using volatile in-memory auth store");
      }
      return fn(this.fallback);
    }
  }
  saveDevice(d: any) { return this.call(s => s.saveDevice(d)); }
  getDevice(id: string) { return this.call(s => s.getDevice(id)); }
  listDevices() { return this.call(s => s.listDevices()); }
  revokeDevice(id: string, at: number) { return this.call(s => s.revokeDevice(id, at)); }
  countActiveDevices() { return this.call(s => s.countActiveDevices()); }
  hasActiveAdminDevice() { return this.call(s => s.hasActiveAdminDevice()); }
  savePairingCode(h: string, r: string[], e: number) { return this.call(s => s.savePairingCode(h, r, e)); }
  consumePairingCode(h: string, d: string, at: number) { return this.call(s => s.consumePairingCode(h, d, at)); }
  saveChallenge(h: string, d: string, e: number) { return this.call(s => s.saveChallenge(h, d, e)); }
  consumeChallenge(h: string) { return this.call(s => s.consumeChallenge(h)); }
  saveSession(x: any) { return this.call(s => s.saveSession(x)); }
  getSession(h: string) { return this.call(s => s.getSession(h)); }
  listActiveSessionsForDevice(d: string, n: number) { return this.call(s => s.listActiveSessionsForDevice(d, n)); }
  revokeSession(h: string, at: number) { return this.call(s => s.revokeSession(h, at)); }
  pruneExpired(n: number) { return this.call(s => s.pruneExpired(n)); }
}

let singletonPromise: Promise<AuthV2Service> | null = null;
async function createSingleton(): Promise<AuthV2Service> {
  try {
    const { db } = await import("../../db");
    return new AuthV2Service(new ResilientAuthV2Store(new DrizzleAuthV2Store(db), new InMemoryAuthV2Store()));
  } catch {
    console.error("[AUTHV2] durable database unavailable; using volatile in-memory auth store");
    return new AuthV2Service(new InMemoryAuthV2Store());
  }
}
export function getAuthV2Service(): Promise<AuthV2Service> {
  if (!singletonPromise) singletonPromise = createSingleton();
  return singletonPromise;
}
export function resetAuthV2ServiceForTests(): void { singletonPromise = null; }
