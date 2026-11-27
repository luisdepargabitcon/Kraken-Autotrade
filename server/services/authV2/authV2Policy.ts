export type AuthV2PolicyEntry = { method?: string; path: string; permission: string; exact?: boolean };

// Deny-by-default route policy. `authenticated` means any valid device session;
// resource entries use the NEXA v2 permission model (<resource>:control).
export const AUTHV2_PUBLIC_ROUTES: AuthV2PolicyEntry[] = [
  { method: "GET", path: "/api/health", permission: "public", exact: true },
  { method: "POST", path: "/api/v2/pair/redeem", permission: "public", exact: true },
  { method: "POST", path: "/api/v2/session/challenge", permission: "public", exact: true },
  { method: "POST", path: "/api/v2/session/redeem", permission: "public", exact: true },
  // Bootstrap-capable but internally guarded by pair/issue itself.
  { method: "POST", path: "/api/v2/pair/issue", permission: "public", exact: true },
];

export const AUTHV2_ROUTE_POLICY: AuthV2PolicyEntry[] = [
  { path: "/api/v2/devices", permission: "admin" },
  { path: "/api/v2/auth", permission: "authenticated" },

  { path: "/api/scan/diagnostic", permission: "admin" },

  { path: "/api/institutional-dca/config", permission: "admin" },
  { path: "/api/institutional-dca/telegram/test", permission: "admin" },
  { path: "/api/institutional-dca/entry-diagnostics", permission: "admin" },
  { path: "/api/idca/hybrid/config", permission: "admin" },
  { path: "/api/idca/hybrid/alert-config", permission: "admin" },
  { path: "/api/idca/hybrid/mode", permission: "admin" },

  { path: "/api/grid-isolated/config", permission: "admin" },
  { path: "/api/grid-isolated/mode", permission: "admin" },
  { path: "/api/grid-isolated/activate", permission: "admin" },
  { path: "/api/grid-isolated/shadow-open-cycles/diagnose", permission: "admin" },
  { path: "/api/grid-isolated/shadow-orphan-cycles/diagnose", permission: "admin" },

  { path: "/api/ama/mode", permission: "admin" },
  { path: "/api/ama/mandate/activate", permission: "admin" },
  { path: "/api/ama/real/activate", permission: "admin" },
  { path: "/api/ama/real/authorization", permission: "admin" },

  { path: "/api/spot/mode", permission: "admin" },
  { path: "/api/positions/smart-exit-diagnostics", permission: "admin" },
  { path: "/api/market-metrics/config", permission: "admin" },
  { path: "/api/fisco/config", permission: "admin" },
  { path: "/api/fisco/alerts/config", permission: "admin" },
  { path: "/api/fisco/test-apis", permission: "admin" },
  { path: "/api/fisco/diagnostic-detail", permission: "admin" },
  { path: "/api/fisco/v2/activate-official", permission: "admin" },

  { method: "POST", path: "/api/institutional-dca/emergency", permission: "idca:emergency" },
  { method: "POST", path: "/api/institutional-dca/cycles", permission: "idca:control" },
  { method: "DELETE", path: "/api/institutional-dca/cycles", permission: "idca:emergency" },
  { path: "/api/institutional-dca", permission: "idca:control" },
  { path: "/api/idca", permission: "idca:control" },

  { method: "POST", path: "/api/ama/kill-switch", permission: "ama:control", exact: true },
  { method: "POST", path: "/api/ama/real/kill-switch", permission: "ama:control", exact: true },
  { path: "/api/ama", permission: "ama:control" },

  { path: "/api/grid-isolated", permission: "grid:control" },

  { path: "/api/open-positions", permission: "spot:control" },
  { path: "/api/positions", permission: "spot:control" },
  { path: "/api/spot", permission: "spot:control" },
  { path: "/api/trade", permission: "spot:control" },
  { path: "/api/trades", permission: "spot:control" },

  { path: "/api/portfolio-summary", permission: "portfolio:control" },
  { path: "/api/portfolio", permission: "portfolio:control" },
  { path: "/api/fisco", permission: "fisco:control" },
  { path: "/api/fifo", permission: "fisco:control" },

  { path: "/api/balance", permission: "read" },
  { path: "/api/balances", permission: "read" },
  { path: "/api/prices", permission: "read" },
  { path: "/api/market-data", permission: "read" },
  { path: "/api/market-metrics", permission: "read" },
  { path: "/api/market", permission: "read" },
  { path: "/api/dashboard", permission: "read" },
  { path: "/api/events", permission: "read" },
  { path: "/api/notifications", permission: "read" },
  { path: "/api/performance", permission: "read" },
  { path: "/api/scan", permission: "read" },

  { path: "/api/config", permission: "admin" },
  { path: "/api/admin", permission: "admin" },
  { path: "/api/ai", permission: "admin" },
  { path: "/api/audit", permission: "admin" },
  { path: "/api/autotuning", permission: "admin" },
  { path: "/api/backups", permission: "admin" },
  { path: "/api/db", permission: "admin" },
  { path: "/api/debug", permission: "admin" },
  { path: "/api/diagnostics", permission: "admin" },
  { path: "/api/dryrun", permission: "admin" },
  { path: "/api/environment", permission: "admin" },
  { path: "/api/exchange-diagnostics", permission: "admin" },
  { path: "/api/kraken", permission: "admin" },
  { path: "/api/logs", permission: "admin" },
  { path: "/api/rate-limiter", permission: "admin" },
  { path: "/api/telegram", permission: "admin" },
  { path: "/api/test", permission: "admin" },
  { path: "/api/trading", permission: "admin" },
];

function normalize(path: string): string {
  const p = path.split("?")[0];
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}
function matches(entry: AuthV2PolicyEntry, method: string, path: string): boolean {
  if (entry.method && entry.method !== method) return false;
  const p = normalize(path);
  const e = normalize(entry.path);
  return entry.exact ? p === e : (p === e || p.startsWith(e + "/"));
}
export function resolveAuthV2RoutePermission(method: string, path: string, policy: AuthV2PolicyEntry[] = AUTHV2_ROUTE_POLICY): string | null {
  const m = method.toUpperCase();
  for (const pub of AUTHV2_PUBLIC_ROUTES) if (matches(pub, m, path)) return "public";
  // Longest-prefix wins so exact emergency rules beat generic resource rules.
  const candidates = policy.filter(e => matches(e, m, path)).sort((a, b) => b.path.length - a.path.length);
  return candidates[0]?.permission ?? null;
}
export function createAuthV2Policy(entries: AuthV2PolicyEntry[] = AUTHV2_ROUTE_POLICY) {
  return { entries, resolve: (method: string, path: string) => resolveAuthV2RoutePermission(method, path, entries) };
}
