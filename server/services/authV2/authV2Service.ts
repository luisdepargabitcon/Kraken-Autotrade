// AuthV2Service — passwordless device authentication compatible with the NEXA v2 BFF contract.
// ECDSA P-256/SHA-256 ieee-p1363 signatures over UTF-8 nonce bytes; server stores hashes only.
import { randomBytes, createHash, verify as cryptoVerify, timingSafeEqual, createPublicKey } from "crypto";

export const AUTHV2_PERMISSIONS = [
  "admin", "*", "read",
  "idca:read", "idca:control", "idca:emergency",
  "grid:read", "grid:control",
  "ama:read", "ama:control",
  "spot:read", "spot:control",
  "portfolio:read", "portfolio:control",
  "fisco:read", "fisco:control",
] as const;
export type AuthV2Permission = typeof AUTHV2_PERMISSIONS[number];

export interface AuthV2Device {
  deviceId: string;
  publicKeySpkiB64: string;
  roles: string[];
  pairedAt: number;
  revokedAt: number | null;
  label?: string;
  platform?: string;
}
export interface AuthV2Session {
  tokenHash: string;
  deviceId: string;
  roles: string[];
  csrfHash: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}
export interface AuthV2Store {
  saveDevice(device: AuthV2Device): Promise<void>;
  getDevice(deviceId: string): Promise<AuthV2Device | undefined>;
  listDevices(): Promise<AuthV2Device[]>;
  revokeDevice(deviceId: string, at: number): Promise<void>;
  countActiveDevices(): Promise<number>;
  hasActiveAdminDevice(): Promise<boolean>;
  savePairingCode(codeHash: string, roles: string[], expiresAt: number): Promise<void>;
  consumePairingCode(codeHash: string, deviceId: string, at: number): Promise<{ roles: string[]; expiresAt: number } | null>;
  saveChallenge(nonceHash: string, deviceId: string, expiresAt: number): Promise<void>;
  consumeChallenge(nonceHash: string): Promise<{ deviceId: string; expiresAt: number } | null>;
  saveSession(session: AuthV2Session): Promise<void>;
  getSession(tokenHash: string): Promise<AuthV2Session | undefined>;
  listActiveSessionsForDevice(deviceId: string, now: number): Promise<AuthV2Session[]>;
  revokeSession(tokenHash: string, at: number): Promise<void>;
  pruneExpired(now: number): Promise<void>;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export class InMemoryAuthV2Store implements AuthV2Store {
  readonly devices = new Map<string, AuthV2Device>();
  readonly pairingCodes = new Map<string, { roles: string[]; expiresAt: number; usedBy?: string; usedAt?: number }>();
  readonly challenges = new Map<string, { deviceId: string; expiresAt: number }>();
  readonly sessions = new Map<string, AuthV2Session>();

  async saveDevice(device: AuthV2Device): Promise<void> { this.devices.set(device.deviceId, { ...device, roles: [...device.roles] }); }
  async getDevice(deviceId: string): Promise<AuthV2Device | undefined> { const d = this.devices.get(deviceId); return d ? { ...d, roles: [...d.roles] } : undefined; }
  async listDevices(): Promise<AuthV2Device[]> { return [...this.devices.values()].map(d => ({ ...d, roles: [...d.roles] })); }
  async revokeDevice(deviceId: string, at: number): Promise<void> {
    const d = this.devices.get(deviceId);
    if (d) d.revokedAt = at;
    for (const s of this.sessions.values()) if (s.deviceId === deviceId && !s.revokedAt) s.revokedAt = at;
  }
  async countActiveDevices(): Promise<number> { return [...this.devices.values()].filter(d => !d.revokedAt).length; }
  async hasActiveAdminDevice(): Promise<boolean> { return [...this.devices.values()].some(d => !d.revokedAt && (d.roles.includes("admin") || d.roles.includes("*"))); }
  async savePairingCode(codeHash: string, roles: string[], expiresAt: number): Promise<void> { this.pairingCodes.set(codeHash, { roles: [...roles], expiresAt }); }
  async consumePairingCode(codeHash: string, deviceId: string, at: number): Promise<{ roles: string[]; expiresAt: number } | null> {
    const entry = this.pairingCodes.get(codeHash);
    if (!entry || entry.usedBy) return null;
    entry.usedBy = deviceId; entry.usedAt = at;
    return { roles: [...entry.roles], expiresAt: entry.expiresAt };
  }
  async saveChallenge(nonceHash: string, deviceId: string, expiresAt: number): Promise<void> { this.challenges.set(nonceHash, { deviceId, expiresAt }); }
  async consumeChallenge(nonceHash: string): Promise<{ deviceId: string; expiresAt: number } | null> {
    const entry = this.challenges.get(nonceHash);
    if (!entry) return null;
    this.challenges.delete(nonceHash);
    return { ...entry };
  }
  async saveSession(session: AuthV2Session): Promise<void> { this.sessions.set(session.tokenHash, { ...session, roles: [...session.roles] }); }
  async getSession(tokenHash: string): Promise<AuthV2Session | undefined> { const s = this.sessions.get(tokenHash); return s ? { ...s, roles: [...s.roles] } : undefined; }
  async listActiveSessionsForDevice(deviceId: string, now: number): Promise<AuthV2Session[]> {
    return [...this.sessions.values()].filter(s => s.deviceId === deviceId && !s.revokedAt && s.expiresAt > now).sort((a,b)=>a.createdAt-b.createdAt).map(s=>({...s,roles:[...s.roles]}));
  }
  async revokeSession(tokenHash: string, at: number): Promise<void> { const s = this.sessions.get(tokenHash); if (s) s.revokedAt = at; }
  async pruneExpired(now: number): Promise<void> {
    for (const [k,v] of this.pairingCodes) if (v.expiresAt <= now) this.pairingCodes.delete(k);
    for (const [k,v] of this.challenges) if (v.expiresAt <= now) this.challenges.delete(k);
    for (const [k,v] of this.sessions) if (v.expiresAt <= now) this.sessions.delete(k);
  }
}

export const AUTHV2_PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const AUTHV2_CHALLENGE_TTL_MS = 60 * 1000;
export const AUTHV2_MAX_DEVICES = 20;
export const AUTHV2_MAX_SESSIONS_PER_DEVICE = 5;
export function authV2SessionTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.NXV2_SESSION_TTL || 8 * 60 * 60 * 1000);
  return Number.isFinite(raw) && raw > 0 ? raw : 8 * 60 * 60 * 1000;
}

