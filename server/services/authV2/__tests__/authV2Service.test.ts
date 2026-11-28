import { describe, expect, it, beforeEach } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "crypto";
import {
  AuthV2Service,
  InMemoryAuthV2Store,
  AUTHV2_CHALLENGE_TTL_MS,
  AUTHV2_PAIRING_CODE_TTL_MS,
  AUTHV2_MAX_SESSIONS_PER_DEVICE,
  sha256Hex,
  type AuthV2Store,
} from "../authV2Service";

function makeDevice(id = "test-device-" + Math.random().toString(36).slice(2, 18)) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spkiB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return {
    deviceId: id,
    spkiB64,
    signNonce: (nonce: string) => cryptoSign("sha256", Buffer.from(nonce, "utf8"), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64"),
  };
}
async function pair(service: AuthV2Service, roles = ["read"]) {
  const { code } = await service.issuePairingCode(roles);
  const dev = makeDevice();
  const paired = await service.redeemPairing(code, dev.deviceId, dev.spkiB64, "test", "web");
  return { dev, paired, code };
}
async function login(service: AuthV2Service, dev: ReturnType<typeof makeDevice>) {
  const challenge = await service.createChallenge(dev.deviceId);
  return service.redeemChallenge(dev.deviceId, challenge!.nonce, dev.signNonce(challenge!.nonce));
}

export function authV2StoreContractTests(makeStore: () => AuthV2Store | Promise<AuthV2Store>, label: string): void {
  describe(`AuthV2 ${label} store contract`, () => {
    let store: AuthV2Store;
    let service: AuthV2Service;
    let now: number;
    beforeEach(async () => {
      now = 1_700_000_000_000;
      store = await makeStore();
      service = new AuthV2Service(store, () => now);
    });

    it("full ECDSA pairing/challenge/session flow returns real csrf", async () => {
      const { dev, paired } = await pair(service, ["idca:control"]);
      expect(paired).not.toBeNull();
      const session = await login(service, dev);
      expect(session).not.toBeNull();
      expect(session!.csrf).toMatch(/^[a-f0-9]{32}$/);
      const validated = await service.validateToken(session!.token);
      expect(validated!.deviceId).toBe(dev.deviceId);
      const stored = await store.getSession(sha256Hex(session!.token));
      expect(stored).toBeDefined();
      expect((stored as any)?.token).toBeUndefined();
    });

    it("pairing codes are uppercase-normalized, expire and are single-use", async () => {
      const { code } = await service.issuePairingCode(["read"]);
      const d1 = makeDevice();
      const d2 = makeDevice();
      expect(await service.redeemPairing(code.toLowerCase(), d1.deviceId, d1.spkiB64)).not.toBeNull();
      expect(await service.redeemPairing(code, d2.deviceId, d2.spkiB64)).toBeNull();
      const expired = await service.issuePairingCode(["read"]);
      now += AUTHV2_PAIRING_CODE_TTL_MS + 1;
      const d3 = makeDevice();
      expect(await service.redeemPairing(expired.code, d3.deviceId, d3.spkiB64)).toBeNull();
    });

    it("nonce replay, foreign signature and cross-device binding fail", async () => {
      const first = await pair(service);
      const second = await pair(service);
      const challenge = await service.createChallenge(first.dev.deviceId);
      const good = await service.redeemChallenge(first.dev.deviceId, challenge!.nonce, first.dev.signNonce(challenge!.nonce));
      expect(good).not.toBeNull();
      const replay = await service.redeemChallenge(first.dev.deviceId, challenge!.nonce, first.dev.signNonce(challenge!.nonce));
      expect(replay).toBeNull();
      const c2 = await service.createChallenge(first.dev.deviceId);
      expect(await service.redeemChallenge(first.dev.deviceId, c2!.nonce, second.dev.signNonce(c2!.nonce))).toBeNull();
      const c3 = await service.createChallenge(first.dev.deviceId);
      expect(await service.redeemChallenge(second.dev.deviceId, c3!.nonce, first.dev.signNonce(c3!.nonce))).toBeNull();
    });

    it("expired challenge, revoked device and revoked/invalid/expired tokens fail", async () => {
      const { dev } = await pair(service);
      const c = await service.createChallenge(dev.deviceId);
      now += AUTHV2_CHALLENGE_TTL_MS + 1;
      expect(await service.redeemChallenge(dev.deviceId, c!.nonce, dev.signNonce(c!.nonce))).toBeNull();
      const s = await login(service, dev);
      expect(await service.validateToken(s!.token)).not.toBeNull();
      await service.revokeToken(s!.token);
      expect(await service.validateToken(s!.token)).toBeNull();
      expect(await service.validateToken("0".repeat(64))).toBeNull();
      const other = await pair(service);
      const s2 = await login(service, other.dev);
      await service.revokeDevice(other.dev.deviceId);
      expect(await service.validateToken(s2!.token)).toBeNull();
    });

    it("device and per-device session limits are enforced", async () => {
      const admin = await pair(service, ["admin"]);
      expect(admin.paired!.roles).toEqual(["admin"]);
      for (let i = 0; i < 19; i++) expect((await pair(service)).paired).not.toBeNull();
      expect((await pair(service)).paired).toBeNull();
      for (let i = 0; i < AUTHV2_MAX_SESSIONS_PER_DEVICE + 2; i++) expect(await login(service, admin.dev)).not.toBeNull();
      const active = await store.listActiveSessionsForDevice(admin.dev.deviceId, now);
      expect(active.length).toBeLessThanOrEqual(AUTHV2_MAX_SESSIONS_PER_DEVICE);
    });

    it("pruneExpired removes expired codes, challenges and sessions", async () => {
      const { dev } = await pair(service);
      await service.createChallenge(dev.deviceId);
      const s = await login(service, dev);
      now += 9 * 60 * 60 * 1000;
      await store.pruneExpired(now);
      expect(await service.validateToken(s!.token)).toBeNull();
      expect(await service.createChallenge(dev.deviceId)).not.toBeNull();
    });
  });
}

authV2StoreContractTests(() => new InMemoryAuthV2Store(), "memory");

describe("AuthV2 permissions", () => {

  it("rejects roles outside the whitelist", async () => {
    const service = new AuthV2Service(new InMemoryAuthV2Store());
    await expect(service.issuePairingCode(["superuser"])).rejects.toThrow("invalid_roles");
    await expect(service.issuePairingCode([])).rejects.toThrow("invalid_roles");
  });
  it("implements NEXA read/control semantics", () => {
    const service = new AuthV2Service(new InMemoryAuthV2Store());
    expect(service.hasPermission(["admin"], "grid:control", "POST")).toBe(true);
    expect(service.hasPermission(["*"], "grid:control", "POST")).toBe(true);
    expect(service.hasPermission(["grid:control"], "grid:control", "POST")).toBe(true);
    expect(service.hasPermission(["grid:read"], "grid:control", "POST")).toBe(false);
    expect(service.hasPermission(["grid:read"], "grid:control", "GET")).toBe(true);
    expect(service.hasPermission(["read"], "fisco:control", "GET")).toBe(true);
    expect(service.hasPermission(["read"], "fisco:control", "POST")).toBe(false);
    expect(service.hasPermission(["idca:control"], "grid:control", "GET")).toBe(false);
    expect(service.hasPermission(["read"], "admin", "GET")).toBe(false);
  });
});
