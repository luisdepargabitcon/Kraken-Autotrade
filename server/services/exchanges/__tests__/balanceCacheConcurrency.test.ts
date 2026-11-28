import { afterEach, describe, expect, it, vi } from "vitest";
import { BalanceCache } from "../BalanceCache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("BalanceCache concurrency and invalidation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("conserva entrada caducada con edad real pero get() no la usa y fuerza fetch fresco", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const cache = new BalanceCache(50);
    cache.set("revolutx", { USD: 100 }, "test");

    vi.setSystemTime(10_060);
    expect(cache.get("revolutx")).toBeNull();
    const meta = cache.getWithMeta("revolutx");
    expect(meta?.stale).toBe(true);
    expect(meta?.ageMs).toBe(60);
    expect(meta?.data.USD).toBe(100);

    const fetcher = vi.fn(async () => ({ USD: 120 }));
    const fresh = await cache.getOrFetchCoalesced("revolutx", fetcher);
    expect(fresh.USD).toBe(120);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("single-flight coalesce misses concurrentes de la misma generación", async () => {
    const cache = new BalanceCache(1_000);
    const gate = deferred<Record<string, number>>();
    const fetcher = vi.fn(() => gate.promise);

    const a = cache.getOrFetchCoalesced("revolutx", fetcher);
    const b = cache.getOrFetchCoalesced("revolutx", fetcher);
    gate.resolve({ USD: 50 });
    await Promise.all([a, b]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.getStats().coalescedCalls).toBe(1);
  });

  it("invalidate durante fetch en vuelo impide repoblar y obliga a una petición nueva", async () => {
    const cache = new BalanceCache(1_000);
    const first = deferred<Record<string, number>>();
    const second = deferred<Record<string, number>>();
    const firstFetcher = vi.fn(() => first.promise);
    const secondFetcher = vi.fn(() => second.promise);

    const oldPromise = cache.getOrFetchCoalesced("revolutx", firstFetcher);
    cache.invalidate("revolutx");
    const newPromise = cache.getOrFetchCoalesced("revolutx", secondFetcher);

    expect(firstFetcher).toHaveBeenCalledTimes(1);
    expect(secondFetcher).toHaveBeenCalledTimes(1);

    first.resolve({ USD: 10 });
    await oldPromise;
    expect(cache.get("revolutx")).toBeNull();

    second.resolve({ USD: 20 });
    await newPromise;
    expect(cache.get("revolutx")?.USD).toBe(20);
  });

  it("llamadas posteriores a invalidate se coalescen con la nueva petición, no con la antigua", async () => {
    const cache = new BalanceCache(1_000);
    const first = deferred<Record<string, number>>();
    const second = deferred<Record<string, number>>();
    const firstFetcher = vi.fn(() => first.promise);
    const secondFetcher = vi.fn(() => second.promise);

    const oldPromise = cache.getOrFetchCoalesced("revolutx", firstFetcher);
    cache.invalidate("revolutx");
    const newA = cache.getOrFetchCoalesced("revolutx", secondFetcher);
    const newB = cache.getOrFetchCoalesced("revolutx", secondFetcher);

    expect(firstFetcher).toHaveBeenCalledTimes(1);
    expect(secondFetcher).toHaveBeenCalledTimes(1);
    expect(cache.getStats().coalescedCalls).toBe(1);

    first.resolve({ USD: 1 });
    second.resolve({ USD: 2 });
    await oldPromise;
    await Promise.all([newA, newB]);
    expect(cache.get("revolutx")?.USD).toBe(2);
  });
});
