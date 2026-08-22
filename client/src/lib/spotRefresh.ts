import { QueryClient } from "@tanstack/react-query";

export const SPOT_REFRESH_QUERY_KEYS = [
  "spot-status",
  "spot-positions",
  "spot-history",
  "spot-summary",
  "spot-intents",
  "spot-audit",
  "spot-activity",
  "spot-context",
  "spot-pairs",
] as const;

export function refreshSpotData(queryClient: QueryClient, refetchStatus: () => void): void {
  for (const key of SPOT_REFRESH_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
  refetchStatus();
}
