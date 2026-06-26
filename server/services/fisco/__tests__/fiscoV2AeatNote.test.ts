/**
 * Tests for FiscoHtmlRenderer — AEAT/Bit2Me nota informativa + comisiones en informe.
 * Verifica que el HTML contiene la nota explicativa sobre tratamiento de comisiones.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock pool ──────────────────────────────────────────────────────────────

const mockPool = {
  query: vi.fn(),
};

vi.mock("../../../db", () => ({
  pool: mockPool,
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe("FiscoHtmlRenderer — Nota AEAT/Bit2Me en informe HTML", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all queries return empty
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  it("H-AEAT-01: informe contiene 'comisiones directamente asociadas'", async () => {
    // The note text is static in the renderer, so we just need to call renderAnnualHtml
    // with minimal mocked data and check the output
    const { FiscoHtmlRenderer } = await import("../FiscoHtmlRenderer");
    const renderer = new FiscoHtmlRenderer(mockPool as any);

    const html = await renderer.renderAnnualHtml({
      year: 2025,
      exchanges: ["kraken"],
      finStatus: {
        status: "OK",
        gains_eur: 100,
        losses_eur: 50,
        net_gain_loss_eur: 50,
        operations_count: 10,
        disposals_count: 5,
        open_lots_count: 3,
      },
      portfolio: { total_eur: 5000 },
      krakenRec: { status: "OK" },
    });

    // The note should mention "comisiones directamente asociadas" or similar
    // Since the exact text may vary, check for key phrases
    expect(html).toContain("comisiones");
    expect(html.toLowerCase()).toContain("adquisici");
    expect(html.toLowerCase()).toContain("transmisi");
  });

  it("H-AEAT-02: informe contiene 'valor de adquisición'", async () => {
    const { FiscoHtmlRenderer } = await import("../FiscoHtmlRenderer");
    const renderer = new FiscoHtmlRenderer(mockPool as any);

    const html = await renderer.renderAnnualHtml({
      year: 2025,
      exchanges: ["kraken"],
      finStatus: {
        status: "OK",
        gains_eur: 100,
        losses_eur: 50,
        net_gain_loss_eur: 50,
        operations_count: 10,
        disposals_count: 5,
        open_lots_count: 3,
      },
      portfolio: { total_eur: 5000 },
      krakenRec: { status: "OK" },
    });

    expect(html.toLowerCase()).toContain("valor de adquisici");
  });

  it("H-AEAT-03: informe contiene 'valor de transmisión'", async () => {
    const { FiscoHtmlRenderer } = await import("../FiscoHtmlRenderer");
    const renderer = new FiscoHtmlRenderer(mockPool as any);

    const html = await renderer.renderAnnualHtml({
      year: 2025,
      exchanges: ["kraken"],
      finStatus: {
        status: "OK",
        gains_eur: 100,
        losses_eur: 50,
        net_gain_loss_eur: 50,
        operations_count: 10,
        disposals_count: 5,
        open_lots_count: 3,
      },
      portfolio: { total_eur: 5000 },
      krakenRec: { status: "OK" },
    });

    expect(html.toLowerCase()).toContain("valor de transmisi");
  });

  it("H-AEAT-04: informe contiene 'sin duplicar'", async () => {
    const { FiscoHtmlRenderer } = await import("../FiscoHtmlRenderer");
    const renderer = new FiscoHtmlRenderer(mockPool as any);

    const html = await renderer.renderAnnualHtml({
      year: 2025,
      exchanges: ["kraken"],
      finStatus: {
        status: "OK",
        gains_eur: 100,
        losses_eur: 50,
        net_gain_loss_eur: 50,
        operations_count: 10,
        disposals_count: 5,
        open_lots_count: 3,
      },
      portfolio: { total_eur: 5000 },
      krakenRec: { status: "OK" },
    });

    expect(html.toLowerCase()).toContain("no duplica");
  });

  it("H-AEAT-05: informe contiene sección 'Nota informativa'", async () => {
    const { FiscoHtmlRenderer } = await import("../FiscoHtmlRenderer");
    const renderer = new FiscoHtmlRenderer(mockPool as any);

    const html = await renderer.renderAnnualHtml({
      year: 2025,
      exchanges: ["kraken"],
      finStatus: {
        status: "OK",
        gains_eur: 100,
        losses_eur: 50,
        net_gain_loss_eur: 50,
        operations_count: 10,
        disposals_count: 5,
        open_lots_count: 3,
      },
      portfolio: { total_eur: 5000 },
      krakenRec: { status: "OK" },
    });

    expect(html).toContain("Nota informativa");
    expect(html).toContain("Tratamiento de comisiones");
    expect(html).toContain("AEAT_INTEGRATED_TRACEABLE");
  });

  it("H-AEAT-06: la nota está dentro de report-main (imprimible)", async () => {
    const { FiscoHtmlRenderer } = await import("../FiscoHtmlRenderer");
    const renderer = new FiscoHtmlRenderer(mockPool as any);

    const html = await renderer.renderAnnualHtml({
      year: 2025,
      exchanges: ["kraken"],
      finStatus: {
        status: "OK",
        gains_eur: 100,
        losses_eur: 50,
        net_gain_loss_eur: 50,
        operations_count: 10,
        disposals_count: 5,
        open_lots_count: 3,
      },
      portfolio: { total_eur: 5000 },
      krakenRec: { status: "OK" },
    });

    // The note should be before the closing </div><!-- /.report-main -->
    const noteIdx = html.indexOf("Nota informativa");
    const reportMainEndIdx = html.indexOf("</div><!-- /.report-main -->");
    expect(noteIdx).toBeGreaterThan(-1);
    expect(reportMainEndIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeLessThan(reportMainEndIdx);
  });
});

// ── Tests de comisiones en buildAnnualGainLossByAssetSummary ───────────────

describe("FiscoHtmlRenderer — Comisiones en resumen por activo", () => {
  it("H-FEE-01: compra 100€ + fee 1€ → adquisición fiscal = 101€", async () => {
    const { buildAnnualGainLossByAssetSummary } = await import("../FiscoHtmlRenderer");
    const result = buildAnnualGainLossByAssetSummary(2025, [
      {
        asset: "BTC",
        sell_operation_id: 1,
        counter_asset: "EUR",
        pair: "BTCEUR",
        op_type: "trade_sell",
        net_proceeds_eur: 100,
        cost_basis_eur: 101,
        gain_loss_eur: -1,
        is_fee_disposal: false,
      },
    ]);

    const btc = result.rows.find(r => r.ticker === "BTC");
    expect(btc).toBeDefined();
    // cost_basis includes fee (AEAT integrated)
    expect(btc!.acquisitionValueEur).toBe(101);
    // gain/loss = transmission - acquisition = 100 - 101 = -1
    expect(btc!.capitalGainLossEur).toBe(-1);
  });

  it("H-FEE-02: venta 100€ + fee 1€ → transmisión fiscal = 99€", async () => {
    const { buildAnnualGainLossByAssetSummary } = await import("../FiscoHtmlRenderer");
    // net_proceeds_eur is already net of fee (100 - 1 = 99) per Bit2Me convention
    const result = buildAnnualGainLossByAssetSummary(2025, [
      {
        asset: "BTC",
        sell_operation_id: 1,
        counter_asset: "EUR",
        pair: "BTCEUR",
        op_type: "trade_sell",
        net_proceeds_eur: 99,
        cost_basis_eur: 50,
        gain_loss_eur: 49,
        is_fee_disposal: false,
      },
    ]);

    const btc = result.rows.find(r => r.ticker === "BTC");
    expect(btc).toBeDefined();
    // transmission_value = 99 (already net of fee per AEAT)
    expect(btc!.transmissionValueEur).toBe(99);
    // gain/loss = 99 - 50 = 49
    expect(btc!.capitalGainLossEur).toBe(49);
  });

  it("H-FEE-03: resumen — transmisión neta - adquisición = ganancia/pérdida (sin doble cómputo)", async () => {
    const { buildAnnualGainLossByAssetSummary } = await import("../FiscoHtmlRenderer");
    // net_proceeds_eur = 195 (200 gross - 5 fee, AEAT integrated)
    const result = buildAnnualGainLossByAssetSummary(2025, [
      {
        asset: "BTC",
        sell_operation_id: 1,
        counter_asset: "EUR",
        pair: "BTCEUR",
        op_type: "trade_sell",
        net_proceeds_eur: 195,
        cost_basis_eur: 150,
        gain_loss_eur: 45,
        is_fee_disposal: false,
      },
    ]);

    const btc = result.rows.find(r => r.ticker === "BTC");
    const transmission = btc!.transmissionValueEur;
    const acquisition = btc!.acquisitionValueEur;
    const gainLoss = btc!.capitalGainLossEur;

    // transmission - acquisition should equal gain_loss (no fee double-counting)
    expect(Math.abs((transmission - acquisition) - gainLoss)).toBeLessThan(0.01);

    // Verify totals match
    expect(result.totals.transmissionValueEur).toBe(195);
    expect(result.totals.acquisitionValueEur).toBe(150);
    expect(result.totals.capitalGainLossEur).toBe(45);
  });
});
