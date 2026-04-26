/**
 * idcaLog — Helper centralizado para logs técnicos del módulo IDCA.
 *
 * Escribe en consola con prefijo claro y persiste en institutional_dca_events
 * con severity=debug/info/warn/error para que aparezcan en la subpestaña Terminal.
 *
 * NO persistir arrays de velas ni payloads >10KB.
 */

type IdcaLogLevel = "debug" | "info" | "warn" | "error";

interface IdcaLogMeta {
  pair?: string;
  mode?: string;
  source?: string;
  cycleId?: number;
  [key: string]: unknown;
}

const MAX_PAYLOAD_BYTES = 8192;

function truncatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const str = JSON.stringify(payload);
  if (str.length <= MAX_PAYLOAD_BYTES) return payload;
  // Drop large array fields, keep scalars
  const trimmed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (Array.isArray(v)) {
      trimmed[k] = `[array truncated, length=${v.length}]`;
    } else {
      trimmed[k] = v;
    }
  }
  const trimmedStr = JSON.stringify(trimmed);
  if (trimmedStr.length <= MAX_PAYLOAD_BYTES) return trimmed;
  return { _truncated: true, message: "payload too large" };
}

export function idcaLog(
  level: IdcaLogLevel,
  message: string,
  meta?: IdcaLogMeta & Record<string, unknown>
): void {
  const { pair, mode, source, cycleId, ...restMeta } = meta ?? {};

  const prefix = [
    "[IDCA]",
    source ? `[${source}]` : null,
    pair ? `[${pair}]` : null,
    mode ? `[${mode.toUpperCase()}]` : null,
  ].filter(Boolean).join("");

  const fullMessage = `${prefix} ${message}`;

  switch (level) {
    case "debug":  console.debug(fullMessage); break;
    case "info":   console.log(fullMessage); break;
    case "warn":   console.warn(fullMessage); break;
    case "error":  console.error(fullMessage); break;
  }

  // Persistir de forma asíncrona — no bloquear el flujo principal
  persistIdcaLog(level, message, { pair, mode, source, cycleId, ...restMeta }).catch(() => {
    // silenciar errores de persistencia para no romper flujo
  });
}

async function persistIdcaLog(
  level: IdcaLogLevel,
  message: string,
  meta: IdcaLogMeta & Record<string, unknown>
): Promise<void> {
  try {
    const { createEvent } = await import("./IdcaRepository");
    const { pair, mode, source, cycleId, ...rest } = meta;

    const rawPayload: Record<string, unknown> = { source: source ?? "IDCA", ...rest };
    const payloadJson = Object.keys(rawPayload).length > 0
      ? truncatePayload(rawPayload)
      : undefined;

    await createEvent({
      cycleId: cycleId ?? null,
      pair: pair ?? null,
      mode: mode ?? null,
      eventType: "terminal_log",
      severity: level,
      message,
      humanTitle: null,
      humanMessage: null,
      technicalSummary: source ? `[${source}]` : null,
      payloadJson: payloadJson ?? null,
    });
  } catch {
    // silenciar
  }
}
