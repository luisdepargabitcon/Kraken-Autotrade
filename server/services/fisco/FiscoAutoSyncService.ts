/**
 * FiscoAutoSyncService — Daily automatic FISCO synchronization with retry logic
 *
 * Flow:
 *   1. At 00:00 Europe/Madrid: sync operations → dry_run → (if safe) commit → validate → Telegram
 *   2. If no new operations: send Telegram "no changes" with light validation
 *   3. If new operations: send Telegram with breakdown by exchange/type
 *   4. If sync fails: retry at 00:15, 01:00, 03:00, 06:00
 *   5. If all retries fail: send Telegram "manual review required"
 *
 * Auto-commit conditions:
 *   - critical_errors = 0
 *   - isSafeForReport = true
 *   - stablecoin_anomalies = []
 *   - no FIFO negative
 *   - portfolio_status not blocking
 *   - finalization-status finalizable
 *   - no new conservative disposals pending manual review
 *   - no missing essential exchange data
 *
 * Retry schedule:
 *   - Attempt 1: 00:00
 *   - Retry 1: 00:15
 *   - Retry 2: 01:00
 *   - Retry 3: 03:00
 *   - Retry 4: 06:00
 */

import { pool } from "../../db";
import { FiscoRebuildService, type RebuildResult, type RebuildMode } from "../FiscoRebuildService";
import { FiscoValidationService, type FinalizationStatus, type PortfolioValidationResult } from "./FiscoValidationService";
import { KrakenReconciliationService } from "./KrakenReconciliationService";
import { randomUUID } from "crypto";
import { environment } from "../environment";
import { telegramService } from "../telegram";
import {
  buildFiscoAutoSyncSuccessHTML,
  buildFiscoAutoSyncNoChangesHTML,
  buildFiscoAutoSyncWarningsHTML,
  buildFiscoAutoSyncErrorHTML,
  buildFiscoAutoSyncAllFailedHTML,
} from "../telegram/templates";
import {
  validateContext,
  FiscoAutoSyncSuccessContextSchema,
  FiscoAutoSyncNoChangesContextSchema,
  FiscoAutoSyncWarningsContextSchema,
  FiscoAutoSyncErrorContextSchema,
  FiscoAutoSyncAllFailedContextSchema,
} from "../telegram/types";

// ============================================================
// Types
// ============================================================

export type AutoSyncStatus = "pending" | "running" | "success" | "success_with_warnings" | "failed" | "skipped_no_changes";

export interface AutoSyncJob {
  id: number;
  scheduled_for: Date;
  started_at: Date | null;
  completed_at: Date | null;
  timezone: string;
  attempt_number: number;
  max_attempts: number;
  status: AutoSyncStatus;
  exchanges_synced: string[] | null;
  new_operations_count: number;
  new_operations_by_exchange: Record<string, { total: number; buys: number; sells: number; others: number }> | null;
  dry_run_id: number | null;
  commit_run_id: number | null;
  finalization_status: FinalizationStatus | null;
  portfolio_status: PortfolioValidationResult | null;
  warnings: any[] | null;
  error_message: string | null;
  telegram_sent: boolean;
  telegram_message_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface AutoSyncResult {
  jobId: number;
  status: AutoSyncStatus;
  newOperationsCount: number;
  dryRunResult: RebuildResult | null;
  commitResult: RebuildResult | null;
  finalizationStatus: FinalizationStatus | null;
  portfolioStatus: PortfolioValidationResult | null;
  warnings: string[];
  error?: string;
  telegramSent: boolean;
  nextRetryAt: Date | null;
}

export interface AutoSyncOptions {
  year?: number;
  timezone?: string;
  forceSync?: boolean; // Skip "no new operations" check
}

// ============================================================
// Retry schedule
// ============================================================

const RETRY_SCHEDULE_MINUTES = [0, 15, 60, 180, 360]; // 00:00, 00:15, 01:00, 03:00, 06:00

// ============================================================
// FiscoAutoSyncService
// ============================================================

export class FiscoAutoSyncService {
  private static instance: FiscoAutoSyncService;

