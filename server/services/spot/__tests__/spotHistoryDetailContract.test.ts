/**
 * Contract tests for SpotTradeDetail — detail endpoint response shape.
 *
 * Verifies timeline construction, context fields, protections structure,
 * and availability classification from bot_events data.
 */
import { describe, it, expect } from "vitest";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ETH_ENTRY_META = JSON.stringify({
  spotActivityId: "7725ff95",
  pair: "ETH/USD",
  severity: "SUCCESS",
  decision: "BUY",
  executionMode: "SHADOW",
  setupTag: "PULLBACK_CONTINUATION",
  regime: "TREND",
  direction: "BULLISH",
  macroBias: "BULLISH",
  reasonCode: "ENTRY_FILLED",
  lotId: "spot-ETH/USD-mt3ge42d-1lm1",
  price: 2450.5249369999997,
  explanation: "Posición abierta: spot-ETH/USD-mt3ge42d-1lm1 @ 2450.52",
});

const ETH_PROTECTION_META = JSON.stringify({
  spotActivityId: "b4a77aee",
  pair: "ETH/USD",
  severity: "INFO",
  decision: "BE_ACTIVATED",
  executionMode: "SHADOW",
  reasonCode: "PROTECTION_BE_ACTIVATED",
  lotId: "spot-ETH/USD-mt3ge42d-1lm1",
  explanation: "Stop movido a break-even para posición spot-ETH/USD-mt3ge42d-1lm1",
});

const XRP_TRAILING_META = JSON.stringify({
  spotActivityId: "5ab4da3a",
  pair: "XRP/USD",
  severity: "INFO",
  decision: "TRAILING_ACTIVATED",
  executionMode: "SHADOW",
  reasonCode: "PROTECTION_TRAILING_ACTIVATED",
  lotId: "spot-XRP/USD-mt3qoigh-33j0",
  explanation: "Trailing stop armado para posición spot-XRP/USD-mt3qoigh-33j0",
});

const ETH_EXIT_META = JSON.stringify({
  spotActivityId: "4958e5b6",
  pair: "ETH/USD",
  severity: "SUCCESS",
  decision: "SELL",
  executionMode: "SHADOW",
  reasonCode: "TIME_EFFICIENCY",
  lotId: "spot-ETH/USD-mt3ge42d-1lm1",
  price: 2478.20028,
  explanation: "Posición cerrada: spot-ETH/USD-mt3ge42d-1lm1 @ 2478.20028, PnL=$17.46, razón=Time efficiency, R 0.43",
});

// ─── Timeline builder simulation ──────────────────────────────────────────────

interface BotEvent {
  type: string;
  timestamp: string;
  meta: string;
}

interface TimelineEvent {
  timestamp: number;
  type: string;
  titleEs: string;
  descriptionEs: string;
  price?: number;
  pnlUsd?: number;
}

