import { describe, it, expect } from "vitest";
import {
  buildGridLevelLadderViewModel,
  filterAndSearchRows,
  insertCurrentPriceMarker,
  searchHistoricalRows,
  humanizeMakerState,
  type OperationalInput,
} from "../gridLevelLadderViewModel";

function makeOperational(): OperationalInput {
  return {
    header: { currentPrice: 92000 },
    currentRange: { exists: true, message: "Rango activo cargado." },
    market: { entryRange: { activeRangeVersionId: "range-uuid-1234", active: true } },
    levels: {
      entryLevels: [
        { id: "buy-1", side: "BUY", price: 90000, quantity: 0.01, status: "planned", statusLabel: "Planificado", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
        { id: "buy-2", side: "BUY", price: 85000, quantity: 0.01, status: "planned", statusLabel: "Planificado", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
      ],
      referenceRungs: [
        { id: "rung-1", side: "SELL", price: 95000, quantity: 0.01, status: "planned", statusLabel: "Planificado", rangeRelation: "current", targetOfOpenCycle: false, rangeVersionId: "range-uuid-1234" },
        { id: "rung-2", side: "SELL", price: 100000, quantity: 0.01, status: "planned", statusLabel: "Planificado", rangeRelation: "current", targetOfOpenCycle: false, rangeVersionId: "range-uuid-1234" },
      ],
      legacyTargetLevels: [],
      historicalLevels: [
        { id: "hist-1", side: "BUY", price: 80000, quantity: 0.01, status: "replaced", statusLabel: "Reemplazado", rangeRelation: "previous", rangeVersionId: "range-old-5678" },
      ],
    },
    cycleOwnedExits: [],
  };
}

function makeCanonicalOperational(): OperationalInput {
  const base = makeOperational();
  return {
    ...base,
    currentRange: { exists: true, message: "Rango activo cargado.", subtitle: null, lowerPrice: 85000, centerPrice: 92500, upperPrice: 100000, widthPct: 17.6 },
    market: { entryRange: { activeRangeVersionId: "937f406d-3abe-461e-9bfc-6ebfc96ff119", active: true } },
    levels: {
      ...base.levels!,
      entryLevels: base.levels!.entryLevels!.map((e) => ({ ...e, rangeVersionId: "937f406d-3abe-461e-9bfc-6ebfc96ff119" })),
      referenceRungs: base.levels!.referenceRungs!.map((r) => ({ ...r, rangeVersionId: "937f406d-3abe-461e-9bfc-6ebfc96ff119" })),
    },
  };
}

describe("gridLevelLadderViewModel — 30 mandatory cases", () => {
  // 1. Combina BUY y referenceRungs
  it("1: combines entryLevels and referenceRungs into rows", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    expect(vm.rows.length).toBe(4);
    expect(vm.rows.some((r) => r.kind === "BUY_ENTRY")).toBe(true);
    expect(vm.rows.some((r) => r.kind === "REFERENCE_RUNG")).toBe(true);
  });

  // 2. Ordena de mayor a menor precio
  it("2: sorts rows by price descending", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    const prices = vm.rows.map((r) => r.price);
    expect(prices).toEqual([100000, 95000, 90000, 85000]);
  });

  // 3. No separa BUY y SELL en arrays visuales independientes
  it("3: does not separate BUY and SELL into independent visual arrays", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    const kinds = vm.rows.map((r) => r.kind);
    // Should be interleaved by price, not grouped by kind
    expect(kinds).not.toEqual(["BUY_ENTRY", "BUY_ENTRY", "REFERENCE_RUNG", "REFERENCE_RUNG"]);
  });

  // 4. Inserta precio actual una sola vez
  it("4: inserts current price marker exactly once", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    const withMarker = insertCurrentPriceMarker(vm.rows, vm.currentPrice);
    const markers = withMarker.filter((r) => "isMarker" in r && r.isMarker);
    expect(markers.length).toBe(1);
  });

  // 5. Precio actual por encima de todos
  it("5: current price above all levels — marker at top", () => {
    const op = makeOperational();
    op.header = { currentPrice: 110000 };
    const vm = buildGridLevelLadderViewModel(op);
    const withMarker = insertCurrentPriceMarker(vm.rows, vm.currentPrice);
    expect("isMarker" in withMarker[0] && withMarker[0].isMarker).toBe(true);
  });

  // 6. Precio actual entre niveles
  it("6: current price between levels — marker in correct position", () => {
    const op = makeOperational();
    op.header = { currentPrice: 92000 };
    const vm = buildGridLevelLadderViewModel(op);
    const withMarker = insertCurrentPriceMarker(vm.rows, vm.currentPrice);
    const markerIdx = withMarker.findIndex((r) => "isMarker" in r && r.isMarker);
    expect(markerIdx).toBeGreaterThan(0);
    expect(markerIdx).toBeLessThan(withMarker.length - 1);
  });

  // 7. Precio actual por debajo de todos
  it("7: current price below all levels — marker at bottom", () => {
    const op = makeOperational();
    op.header = { currentPrice: 80000 };
    const vm = buildGridLevelLadderViewModel(op);
    const withMarker = insertCurrentPriceMarker(vm.rows, vm.currentPrice);
    const last = withMarker[withMarker.length - 1];
    expect("isMarker" in last && last.isMarker).toBe(true);
  });

  // 8. Precio actual inválido
  it("8: invalid current price — no marker inserted", () => {
    const op = makeOperational();
    op.header = { currentPrice: null };
    const vm = buildGridLevelLadderViewModel(op);
    const withMarker = insertCurrentPriceMarker(vm.rows, vm.currentPrice);
    expect(withMarker.filter((r) => "isMarker" in r && r.isMarker).length).toBe(0);
    expect(vm.warnings.some((w) => w.code === "NO_CURRENT_PRICE")).toBe(true);
  });

  // 9. No cuenta el marcador como nivel
  it("9: marker is not counted as a level", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    const withMarker = insertCurrentPriceMarker(vm.rows, vm.currentPrice);
    const nonMarkerRows = withMarker.filter((r) => !("isMarker" in r && r.isMarker));
    expect(nonMarkerRows.length).toBe(vm.rows.length);
  });

  // 10. Excluye histórico de la escalera actual
  it("10: excludes historical levels from current ladder", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    expect(vm.rows.every((r) => r.rangeRelation === "current")).toBe(true);
  });

  // 11. Mantiene histórico en su colección separada
  it("11: keeps historical levels in separate collection", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    expect(vm.historicalRows.length).toBe(1);
    expect(vm.historicalRows[0].id).toBe("hist-1");
  });

  // 12. No empareja BUY y SELL por cantidad
  it("12: does not pair BUY and SELL by quantity", () => {
    const op = makeOperational();
    // All quantities are 0.01 — if pairing by quantity, we'd see linked cycles
    const vm = buildGridLevelLadderViewModel(op);
    const buyRows = vm.rows.filter((r) => r.kind === "BUY_ENTRY");
    expect(buyRows.every((r) => r.linkedCycles.length === 0)).toBe(true);
  });

  // 13. No empareja BUY y SELL por índice
  it("13: does not pair BUY and SELL by index", () => {
    const op = makeOperational();
    const vm = buildGridLevelLadderViewModel(op);
    const buyRows = vm.rows.filter((r) => r.kind === "BUY_ENTRY");
    expect(buyRows.every((r) => r.cycleId === null)).toBe(true);
  });

  // 14. BUY planned indica target pendiente
  it("14: BUY planned shows target pending explanation", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    const buyRows = vm.rows.filter((r) => r.kind === "BUY_ENTRY");
    expect(buyRows.every((r) => r.explanation.includes("Target definitivo: se asignará después de ejecutar el BUY"))).toBe(true);
  });

  // 15. Asocia ciclo mediante targetRungLevelId
  it("15: associates cycle via targetRungLevelId", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c1",
      cycleNumber: 1,
      targetOwner: "cycle",
      targetSellPrice: 95000,
      targetRungLevelId: "rung-1",
      buyPrice: 90000,
      quantity: 0.01,
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const rung = vm.rows.find((r) => r.levelId === "rung-1");
    expect(rung).toBeDefined();
    expect(rung!.linkedCycles.length).toBe(1);
    expect(rung!.linkedCycles[0].cycleId).toBe("c1");
  });

  // 16. Asocia por targetSellPrice con tolerancia solo cuando no hay ID
  it("16: associates by targetSellPrice with tolerance when no ID", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c2",
      cycleNumber: 2,
      targetOwner: "cycle",
      targetSellPrice: 95000.005,
      targetRungLevelId: null,
      buyPrice: 90000,
      quantity: 0.01,
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const rung = vm.rows.find((r) => r.levelId === "rung-1");
    expect(rung).toBeDefined();
    expect(rung!.linkedCycles.length).toBe(1);
  });

  // 17. No duplica rung cuando tiene ciclo asociado
  it("17: does not duplicate rung when cycle is associated", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c1",
      cycleNumber: 1,
      targetOwner: "cycle",
      targetSellPrice: 95000,
      targetRungLevelId: "rung-1",
      buyPrice: 90000,
      quantity: 0.01,
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const rungRows = vm.rows.filter((r) => r.kind === "REFERENCE_RUNG" && r.levelId === "rung-1");
    expect(rungRows.length).toBe(1);
  });

  // 18. Permite varios ciclos asociados a un mismo rung
  it("18: allows multiple cycles associated to same rung", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [
      { cycleId: "c1", cycleNumber: 1, targetOwner: "cycle", targetSellPrice: 95000, targetRungLevelId: "rung-1", buyPrice: 90000, quantity: 0.01 },
      { cycleId: "c2", cycleNumber: 2, targetOwner: "cycle", targetSellPrice: 95000, targetRungLevelId: "rung-1", buyPrice: 88000, quantity: 0.01 },
    ];
    const vm = buildGridLevelLadderViewModel(op);
    const rung = vm.rows.find((r) => r.levelId === "rung-1");
    expect(rung!.linkedCycles.length).toBe(2);
  });

  // 19. Crea target sintético cuando no hay rung coincidente
  it("19: creates synthetic target when no matching rung", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c3",
      cycleNumber: 3,
      targetOwner: "cycle",
      targetSellPrice: 97000,
      targetRungLevelId: null,
      buyPrice: 90000,
      quantity: 0.01,
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const synth = vm.rows.find((r) => r.kind === "CYCLE_SELL_TARGET" && r.cycleId === "c3");
    expect(synth).toBeDefined();
    expect(synth!.price).toBe(97000);
  });

  // 20. Ordena target sintético por precio
  it("20: synthetic target is sorted by price within ladder", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c3",
      cycleNumber: 3,
      targetOwner: "cycle",
      targetSellPrice: 97000,
      targetRungLevelId: null,
      buyPrice: 90000,
      quantity: 0.01,
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const prices = vm.rows.map((r) => r.price);
    // 97000 should be between 100000 and 95000
    const idx97 = prices.indexOf(97000);
    expect(idx97).toBeGreaterThan(0);
    expect(idx97).toBeLessThan(prices.length - 1);
  });

  // 21. Calcula notional visual cuando falta
  it("21: computes notional when missing", () => {
    const op = makeOperational();
    op.levels!.entryLevels![0].quantity = 0.005;
    const vm = buildGridLevelLadderViewModel(op);
    const buy1 = vm.rows.find((r) => r.levelId === "buy-1");
    expect(buy1!.notionalUsd).toBe(90000 * 0.005);
  });

  // 22. No muta operational
  it("22: does not mutate operational input", () => {
    const op = makeOperational();
    const originalJson = JSON.stringify(op);
    buildGridLevelLadderViewModel(op);
    expect(JSON.stringify(op)).toBe(originalJson);
  });

  // 23. Keys estables y únicas
  it("23: keys are stable and unique", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    const keys = vm.rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Run twice — keys should be identical
    const vm2 = buildGridLevelLadderViewModel(makeOperational());
    expect(vm2.rows.map((r) => r.key)).toEqual(keys);
  });

  // 24. Datos nulos no provocan excepción
  it("24: null data does not throw", () => {
    expect(() => buildGridLevelLadderViewModel(null as any)).not.toThrow();
    expect(() => buildGridLevelLadderViewModel(undefined)).not.toThrow();
    expect(() => buildGridLevelLadderViewModel({})).not.toThrow();
    expect(() => buildGridLevelLadderViewModel({ levels: null, header: null })).not.toThrow();
  });

  // 25. Filtrado Todos
  it("25: filter 'all' returns all rows", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    const filtered = filterAndSearchRows(vm.rows, "all", "");
    expect(filtered.length).toBe(vm.rows.length);
  });

  // 26. Filtrado BUY
  it("26: filter 'buy' returns only BUY_ENTRY rows", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    const filtered = filterAndSearchRows(vm.rows, "buy", "");
    expect(filtered.length).toBe(2);
    expect(filtered.every((r) => r.kind === "BUY_ENTRY")).toBe(true);
  });

  // 27. Filtrado SELL/rungs
  it("27: filter 'sell' returns REFERENCE_RUNG and CYCLE_SELL_TARGET", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c3", cycleNumber: 3, targetOwner: "cycle", targetSellPrice: 97000, buyPrice: 90000, quantity: 0.01,
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const filtered = filterAndSearchRows(vm.rows, "sell", "");
    expect(filtered.length).toBe(3); // 2 rungs + 1 synthetic
    expect(filtered.every((r) => r.kind === "REFERENCE_RUNG" || r.kind === "CYCLE_SELL_TARGET")).toBe(true);
  });

  // 28. Filtrado Con ciclo
  it("28: filter 'withCycle' returns only rows with cycles", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c1", cycleNumber: 1, targetOwner: "cycle", targetSellPrice: 95000, targetRungLevelId: "rung-1", buyPrice: 90000, quantity: 0.01,
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const filtered = filterAndSearchRows(vm.rows, "withCycle", "");
    expect(filtered.length).toBe(1);
    expect(filtered[0].levelId).toBe("rung-1");
  });

  // 29. Búsqueda por ciclo
  it("29: search by cycle number", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c1", cycleNumber: 42, targetOwner: "cycle", targetSellPrice: 95000, targetRungLevelId: "rung-1", buyPrice: 90000, quantity: 0.01,
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const filtered = filterAndSearchRows(vm.rows, "all", "42");
    expect(filtered.length).toBe(1);
    expect(filtered[0].linkedCycles[0].cycleNumber).toBe(42);
  });

  // 30. Búsqueda por precio
  it("30: search by price", () => {
    const vm = buildGridLevelLadderViewModel(makeOperational());
    const filtered = filterAndSearchRows(vm.rows, "all", "95000");
    expect(filtered.length).toBe(1);
    expect(filtered[0].price).toBe(95000);
  });
});