  public static getInstance(): FiscoAutoSyncService {
    if (!FiscoAutoSyncService.instance) {
      FiscoAutoSyncService.instance = new FiscoAutoSyncService();
    }
    return FiscoAutoSyncService.instance;
  }

  // ============================================================
  // Public entrypoint
  // ============================================================

  /**
   * Run auto-sync for a specific date (typically called by scheduler)
   */
  async runAutoSync(options: AutoSyncOptions = {}): Promise<AutoSyncResult> {
    const { year = new Date().getFullYear(), timezone = "Europe/Madrid", forceSync = false } = options;
    const now = new Date();
    const scheduledFor = this.getScheduledTimeForTimezone(now, timezone);

    console.log(`[fisco/auto-sync] Starting auto-sync for year=${year} timezone=${timezone} scheduled=${scheduledFor.toISOString()}`);

    // Check if there's already a pending/running job for this day
    const existingJob = await this.getJobForDate(scheduledFor, timezone);
    if (existingJob && (existingJob.status === "running" || existingJob.status === "pending")) {
      console.log(`[fisco/auto-sync] Job already running/pending for this day: ${existingJob.id}`);
      return {
        jobId: existingJob.id,
        status: existingJob.status,
        newOperationsCount: existingJob.new_operations_count,
        dryRunResult: null,
        commitResult: null,
        finalizationStatus: existingJob.finalization_status,
        portfolioStatus: existingJob.portfolio_status,
        warnings: existingJob.warnings || [],
        error: "Job already running",
        telegramSent: existingJob.telegram_sent,
        nextRetryAt: null,
      };
    }

    // Create new job record
    const jobId = await this.createJob(scheduledFor, timezone, 1, 5);

    // Declare outside try block for error handling
    let newOpsCount = 0;
    let newOpsByExchange: Record<string, { total: number; buys: number; sells: number; others: number }> = {};

    try {
      await this.updateJob(jobId, { status: "running", started_at: now });

      // Step 1: Check for new operations (unless forceSync)
      if (!forceSync) {
        const newOpsCheck = await this.checkForNewOperations(year);
        newOpsCount = newOpsCheck.total;
        newOpsByExchange = newOpsCheck.byExchange;

        if (newOpsCount === 0) {
          console.log(`[fisco/auto-sync] No new operations detected`);
          await this.updateJob(jobId, {
            status: "skipped_no_changes",
            completed_at: new Date(),
            new_operations_count: 0,
            new_operations_by_exchange: newOpsByExchange,
          });

          // Light validation to confirm FISCO still OK
          const validation = await this.runLightValidation(year);
          await this.updateJob(jobId, {
            finalization_status: validation.finalization,
            portfolio_status: validation.portfolio,
          });

          // Send Telegram "no changes"
          await this.sendTelegramNoChanges(year, validation.finalization, validation.portfolio, jobId);

          await this.updateJob(jobId, { telegram_sent: true });

          return {
            jobId,
            status: "skipped_no_changes",
            newOperationsCount: 0,
            dryRunResult: null,
            commitResult: null,
            finalizationStatus: validation.finalization,
            portfolioStatus: validation.portfolio,
            warnings: [],
            telegramSent: true,
            nextRetryAt: null,
          };
        }
      }

      console.log(`[fisco/auto-sync] ${newOpsCount} new operations detected`);

      // Step 2: Run dry_run
      const rebuildService = FiscoRebuildService.getInstance();
      const dryRunResult = await rebuildService.rebuild({
        mode: "dry_run",
        triggeredBy: "auto-sync",
        fullSync: true,
      });

      await this.updateJob(jobId, {
        dry_run_id: dryRunResult.runId ? parseInt(dryRunResult.runId.replace(/-/g, "").substring(0, 8), 16) : null,
        new_operations_count: newOpsCount,
        new_operations_by_exchange: newOpsByExchange,
        warnings: dryRunResult.warnings as any[],
      });

      // Step 3: Check if safe for auto-commit
      const isSafeForAutoCommit = this.isSafeForAutoCommit(dryRunResult);

      if (!isSafeForAutoCommit) {
        console.log(`[fisco/auto-sync] Not safe for auto-commit: ${dryRunResult.criticalErrors.length} critical errors`);
        await this.updateJob(jobId, {
          status: "failed",
          completed_at: new Date(),
          error_message: `Not safe for auto-commit: ${dryRunResult.criticalErrors.length} critical errors`,
        });

        // Send Telegram error with retry info
        const nextRetryAt = this.calculateNextRetry(1);
        await this.sendTelegramError(year, 1, 5, "Not safe for auto-commit", nextRetryAt, jobId);

        await this.updateJob(jobId, { telegram_sent: true });

        return {
          jobId,
          status: "failed",
          newOperationsCount: newOpsCount,
          dryRunResult,
          commitResult: null,
          finalizationStatus: null,
          portfolioStatus: null,
          warnings: dryRunResult.warnings,
          error: "Not safe for auto-commit",
          telegramSent: true,
          nextRetryAt,
        };
      }

      // Step 4: Run commit
      const commitResult = await rebuildService.rebuild({
        mode: "commit",
        triggeredBy: "auto-sync",
        fullSync: true,
      });

      await this.updateJob(jobId, {
        commit_run_id: commitResult.runId ? parseInt(commitResult.runId.replace(/-/g, "").substring(0, 8), 16) : null,
      });

      // Step 5: Run full validation
      const validation = await this.runFullValidation(year);
      await this.updateJob(jobId, {
        finalization_status: validation.finalization,
        portfolio_status: validation.portfolio,
      });

      // Step 6: Determine final status
      const hasWarnings = dryRunResult.warnings.length > 0 || validation.finalization.warnings.length > 0;
      const finalStatus: AutoSyncStatus = hasWarnings ? "success_with_warnings" : "success";

      await this.updateJob(jobId, {
        status: finalStatus,
        completed_at: new Date(),
        warnings: [...dryRunResult.warnings, ...validation.finalization.warnings],
      });

      // Step 7: Send Telegram
      if (hasWarnings) {
        await this.sendTelegramWithWarnings(year, newOpsCount, newOpsByExchange, validation.finalization, dryRunResult.warnings, jobId);
      } else {
        await this.sendTelegramSuccess(year, newOpsCount, newOpsByExchange, validation.finalization, jobId);
      }

      await this.updateJob(jobId, { telegram_sent: true });

      return {
        jobId,
        status: finalStatus,
        newOperationsCount: newOpsCount,
        dryRunResult,
        commitResult,
        finalizationStatus: validation.finalization,
        portfolioStatus: validation.portfolio,
        warnings: [...dryRunResult.warnings, ...validation.finalization.warnings] as string[],
        telegramSent: true,
        nextRetryAt: null,
      };

    } catch (error: any) {
      console.error(`[fisco/auto-sync] Error:`, error);
      await this.updateJob(jobId, {
        status: "failed",
        completed_at: new Date(),
        error_message: error.message,
      });

      // Schedule retry
      const nextRetryAt = this.calculateNextRetry(1);
      await this.sendTelegramError(year, 1, 5, error.message, nextRetryAt, jobId);
      await this.updateJob(jobId, { telegram_sent: true });

      return {
        jobId,
        status: "failed",
        newOperationsCount: 0,
        dryRunResult: null,
        commitResult: null,
        finalizationStatus: null,
        portfolioStatus: null,
        warnings: [],
        error: error.message,
        telegramSent: true,
        nextRetryAt,
      };
    }
  }

