/**
 * RevolutXRequestScheduler — serial scheduler for signed Revolut X requests.
 *
 * Design goals:
 * - concurrency 1 and minimum spacing for every signed private call;
 * - priority classes with ageing, so low-priority history cannot starve forever;
 * - global cooldown after 429/503, honoring Retry-After when present;
 * - bounded retries only for idempotent GET requests;
 * - optional single-flight for concurrent read GETs;
 * - injectable clock/sleep/random for deterministic tests.
 */

export const REVOLUTX_PRIORITY = {
  P0_EXECUTION: 0,
  P1_RECONCILIATION: 1,
  P2_BALANCE: 2,
  P3_HISTORY: 3,
} as const;

export type RevolutXPriorityClass = keyof typeof REVOLUTX_PRIORITY;
export type RevolutXPriority = typeof REVOLUTX_PRIORITY[RevolutXPriorityClass];

export interface SchedulerClock {
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
}

export interface RevolutXSchedulerOptions {
  minTimeMs?: number;
  agingThresholdMs?: number;
  maxCooldownMs?: number;
  maxGetRetries?: number;
  clock?: Partial<SchedulerClock>;
  fetchImpl?: typeof fetch;
}

export interface ScheduledHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  bodyText: string;
  text(): Promise<string>;
  json(): Promise<any>;
}

export interface RevolutXScheduledRequestInput {
  method: string;
  endpoint: string;
  priority: RevolutXPriority;
  requestFactory: () => { url: string; init: RequestInit };
  singleFlightKey?: string;
  retryable?: boolean;
  onAuthFailure?: (endpoint: string) => void;
}

export interface RevolutXSchedulerStats {
  queueLength: number;
  totalCalls: number;
  retries: number;
  rateLimited: number;
  coalesced: number;
  callsByEndpoint: Record<string, number>;
  callsByPriority: Record<string, number>;
}

interface SchedulerTask {
  input: RevolutXScheduledRequestInput;
  enqueuedAtMs: number;
  resolve: (value: ScheduledHttpResponse) => void;
  reject: (error: unknown) => void;
}

const defaultClock: SchedulerClock = {
  nowMs: () => Date.now(),
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

function responseSnapshot(response: Response, bodyText: string | null): ScheduledHttpResponse {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers ?? new Headers(),
    bodyText: bodyText ?? "",
    text: async () => bodyText ?? response.text(),
    json: async () => bodyText != null ? JSON.parse(bodyText) : response.json(),
  };
}

function priorityLabel(priority: RevolutXPriority): string {
  if (priority === REVOLUTX_PRIORITY.P0_EXECUTION) return "P0_EXECUTION";
  if (priority === REVOLUTX_PRIORITY.P1_RECONCILIATION) return "P1_RECONCILIATION";
  if (priority === REVOLUTX_PRIORITY.P2_BALANCE) return "P2_BALANCE";
  return "P3_HISTORY";
}

export class RevolutXRequestScheduler {
  private readonly minTimeMs: number;
  private readonly agingThresholdMs: number;
  private readonly maxCooldownMs: number;
  private readonly maxGetRetries: number;
  private readonly clock: SchedulerClock;
  private readonly fetchImpl: typeof fetch;

  private queue: SchedulerTask[] = [];
  private pumping = false;
  private lastCallAtMs = 0;
  private cooldownUntilMs = 0;
  private consecutiveRateLimits = 0;
  private singleFlight = new Map<string, Promise<ScheduledHttpResponse>>();

  private totalCalls = 0;
  private retries = 0;
  private rateLimited = 0;
  private coalesced = 0;
  private callsByEndpoint = new Map<string, number>();
  private callsByPriority = new Map<string, number>();

  constructor(options: RevolutXSchedulerOptions = {}) {
    this.minTimeMs = options.minTimeMs ?? 250;
    this.agingThresholdMs = options.agingThresholdMs ?? 5_000;
    this.maxCooldownMs = options.maxCooldownMs ?? 60_000;
    this.maxGetRetries = options.maxGetRetries ?? 2;
    this.clock = { ...defaultClock, ...(options.clock ?? {}) };
    this.fetchImpl = options.fetchImpl ?? (((url: any, init?: any) => globalThis.fetch(url, init)) as typeof fetch);
  }

  schedule(input: RevolutXScheduledRequestInput): Promise<ScheduledHttpResponse> {
    const method = input.method.toUpperCase();
    if (method === "GET" && input.singleFlightKey) {
      const existing = this.singleFlight.get(input.singleFlightKey);
      if (existing) {
        this.coalesced++;
        return existing;
      }
    }

    const promise = new Promise<ScheduledHttpResponse>((resolve, reject) => {
      this.queue.push({
        input: { ...input, method },
        enqueuedAtMs: this.clock.nowMs(),
        resolve,
        reject,
      });
      void this.pump();
    });

    if (method === "GET" && input.singleFlightKey) {
      this.singleFlight.set(input.singleFlightKey, promise);
      promise.finally(() => {
        if (this.singleFlight.get(input.singleFlightKey!) === promise) {
          this.singleFlight.delete(input.singleFlightKey!);
        }
      }).catch(() => {});
    }

    return promise;
  }

  getStats(): RevolutXSchedulerStats {
    return {
      queueLength: this.queue.length,
      totalCalls: this.totalCalls,
      retries: this.retries,
      rateLimited: this.rateLimited,
      coalesced: this.coalesced,
      callsByEndpoint: Object.fromEntries(this.callsByEndpoint),
      callsByPriority: Object.fromEntries(this.callsByPriority),
    };
  }

