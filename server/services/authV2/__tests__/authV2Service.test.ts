import { describe, expect, it, beforeEach } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "crypto";
import {
  AuthV2Service,
  InMemoryAuthV2Store,
  AUTHV2_CHALLENGE_TTL_MS,
  AUTHV2_SESSION_TTL_MS,
  AUTHV2_PAIRING_CODE_TTL_MS,
} from "../authV2Service";

// Auth v2 contract tests (P0): pairing, challenge-response with real ECDSA
// P-256 keys, single-use semantics, expiry, replay prevention, revocation and
// deny-by-default authorization. No network, no credentials.

function makeDevice() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spkiB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const deviceId = "test-device-" + Math.random().toString(36).slice(2, 18);
  const signNonce = (nonce: string) =>
    cryptoSign("sha256", Buffer.from(nonce, "utf8"), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
  return { deviceId, spkiB64, signNonce };
}

describe("AuthV2Service pairing", () => {
  let store: InMemoryAuthV2Store;
  let service: AuthV2Service;
  let now: number;

  beforeEach(() => {
    now = 1_700_000_000_000;
    store = new InMemoryAuthV2Store();
    service = new AuthV2Service(store, () => now);
  });

  it("full flow: issue code -> pair -> challenge -> session -> validate", () => {
    const { code } = service.issuePairingCode(["operator"]);
    const dev = makeDevice();
    const paired = service.redeemPairing(code, dev.deviceId, dev.spkiB64, "test", "web");
    expect(paired).not.toBeNull();
    expect(paired!.roles).toEqual(["operator"]);

    const challenge = service.createChallenge(dev.deviceId);
    expect(challenge).not.toBeNull();
    const session = service.redeemChallenge(dev.deviceId, challenge!.nonce, dev.signNonce(challenge!.nonce));
    expect(session).not.toBeNull();
    expect(session!.expiresAt).toBe(now + AUTHV2_SESSION_TTL_MS);

    const validated = service.validateToken(session!.token);
    expect(validated).not.toBeNull();
    expect(validated!.deviceId).toBe(dev.deviceId);
    expect(validated!.roles).toEqual(["operator"]);
  });

  it("pairing code is single-use even on success", () => {
    const { code } = service.issuePairingCode(["reader"]);
    const d1 = makeDevice();
    const d2 = makeDevice();
    expect(service.redeemPairing(code, d1.deviceId, d1.spkiB64)).not.toBeNull();
    expect(service.redeemPairing(code, d2.deviceId, d2.spkiB64)).toBeNull();
  });

  it("expired pairing code is rejected", () => {
    const { code } = service.issuePairingCode(["reader"]);
    now += AUTHV2_PAIRING_CODE_TTL_MS + 1;
    const dev = makeDevice();
    expect(service.redeemPairing(code, dev.deviceId, dev.spkiB64)).toBeNull();
  });

  it("unknown pairing code is rejected and cannot re-pair an existing deviceId", () => {
    const { code } = service.issuePairingCode(["reader"]);
    const dev = makeDevice();
    expect(service.redeemPairing("deadbeefdead", dev.deviceId, dev.spkiB64)).toBeNull();
    expect(service.redeemPairing(code, dev.deviceId, dev.spkiB64)).not.toBeNull();
    // A second code must not silently overwrite the existing device credential.
    const { code: code2 } = service.issuePairingCode(["admin"]);
    expect(service.redeemPairing(code2, dev.deviceId, dev.spkiB64)).toBeNull();
  });

  it("challenge is single-use: replay of the same nonce fails", () => {
    const { code } = service.issuePairingCode(["reader"]);
    const dev = makeDevice();
    service.redeemPairing(code, dev.deviceId, dev.spkiB64);
    const challenge = service.createChallenge(dev.deviceId)!;
    const sig = dev.signNonce(challenge.nonce);
    expect(service.redeemChallenge(dev.deviceId, challenge.nonce, sig)).not.toBeNull();
    // Replay: same nonce + valid signature must fail (nonce already consumed).
    expect(service.redeemChallenge(dev.deviceId, challenge.nonce, sig)).toBeNull();
  });

  it("expired challenge is rejected", () => {
    const { code } = service.issuePairingCode(["reader"]);
    const dev = makeDevice();
    service.redeemPairing(code, dev.deviceId, dev.spkiB64);
    const challenge = service.createChallenge(dev.deviceId)!;
    now += AUTHV2_CHALLENGE_TTL_MS + 1;
    expect(service.redeemChallenge(dev.deviceId, challenge.nonce, dev.signNonce(challenge.nonce))).toBeNull();
  });

  it("wrong signature, wrong device binding and unknown challenge are rejected", () => {
    const { code } = service.issuePairingCode(["reader"]);
    const dev = makeDevice();
    const other = makeDevice();
    service.redeemPairing(code, dev.deviceId, dev.spkiB64);
    service.redeemPairing(service.issuePairingCode(["reader"]).code, other.deviceId, other.spkiB64);

    const challenge = service.createChallenge(dev.deviceId)!;
    // Wrong key signs.
    expect(service.redeemChallenge(dev.deviceId, challenge.nonce, other.signNonce(challenge.nonce))).toBeNull();

    const c2 = service.createChallenge(dev.deviceId)!;
    // Challenge bound to dev but redeemed by other deviceId.
    expect(service.redeemChallenge(other.deviceId, c2.nonce, dev.signNonce(c2.nonce))).toBeNull();

    // Unknown nonce.
    expect(service.redeemChallenge(dev.deviceId, "f".repeat(64), dev.signNonce("f".repeat(64)))).toBeNull();
  });

  it("challenge issuance is refused for unknown or revoked devices", () => {
    expect(service.createChallenge("no-such-device")).toBeNull();
    const { code } = service.issuePairingCode(["reader"]);
    const dev = makeDevice();
    service.redeemPairing(code, dev.deviceId, dev.spkiB64);
    service.revokeDevice(dev.deviceId);
    expect(service.createChallenge(dev.deviceId)).toBeNull();
  });

  it("expired and revoked sessions are invalid; device revocation kills sessions", () => {
    const { code } = service.issuePairingCode(["reader"]);
    const dev = makeDevice();
    service.redeemPairing(code, dev.deviceId, dev.spkiB64);
    const c = service.createChallenge(dev.deviceId)!;
    const session = service.redeemChallenge(dev.deviceId, c.nonce, dev.signNonce(c.nonce))!;

    // Logout revocation.
    service.revokeToken(session.token);
    expect(service.validateToken(session.token)).toBeNull();

    // New session, then device revocation.
    const c2 = service.createChallenge(dev.deviceId)!;
    const s2 = service.redeemChallenge(dev.deviceId, c2.nonce, dev.signNonce(c2.nonce))!;
    service.revokeDevice(dev.deviceId);
    expect(service.validateToken(s2.token)).toBeNull();

    // New device+session, then expiry.
    const dev2 = makeDevice();
    service.redeemPairing(service.issuePairingCode(["reader"]).code, dev2.deviceId, dev2.spkiB64);
    const c3 = service.createChallenge(dev2.deviceId)!;
    const s3 = service.redeemChallenge(dev2.deviceId, c3.nonce, dev2.signNonce(c3.nonce))!;
    now += AUTHV2_SESSION_TTL_MS + 1;
    expect(service.validateToken(s3.token)).toBeNull();
  });

  it("authorization is deny-by-default; admin implies permission", () => {
    expect(service.hasPermission([], "idca:control")).toBe(false);
    expect(service.hasPermission(["reader"], "idca:control")).toBe(false);
    expect(service.hasPermission(["reader"], "")).toBe(false);
    expect(service.hasPermission(["admin"], "idca:control")).toBe(true);
    expect(service.hasPermission(["operator"], "operator")).toBe(true);
  });

  it("raw token is never stored (only its hash)", () => {
    const { code } = service.issuePairingCode(["reader"]);
    const dev = makeDevice();
    service.redeemPairing(code, dev.deviceId, dev.spkiB64);
    const c = service.createChallenge(dev.deviceId)!;
    const session = service.redeemChallenge(dev.deviceId, c.nonce, dev.signNonce(c.nonce))!;
    const keys = Array.from((store as any).sessions.keys());
    expect(keys).not.toContain(session.token);
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
  });
});
