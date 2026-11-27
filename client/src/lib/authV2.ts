export interface AuthV2Session {
  token: string;
  expiresAt: number;
  roles: string[];
  csrf: string;
}

export interface AuthV2KeyStorage {
  get(key: string): Promise<CryptoKey | undefined>;
  set(key: string, value: CryptoKey): Promise<void>;
  delete(key: string): Promise<void>;
}

const SESSION_KEY = "nexa.authv2.session";
const DEVICE_KEY = "nexa.authv2.deviceId";
const DEFAULT_API_BASE = "/api";

class IndexedDbKeyStorage implements AuthV2KeyStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open("nexa-authv2", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("keys");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }
  async get(key: string): Promise<CryptoKey | undefined> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction("keys").objectStore("keys").get(key);
      req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
      req.onerror = () => reject(req.error);
    });
  }
  async set(key: string, value: CryptoKey): Promise<void> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction("keys", "readwrite").objectStore("keys").put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  async delete(key: string): Promise<void> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction("keys", "readwrite").objectStore("keys").delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

let keyStorage: AuthV2KeyStorage | null = null;
let apiBase = DEFAULT_API_BASE;

export function configureAuthV2(options: { keyStorage?: AuthV2KeyStorage; apiBase?: string }): void {
  if (options.keyStorage) keyStorage = options.keyStorage;
  if (options.apiBase) apiBase = options.apiBase.replace(/\/+$/, "");
}

function keys(): AuthV2KeyStorage {
  if (!keyStorage) keyStorage = new IndexedDbKeyStorage();
  return keyStorage;
}

function storageArea(kind: "local" | "session"): Storage | null {
  try { return kind === "local" ? globalThis.localStorage : globalThis.sessionStorage; } catch { return null; }
}

export function getAuthV2DeviceId(): string {
  const local = storageArea("local");
  let id = local?.getItem(DEVICE_KEY) || "";
  if (!id) {
    id = crypto.randomUUID();
    local?.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getAuthV2Session(): AuthV2Session | null {
  try {
    const raw = storageArea("session")?.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthV2Session;
    if (!session.token || !session.csrf || !Number.isFinite(session.expiresAt) || Date.now() >= session.expiresAt) return null;
    return session;
  } catch {
    return null;
  }
}

export function getAuthV2Token(): string | null {
  return getAuthV2Session()?.token ?? null;
}

function saveSession(session: AuthV2Session): void {
  storageArea("session")?.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent("authv2-session-updated"));
}

export function clearAuthV2Session(): void {
  storageArea("session")?.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent("authv2-session-cleared"));
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function postJson<T>(path: string, body: unknown, session?: AuthV2Session | null): Promise<{ status: number; data: T | null }> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (session) {
    headers.authorization = `Bearer ${session.token}`;
    headers["x-csrf-token"] = session.csrf;
  }
  const res = await fetch(apiBase + path, { method: "POST", headers, body: JSON.stringify(body) });
  let data: T | null = null;
  try { data = await res.json() as T; } catch { /* non-json */ }
  return { status: res.status, data };
}

export async function pairAuthV2Device(code: string, label = "Navegador web"): Promise<{ ok: boolean; error?: string; roles?: string[] }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicKey = arrayBufferToBase64(await crypto.subtle.exportKey("spki", pair.publicKey));
  const deviceId = getAuthV2DeviceId();
  const res = await postJson<{ ok?: boolean; roles?: string[]; error?: string }>("/v2/pair/redeem", {
    code: String(code || "").trim(),
    deviceId,
    publicKey,
    platform: "web",
    label,
  });
  if (res.status !== 200 || !res.data?.ok) return { ok: false, error: res.data?.error || `pair_failed_${res.status}` };
  await keys().set("private", pair.privateKey);
  await keys().set("public", pair.publicKey);
  return { ok: true, roles: res.data.roles || [] };
}

async function signNonce(nonce: string): Promise<string | null> {
  const privateKey = await keys().get("private");
  if (!privateKey) return null;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    new TextEncoder().encode(nonce),
  );
  return arrayBufferToBase64(signature);
}

export async function obtainAuthV2Session(): Promise<AuthV2Session | null> {
  const deviceId = getAuthV2DeviceId();
  const challenge = await postJson<{ nonce?: string }>("/v2/session/challenge", { deviceId });
  if (challenge.status !== 200 || !challenge.data?.nonce) return null;
  const signature = await signNonce(challenge.data.nonce);
  if (!signature) return null;
  const redeemed = await postJson<AuthV2Session>("/v2/session/redeem", { deviceId, nonce: challenge.data.nonce, signature });
  if (redeemed.status !== 200 || !redeemed.data?.token || !redeemed.data.csrf) return null;
  const session = redeemed.data;
  saveSession(session);
  return session;
}

export async function ensureAuthV2Session(): Promise<AuthV2Session | null> {
  const current = getAuthV2Session();
  if (current && current.expiresAt - Date.now() > 30_000) return current;
  const renewed = await obtainAuthV2Session().catch(() => null);
  if (!renewed) clearAuthV2Session();
  return renewed;
}

export async function logoutAuthV2(): Promise<void> {
  const session = getAuthV2Session();
  if (session) await postJson("/v2/auth/logout", {}, session).catch(() => undefined);
  clearAuthV2Session();
}

export async function authV2Headers(method = "GET"): Promise<Record<string, string>> {
  const session = await ensureAuthV2Session();
  if (!session) return {};
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` };
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) headers["x-csrf-token"] = session.csrf;
  return headers;
}

export function authV2WebSocketToken(): string | null {
  return getAuthV2Token();
}
