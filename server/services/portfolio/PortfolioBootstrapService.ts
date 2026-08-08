/**
 * PortfolioBootstrapService — R2.11
 *
 * Modo: READ_ONLY_DISCOVERY
 *
 * Descubre balances físicos y evidencia de inventario por modo
 * desde la base de datos existente. No escribe en el exchange.
 *
 * Atribuye automáticamente únicamente si existe evidencia inequívoca.
 * Si no puede probarse el ownership, atribuye a MANUAL.
 *
 * Genera: artifacts/portfolio-bootstrap-report.json
 */

import { pool } from "../../db";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { portfolioAllocationGuard } from "./PortfolioAllocationGuard";
import type { OperationalMode, AttributionSourceType } from "./portfolioTypes";

const PROJECT_ROOT = process.cwd();

export interface ModeEvidence {
  mode: OperationalMode;
  exchange: string;
  asset: string;
  quantity: number;
  costBasisUsd: number;
  sourceType: AttributionSourceType;
  sourceId: string | null;
  cycleId: string | null;
  trancheId: string | null;
  lotId: string | null;
  evidence: "EXPLICIT" | "INFERRED" | "NONE";
}

export interface ProposedAttribution {
  attributionId: string;
  exchange: string;
  asset: string;
  mode: OperationalMode;
  quantity: number;
  costBasisUsd: number;
  sourceType: AttributionSourceType;
  sourceId: string | null;
  cycleId: string | null;
  trancheId: string | null;
  lotId: string | null;
  reason: string;
}

export interface InventoryReconciliation {
  exchange: string;
  asset: string;
  physicalQuantity: number;
  attributedAMA: number;
  attributedGRID: number;
  attributedIDCA: number;
  attributedTrading: number;
  manualUnassigned: number;
  sumAttributed: number;
  invariant: boolean;
}

export interface BootstrapReport {
  generatedAt: string;
  gitSha: string;
  exchangeBalances: {
    exchange: string;
    balances: Record<string, number>;
    error: string | null;
  }[];
  modeEvidence: ModeEvidence[];
  proposedAttributions: ProposedAttribution[];
  unassigned: { exchange: string; asset: string; quantity: number }[];
  warnings: string[];
  conflicts: string[];
  summary: {
    totalExchanges: number;
    totalAssets: number;
    totalEvidence: number;
    totalProposed: number;
    totalUnassigned: number;
    invariantsPassed: boolean;
  };
}

class PortfolioBootstrapService {

  /**
   * Ejecuta el bootstrap completo en modo READ_ONLY_DISCOVERY.
   * No escribe en el exchange. No crea órdenes.
   */
  async runBootstrap(): Promise<BootstrapReport> {
    const generatedAt = new Date().toISOString();
    const warnings: string[] = [];
    const conflicts: string[] = [];

    // 1. Fetch physical balances
    const exchangeBalances = await portfolioAllocationGuard.fetchAllExchangeBalances();
    const exchangeBalanceReport = exchangeBalances.map((eb) => ({
      exchange: eb.exchange,
      balances: eb.balances,
      error: eb.error,
    }));

    // 2. Gather mode evidence from DB
    const amaEvidence = await this.discoverAmaEvidence();
    const gridEvidence = await this.discoverGridEvidence();
    const idcaEvidence = await this.discoverIdcaEvidence();
    const tradingEvidence = await this.discoverTradingEvidence();
    const allEvidence = [...amaEvidence, ...gridEvidence, ...idcaEvidence, ...tradingEvidence];

    // 3. Build proposed attributions
    const proposedAttributions = this.buildProposedAttributions(allEvidence);

    // 4. Reconcile physical vs attributed
    const reconciliation = this.reconcileInventory(exchangeBalances, allEvidence);

    // 5. Identify unassigned
    const unassigned = reconciliation
      .filter((r) => r.manualUnassigned > 0)
      .map((r) => ({
        exchange: r.exchange,
        asset: r.asset,
        quantity: r.manualUnassigned,
      }));

    // 6. Check invariants
    const invariantsPassed = reconciliation.every((r) => r.invariant);
    if (!invariantsPassed) {
      conflicts.push("Inventory invariant violated: sumAttributed > physicalQuantity for some asset");
    }

    // 7. Warnings
    for (const eb of exchangeBalances) {
      if (eb.error) {
        warnings.push(`Exchange ${eb.exchange} balance fetch error: ${eb.error}`);
      }
    }
    if (allEvidence.length === 0) {
      warnings.push("No mode evidence found — all inventory will be MANUAL");
    }

    // 8. Git SHA
    let gitSha = "unknown";
    try {
      gitSha = execSync("git rev-parse HEAD", { encoding: "utf-8", cwd: PROJECT_ROOT }).trim();
    } catch {}

    const report: BootstrapReport = {
      generatedAt,
      gitSha,
      exchangeBalances: exchangeBalanceReport,
      modeEvidence: allEvidence,
      proposedAttributions,
      unassigned,
      warnings,
      conflicts,
      summary: {
        totalExchanges: exchangeBalances.length,
        totalAssets: new Set(
          exchangeBalances.flatMap((eb) =>
            Object.keys(eb.balances).map((a) => `${eb.exchange}:${a}`),
          ),
        ).size,
        totalEvidence: allEvidence.length,
        totalProposed: proposedAttributions.length,
        totalUnassigned: unassigned.length,
        invariantsPassed,
      },
    };

    // 9. Write artifact
    const artifactsDir = join(PROJECT_ROOT, "artifacts");
    if (!existsSync(artifactsDir)) {
      mkdirSync(artifactsDir, { recursive: true });
    }
    const artifactPath = join(artifactsDir, "portfolio-bootstrap-report.json");
    writeFileSync(artifactPath, JSON.stringify(report, null, 2));
    console.log(`[PortfolioBootstrap] Report written to ${artifactPath}`);

    return report;
  }

