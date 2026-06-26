import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Tests de regresión visual: verifica que los componentes FISCO no usen
 clases claras (bg-white, bg-gray-100, etc.) y que las traducciones
 * de bloqueos y mensajes técnicos estén en castellano.
 */

const FISCO_COMPONENTS_DIR = join(__dirname, "../../../../client/src/components/fisco");
const FISCO_PAGE = join(__dirname, "../../../../client/src/pages/Fisco.tsx");

function readFile(relPath: string): string {
  return readFileSync(join(FISCO_COMPONENTS_DIR, relPath), "utf-8");
}

describe("Regresión visual FISCO — tema oscuro", () => {
  it("FiscoReportsCenter.tsx no contiene bg-white en subcards", () => {
    const content = readFile("FiscoReportsCenter.tsx");
    const bgWhiteMatches = content.match(/bg-white(?!\/\d)/g);
    // bg-white/5 is ok (hover effect with opacity), bare bg-white is not
    const bareBgWhite = bgWhiteMatches?.filter(m => !m.includes("/")) ?? [];
    expect(bareBgWhite.length).toBe(0);
  });

  it("FiscoReportsCenter.tsx no contiene bg-gray-100 ni bg-slate-100", () => {
    const content = readFile("FiscoReportsCenter.tsx");
    expect(content).not.toContain("bg-gray-100");
    expect(content).not.toContain("bg-slate-100");
  });

  it("FiscoReportsCenter.tsx no contiene bg-green-100, bg-yellow-100, bg-red-100", () => {
    const content = readFile("FiscoReportsCenter.tsx");
    expect(content).not.toContain("bg-green-100");
    expect(content).not.toContain("bg-yellow-100");
    expect(content).not.toContain("bg-red-100");
  });

  it("FiscoReportsCenter.tsx no contiene text-*-700/800 sobre fondos claros", () => {
    const content = readFile("FiscoReportsCenter.tsx");
    expect(content).not.toContain("text-green-700");
    expect(content).not.toContain("text-red-700");
    expect(content).not.toContain("text-yellow-700");
    expect(content).not.toContain("text-green-800");
    expect(content).not.toContain("text-red-800");
    expect(content).not.toContain("text-yellow-800");
  });

  it("FiscoPanelSection.tsx no contiene 'Balance Check' visible", () => {
    const content = readFile("FiscoPanelSection.tsx");
    expect(content).not.toContain(">Balance Check<");
  });

  it("FiscoNav.tsx no contiene 'Balance Check' como label", () => {
    const content = readFile("FiscoNav.tsx");
    expect(content).not.toContain('label: "Balance Check"');
  });

  it("FiscoTransferLinksSection.tsx no contiene 'transfer links' ni 'Transfer Matching'", () => {
    const content = readFile("FiscoTransferLinksSection.tsx");
    expect(content).not.toContain("transfer links");
    expect(content).not.toContain("Transfer Matching");
  });
});

describe("Regresión traducciones FISCO — códigos técnicos en castellano", () => {
  it("fiscoLabels.ts traduce GROSS_GAINS_LOSSES_DIFF_EXCESSIVE", () => {
    const content = readFile("fiscoLabels.ts");
    expect(content).toContain("GROSS_GAINS_LOSSES_DIFF_EXCESSIVE");
    expect(content).toContain("Diferencia bruta excesiva");
  });

  it("fiscoLabels.ts traduce ENGINE_NOT_FULL_V2", () => {
    const content = readFile("fiscoLabels.ts");
    expect(content).toContain("ENGINE_NOT_FULL_V2");
    expect(content).toContain("motor V2 aún no es completo");
  });

  it("fiscoLabels.ts traduce GROSS_DIFF_NOT_TRACEABLE", () => {
    const content = readFile("fiscoLabels.ts");
    expect(content).toContain("GROSS_DIFF_NOT_TRACEABLE");
    expect(content).toContain("no trazable");
  });

  it("fiscoLabels.ts traduce skipFiatDepositsWithdrawals", () => {
    const content = readFile("fiscoLabels.ts");
    expect(content).toContain("skipFiatDepositsWithdrawals");
    expect(content).toContain("depósito fiat EUR");
    expect(content).not.toContain("deposit fiat");
  });

  it("fiscoLabels.ts contiene formatFiscoTechnicalMessage", () => {
    const content = readFile("fiscoLabels.ts");
    expect(content).toContain("formatFiscoTechnicalMessage");
  });
});

describe("Regresión Fisco.tsx — strings visibles", () => {
  it("Fisco.tsx no contiene 'Balance Check' visible", () => {
    const content = readFileSync(FISCO_PAGE, "utf-8");
    // Strip JSX comments before checking
    const stripped = content.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const visibleMatches = stripped.match(/>[^<]*Balance Check[^<]*</g);
    expect(visibleMatches ?? []).toHaveLength(0);
  });

  it("Fisco.tsx no contiene 'Seguro para informe' (debe ser 'Apto')", () => {
    const content = readFileSync(FISCO_PAGE, "utf-8");
    expect(content).not.toContain("Seguro para informe");
  });

  it("Fisco.tsx usa 'Apto para informe en sombra'", () => {
    const content = readFileSync(FISCO_PAGE, "utf-8");
    expect(content).toContain("Apto para informe en sombra");
  });
});