export function validAuthV2PublicKey(publicKeySpkiB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeySpkiB64, "base64"), format: "der", type: "spki" });
    return key.asymmetricKeyType === "ec" && (key.asymmetricKeyDetails as any)?.namedCurve === "prime256v1";
  } catch { return false; }
}
function verifyDeviceSignature(publicKeySpkiB64: string, nonce: string, signatureB64: string): boolean {
  try {
    return cryptoVerify(
      "sha256",
      Buffer.from(nonce, "utf8"),
      { key: createPublicKey({ key: Buffer.from(publicKeySpkiB64, "base64"), format: "der", type: "spki" }), dsaEncoding: "ieee-p1363" },
      Buffer.from(signatureB64, "base64")
    );
  } catch { return false; }
}
export function normalizePairCode(code: string): string { return String(code || "").trim().toUpperCase(); }
export function validRoles(roles: unknown): roles is string[] {
  return Array.isArray(roles) && roles.length > 0 && roles.every(r => typeof r === "string" && (AUTHV2_PERMISSIONS as readonly string[]).includes(r));
}

interface AuditEntry { ts: string; kind: string; actor: string; method?: string; path?: string; status?: number; detail?: string }

export class AuthV2Service {
  private auditLog: AuditEntry[] = [];
  private pruneTimer?: NodeJS.Timeout;
  constructor(
    public readonly store: AuthV2Store,
    private now: () => number = () => Date.now(),
    private sessionTtlMs: number = authV2SessionTtlMs(),
  ) {
    this.pruneTimer = setInterval(() => { this.store.pruneExpired(this.now()).catch(() => {}); }, 60_000);
    this.pruneTimer.unref?.();
  }
  audit(kind: string, actor: string, detail?: string, method?: string, path?: string, status?: number): void {
    this.auditLog.push({ ts: new Date(this.now()).toISOString(), kind, actor, detail, method, path, status });
    if (this.auditLog.length > 1000) this.auditLog.splice(0, this.auditLog.length - 1000);
  }
  getAuditLog(): AuditEntry[] { return [...this.auditLog]; }

  async issuePairingCode(roles: string[]): Promise<{ code: string; expiresAt: number; expiresIn: number }> {
    if (!validRoles(roles)) throw new Error("invalid_roles");
    await this.store.pruneExpired(this.now());
    const code = randomBytes(6).toString("hex").toUpperCase();
    const expiresAt = this.now() + AUTHV2_PAIRING_CODE_TTL_MS;
    await this.store.savePairingCode(sha256Hex(code), [...new Set(roles)], expiresAt);
    return { code, expiresAt, expiresIn: 600 };
  }