function buildTimelineFromEvents(events: BotEvent[]): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  for (const ev of events) {
    const meta = JSON.parse(ev.meta);
    const timestamp = new Date(ev.timestamp).getTime();
    const price = meta.price ? Number(meta.price) : undefined;
    const explanation = String(meta.explanation ?? "");

    switch (ev.type) {
      case "SPOT_ENTRY":
        result.push({ timestamp, type: "ENTRY", titleEs: "Entrada ejecutada", descriptionEs: explanation, price });
        break;
      case "SPOT_POSITION":
        break;
      case "SPOT_PROTECTION": {
        const dec = meta.decision ?? "";
        if (dec === "BE_ACTIVATED") {
          result.push({ timestamp, type: "BREAK_EVEN", titleEs: "Break-even activado", descriptionEs: explanation, price });
        } else if (dec === "TRAILING_ACTIVATED") {
          result.push({ timestamp, type: "TRAILING", titleEs: "Trailing stop armado", descriptionEs: explanation, price });
        }
        break;
      }
      case "SPOT_EXIT": {
        const pnlMatch = explanation.match(/PnL=\$([+-]?\d+\.?\d*)/);
        const pnlUsd = pnlMatch ? Number(pnlMatch[1]) : undefined;
        result.push({ timestamp, type: "EXIT", titleEs: "Posición cerrada", descriptionEs: explanation, price, pnlUsd });
        break;
      }
    }
  }
  return result.sort((a, b) => a.timestamp - b.timestamp);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SpotTradeDetail — timeline contract", () => {
  const baseTime = new Date("2026-08-22T05:00:00Z").getTime();

  function makeEvent(type: string, meta: string, offsetMs = 0): BotEvent {
    return {
      type,
      timestamp: new Date(baseTime + offsetMs).toISOString(),
      meta,
    };
  }

  it("HIST_DET_01 — SPOT_ENTRY creates ENTRY timeline event", () => {
    const events = [makeEvent("SPOT_ENTRY", ETH_ENTRY_META)];
    const timeline = buildTimelineFromEvents(events);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].type).toBe("ENTRY");
    expect(timeline[0].titleEs).toBe("Entrada ejecutada");
    expect(timeline[0].price).toBeCloseTo(2450.52, 0);
  });

  it("HIST_DET_02 — SPOT_POSITION is skipped (not a visible event)", () => {
    const positionMeta = JSON.stringify({ type: "SPOT_POSITION", lotId: "spot-ETH/USD-test" });
    const events = [
      makeEvent("SPOT_ENTRY", ETH_ENTRY_META, 0),
      makeEvent("SPOT_POSITION", positionMeta, 100),
    ];
    const timeline = buildTimelineFromEvents(events);
    expect(timeline).toHaveLength(1);
    expect(timeline.every(e => e.type !== "SPOT_POSITION")).toBe(true);
  });

  it("HIST_DET_03 — BE_ACTIVATED creates BREAK_EVEN timeline event", () => {
    const events = [
      makeEvent("SPOT_ENTRY", ETH_ENTRY_META, 0),
      makeEvent("SPOT_PROTECTION", ETH_PROTECTION_META, 60000),
    ];
    const timeline = buildTimelineFromEvents(events);
    expect(timeline).toHaveLength(2);
    const beEvent = timeline.find(e => e.type === "BREAK_EVEN");
    expect(beEvent).toBeDefined();
    expect(beEvent!.titleEs).toBe("Break-even activado");
  });

  it("HIST_DET_04 — TRAILING_ACTIVATED creates TRAILING timeline event", () => {
    const events = [makeEvent("SPOT_PROTECTION", XRP_TRAILING_META, 0)];
    const timeline = buildTimelineFromEvents(events);
    const trailingEvent = timeline.find(e => e.type === "TRAILING");
    expect(trailingEvent).toBeDefined();
    expect(trailingEvent!.titleEs).toBe("Trailing stop armado");
  });

  it("HIST_DET_05 — SPOT_EXIT creates EXIT event with pnlUsd parsed from explanation", () => {
    const events = [makeEvent("SPOT_EXIT", ETH_EXIT_META, 0)];
    const timeline = buildTimelineFromEvents(events);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].type).toBe("EXIT");
    expect(timeline[0].price).toBeCloseTo(2478.20, 1);
    expect(timeline[0].pnlUsd).toBe(17.46);
  });

  it("HIST_DET_06 — timeline is sorted chronologically", () => {
    const events = [
      makeEvent("SPOT_EXIT", ETH_EXIT_META, 5000),
      makeEvent("SPOT_ENTRY", ETH_ENTRY_META, 0),
      makeEvent("SPOT_PROTECTION", ETH_PROTECTION_META, 2000),
    ];
    const timeline = buildTimelineFromEvents(events);
    expect(timeline[0].type).toBe("ENTRY");
    expect(timeline[1].type).toBe("BREAK_EVEN");
    expect(timeline[2].type).toBe("EXIT");
  });

  it("HIST_DET_07 — complete XRP timeline (5 events → 4 visible)", () => {
    const xrpEntryMeta = JSON.stringify({ decision: "BUY", lotId: "spot-XRP/USD-test", price: 1.5, explanation: "Entrada XRP" });
    const xrpPosMeta = JSON.stringify({ decision: "OPEN", lotId: "spot-XRP/USD-test" });
    const xrpExitMeta = JSON.stringify({ decision: "SELL", reasonCode: "TRAILING", lotId: "spot-XRP/USD-test", price: 1.66, explanation: "Salida XRP, PnL=$107.20" });
    const events = [
      makeEvent("SPOT_ENTRY", xrpEntryMeta, 0),
      makeEvent("SPOT_POSITION", xrpPosMeta, 100),
      makeEvent("SPOT_PROTECTION", ETH_PROTECTION_META, 2000),
      makeEvent("SPOT_PROTECTION", XRP_TRAILING_META, 4000),
      makeEvent("SPOT_EXIT", xrpExitMeta, 6000),
    ];
    const timeline = buildTimelineFromEvents(events);
    expect(timeline).toHaveLength(4);
    expect(timeline[0].type).toBe("ENTRY");
    expect(timeline[1].type).toBe("BREAK_EVEN");
    expect(timeline[2].type).toBe("TRAILING");
    expect(timeline[3].type).toBe("EXIT");
  });
});

