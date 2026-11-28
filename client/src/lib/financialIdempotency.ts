// Automatic durable-identity compliance for FINANCIAL mutating requests.
//
// The server rejects any financial mutation without x-idempotency-key (428,
// fail-closed). This interceptor installs once at client bootstrap and
// guarantees that EVERY mutating request to a financial route carries a key:
//   - if the caller already provides one (per-operation stable key), it is
//     preserved untouched — that is the strong protection against double
//     submits;
//   - otherwise a unique uuid is generated per call, which satisfies the
//     durable-identity requirement and protects network-level retries of the
//     same request, but NOT double-clicks: callers that mutate financial
//     state SHOULD pass an explicit stable key per user operation.
//
// The wrapper is transparent: it delegates to the original fetch with the
// same arguments and only adds a header when missing.
const FINANCIAL_PREFIXES = [
  "/api/grid-isolated",
  "/api/spot",
  "/api/idca",
  "/api/institutional-dca",
  "/api/positions",
  "/api/trailing",
  "/api/ama",
];

function isFinancialMutation(url: string, method: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;
  let path = url;
  try {
    path = new URL(url, window.location.origin).pathname;
  } catch {
    return false;
  }
  return FINANCIAL_PREFIXES.some(p => path === p || path.startsWith(p + "/") || path.startsWith(p));
}

export function installFinancialIdempotencyInterceptor(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if ((window as any).__financialIdempotencyInstalled) return;
  (window as any).__financialIdempotencyInstalled = true;
  const original = window.fetch.bind(window);
  window.fetch = (async (input: any, init?: any) => {
    try {
      const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (isFinancialMutation(url, method)) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has("x-idempotency-key")) {
          headers.set("x-idempotency-key", crypto.randomUUID());
        }
        return await original(input, { ...init, headers });
      }
    } catch {
      // Fall through to the original call untouched on any introspection error.
    }
    return original(input, init);
  }) as typeof window.fetch;
}