  async redeemPairing(codeInput: string, deviceId: string, publicKeySpkiB64: string, label?: string, platform?: string): Promise<{ roles: string[] } | null> {
    await this.store.pruneExpired(this.now());
    const code = normalizePairCode(codeInput);
    if (!/^[A-Z0-9]{12}$/.test(code)) return null;
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(deviceId || "")) return null;
    if (!publicKeySpkiB64 || publicKeySpkiB64.length > 512 || !validAuthV2PublicKey(publicKeySpkiB64)) return null;
    if (await this.store.getDevice(deviceId)) return null;
    if ((await this.store.countActiveDevices()) >= AUTHV2_MAX_DEVICES) return null;
    const hadAdmin = await this.store.hasActiveAdminDevice();
    const entry = await this.store.consumePairingCode(sha256Hex(code), deviceId, this.now());
    if (!entry || entry.expiresAt <= this.now()) return null;
    const roles = hadAdmin ? entry.roles : ["admin"];
    await this.store.saveDevice({
      deviceId, publicKeySpkiB64, roles, pairedAt: this.now(), revokedAt: null,
      label: label?.slice(0, 120), platform: platform?.slice(0, 40) || "web",
    });
    this.audit("pair_redeem", deviceId);
    return { roles };
  }

  async createChallenge(deviceId: string): Promise<{ nonce: string; expiresIn: number } | null> {
    await this.store.pruneExpired(this.now());
    const device = await this.store.getDevice(deviceId);
    if (!device || device.revokedAt) return null;
    const nonce = randomBytes(32).toString("hex");
    await this.store.saveChallenge(sha256Hex(nonce), deviceId, this.now() + AUTHV2_CHALLENGE_TTL_MS);
    return { nonce, expiresIn: 60 };
  }

  async redeemChallenge(deviceId: string, nonce: string, signatureB64: string): Promise<{ token: string; expiresAt: number; roles: string[]; csrf: string } | null> {
    await this.store.pruneExpired(this.now());
    const challenge = await this.store.consumeChallenge(sha256Hex(String(nonce || "")));
    if (!challenge || challenge.expiresAt <= this.now() || challenge.deviceId !== deviceId) return null;
    const device = await this.store.getDevice(deviceId);
    if (!device || device.revokedAt) return null;
    if (!verifyDeviceSignature(device.publicKeySpkiB64, nonce, signatureB64)) return null;
    const token = randomBytes(32).toString("hex");
    const csrf = randomBytes(16).toString("hex");
    const expiresAt = this.now() + this.sessionTtlMs;
    const active = await this.store.listActiveSessionsForDevice(deviceId, this.now());
    for (const old of active.slice(0, Math.max(0, active.length - AUTHV2_MAX_SESSIONS_PER_DEVICE + 1))) {
      await this.store.revokeSession(old.tokenHash, this.now());
    }
    await this.store.saveSession({ tokenHash: sha256Hex(token), deviceId, roles: [...device.roles], csrfHash: sha256Hex(csrf), createdAt: this.now(), expiresAt, revokedAt: null });
    this.audit("session_redeem", deviceId);
    return { token, expiresAt, roles: [...device.roles], csrf };
  }

  async validateToken(token: string): Promise<{ deviceId: string; roles: string[]; expiresAt: number } | null> {
    const s = await this.getSessionByToken(token);
    return s ? { deviceId: s.deviceId, roles: [...s.roles], expiresAt: s.expiresAt } : null;
  }
  async getSessionByToken(token: string): Promise<AuthV2Session | null> {
    if (!/^[a-f0-9]{64}$/i.test(token || "")) return null;
    const session = await this.store.getSession(sha256Hex(token.toLowerCase()));
    if (!session || session.revokedAt || session.expiresAt <= this.now()) return null;
    const device = await this.store.getDevice(session.deviceId);
    if (!device || device.revokedAt) return null;
    return session;
  }
  async validateCsrf(session: AuthV2Session, presented: unknown): Promise<boolean> {
    if (typeof presented !== "string" || !/^[a-f0-9]{32}$/i.test(presented)) return false;
    return safeEqual(session.csrfHash, sha256Hex(presented.toLowerCase()));
  }
  hasPermission(roles: string[], permission: string, method = "GET"): boolean {
    if (!permission) return false;
    if (roles.includes("admin") || roles.includes("*")) return true;
    if (permission === "admin") return false;
    if (roles.includes(permission)) return true;
    if (method === "GET" || method === "HEAD") {
      if (roles.includes("read")) return true;
      if (permission.endsWith(":control") && roles.includes(permission.replace(":control", ":read"))) return true;
    }
    return false;
  }
  async revokeToken(token: string): Promise<void> { if (/^[a-f0-9]{64}$/i.test(token || "")) await this.store.revokeSession(sha256Hex(token.toLowerCase()), this.now()); }
  async revokeDevice(deviceId: string): Promise<boolean> {
    const d = await this.store.getDevice(deviceId);
    if (!d) return false;
    await this.store.revokeDevice(deviceId, this.now());
    this.audit("device_revoke", deviceId);
    return true;
  }
  async listDevices(): Promise<Array<Omit<AuthV2Device,"publicKeySpkiB64">>> {
    return (await this.store.listDevices()).map(({ publicKeySpkiB64: _omit, ...d }) => d);
  }
}

export function createMemoryAuthV2Service(now?: () => number): AuthV2Service {
  return new AuthV2Service(new InMemoryAuthV2Store(), now);
}