  /**
   * Retry a failed job
   */
  async retryFailedJob(jobId: number): Promise<AutoSyncResult> {
    const job = await this.getJobById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== "failed") {
      throw new Error(`Job ${jobId} is not in failed status`);
    }

    const nextAttempt = job.attempt_number + 1;
    if (nextAttempt > job.max_attempts) {
      throw new Error(`Job ${jobId} has exceeded max attempts (${job.max_attempts})`);
    }

    const year = new Date(job.scheduled_for).getFullYear();
    const now = new Date();
    const scheduledFor = this.getScheduledTimeForTimezone(now, job.timezone);

    // Create new job record for retry
    const newJobId = await this.createJob(scheduledFor, job.timezone, nextAttempt, job.max_attempts);

    try {
      await this.updateJob(newJobId, { status: "running", started_at: now });

      // Run dry_run
      const rebuildService = FiscoRebuildService.getInstance();
      const dryRunResult = await rebuildService.rebuild({
        mode: "dry_run",
        triggeredBy: "auto-sync-retry",
        fullSync: true,
      });

      await this.updateJob(newJobId, {
        dry_run_id: dryRunResult.runId ? parseInt(dryRunResult.runId.replace(/-/g, "").substring(0, 8), 16) : null,
        warnings: dryRunResult.warnings,
      });

      // Check if safe for auto-commit
      const isSafeForAutoCommit = this.isSafeForAutoCommit(dryRunResult);

      if (!isSafeForAutoCommit) {
        await this.updateJob(newJobId, {
          status: "failed",
          completed_at: new Date(),
          error_message: `Not safe for auto-commit: ${dryRunResult.criticalErrors.length} critical errors`,
        });

        const nextRetryAt = this.calculateNextRetry(nextAttempt);
        if (nextRetryAt) {
          await this.sendTelegramError(year, nextAttempt, job.max_attempts, "Not safe for auto-commit", nextRetryAt, newJobId);
        } else {
          await this.sendTelegramAllFailed(year, nextAttempt, job.max_attempts, newJobId);
        }

        await this.updateJob(newJobId, { telegram_sent: true });

        return {
          jobId: newJobId,
          status: "failed",
          newOperationsCount: 0,
          dryRunResult,
          commitResult: null,
          finalizationStatus: null,
          portfolioStatus: null,
          warnings: dryRunResult.warnings,
          error: "Not safe for auto-commit",
          telegramSent: true,
          nextRetryAt,
        };
      }

      // Run commit
      const commitResult = await rebuildService.rebuild({
        mode: "commit",
        triggeredBy: "auto-sync-retry",
        fullSync: true,
      });

      await this.updateJob(newJobId, {
        commit_run_id: commitResult.runId ? parseInt(commitResult.runId.replace(/-/g, "").substring(0, 8), 16) : null,
      });

      // Run validation
      const validation = await this.runFullValidation(year);
      await this.updateJob(newJobId, {
        finalization_status: validation.finalization,
        portfolio_status: validation.portfolio,
      });

      const hasWarnings = dryRunResult.warnings.length > 0 || validation.finalization.warnings.length > 0;
      const finalStatus: AutoSyncStatus = hasWarnings ? "success_with_warnings" : "success";

      await this.updateJob(newJobId, {
        status: finalStatus,
        completed_at: new Date(),
        warnings: [...dryRunResult.warnings, ...validation.finalization.warnings],
      });

      await this.sendTelegramSuccess(year, 0, {}, validation.finalization, newJobId);
      await this.updateJob(newJobId, { telegram_sent: true });

      return {
        jobId: newJobId,
        status: finalStatus,
        newOperationsCount: 0,
        dryRunResult,
        commitResult,
        finalizationStatus: validation.finalization,
        portfolioStatus: validation.portfolio,
        warnings: [...dryRunResult.warnings, ...validation.finalization.warnings] as string[],
        telegramSent: true,
        nextRetryAt: null,
      };

    } catch (error: any) {
      console.error(`[fisco/auto-sync] Retry error:`, error);
      await this.updateJob(newJobId, {
        status: "failed",
        completed_at: new Date(),
        error_message: error.message,
      });

      const nextRetryAt = this.calculateNextRetry(nextAttempt);
      if (nextRetryAt) {
        await this.sendTelegramError(year, nextAttempt, job.max_attempts, error.message, nextRetryAt, newJobId);
      } else {
        await this.sendTelegramAllFailed(year, nextAttempt, job.max_attempts, newJobId);
      }

      await this.updateJob(newJobId, { telegram_sent: true });

      return {
        jobId: newJobId,
        status: "failed",
        newOperationsCount: 0,
        dryRunResult: null,
        commitResult: null,
        finalizationStatus: null,
        portfolioStatus: null,
        warnings: [],
        error: error.message,
        telegramSent: true,
        nextRetryAt,
      };
    }
  }

