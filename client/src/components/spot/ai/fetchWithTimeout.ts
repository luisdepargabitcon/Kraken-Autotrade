/**
 * fetchWithTimeout — Fetch wrapper with AbortController-based timeout.
 *
 * R14: Prevents infinite loading states in the IA Forward Twin panel.
 * On timeout, throws a TimeoutError so React Query can surface it as an error.
 */

export class TimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Tiempo de espera agotado (${timeoutMs}ms)`);
    this.name = "TimeoutError";
  }
}

/**
 * Fetch JSON with a timeout. Throws TimeoutError on timeout, Error on non-OK.
 */
export async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number = 15000,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json() as T;
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new TimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