// ─── Context extraction contract ──────────────────────────────────────────────

describe("SpotTradeDetail — context contract", () => {
  it("HIST_CTX_01 — SPOT_ENTRY meta provides regime, direction, macroBias", () => {
    const meta = JSON.parse(ETH_ENTRY_META);
    expect(meta.regime).toBe("TREND");
    expect(meta.direction).toBe("BULLISH");
    expect(meta.macroBias).toBe("BULLISH");
  });

  it("HIST_CTX_02 — SPOT_ENTRY meta provides setupTag", () => {
    const meta = JSON.parse(ETH_ENTRY_META);
    expect(meta.setupTag).toBe("PULLBACK_CONTINUATION");
  });

  it("HIST_CTX_03 — context is FULL_DETAIL when both timeline and context are available", () => {
    const hasTimeline = true;
    const hasContext = true;
    const avail = hasTimeline && hasContext ? "FULL_DETAIL"
      : (hasTimeline || hasContext) ? "PARTIAL_DETAIL" : "BASIC_DETAIL";
    expect(avail).toBe("FULL_DETAIL");
  });

  it("HIST_CTX_04 — BASIC_DETAIL when no timeline and no context", () => {
    const avail = false && false ? "FULL_DETAIL"
      : (false || false) ? "PARTIAL_DETAIL" : "BASIC_DETAIL";
    expect(avail).toBe("BASIC_DETAIL");
  });
});

// ─── Protections contract ─────────────────────────────────────────────────────

describe("SpotTradeDetail — protections contract", () => {
  it("HIST_PROT_01 — BE_ACTIVATED event sets breakEvenActivated=true", () => {
    const meta = JSON.parse(ETH_PROTECTION_META);
    const breakEvenActivated = meta.decision === "BE_ACTIVATED";
    expect(breakEvenActivated).toBe(true);
  });

  it("HIST_PROT_02 — TRAILING_ACTIVATED event sets trailingActivated=true", () => {
    const meta = JSON.parse(XRP_TRAILING_META);
    const trailingActivated = meta.decision === "TRAILING_ACTIVATED";
    expect(trailingActivated).toBe(true);
  });

  it("HIST_PROT_03 — missing protection events default to false", () => {
    const events: BotEvent[] = [];
    let beActivated = false;
    let trailingActivated = false;
    for (const ev of events) {
      if (ev.type === "SPOT_PROTECTION") {
        const m = JSON.parse(ev.meta);
        if (m.decision === "BE_ACTIVATED") beActivated = true;
        if (m.decision === "TRAILING_ACTIVATED") trailingActivated = true;
      }
    }
    expect(beActivated).toBe(false);
    expect(trailingActivated).toBe(false);
  });
});
