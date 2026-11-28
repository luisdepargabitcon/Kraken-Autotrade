import { sql } from "drizzle-orm";
import type { AuthV2Device, AuthV2Session, AuthV2Store } from "./authV2Service";

function ms(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  const n = new Date(String(v)).getTime();
  return Number.isFinite(n) ? n : 0;
}
function rows(result: unknown): any[] {
  return Array.isArray((result as any)?.rows) ? (result as any).rows : [];
}
function asDevice(r: any): AuthV2Device {
  return { deviceId: r.device_id, publicKeySpkiB64: r.public_key_spki_b64, roles: Array.isArray(r.roles) ? r.roles : [], pairedAt: ms(r.paired_at), revokedAt: r.revoked_at ? ms(r.revoked_at) : null, label: r.label ?? undefined, platform: r.platform ?? undefined };
}
function asSession(r: any): AuthV2Session {
  return { tokenHash: r.token_hash, deviceId: r.device_id, roles: Array.isArray(r.roles) ? r.roles : [], csrfHash: r.csrf_hash, createdAt: ms(r.created_at), expiresAt: ms(r.expires_at), revokedAt: r.revoked_at ? ms(r.revoked_at) : null };
}
const ts = (n: number) => new Date(n);

export class DrizzleAuthV2Store implements AuthV2Store {
  constructor(private db: any) {}
  async saveDevice(d: AuthV2Device): Promise<void> {
    await this.db.execute(sql`insert into nexa_auth_devices (device_id,public_key_spki_b64,roles,paired_at,revoked_at,label,platform)
      values (${d.deviceId},${d.publicKeySpkiB64},${JSON.stringify(d.roles)}::jsonb,${ts(d.pairedAt)},${d.revokedAt?ts(d.revokedAt):null},${d.label??null},${d.platform??null})
      on conflict (device_id) do update set public_key_spki_b64=excluded.public_key_spki_b64, roles=excluded.roles, revoked_at=excluded.revoked_at, label=excluded.label, platform=excluded.platform, updated_at=now()`);
  }
  async getDevice(deviceId: string): Promise<AuthV2Device | undefined> {
    const r = rows(await this.db.execute(sql`select * from nexa_auth_devices where device_id=${deviceId}`))[0];
    return r ? asDevice(r) : undefined;
  }
  async listDevices(): Promise<AuthV2Device[]> { return rows(await this.db.execute(sql`select * from nexa_auth_devices order by paired_at`)).map(asDevice); }
  async revokeDevice(deviceId: string, at: number): Promise<void> {
    await this.db.execute(sql`update nexa_auth_devices set revoked_at=${ts(at)}, updated_at=now() where device_id=${deviceId} and revoked_at is null`);
    await this.db.execute(sql`update nexa_auth_sessions set revoked_at=${ts(at)} where device_id=${deviceId} and revoked_at is null`);
  }
  async countActiveDevices(): Promise<number> { return Number(rows(await this.db.execute(sql`select count(*)::int c from nexa_auth_devices where revoked_at is null`))[0]?.c || 0); }
  async hasActiveAdminDevice(): Promise<boolean> {
    return Number(rows(await this.db.execute(sql`select count(*)::int c from nexa_auth_devices d where d.revoked_at is null and exists (select 1 from jsonb_array_elements_text(d.roles) r where r in ('admin','*'))`))[0]?.c || 0) > 0;
  }
  async savePairingCode(codeHash: string, roles: string[], expiresAt: number): Promise<void> {
    await this.db.execute(sql`insert into nexa_auth_pair_codes (code_hash,roles,expires_at) values (${codeHash},${JSON.stringify(roles)}::jsonb,${ts(expiresAt)}) on conflict (code_hash) do nothing`);
  }
  async consumePairingCode(codeHash: string, deviceId: string, at: number): Promise<{ roles: string[]; expiresAt: number } | null> {
    const r = rows(await this.db.execute(sql`update nexa_auth_pair_codes set used_by_device_id=${deviceId}, used_at=${ts(at)} where code_hash=${codeHash} and used_by_device_id is null returning roles,expires_at`))[0];
    return r ? { roles: Array.isArray(r.roles) ? r.roles : [], expiresAt: ms(r.expires_at) } : null;
  }
  async saveChallenge(nonceHash: string, deviceId: string, expiresAt: number): Promise<void> {
    await this.db.execute(sql`insert into nexa_auth_challenges (nonce_hash,device_id,expires_at) values (${nonceHash},${deviceId},${ts(expiresAt)}) on conflict (nonce_hash) do nothing`);
  }
  async consumeChallenge(nonceHash: string): Promise<{ deviceId: string; expiresAt: number } | null> {
    const r = rows(await this.db.execute(sql`delete from nexa_auth_challenges where nonce_hash=${nonceHash} returning device_id,expires_at`))[0];
    return r ? { deviceId: r.device_id, expiresAt: ms(r.expires_at) } : null;
  }
  async saveSession(s: AuthV2Session): Promise<void> {
    await this.db.execute(sql`insert into nexa_auth_sessions (token_hash,device_id,roles,csrf_hash,created_at,expires_at,revoked_at) values (${s.tokenHash},${s.deviceId},${JSON.stringify(s.roles)}::jsonb,${s.csrfHash},${ts(s.createdAt)},${ts(s.expiresAt)},${s.revokedAt?ts(s.revokedAt):null})`);
  }
  async getSession(tokenHash: string): Promise<AuthV2Session | undefined> {
    const r = rows(await this.db.execute(sql`select * from nexa_auth_sessions where token_hash=${tokenHash}`))[0];
    return r ? asSession(r) : undefined;
  }
  async listActiveSessionsForDevice(deviceId: string, now: number): Promise<AuthV2Session[]> {
    return rows(await this.db.execute(sql`select * from nexa_auth_sessions where device_id=${deviceId} and revoked_at is null and expires_at>${ts(now)} order by created_at asc`)).map(asSession);
  }
  async revokeSession(tokenHash: string, at: number): Promise<void> { await this.db.execute(sql`update nexa_auth_sessions set revoked_at=${ts(at)} where token_hash=${tokenHash} and revoked_at is null`); }
  async pruneExpired(now: number): Promise<void> {
    const t = ts(now);
    await this.db.execute(sql`delete from nexa_auth_pair_codes where expires_at<=${t}`);
    await this.db.execute(sql`delete from nexa_auth_challenges where expires_at<=${t}`);
    await this.db.execute(sql`delete from nexa_auth_sessions where expires_at<=${t}`);
  }
}