  /**
   * Descubre evidencia AMA desde ama_tranche_fill_events.
   * Solo evidencia EXPLICIT: tranche fill ligado a cycle.
   */
  private async discoverAmaEvidence(): Promise<ModeEvidence[]> {
    try {
      const res = await pool.query(
        `SELECT
            tfe.fill_event_id,
            tfe.cycle_id,
            tfe.tranche_id,
            tfe.asset,
            tfe.quantity_filled,
            tfe.executed_price_usd,
            c.exchange
         FROM ama_tranche_fill_events tfe
         JOIN ama_cycles c ON c.cycle_id = tfe.cycle_id
         WHERE tfe.quantity_filled > 0
         ORDER BY tfe.created_at DESC`,
      );

      return res.rows.map((row): ModeEvidence => ({
        mode: "AMA",
        exchange: row.exchange || "revolutx",
        asset: row.asset || "BTC",
        quantity: parseFloat(row.quantity_filled),
        costBasisUsd: parseFloat(row.executed_price_usd || "0") * parseFloat(row.quantity_filled),
        sourceType: "AMA_TRANCHE",
        sourceId: row.fill_event_id,
        cycleId: row.cycle_id,
        trancheId: row.tranche_id,
        lotId: null,
        evidence: "EXPLICIT",
      }));
    } catch {
      return [];
    }
  }

