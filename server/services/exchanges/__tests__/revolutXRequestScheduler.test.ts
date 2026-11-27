import { describe, expect, it, vi } from "vitest";
import {
  RevolutXRequestScheduler,
  REVOLUTX_PRIORITY,
  normalizeSingleFlightKey,
} from "../RevolutXRequestScheduler";

function jsonResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers,
  });
}

function makeClock(start = 1_000) {
  const state = { now: start };
  return {
    state,
    nowMs: () => state.now,
    sleep: vi.fn(async (ms: number) => {
      state.now += ms;
    }),
    random: () => 0.5,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function input(priority: number, endpoint: string, method = "GET") {
  return {
    method,
    endpoint,
    priority,
    requestFactory: () => ({ url: `https://example.test${endpoint}`, init: { method } }),
  };
}

describe("RevolutXRequestScheduler", () => {
  it("prioriza P0 sobre P3 encoladas y mantiene concurrencia 1", async () => {
    const clock = makeClock();
    const gate = deferred<Response>();
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn(async (url: any) => {
      const endpoint = String(url).replace("https://example.test", "");
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        if (endpoint === "/first") return await gate.promise;
        order.push(endpoint);
        return jsonResponse(200, { endpoint });
      } finally {
        active--;
      }
    });
    const scheduler = new RevolutXRequestScheduler({
      minTimeMs: 10,
      clock,
      fetchImpl: fetchMock as any,
    });

    const first = scheduler.schedule(input(REVOLUTX_PRIORITY.P1_RECONCILIATION, "/first"));
    await Promise.resolve();
    const p3 = scheduler.schedule(input(REVOLUTX_PRIORITY.P3_HISTORY, "/history"));
    const p0 = scheduler.schedule(input(REVOLUTX_PRIORITY.P0_EXECUTION, "/execution"));
    gate.resolve(jsonResponse(200, { first: true }));

    await Promise.all([first, p3, p0]);
    expect(order).toEqual(["/execution", "/history"]);
    expect(maxActive).toBe(1);
  });

  it("envejecimiento evita inanición de P3 frente a P1 posterior", async () => {
    const clock = makeClock();
    const gate = deferred<Response>();
    const order: string[] = [];
    const fetchMock = vi.fn(async (url: any) => {
      const endpoint = String(url).replace("https://example.test", "");
      if (endpoint === "/first") return await gate.promise;
      order.push(endpoint);
      return jsonResponse(200);
    });
    const scheduler = new RevolutXRequestScheduler({
      minTimeMs: 0,
      agingThresholdMs: 1_000,
      clock,
      fetchImpl: fetchMock as any,
    });

    const first = scheduler.schedule(input(REVOLUTX_PRIORITY.P1_RECONCILIATION, "/first"));
    await Promise.resolve();
    const oldP3 = scheduler.schedule(input(REVOLUTX_PRIORITY.P3_HISTORY, "/old-history"));
    clock.state.now += 2_100;
    const newP1 = scheduler.schedule(input(REVOLUTX_PRIORITY.P1_RECONCILIATION, "/new-reconciliation"));
    gate.resolve(jsonResponse(200));

    await Promise.all([first, oldP3, newP1]);
    expect(order[0]).toBe("/old-history");
  });

  it("respeta Retry-After en segundos con cooldown global", async () => {
    const clock = makeClock();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const scheduler = new RevolutXRequestScheduler({ minTimeMs: 0, clock, fetchImpl: fetchMock as any });

    const response = await scheduler.schedule(input(REVOLUTX_PRIORITY.P1_RECONCILIATION, "/order"));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(clock.state.now).toBeGreaterThanOrEqual(1_000 + 2_000);
    expect(scheduler.getStats().rateLimited).toBe(1);
  });

  it("respeta Retry-After en fecha HTTP", async () => {
    const clock = makeClock(10_000);
    const httpDate = new Date(13_000).toUTCString();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503, {}, { "retry-after": httpDate }))
      .mockResolvedValueOnce(jsonResponse(200));
    const scheduler = new RevolutXRequestScheduler({ minTimeMs: 0, clock, fetchImpl: fetchMock as any });

    await scheduler.schedule(input(REVOLUTX_PRIORITY.P1_RECONCILIATION, "/fills"));

    expect(clock.state.now).toBeGreaterThanOrEqual(13_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backoff con jitter queda acotado usando random inyectado", async () => {
    const clock = makeClock();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(200));
    const scheduler = new RevolutXRequestScheduler({ minTimeMs: 0, clock, fetchImpl: fetchMock as any, maxCooldownMs: 5_000 });

    await scheduler.schedule(input(REVOLUTX_PRIORITY.P1_RECONCILIATION, "/trades"));

    const elapsed = clock.state.now - 1_000;
    expect(elapsed).toBeGreaterThanOrEqual(2_000);
    expect(elapsed).toBeLessThanOrEqual(2_500);
  });

  it("GET se reintenta como máximo 2 veces; POST nunca se reintenta", async () => {
    const clock = makeClock();
    const getFetch = vi.fn(async () => jsonResponse(500));
    const getScheduler = new RevolutXRequestScheduler({ minTimeMs: 0, clock, fetchImpl: getFetch as any });
    const getResponse = await getScheduler.schedule(input(REVOLUTX_PRIORITY.P1_RECONCILIATION, "/order", "GET"));
    expect(getResponse.status).toBe(500);
    expect(getFetch).toHaveBeenCalledTimes(3);
    expect(getScheduler.getStats().retries).toBe(2);

    const postFetch = vi.fn(async () => jsonResponse(429));
    const postScheduler = new RevolutXRequestScheduler({ minTimeMs: 0, clock, fetchImpl: postFetch as any });
    const postResponse = await postScheduler.schedule(input(REVOLUTX_PRIORITY.P0_EXECUTION, "/orders", "POST"));
    expect(postResponse.status).toBe(429);
    expect(postFetch).toHaveBeenCalledTimes(1);
    expect(postScheduler.getStats().retries).toBe(0);
  });

  it("401/403 no se reintentan y alimentan callback de breaker", async () => {
    const clock = makeClock();
    const onAuthFailure = vi.fn();
    const fetchMock = vi.fn(async () => jsonResponse(401));
    const scheduler = new RevolutXRequestScheduler({ minTimeMs: 0, clock, fetchImpl: fetchMock as any });
    const request = {
      ...input(REVOLUTX_PRIORITY.P1_RECONCILIATION, "/order", "GET"),
      onAuthFailure,
    };

    const response = await scheduler.schedule(request);

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).toHaveBeenCalledWith("/order");
    expect(scheduler.getStats().retries).toBe(0);
  });

  it("un salto atrás del reloj no convierte el espaciado en una espera enorme", async () => {
    const clock = makeClock(10_000);
    const fetchMock = vi.fn(async () => jsonResponse(200));
    const scheduler = new RevolutXRequestScheduler({ minTimeMs: 10, clock, fetchImpl: fetchMock as any });

    await scheduler.schedule(input(REVOLUTX_PRIORITY.P1_RECONCILIATION, "/first"));
    clock.state.now = 1_000;
    await scheduler.schedule(input(REVOLUTX_PRIORITY.P1_RECONCILIATION, "/second"));

    expect(clock.sleep).toHaveBeenLastCalledWith(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("single-flight coalesce GET concurrentes por clave normalizada", async () => {
    const clock = makeClock();
    const gate = deferred<Response>();
    const fetchMock = vi.fn(async () => gate.promise);
    const scheduler = new RevolutXRequestScheduler({ minTimeMs: 0, clock, fetchImpl: fetchMock as any });
    const key = normalizeSingleFlightKey("GET", "/api/1.0/fills", "b=2&a=1");
    const request = {
      ...input(REVOLUTX_PRIORITY.P1_RECONCILIATION, "/api/1.0/fills", "GET"),
      singleFlightKey: key,
    };

    const a = scheduler.schedule(request);
    const b = scheduler.schedule(request);
    gate.resolve(jsonResponse(200, { rows: [] }));
    const [ra, rb] = await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await ra.json()).rows).toEqual([]);
    expect((await rb.json()).rows).toEqual([]);
    expect(scheduler.getStats().coalesced).toBe(1);
    expect(normalizeSingleFlightKey("GET", "/x", "b=2&a=1")).toBe(normalizeSingleFlightKey("GET", "/x", "a=1&b=2"));
  });
});
