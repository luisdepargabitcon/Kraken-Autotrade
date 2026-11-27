import { createHash } from "crypto";

export function deterministicClientOrderId(internalIntentId: string): string {
  const hash = createHash("sha256").update(internalIntentId).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