describe("gridLevelLadderViewModel — contract alignment and corrections", () => {
  // 31. Fixture canónico sin currentRange.id
  it("31: canonical fixture does not contain currentRange.id", () => {
    const op = makeCanonicalOperational();
    expect((op.currentRange as any).id).toBeUndefined();
  });

  // 32. activeRangeVersionId se obtiene de market.entryRange
  it("32: activeRangeId resolved from market.entryRange.activeRangeVersionId", () => {
    const op = makeCanonicalOperational();
    const vm = buildGridLevelLadderViewModel(op);
    expect(vm.activeRangeId).toBe("937f406d-3abe-461e-9bfc-6ebfc96ff119");
    expect(vm.activeRangeLabel).toContain("Rango vigente");
    expect(vm.activeRangeLabel).toContain("937f406d");
  });

  // 33. Current range existente sin UUID muestra "Rango vigente"
  it("33: current range exists without UUID shows 'Rango vigente' not 'Sin rango activo'", () => {
    const op = makeOperational();
    op.market = { entryRange: { activeRangeVersionId: null, active: true } };
    op.currentRange = { exists: true };
    op.levels!.entryLevels!.forEach((e) => { e.rangeVersionId = undefined; });
    op.levels!.referenceRungs!.forEach((r) => { r.rangeVersionId = undefined; });
    const vm = buildGridLevelLadderViewModel(op);
    expect(vm.activeRangeLabel).toBe("Rango vigente");
    expect(vm.activeRangeLabel).not.toContain("Sin rango activo");
  });

  // 34. ID de rung incorrecto no cae a coincidencia por precio
  it("34: incorrect targetRungLevelId does not fall back to price match", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c-bad",
      cycleNumber: 99,
      targetOwner: "cycle",
      targetSellPrice: 95000,
      targetRungLevelId: "rung-inexistente",
      buyPrice: 90000,
      quantity: 0.01,
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const rung1 = vm.rows.find((r) => r.levelId === "rung-1");
    expect(rung1).toBeDefined();
    expect(rung1!.linkedCycles.length).toBe(0);
    const synth = vm.rows.find((r) => r.kind === "CYCLE_SELL_TARGET" && r.cycleId === "c-bad");
    expect(synth).toBeDefined();
    expect(vm.warnings.some((w) => w.code === "RUNG_NOT_FOUND")).toBe(true);
  });

  // 35. Ciclo sin ID sí puede asociarse por precio dentro de tolerancia
  it("35: cycle without ID associates by price within tolerance", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c-price",
      cycleNumber: 5,
      targetOwner: "cycle",
      targetSellPrice: 95000.005,
      targetRungLevelId: null,
      buyPrice: 90000,
      quantity: 0.01,
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const rung1 = vm.rows.find((r) => r.levelId === "rung-1");
    expect(rung1).toBeDefined();
    expect(rung1!.linkedCycles.length).toBe(1);
    expect(rung1!.linkedCycles[0].cycleId).toBe("c-price");
  });

  // 36. makerState técnico se humaniza
  it("36: MAKER_PENDING is humanized to 'SELL maker pendiente'", () => {
    expect(humanizeMakerState("MAKER_PENDING")).toBe("SELL maker pendiente");
    expect(humanizeMakerState("maker_pending")).toBe("SELL maker pendiente");
    expect(humanizeMakerState(null)).toBe(null);
    expect(humanizeMakerState("UNKNOWN_STATE")).toBe("UNKNOWN_STATE");
  });

  // 37. Synthetic target humanizes makerState
  it("37: synthetic target row shows humanized makerState", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c-maker",
      cycleNumber: 7,
      targetOwner: "cycle",
      targetSellPrice: 97000,
      targetRungLevelId: null,
      buyPrice: 90000,
      quantity: 0.01,
      makerState: "MAKER_PENDING",
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const synth = vm.rows.find((r) => r.kind === "CYCLE_SELL_TARGET" && r.cycleId === "c-maker");
    expect(synth).toBeDefined();
    expect(synth!.statusLabel).toBe("SELL maker pendiente");
    expect(synth!.statusLabel).not.toBe("MAKER_PENDING");
  });

  // 38. Búsqueda histórica por cycleId
  it("38: historical search by cycleId", () => {
    const op = makeOperational();
    op.levels!.historicalLevels = [
      { id: "h1", side: "BUY", price: 80000, quantity: 0.01, status: "replaced", statusLabel: "Reemplazado", rangeRelation: "previous", cycleId: "cycle-abc", cycleNumber: 3, rangeVersionId: "rv-old" },
      { id: "h2", side: "SELL", price: 81000, quantity: 0.01, status: "replaced", statusLabel: "Reemplazado", rangeRelation: "previous", cycleId: "cycle-xyz", cycleNumber: 4, rangeVersionId: "rv-old" },
    ];
    const vm = buildGridLevelLadderViewModel(op);
    const filtered = searchHistoricalRows(vm.historicalRows, "cycle-abc");
    expect(filtered.length).toBe(1);
    expect(filtered[0].cycleId).toBe("cycle-abc");
  });

  // 39. Búsqueda histórica por rangeVersionId
  it("39: historical search by rangeVersionId", () => {
    const op = makeOperational();
    op.levels!.historicalLevels = [
      { id: "h1", side: "BUY", price: 80000, quantity: 0.01, status: "replaced", statusLabel: "Reemplazado", rangeRelation: "previous", rangeVersionId: "rv-old-111" },
      { id: "h2", side: "SELL", price: 81000, quantity: 0.01, status: "replaced", statusLabel: "Reemplazado", rangeRelation: "previous", rangeVersionId: "rv-old-222" },
    ];
    const vm = buildGridLevelLadderViewModel(op);
    const filtered = searchHistoricalRows(vm.historicalRows, "rv-old-222");
    expect(filtered.length).toBe(1);
    expect(filtered[0].rangeVersionId).toBe("rv-old-222");
  });

  // 40. Búsqueda histórica por precio
  it("40: historical search by price", () => {
    const op = makeOperational();
    op.levels!.historicalLevels = [
      { id: "h1", side: "BUY", price: 80000, quantity: 0.01, status: "replaced", statusLabel: "Reemplazado", rangeRelation: "previous" },
      { id: "h2", side: "SELL", price: 81000, quantity: 0.01, status: "replaced", statusLabel: "Reemplazado", rangeRelation: "previous" },
    ];
    const vm = buildGridLevelLadderViewModel(op);
    const filtered = searchHistoricalRows(vm.historicalRows, "81000");
    expect(filtered.length).toBe(1);
    expect(filtered[0].price).toBe(81000);
  });

  // 41. FALSE_BUY_SELL_PAIRINGS = 0 con ID incorrecto
  it("41: no false buy-sell pairings when targetRungLevelId doesn't match", () => {
    const op = makeOperational();
    op.cycleOwnedExits = [{
      cycleId: "c-bad",
      cycleNumber: 99,
      targetOwner: "cycle",
      targetSellPrice: 95000,
      targetRungLevelId: "rung-inexistente",
      buyPrice: 90000,
      quantity: 0.01,
    }];
    const vm = buildGridLevelLadderViewModel(op);
    const rungsWithCycles = vm.rows.filter((r) => r.kind === "REFERENCE_RUNG" && r.linkedCycles.length > 0);
    expect(rungsWithCycles.length).toBe(0);
  });

  // 42. Refetch con nuevos objetos no duplica filas
  it("42: refetch with new objects does not duplicate rows", () => {
    const op1 = makeOperational();
    const vm1 = buildGridLevelLadderViewModel(op1);
    const op2 = makeOperational();
    const vm2 = buildGridLevelLadderViewModel(op2);
    expect(vm2.rows.length).toBe(vm1.rows.length);
    const keys2 = vm2.rows.map((r) => r.key);
    expect(new Set(keys2).size).toBe(keys2.length);
  });
});

