/**
 * AMA UX Contract Tests — validates Spanish labels and mode translations.
 */

import { describe, it, expect } from "vitest";
import {
  MODE_LABELS,
  CYCLE_STATE_LABELS,
  REAL_STATE_LABELS,
  LAB_STATUS_LABELS,
  REPLAY_STATUS_LABELS,
  SHADOW_STATUS_LABELS,
  TRANCHE_TYPE_LABELS,
  TRANCHE_STATUS_LABELS,
  SLEEVE_LABELS,
  MACRO_ZONE_LABELS,
  DATA_QUALITY_LABELS,
  READINESS_BLOCKER_LABELS,
  translateMode,
  translateCycleState,
  translateRealState,
  translateLabStatus,
  translateReplayStatus,
  translateShadowStatus,
  translateTrancheType,
  translateTrancheStatus,
  translateSleeve,
  translateMacroZone,
  translateDataQuality,
  translateReadinessBlocker,
} from "../../../client/src/components/ama/amaLabels";

describe("AMA UX Contract — Spanish Labels", () => {
  describe("Mode Labels", () => {
    it("translates all 7 modes to Spanish", () => {
      expect(MODE_LABELS.OFF).toBe("Desactivado");
      expect(MODE_LABELS.LAB).toBe("Laboratorio");
      expect(MODE_LABELS.REPLAY).toBe("Reproducción histórica");
      expect(MODE_LABELS.SHADOW_SCENARIO).toBe("Simulación de escenario");
      expect(MODE_LABELS.SHADOW_LIVE).toBe("Simulación en vivo");
      expect(MODE_LABELS.REAL_LIMITED).toBe("Real limitado");
      expect(MODE_LABELS.REAL_FULL).toBe("Real completo — bloqueado");
    });

    it("translateMode returns Spanish for known modes", () => {
      expect(translateMode("OFF")).toBe("Desactivado");
      expect(translateMode("REPLAY")).toBe("Reproducción histórica");
      expect(translateMode("REAL_LIMITED")).toBe("Real limitado");
    });

    it("translateMode returns safe fallback for unknown modes (never a raw enum)", () => {
      expect(translateMode("UNKNOWN")).toBe("Sin clasificar");
    });
  });

  describe("Cycle State Labels", () => {
    it("translates key cycle states to Spanish", () => {
      expect(CYCLE_STATE_LABELS.OBSERVING).toBe("Observando mercado");
      expect(CYCLE_STATE_LABELS.ACCUMULATING).toBe("Acumulando");
      expect(CYCLE_STATE_LABELS.CLOSED).toBe("Ciclo cerrado");
    });

    it("translateCycleState works for known and unknown", () => {
      expect(translateCycleState("OBSERVING")).toBe("Observando mercado");
      expect(translateCycleState("UNKNOWN_STATE")).toBe("Sin clasificar");
    });
  });

  describe("Real State Labels", () => {
    it("translates all real operational states to Spanish", () => {
      expect(REAL_STATE_LABELS.NOT_READY).toBe("No preparado");
      expect(REAL_STATE_LABELS.ARMED).toBe("Armado · esperando señal");
      expect(REAL_STATE_LABELS.ACTIVE).toBe("Operando");
      expect(REAL_STATE_LABELS.KILL_SWITCHED).toBe("Parada de emergencia");
    });

    it("translateRealState works for known and unknown", () => {
      expect(translateRealState("ARMED")).toBe("Armado · esperando señal");
      expect(translateRealState("UNKNOWN")).toBe("Sin clasificar");
    });
  });

  describe("Lab Status Labels", () => {
    it("translates lab statuses to Spanish", () => {
      expect(LAB_STATUS_LABELS.RUNNING).toBe("Ejecutando");
      expect(LAB_STATUS_LABELS.COMPLETED).toBe("Completado");
      expect(LAB_STATUS_LABELS.FAILED).toBe("Error");
    });

    it("translateLabStatus works", () => {
      expect(translateLabStatus("COMPLETED")).toBe("Completado");
      expect(translateLabStatus("UNKNOWN")).toBe("Sin clasificar");
    });
  });

  describe("Replay Status Labels", () => {
    it("translates replay statuses to Spanish", () => {
      expect(REPLAY_STATUS_LABELS.QUEUED).toBe("En cola");
      expect(REPLAY_STATUS_LABELS.RUNNING).toBe("Ejecutando");
      expect(REPLAY_STATUS_LABELS.COMPLETED).toBe("Completado");
    });

    it("translateReplayStatus works", () => {
      expect(translateReplayStatus("COMPLETED")).toBe("Completado");
      expect(translateReplayStatus("UNKNOWN")).toBe("Sin clasificar");
    });
  });

  describe("Shadow Status Labels", () => {
    it("translates shadow statuses to Spanish", () => {
      expect(SHADOW_STATUS_LABELS.ACTIVE).toBe("Activa");
      expect(SHADOW_STATUS_LABELS.CLOSED).toBe("Cerrada");
    });

    it("translateShadowStatus works", () => {
      expect(translateShadowStatus("ACTIVE")).toBe("Activa");
      expect(translateShadowStatus("UNKNOWN")).toBe("Sin clasificar");
    });
  });

  describe("Tranche Labels", () => {
    it("translates tranche types to Spanish", () => {
      expect(TRANCHE_TYPE_LABELS.PROBE).toBe("Sonda");
      expect(TRANCHE_TYPE_LABELS.VALUE).toBe("Valor");
      expect(TRANCHE_TYPE_LABELS.DEEP_VALUE).toBe("Valor profundo");
    });

    it("translates tranche statuses to Spanish", () => {
      expect(TRANCHE_STATUS_LABELS.PLANNED).toBe("Planificado");
      expect(TRANCHE_STATUS_LABELS.EXECUTED).toBe("Ejecutado");
    });

    it("translateTrancheType and translateTrancheStatus work", () => {
      expect(translateTrancheType("PROBE")).toBe("Sonda");
      expect(translateTrancheStatus("EXECUTED")).toBe("Ejecutado");
      expect(translateTrancheType("UNKNOWN")).toBe("Sin clasificar");
    });
  });

  describe("Sleeve Labels", () => {
    it("translates sleeve allocations to Spanish", () => {
      expect(SLEEVE_LABELS.RECOVER_PRINCIPAL).toBe("Recuperar capital");
      expect(SLEEVE_LABELS.DE_RISK).toBe("Reducir riesgo");
    });

    it("translateSleeve works", () => {
      expect(translateSleeve("DE_RISK")).toBe("Reducir riesgo");
      expect(translateSleeve("UNKNOWN")).toBe("Sin clasificar");
    });
  });

  describe("Macro Zone Labels", () => {
    it("translates real backend macro zones to Spanish (MacroZone enum in amaTypes.ts)", () => {
      expect(MACRO_ZONE_LABELS.NORMAL).toBe("Normal");
      expect(MACRO_ZONE_LABELS.RETROCESO).toBe("Retroceso");
      expect(MACRO_ZONE_LABELS.CORRECCION).toBe("Corrección");
      expect(MACRO_ZONE_LABELS.VALUE).toBe("Zona de valor");
      expect(MACRO_ZONE_LABELS.DEEP_VALUE).toBe("Valor profundo");
      expect(MACRO_ZONE_LABELS.CAPITULACION).toBe("Capitulación");
      expect(MACRO_ZONE_LABELS.CAPITULACION_EXTREMA).toBe("Capitulación extrema");
    });

    it("translateMacroZone works for every real backend zone, including DEEP_VALUE", () => {
      expect(translateMacroZone("NORMAL")).toBe("Normal");
      expect(translateMacroZone("DEEP_VALUE")).toBe("Valor profundo");
      expect(translateMacroZone("CAPITULACION_EXTREMA")).toBe("Capitulación extrema");
      expect(translateMacroZone(null)).toBe("Sin clasificar");
    });

    it("translateMacroZone never returns a raw unknown enum", () => {
      expect(translateMacroZone("NON_EXISTENT_ZONE")).toBe("Sin clasificar");
    });
  });

  describe("Data Quality Labels", () => {
    it("translates data quality to Spanish", () => {
      expect(DATA_QUALITY_LABELS.GOOD).toBe("Buena");
      expect(DATA_QUALITY_LABELS.POOR).toBe("Deficiente");
      expect(DATA_QUALITY_LABELS.UNAVAILABLE).toBe("No disponible");
    });

    it("translateDataQuality works", () => {
      expect(translateDataQuality("GOOD")).toBe("Buena");
      expect(translateDataQuality("UNKNOWN")).toBe("No disponible");
    });
  });

  describe("Readiness Blocker Labels", () => {
    it("translates readiness blockers to Spanish", () => {
      expect(READINESS_BLOCKER_LABELS.NO_HIGH_WATER_MARK).toBeDefined();
      expect(READINESS_BLOCKER_LABELS.KILL_SWITCH_ACTIVE).toBeDefined();
      expect(READINESS_BLOCKER_LABELS.NO_MANDATE).toBeDefined();
    });

    it("translateReadinessBlocker works for known and unknown", () => {
      expect(translateReadinessBlocker("NO_MANDATE")).toBeDefined();
      expect(translateReadinessBlocker("UNKNOWN_BLOCKER")).toBe("UNKNOWN_BLOCKER");
    });
  });

  describe("No raw enums in UI labels", () => {
    it("all mode labels contain no underscores", () => {
      for (const [, label] of Object.entries(MODE_LABELS)) {
        expect(label).not.toMatch(/_/);
      }
    });

    it("all cycle state labels contain no underscores", () => {
      for (const [, label] of Object.entries(CYCLE_STATE_LABELS)) {
        expect(label).not.toMatch(/_/);
      }
    });

    it("all real state labels contain no underscores", () => {
      for (const [, label] of Object.entries(REAL_STATE_LABELS)) {
        expect(label).not.toMatch(/_/);
      }
    });
  });
});
