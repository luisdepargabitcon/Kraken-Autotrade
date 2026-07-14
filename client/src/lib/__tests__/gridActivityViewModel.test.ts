import { describe, it, expect } from "vitest";
import {
  filterActivityEvents,
  groupRepeatedEvents,
  paginateEvents,
  toActivityViewModel,
  getActivitySummary,
  ACTIVITY_PAGE_SIZES,
} from "../gridActivityViewModel";

function makeEvent(id: number, eventType: string, overrides: any = {}): any {
  return {
    id,
    eventType,
    message: `msg-${id}`,
    naturalMessage: `msg-${id}`,
    title: eventType,
    createdAt: new Date(Date.now() - id * 60000).toISOString(),
    mode: "SHADOW",
    pair: "BTC/USD",
    metadataJson: null,
    ...overrides,
  };
}

describe("filterActivityEvents", () => {
  const events = [
    makeEvent(1, "GRID_SHADOW_EXECUTION_PRICE"),
    makeEvent(2, "GRID_LEVEL_PLACED"),
    makeEvent(3, "GRID_CYCLE_COMPLETED"),
    makeEvent(4, "GRID_CIRCUIT_BREAKER_OPENED"),
    makeEvent(5, "GRID_CYCLE_BUY_FILLED"),
    makeEvent(6, "GRID_RANGE_ACTIVATED"),
  ];

  it("all returns all events", () => {
    expect(filterActivityEvents(events, "all", "simple")).toHaveLength(events.length);
  });

  it("SHADOW filter returns only shadow events", () => {
    const result = filterActivityEvents(events, "SHADOW", "simple");
    expect(result.every(e => e.eventType.includes("SHADOW"))).toBe(true);
  });

  it("LEVEL filter returns level events", () => {
    const result = filterActivityEvents(events, "LEVEL", "simple");
    expect(result.every(e => e.eventType.includes("LEVEL"))).toBe(true);
  });

  it("CYCLE filter returns cycle events", () => {
    const result = filterActivityEvents(events, "CYCLE", "simple");
    expect(result.every(e => e.eventType.includes("CYCLE") || e.eventType.includes("TRAILING"))).toBe(true);
  });

  it("SAFETY filter includes circuit breaker", () => {
    const result = filterActivityEvents(events, "SAFETY", "simple");
    expect(result.some(e => e.eventType.includes("CIRCUIT"))).toBe(true);
  });

  it("errors filter returns only error/blocked events", () => {
    const errEvs = [
      makeEvent(10, "GRID_ORDER_BLOCKED"),
      makeEvent(11, "GRID_LEVEL_ERROR"),
    ];
    const result = filterActivityEvents(errEvs, "errors", "simple");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("groupRepeatedEvents", () => {
  it("groups consecutive same-type events", () => {
    const events = [
      makeEvent(1, "GRID_SHADOW_EXECUTION_PRICE"),
      makeEvent(2, "GRID_SHADOW_EXECUTION_PRICE"),
      makeEvent(3, "GRID_SHADOW_EXECUTION_PRICE"),
      makeEvent(4, "GRID_LEVEL_PLACED"),
    ];
    const grouped = groupRepeatedEvents(events);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]._groupCount).toBe(3);
    expect(grouped[1]._groupCount).toBe(1);
  });

  it("does not group non-consecutive events", () => {
    const events = [
      makeEvent(1, "GRID_SHADOW_EXECUTION_PRICE"),
      makeEvent(2, "GRID_LEVEL_PLACED"),
      makeEvent(3, "GRID_SHADOW_EXECUTION_PRICE"),
    ];
    const grouped = groupRepeatedEvents(events);
    expect(grouped).toHaveLength(3);
  });

  it("handles empty array", () => {
    expect(groupRepeatedEvents([])).toHaveLength(0);
  });
});

describe("paginateEvents", () => {
  const events = Array.from({ length: 55 }, (_, i) =>
    makeEvent(i + 1, "GRID_SHADOW_EXECUTION_PRICE")
  );

  it("default page size 20 gives 3 pages for 55 events", () => {
    const { totalPages } = paginateEvents(events, 0, 20);
    expect(totalPages).toBe(3);
  });

  it("first page returns first 20 events", () => {
    const { items } = paginateEvents(events, 0, 20);
    expect(items).toHaveLength(20);
  });

  it("last page returns remaining events", () => {
    const { items } = paginateEvents(events, 2, 20);
    expect(items).toHaveLength(15);
  });

  it("page 50 returns 2 pages", () => {
    const { totalPages } = paginateEvents(events, 0, 50);
    expect(totalPages).toBe(2);
  });

  it("page 100 returns 1 page", () => {
    const { totalPages } = paginateEvents(events, 0, 100);
    expect(totalPages).toBe(1);
  });

  it("total count matches events length", () => {
    const { totalCount } = paginateEvents(events, 0, 20);
    expect(totalCount).toBe(55);
  });
});

describe("toActivityViewModel", () => {
  it("simple mode hides technical details (metadata)", () => {
    const ev = makeEvent(1, "GRID_SHADOW_EXECUTION_PRICE", {
      metadataJson: { price: 63000 },
    });
    const vm = toActivityViewModel(ev, "simple");
    expect(vm.details).toBeNull();
  });

  it("expert mode shows technical details", () => {
    const ev = makeEvent(1, "GRID_SHADOW_EXECUTION_PRICE", {
      metadataJson: { price: 63000 },
    });
    const vm = toActivityViewModel(ev, "expert");
    expect(vm.details).not.toBeNull();
  });

  it("title strips GRID_ prefix", () => {
    const ev = makeEvent(1, "GRID_LEVEL_PLACED", { title: undefined });
    const vm = toActivityViewModel(ev, "simple");
    expect(vm.title).not.toContain("GRID_");
  });

  it("groupCount reflects _groupCount field", () => {
    const ev = { ...makeEvent(1, "GRID_SHADOW_EXECUTION_PRICE"), _groupCount: 7 };
    const vm = toActivityViewModel(ev, "simple");
    expect(vm.groupCount).toBe(7);
  });
});

describe("getActivitySummary", () => {
  it("counts simulated buys correctly", () => {
    const events = [
      makeEvent(1, "GRID_CYCLE_BUY_FILLED", { createdAt: new Date().toISOString() }),
      makeEvent(2, "GRID_CYCLE_BUY_FILLED", { createdAt: new Date().toISOString() }),
      makeEvent(3, "GRID_CYCLE_COMPLETED", { createdAt: new Date().toISOString() }),
    ];
    const summary = getActivitySummary(events);
    expect(summary.simulatedBuys).toBe(2);
    expect(summary.simulatedSells).toBe(1);
  });

  it("handles empty array", () => {
    const summary = getActivitySummary([]);
    expect(summary.totalLast24h).toBe(0);
  });

  it("ACTIVITY_PAGE_SIZES contains 20, 50, 100", () => {
    expect(ACTIVITY_PAGE_SIZES).toContain(20);
    expect(ACTIVITY_PAGE_SIZES).toContain(50);
    expect(ACTIVITY_PAGE_SIZES).toContain(100);
  });
});