describe("gridLevelLadderViewModel — resolvedRangeId and mixed filtering", () => {
  // 43: vm.activeRangeId returns resolvedRangeId when inferred from levels
  it("43: vm.activeRangeId returns resolvedRangeId when inferred from levels", () => {
    const op = makeOperational();
    op.market = { entryRange: { activeRangeVersionId: null, active: true } };
    op.currentRange = { exists: true };
    op.levels!.entryLevels!.forEach((e) => { e.rangeVersionId = "range-inferred"; e.rangeRelation = "current"; });
    op.levels!.referenceRungs!.forEach((r) => { r.rangeVersionId = "range-inferred"; r.rangeRelation = "current"; });
    const vm = buildGridLevelLadderViewModel(op);
    expect(vm.activeRangeId).toBe("range-inferred");
    expect(vm.activeRangeLabel).toContain("range-in");
    expect(vm.rows.length).toBe(4);
  });

  // 44: inconsistent rangeVersionIds → activeRangeId null, label "Rango vigente"
  it("44: inconsistent current rangeVersionIds → activeRangeId null, label 'Rango vigente'", () => {
    const op = makeOperational();
    op.market = { entryRange: { activeRangeVersionId: null, active: true } };
    op.currentRange = { exists: true };
    op.levels!.entryLevels![0].rangeVersionId = "range-a";
    op.levels!.entryLevels![1].rangeVersionId = "range-b";
    op.levels!.referenceRungs!.forEach((r) => { r.rangeVersionId = "range-a"; });
    op.levels!.entryLevels!.forEach((e) => { e.rangeRelation = "current"; });
    op.levels!.referenceRungs!.forEach((r) => { r.rangeRelation = "current"; });
    const vm = buildGridLevelLadderViewModel(op);
    expect(vm.activeRangeId).toBeNull();
    expect(vm.activeRangeLabel).toBe("Rango vigente");
  });

  // 45: mixed collection — current + no-relation with matching rangeVersionId both included
  it("45: mixed collection — current and no-relation with matching rangeVersionId both included", () => {
    const op = makeOperational();
    op.market = { entryRange: { activeRangeVersionId: "range-uuid-1234", active: true } };
    op.levels!.entryLevels = [
      { id: "buy-1", side: "BUY", price: 90000, quantity: 0.01, status: "planned", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
      { id: "buy-2", side: "BUY", price: 85000, quantity: 0.01, status: "planned", rangeVersionId: "range-uuid-1234" },
    ];
    op.levels!.referenceRungs = [
      { id: "rung-1", side: "SELL", price: 95000, quantity: 0.01, status: "planned", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
      { id: "rung-2", side: "SELL", price: 100000, quantity: 0.01, status: "planned", rangeVersionId: "range-uuid-1234" },
    ];
    const vm = buildGridLevelLadderViewModel(op);
    expect(vm.rows.length).toBe(4);
    expect(vm.rows.some((r) => r.levelId === "buy-1")).toBe(true);
    expect(vm.rows.some((r) => r.levelId === "buy-2")).toBe(true);
  });

  // 46: mixed collection — current included, no-relation with different rangeVersionId excluded
  it("46: mixed collection — current included, no-relation with different rangeVersionId excluded", () => {
    const op = makeOperational();
    op.market = { entryRange: { activeRangeVersionId: "range-uuid-1234", active: true } };
    op.levels!.entryLevels = [
      { id: "buy-1", side: "BUY", price: 90000, quantity: 0.01, status: "planned", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
      { id: "buy-2", side: "BUY", price: 85000, quantity: 0.01, status: "planned", rangeVersionId: "range-other-9999" },
    ];
    op.levels!.referenceRungs = [
      { id: "rung-1", side: "SELL", price: 95000, quantity: 0.01, status: "planned", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
      { id: "rung-2", side: "SELL", price: 100000, quantity: 0.01, status: "planned", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
    ];
    const vm = buildGridLevelLadderViewModel(op);
    expect(vm.rows.some((r) => r.levelId === "buy-1")).toBe(true);
    expect(vm.rows.some((r) => r.levelId === "buy-2")).toBe(false);
  });

  // 47: previous with matching rangeVersionId excluded (explicit rangeRelation has priority)
  it("47: previous with matching rangeVersionId excluded due to explicit rangeRelation", () => {
    const op = makeOperational();
    op.market = { entryRange: { activeRangeVersionId: "range-uuid-1234", active: true } };
    op.levels!.entryLevels = [
      { id: "buy-1", side: "BUY", price: 90000, quantity: 0.01, status: "planned", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
      { id: "buy-2", side: "BUY", price: 85000, quantity: 0.01, status: "planned", rangeRelation: "previous", rangeVersionId: "range-uuid-1234" },
    ];
    op.levels!.referenceRungs = [
      { id: "rung-1", side: "SELL", price: 95000, quantity: 0.01, status: "planned", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
      { id: "rung-2", side: "SELL", price: 100000, quantity: 0.01, status: "planned", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
    ];
    const vm = buildGridLevelLadderViewModel(op);
    expect(vm.rows.some((r) => r.levelId === "buy-1")).toBe(true);
    expect(vm.rows.some((r) => r.levelId === "buy-2")).toBe(false);
  });

  // 48: row without rangeRelation and without rangeVersionId is preserved
  it("48: row without rangeRelation and without rangeVersionId is preserved", () => {
    const op = makeOperational();
    op.market = { entryRange: { activeRangeVersionId: "range-uuid-1234", active: true } };
    op.levels!.entryLevels = [
      { id: "buy-1", side: "BUY", price: 90000, quantity: 0.01, status: "planned", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
      { id: "buy-2", side: "BUY", price: 85000, quantity: 0.01, status: "planned" },
    ];
    op.levels!.referenceRungs = [
      { id: "rung-1", side: "SELL", price: 95000, quantity: 0.01, status: "planned", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
      { id: "rung-2", side: "SELL", price: 100000, quantity: 0.01, status: "planned", rangeRelation: "current", rangeVersionId: "range-uuid-1234" },
    ];
    const vm = buildGridLevelLadderViewModel(op);
    expect(vm.rows.some((r) => r.levelId === "buy-2")).toBe(true);
  });
});