  private effectivePriority(task: SchedulerTask, nowMs: number): number {
    const ageMs = Math.max(0, nowMs - task.enqueuedAtMs);
    const promotions = Math.floor(ageMs / this.agingThresholdMs);
    return Math.max(REVOLUTX_PRIORITY.P0_EXECUTION, task.input.priority - promotions);
  }

  private takeNextTask(): SchedulerTask | undefined {
    if (this.queue.length === 0) return undefined;
    const nowMs = this.clock.nowMs();
    let bestIndex = 0;
    let bestPriority = this.effectivePriority(this.queue[0], nowMs);
    let bestEnqueuedAt = this.queue[0].enqueuedAtMs;

    for (let i = 1; i < this.queue.length; i++) {
      const priority = this.effectivePriority(this.queue[i], nowMs);
      if (
        priority < bestPriority ||
        (priority === bestPriority && this.queue[i].enqueuedAtMs < bestEnqueuedAt)
      ) {
        bestIndex = i;
        bestPriority = priority;
        bestEnqueuedAt = this.queue[i].enqueuedAtMs;
      }
    }

    return this.queue.splice(bestIndex, 1)[0];
  }

  private async waitForSendWindow(): Promise<void> {
    const nowMs = this.clock.nowMs();
    const cooldownWait = this.cooldownUntilMs - nowMs;
    if (cooldownWait > 0) {
      await this.clock.sleep(cooldownWait);
    }

    const afterCooldownNowMs = this.clock.nowMs();
    const elapsedSinceLastCallMs = Math.max(0, afterCooldownNowMs - this.lastCallAtMs);
    const spacingWait = this.minTimeMs - elapsedSinceLastCallMs;
    if (spacingWait > 0) {
      await this.clock.sleep(spacingWait);
    }
  }

  private parseRetryAfterMs(value: string | null, nowMs: number): number | null {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(this.maxCooldownMs, Math.ceil(seconds * 1000));
    }
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) {
      return Math.min(this.maxCooldownMs, Math.max(0, dateMs - nowMs));
    }
    return null;
  }

  private computeFallbackCooldownMs(): number {
    const exponent = Math.min(this.consecutiveRateLimits, 4);
    const base = Math.min(this.maxCooldownMs, 1_000 * 2 ** exponent);
    const jitter = this.clock.random() * Math.min(500, base * 0.25);
    return Math.min(this.maxCooldownMs, base + jitter);
  }

  private applyCooldown(response: ScheduledHttpResponse): void {
    if (response.status !== 429 && response.status !== 503) return;
    this.rateLimited++;
    this.consecutiveRateLimits++;
    const nowMs = this.clock.nowMs();
    const retryAfterMs = this.parseRetryAfterMs(response.headers?.get?.("retry-after"), nowMs);
    const cooldownMs = retryAfterMs ?? this.computeFallbackCooldownMs();
    this.cooldownUntilMs = Math.max(this.cooldownUntilMs, nowMs + cooldownMs);
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private async executeTask(task: SchedulerTask): Promise<ScheduledHttpResponse> {
    const method = task.input.method.toUpperCase();
    const retryable = method === "GET" && task.input.retryable !== false;
    let attempt = 0;

    while (true) {
      await this.waitForSendWindow();
      this.lastCallAtMs = this.clock.nowMs();
      this.totalCalls++;
      this.callsByEndpoint.set(task.input.endpoint, (this.callsByEndpoint.get(task.input.endpoint) ?? 0) + 1);
      const priorityName = priorityLabel(task.input.priority);
      this.callsByPriority.set(priorityName, (this.callsByPriority.get(priorityName) ?? 0) + 1);

      try {
        const request = task.input.requestFactory();
        const rawResponse = await this.fetchImpl(request.url, request.init);
        const nativeResponse = typeof rawResponse.clone === "function" && typeof rawResponse.arrayBuffer === "function";
        const bodyText = nativeResponse ? await rawResponse.text() : null;
        const response = responseSnapshot(rawResponse, bodyText);
        this.applyCooldown(response);

        if (response.status === 401 || response.status === 403) {
          task.input.onAuthFailure?.(task.input.endpoint);
          return response;
        }

        if (response.ok) {
          this.consecutiveRateLimits = 0;
          return response;
        }

        if (!retryable || !this.isRetryableStatus(response.status) || attempt >= this.maxGetRetries) {
          return response;
        }
      } catch (error) {
        if (!retryable || attempt >= this.maxGetRetries) {
          throw error;
        }
      }

      attempt++;
      this.retries++;
      const backoffMs = Math.min(this.maxCooldownMs, 250 * 2 ** attempt + this.clock.random() * 100);
      await this.clock.sleep(backoffMs);
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const task = this.takeNextTask();
        if (!task) break;
        try {
          task.resolve(await this.executeTask(task));
        } catch (error) {
          task.reject(error);
        }
      }
    } finally {
      this.pumping = false;
      if (this.queue.length > 0) {
        void this.pump();
      }
    }
  }
}

export function normalizeSingleFlightKey(method: string, path: string, queryString = ""): string {
  const normalizedQuery = queryString
    .split("&")
    .filter(Boolean)
    .sort()
    .join("&");
  return `${method.toUpperCase()} ${path}${normalizedQuery ? `?${normalizedQuery}` : ""}`;
}
