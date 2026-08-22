import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { refreshSpotData, SPOT_REFRESH_QUERY_KEYS } from "./spotRefresh";

describe("refreshSpotData", () => {
  it("invalidates every SPOT query key and triggers an immediate status refetch", () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const refetchStatus = vi.fn();

    refreshSpotData(queryClient, refetchStatus);

    expect(invalidateSpy).toHaveBeenCalledTimes(SPOT_REFRESH_QUERY_KEYS.length);
    for (const key of SPOT_REFRESH_QUERY_KEYS) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    }
    expect(refetchStatus).toHaveBeenCalledTimes(1);
  });
});