  // ============================================================
  // DB operations
  // ============================================================

  private async createJob(scheduledFor: Date, timezone: string, attemptNumber: number, maxAttempts: number): Promise<number> {
    const result = await pool.query(
      `INSERT INTO fisco_auto_sync_jobs (scheduled_for, timezone, attempt_number, max_attempts, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [scheduledFor, timezone, attemptNumber, maxAttempts]
    );
    return result.rows[0].id;
  }

  private async updateJob(jobId: number, updates: Partial<AutoSyncJob>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        fields.push(`${this.snakeCase(key)} = $${idx}`);
        values.push(value);
        idx++;
      }
    }

    if (fields.length === 0) return;

    values.push(jobId);
    await pool.query(
      `UPDATE fisco_auto_sync_jobs SET ${fields.join(", ")} WHERE id = $${idx}`,
      values
    );
  }

  async getJobById(jobId: number): Promise<AutoSyncJob | null> {
    const result = await pool.query(
      `SELECT * FROM fisco_auto_sync_jobs WHERE id = $1`,
      [jobId]
    );
    return result.rows[0] ? this.mapRowToJob(result.rows[0]) : null;
  }

  async getJobForDate(date: Date, timezone: string): Promise<AutoSyncJob | null> {
    const result = await pool.query(
      `SELECT * FROM fisco_auto_sync_jobs
       WHERE DATE(scheduled_for AT TIME ZONE $1) = DATE($2 AT TIME ZONE $1)
       AND timezone = $1
       AND status IN ('pending', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
      [timezone, date]
    );
    return result.rows[0] ? this.mapRowToJob(result.rows[0]) : null;
  }

  async getLatestJobs(limit: number = 10): Promise<AutoSyncJob[]> {
    const result = await pool.query(
      `SELECT * FROM fisco_auto_sync_jobs
       ORDER BY scheduled_for DESC, created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map(this.mapRowToJob);
  }

  async getStatus(): Promise<{
    lastJob: AutoSyncJob | null;
    nextScheduled: Date | null;
    nextRetry: Date | null;
  }> {
    const lastJobResult = await pool.query(
      `SELECT * FROM fisco_auto_sync_jobs
       ORDER BY scheduled_for DESC, created_at DESC
       LIMIT 1`
    );
    const lastJob = lastJobResult.rows[0] ? this.mapRowToJob(lastJobResult.rows[0]) : null;

    // Calculate next scheduled (00:00 tomorrow in Europe/Madrid)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const nextScheduled = tomorrow;

    // Calculate next retry if there's a failed job
    let nextRetry: Date | null = null;
    if (lastJob && lastJob.status === "failed" && lastJob.attempt_number < lastJob.max_attempts) {
      nextRetry = this.calculateNextRetry(lastJob.attempt_number);
    }

    return { lastJob, nextScheduled, nextRetry };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private snakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  private mapRowToJob(row: any): AutoSyncJob {
    return {
      id: row.id,
      scheduled_for: row.scheduled_for,
      started_at: row.started_at,
      completed_at: row.completed_at,
      timezone: row.timezone,
      attempt_number: row.attempt_number,
      max_attempts: row.max_attempts,
      status: row.status,
      exchanges_synced: row.exchanges_synced,
      new_operations_count: row.new_operations_count,
      new_operations_by_exchange: row.new_operations_by_exchange,
      dry_run_id: row.dry_run_id,
      commit_run_id: row.commit_run_id,
      finalization_status: row.finalization_status,
      portfolio_status: row.portfolio_status,
      warnings: row.warnings,
      error_message: row.error_message,
      telegram_sent: row.telegram_sent,
      telegram_message_id: row.telegram_message_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private getScheduledTimeForTimezone(date: Date, timezone: string): Date {
    // Convert to target timezone and set to 00:00
    const targetDate = new Date(date.toLocaleString("en-US", { timeZone: timezone }));
    targetDate.setHours(0, 0, 0, 0);
    return targetDate;
  }

  private calculateNextRetry(attemptNumber: number): Date | null {
    if (attemptNumber >= RETRY_SCHEDULE_MINUTES.length) {
      return null;
    }
    const now = new Date();
    const nextRetryMinutes = RETRY_SCHEDULE_MINUTES[attemptNumber];
    const nextRetry = new Date(now.getTime() + nextRetryMinutes * 60 * 1000);
    return nextRetry;
  }

  private isSafeForAutoCommit(dryRunResult: RebuildResult): boolean {
    return (
      dryRunResult.criticalErrorsCount === 0 &&
      dryRunResult.isSafeForReport === true
    );
  }

  private async checkForNewOperations(year: number): Promise<{
    total: number;
    byExchange: Record<string, { total: number; buys: number; sells: number; others: number }>;
  }> {
    // Check last sync timestamp
    const lastSyncResult = await pool.query(
      `SELECT MAX(created_at) as last_sync FROM fisco_operations`
    );
    const lastSync = lastSyncResult.rows[0]?.last_sync;

    if (!lastSync) {
      // First sync ever - assume there are operations
      return { total: 1, byExchange: { kraken: { total: 1, buys: 0, sells: 0, others: 1 } } };
    }

    // Count operations added since last sync
    const result = await pool.query(
      `SELECT
         exchange,
         COUNT(*) as total,
         SUM(CASE WHEN op_type = 'trade_buy' THEN 1 ELSE 0 END) as buys,
         SUM(CASE WHEN op_type = 'trade_sell' THEN 1 ELSE 0 END) as sells,
         SUM(CASE WHEN op_type NOT IN ('trade_buy', 'trade_sell') THEN 1 ELSE 0 END) as others
       FROM fisco_operations
       WHERE created_at > $1
       GROUP BY exchange`,
      [lastSync]
    );

    const byExchange: Record<string, { total: number; buys: number; sells: number; others: number }> = {};
    let total = 0;

    for (const row of result.rows) {
      byExchange[row.exchange] = {
        total: parseInt(row.total),
        buys: parseInt(row.buys),
        sells: parseInt(row.sells),
        others: parseInt(row.others),
      };
      total += parseInt(row.total);
    }

    return { total, byExchange };
  }

  private async runLightValidation(year: number): Promise<{
    finalization: FinalizationStatus;
    portfolio: PortfolioValidationResult;
  }> {
    const validSvc = new FiscoValidationService(pool);
    const finalization = await validSvc.getFinalizationStatus(year);
    const portfolio = await validSvc.validatePortfolio(year, null);
    return { finalization, portfolio };
  }

  private async runFullValidation(year: number): Promise<{
    finalization: FinalizationStatus;
    portfolio: PortfolioValidationResult;
  }> {
    const validSvc = new FiscoValidationService(pool);
    const krakenSvc = new KrakenReconciliationService(pool);

    const [finalization, portfolio, krakenRec] = await Promise.all([
      validSvc.getFinalizationStatus(year),
      validSvc.validatePortfolio(year, null),
      krakenSvc.reconcile(year),
    ]);

    return { finalization, portfolio };
  }

  // ============================================================
  // Telegram methods
  // ============================================================

  private async sendTelegramSuccess(
    year: number,
    newOpsCount: number,
    newOpsByExchange: Record<string, { total: number; buys: number; sells: number; others: number }>,
    finalization: FinalizationStatus,
    jobId: number
  ): Promise<void> {
    try {
      const context = validateContext(FiscoAutoSyncSuccessContextSchema, {
        env: environment.envTag,
        year,
        scheduledTime: new Date(),
        newOperationsCount: newOpsCount,
        newOperationsByExchange: newOpsByExchange,
        fifoStatus: finalization.fifo_status,
        portfolioStatus: finalization.portfolio_status,
        finalTaxableGainLossEur: finalization.final_taxable_gain_loss_eur.toFixed(2) + " €",
        warningsCount: finalization.warnings.length,
        reportCanBeFinalized: finalization.report_can_be_finalized,
      }, "FiscoAutoSyncSuccess");

      const message = buildFiscoAutoSyncSuccessHTML(context);
      await telegramService.sendMessage(message, { parseMode: "HTML" });
      console.log(`[fisco/auto-sync] Telegram success sent: year=${year} newOps=${newOpsCount}`);
    } catch (error: any) {
      console.error(`[fisco/auto-sync] Failed to send Telegram success:`, error);
    }
  }

  private async sendTelegramNoChanges(
    year: number,
    finalization: FinalizationStatus,
    portfolio: PortfolioValidationResult,
    jobId: number
  ): Promise<void> {
    try {
      const context = validateContext(FiscoAutoSyncNoChangesContextSchema, {
        env: environment.envTag,
        year,
        scheduledTime: new Date(),
        fifoStatus: finalization.fifo_status,
        portfolioStatus: finalization.portfolio_status,
        finalTaxableGainLossEur: finalization.final_taxable_gain_loss_eur.toFixed(2) + " €",
        reportCanBeFinalized: finalization.report_can_be_finalized,
      }, "FiscoAutoSyncNoChanges");

      const message = buildFiscoAutoSyncNoChangesHTML(context);
      await telegramService.sendMessage(message, { parseMode: "HTML" });
      console.log(`[fisco/auto-sync] Telegram no changes sent: year=${year}`);
    } catch (error: any) {
      console.error(`[fisco/auto-sync] Failed to send Telegram no changes:`, error);
    }
  }

  private async sendTelegramWithWarnings(
    year: number,
    newOpsCount: number,
    newOpsByExchange: Record<string, { total: number; buys: number; sells: number; others: number }>,
    finalization: FinalizationStatus,
    warnings: string[],
    jobId: number
  ): Promise<void> {
    try {
      const context = validateContext(FiscoAutoSyncWarningsContextSchema, {
        env: environment.envTag,
        year,
        scheduledTime: new Date(),
        newOperationsCount: newOpsCount,
        newOperationsByExchange: newOpsByExchange,
        finalTaxableGainLossEur: finalization.final_taxable_gain_loss_eur.toFixed(2) + " €",
        warnings,
        reportCanBeFinalized: finalization.report_can_be_finalized,
      }, "FiscoAutoSyncWarnings");

      const message = buildFiscoAutoSyncWarningsHTML(context);
      await telegramService.sendMessage(message, { parseMode: "HTML" });
      console.log(`[fisco/auto-sync] Telegram with warnings sent: year=${year} warnings=${warnings.length}`);
    } catch (error: any) {
      console.error(`[fisco/auto-sync] Failed to send Telegram with warnings:`, error);
    }
  }

  private async sendTelegramError(
    year: number,
    attempt: number,
    maxAttempts: number,
    error: string,
    nextRetryAt: Date | null,
    jobId: number
  ): Promise<void> {
    try {
      const context = validateContext(FiscoAutoSyncErrorContextSchema, {
        env: environment.envTag,
        year,
        attempt,
        maxAttempts,
        error,
        nextRetryAt,
      }, "FiscoAutoSyncError");

      const message = buildFiscoAutoSyncErrorHTML(context);
      await telegramService.sendMessage(message, { parseMode: "HTML" });
      console.log(`[fisco/auto-sync] Telegram error sent: attempt=${attempt}/${maxAttempts} error=${error}`);
    } catch (error: any) {
      console.error(`[fisco/auto-sync] Failed to send Telegram error:`, error);
    }
  }

  private async sendTelegramAllFailed(
    year: number,
    attempt: number,
    maxAttempts: number,
    jobId: number
  ): Promise<void> {
    try {
      // Get failed attempts from DB
      const failedAttempts = await pool.query(
        `SELECT attempt_number, started_at, error_message
         FROM fisco_auto_sync_jobs
         WHERE scheduled_for IN (
           SELECT scheduled_for FROM fisco_auto_sync_jobs WHERE id = $1
         )
         AND status = 'failed'
         ORDER BY attempt_number`,
        [jobId]
      );

      const attempts = failedAttempts.rows.map(row => ({
        attempt: row.attempt_number,
        time: row.started_at,
        error: row.error_message || "Unknown error",
      }));

      const context = validateContext(FiscoAutoSyncAllFailedContextSchema, {
        env: environment.envTag,
        year,
        attempt,
        maxAttempts,
        attempts,
      }, "FiscoAutoSyncAllFailed");

      const message = buildFiscoAutoSyncAllFailedHTML(context);
      await telegramService.sendMessage(message, { parseMode: "HTML" });
      console.log(`[fisco/auto-sync] Telegram all failed sent: attempt=${attempt}/${maxAttempts}`);
    } catch (error: any) {
      console.error(`[fisco/auto-sync] Failed to send Telegram all failed:`, error);
    }
  }
}