  /**
   * Descubre evidencia GRID desde grid_isolated_cycles.
   * Solo evidencia EXPLICIT: grid fill ligado a range/cycle.
   */
  private async discoverGridEvidence(): Promise<ModeEvidence[]> {
    try {
      const res = await pool.query(
        `SELECT
            cic.id as cycle_id,
            cic.pair,
            cic.buy_fill_qty,
            cic.buy_fill_price,
            cic.exchange
         FROM grid_isolated_cycles cic
         WHERE cic.status IN ('OPEN', 'COMPLETED')
           AND cic.buy_fill_qty > 0`,
      );

      return res.rows.map((row): ModeEvidence => {
        const asset = row.pair?.split("/")[0] || "BTC";
        return {
          mode: "GRID",
          exchange: row.exchange || "revolutx",
          asset,
          quantity: parseFloat(row.buy_fill_qty),
          costBasisUsd: parseFloat(row.buy_fill_price || "0") * parseFloat(row.buy_fill_qty),
          sourceType: "GRID_FILL",
          sourceId: row.cycle_id,
          cycleId: row.cycle_id,
          trancheId: null,
          lotId: null,
          evidence: "EXPLICIT",
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Descubre evidencia IDCA desde institutional_dca_orders.
   * Solo evidencia EXPLICIT: lot/safety order ligado a ciclo.
   */
  private async discoverIdcaEvidence(): Promise<ModeEvidence[]> {
    try {
      const res = await pool.query(
        `SELECT
            o.id as order_id,
            o.cycle_id,
            o.pair,
            o.filled_qty,
            o.avg_fill_price,
            o.exchange
         FROM institutional_dca_orders o
         WHERE o.status = 'FILLED'
           AND o.filled_qty > 0
           AND o.side = 'BUY'`,
      );

      return res.rows.map((row): ModeEvidence => {
        const asset = row.pair?.split("/")[0] || "BTC";
        return {
          mode: "IDCA",
          exchange: row.exchange || "revolutx",
          asset,
          quantity: parseFloat(row.filled_qty),
          costBasisUsd: parseFloat(row.avg_fill_price || "0") * parseFloat(row.filled_qty),
          sourceType: "IDCA_LOT",
          sourceId: String(row.order_id),
          cycleId: String(row.cycle_id),
          trancheId: null,
          lotId: String(row.order_id),
          evidence: "EXPLICIT",
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Descubre evidencia SPOT_NORMAL desde open_positions.
   * Solo evidencia EXPLICIT: trade/position con source mode inequívoco.
   */
  private async discoverTradingEvidence(): Promise<ModeEvidence[]> {
    try {
      const res = await pool.query(
        `SELECT
            op.lot_id,
            op.pair,
            op.quantity,
            op.entry_price,
            op.exchange
         FROM open_positions op
         WHERE op.status = 'OPEN'
           AND op.quantity > 0`,
      );

      return res.rows.map((row): ModeEvidence => {
        const asset = row.pair?.split("/")[0] || "BTC";
        return {
          mode: "SPOT_NORMAL",
          exchange: row.exchange || "kraken",
          asset,
          quantity: parseFloat(row.quantity),
          costBasisUsd: parseFloat(row.entry_price || "0") * parseFloat(row.quantity),
          sourceType: "TRADING_POSITION",
          sourceId: row.lot_id,
          cycleId: null,
          trancheId: null,
          lotId: row.lot_id,
          evidence: "EXPLICIT",
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Construye atribuciones propuestas solo para evidencia EXPLICIT.
   * Si no puede probarse, va a MANUAL.
   */
  private buildProposedAttributions(evidence: ModeEvidence[]): ProposedAttribution[] {
    return evidence
      .filter((e) => e.evidence === "EXPLICIT" && e.quantity > 0)
      .map((e) => ({
        attributionId: `bootstrap-${e.mode}-${e.exchange}-${e.asset}-${e.sourceId}`,
        exchange: e.exchange,
        asset: e.asset,
        mode: e.mode,
        quantity: e.quantity,
        costBasisUsd: e.costBasisUsd,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        cycleId: e.cycleId,
        trancheId: e.trancheId,
        lotId: e.lotId,
        reason: `Explicit evidence: ${e.sourceType} from ${e.mode} cycle ${e.cycleId || "N/A"}`,
      }));
  }

  /**
   * Reconcilia inventario físico vs atribuido por exchange + asset.
   *
   * Por cada exchange + asset:
   *   physicalQuantity
   *   attributedAMA + attributedGRID + attributedIDCA + attributedTrading
   *   manualUnassigned = physical - sumAttributed (nunca negativo)
   */
  private reconcileInventory(
    exchangeBalances: { exchange: string; balances: Record<string, number>; error: string | null }[],
    evidence: ModeEvidence[],
  ): InventoryReconciliation[] {
    const result: InventoryReconciliation[] = [];

    for (const exb of exchangeBalances) {
      if (exb.error) continue;
      for (const [asset, physicalQuantity] of Object.entries(exb.balances)) {
        if (physicalQuantity <= 0) continue;

        let attributedAMA = 0;
        let attributedGRID = 0;
        let attributedIDCA = 0;
        let attributedTrading = 0;

        for (const ev of evidence) {
          if (ev.exchange !== exb.exchange || ev.asset !== asset) continue;
          if (ev.evidence !== "EXPLICIT") continue;
          switch (ev.mode) {
            case "AMA": attributedAMA += ev.quantity; break;
            case "GRID": attributedGRID += ev.quantity; break;
            case "IDCA": attributedIDCA += ev.quantity; break;
            case "SPOT_NORMAL": attributedTrading += ev.quantity; break;
          }
        }

        const sumAttributed = attributedAMA + attributedGRID + attributedIDCA + attributedTrading;
        const manualUnassigned = Math.max(0, physicalQuantity - sumAttributed);
        const invariant = sumAttributed <= physicalQuantity;

        result.push({
          exchange: exb.exchange,
          asset,
          physicalQuantity,
          attributedAMA,
          attributedGRID,
          attributedIDCA,
          attributedTrading,
          manualUnassigned,
          sumAttributed,
          invariant,
        });
      }
    }

    return result;
  }
}

export const portfolioBootstrapService = new PortfolioBootstrapService();
