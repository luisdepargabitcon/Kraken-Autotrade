/**
 * gridActivityViewModel.ts — Pure helpers for activity view model.
 * No DOM, no React, no side-effects. Safe for unit tests.
 */

export type ActivityViewMode = "simple" | "expert";

export const ACTIVITY_PAGE_SIZES = [20, 50, 100] as const;
export type ActivityPageSize = typeof ACTIVITY_PAGE_SIZES[number];

export type ActivityFilterKey =
  | "all"
  | "LEVEL"
  | "CYCLE"
  | "BAND"
  | "SHADOW"
  | "SAFETY"
  | "errors"
  | "SYSTEM";

export interface ActivityEventViewModel {
  id: number;
  timestamp: string;
  eventType: string;
  title: string;
  message: string;
  category: string;
  severity: string;
  mode: string;
  pair: string | null;
  impactSummary: string | null;
  details: any;
  showTechnical: boolean;
  groupCount: number;
}

const SHADOW_EVENT_TYPES = [
  "GRID_SHADOW_EXECUTION_PRICE",
  "GRID_SHADOW_RANGE_REUSED",
  "GRID_SHADOW_RANGE_PROPOSED",
  "GRID_SHADOW_NO_VIABLE_RANGE",
];

function isShadowEvent(eventType: string): boolean {
  return SHADOW_EVENT_TYPES.some(t => eventType.includes("SHADOW"));
}

function categoryFromEventType(eventType: string): string {
  if (eventType.includes("RANGE") || eventType.includes("BAND")) return "BAND";
  if (eventType.includes("LEVEL")) return "LEVEL";
  if (eventType.includes("CYCLE") || eventType.includes("TRAILING")) return "CYCLE";
  if (eventType.includes("PUMP") || eventType.includes("DUMP") || eventType.includes("CIRCUIT")) return "SAFETY";
  if (eventType.includes("ORDER") || eventType.includes("TAKER")) return "ORDER";
  return "SYSTEM";
}

function severityFromEventType(eventType: string): string {
  if (eventType.includes("BLOCKED") || eventType.includes("DENIED")) return "BLOCKED";
  if (eventType.includes("ERROR") || eventType.includes("MISMATCH")) return "ERROR";
  if (eventType.includes("WARNING") || eventType.includes("CANCELLED") || eventType.includes("PAUSED")) return "WARNING";
  if (eventType.includes("COMPLETED") || eventType.includes("FILLED") || eventType.includes("OK")) return "SUCCESS";
  return "INFO";
}

export function filterActivityEvents(
  events: any[],
  filterKey: ActivityFilterKey,
  viewMode: ActivityViewMode
): any[] {
  if (!Array.isArray(events)) return [];
  return events.filter(ev => {
    const et: string = ev?.eventType ?? "";
    if (filterKey === "all") return true;
    if (filterKey === "SHADOW") return isShadowEvent(et);
    if (filterKey === "errors") return severityFromEventType(et) === "ERROR" || severityFromEventType(et) === "BLOCKED";
    return categoryFromEventType(et) === filterKey;
  });
}

export function groupRepeatedEvents(events: any[]): any[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  const grouped: any[] = [];
  let i = 0;
  while (i < events.length) {
    const ev = events[i];
    const et: string = ev?.eventType ?? "";
    let count = 1;
    while (
      i + count < events.length &&
      events[i + count]?.eventType === et &&
      count < 50
    ) {
      count++;
    }
    grouped.push({ ...ev, _groupCount: count });
    i += count;
  }
  return grouped;
}

export function paginateEvents(
  events: any[],
  page: number,
  pageSize: ActivityPageSize
): { items: any[]; totalPages: number; totalCount: number } {
  const totalCount = events.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const items = events.slice(safePage * pageSize, (safePage + 1) * pageSize);
  return { items, totalPages, totalCount };
}

export function toActivityViewModel(
  ev: any,
  viewMode: ActivityViewMode
): ActivityEventViewModel {
  const et: string = ev?.eventType ?? "";
  const showTechnical = viewMode === "expert";
  const msg: string = ev?.naturalMessage ?? ev?.message ?? et;

  return {
    id: ev?.id ?? 0,
    timestamp: ev?.createdAt ?? "",
    eventType: et,
    title: ev?.title ?? et.replace(/^GRID_/, "").replace(/_/g, " "),
    message: msg,
    category: categoryFromEventType(et),
    severity: severityFromEventType(et),
    mode: ev?.mode ?? "SHADOW",
    pair: ev?.pair ?? null,
    impactSummary: null,
    details: showTechnical ? (ev?.metadataJson ?? null) : null,
    showTechnical,
    groupCount: ev?._groupCount ?? 1,
  };
}

export function getActivitySummary(events: any[]): {
  totalLast24h: number;
  simulatedBuys: number;
  simulatedSells: number;
  rangeChanges: number;
  pauses: number;
  errors: number;
} {
  if (!Array.isArray(events)) {
    return { totalLast24h: 0, simulatedBuys: 0, simulatedSells: 0, rangeChanges: 0, pauses: 0, errors: 0 };
  }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = events.filter(ev => new Date(ev?.createdAt ?? 0).getTime() > cutoff);

  return {
    totalLast24h: recent.length,
    simulatedBuys: recent.filter(ev => ev?.eventType === "GRID_CYCLE_BUY_FILLED").length,
    simulatedSells: recent.filter(ev => ev?.eventType === "GRID_CYCLE_COMPLETED").length,
    rangeChanges: recent.filter(ev => (ev?.eventType ?? "").includes("RANGE_ACTIVATED") || (ev?.eventType ?? "").includes("RANGE_PROPOSED")).length,
    pauses: recent.filter(ev => (ev?.eventType ?? "").includes("PAUSED") || (ev?.eventType ?? "").includes("CIRCUIT_BREAKER")).length,
    errors: recent.filter(ev => severityFromEventType(ev?.eventType ?? "") === "ERROR").length,
  };
}
