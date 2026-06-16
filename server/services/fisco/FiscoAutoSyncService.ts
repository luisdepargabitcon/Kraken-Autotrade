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
import { fiscoSyncService, type IncrementalSyncResult } from "../FiscoSyncService";
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

export type AutoSyncStatus = "pending" | "running" | "success" | "success_with_warnings" | "failed" | "failed_commit" | "skipped_no_changes";

export interface AutoSyncJob {
  id: number;
  scheduled_for: Date;
  started_at: Date | null;
  completed_at: Date | null;
  timezone: string;
  attempt_number: number;
  max_attempts: number;
  status: AutoSyncStatus;
  current_phase: string | null;
  exchanges_synced: string[] | null;
  new_operations_count: number;
  new_operations_by_exchange: Record<string, { total: number; buys: number; sells: number; others: number }> | null;
  dry_run_id: number | null;
  commit_run_id: number | null;
  dry_run_rebuild_id: string | null;
  commit_rebuild_id: string | null;
  finalization_status: FinalizationStatus | null;
  portfolio_status: PortfolioValidationResult | null;
  warnings: any[] | null;
  error_message: string | null;
  telegram_sent: boolean;
  telegram_message_id: number | null;
  next_retry_at: Date | null;
  retry_group_id: string | null;
  parent_job_id: number | null;
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
   * Create auto-sync job for a specific date (returns jobId immediately)
   * This is the public method called by HTTP endpoint and scheduler
   */
  async runAutoSync(options: AutoSyncOptions = {}): Promise<{ jobId: number; status: string }> {
    const { year = new Date().getFullYear(), timezone = "Europe/Madrid", forceSync = false } = options;
    const now = new Date();
    const scheduledFor = this.getScheduledTimeForTimezone(now, timezone);

    console.log(`[fisco/auto-sync] Creating auto-sync job for year=${year} timezone=${timezone} scheduled=${scheduledFor.toISOString()}`);

    // Check if there's already a pending/running job for this day
    const existingJob = await this.getJobForDate(scheduledFor, timezone);
    if (existingJob && (existingJob.status === "running" || existingJob.status === "pending")) {
      console.log(`[fisco/auto-sync] Job already running/pending for this day: ${existingJob.id}`);
      return { jobId: existingJob.id, status: existingJob.status };
    }

    // Create new job record with retry_group_id
    const retryGroupId = randomUUID();
    const jobId = await this.createJob(scheduledFor, timezone, 1, 5, retryGroupId);

    console.log(`[fisco/auto-sync] Job created: ${jobId}, starting background processing`);
    return { jobId, status: "pending" };
  }

  /**
   * Process auto-sync job (internal method, runs in background)
   * This contains all the actual sync/dry_run/commit logic
   */
  async processAutoSyncJob(jobId: number, options: AutoSyncOptions = {}): Promise<AutoSyncResult> {
    const { year = new Date().getFullYear(), timezone = "Europe/Madrid", forceSync = false } = options;
    const now = new Date();

    console.log(`[fisco/auto-sync] Processing job ${jobId} for year=${year} timezone=${timezone}`);

    // Watchdog: mark any stale running rebuild runs before starting
    try {
      const rebuildSvc = FiscoRebuildService.getInstance();
      const staleCount = await rebuildSvc.markStaleRebuildRuns();
      if (staleCount > 0) {
        console.warn(`[fisco/auto-sync] job=${jobId} Watchdog cleared ${staleCount} stale rebuild run(s)`);
      }
    } catch (watchdogErr) {
      console.warn(`[fisco/auto-sync] job=${jobId} Watchdog check failed (non-critical):`, watchdogErr);
    }

    // Get job to get scheduled_for
    const job = await this.getJobById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const scheduledFor = job.scheduled_for;

    // Declare outside try block for error handling
    let newOpsCount = 0;
    let newOpsByExchange: Record<string, { total: number; buys: number; sells: number; others: number }> = {};

    try {
      console.log(`[fisco/auto-sync] job=${jobId} phase=started`);
      await this.updateJob(jobId, { status: "running", started_at: now, current_phase: "started" });

      // Step 1: Execute real incremental sync (unless forceSync)
      let syncErrors: string[] = [];
      if (!forceSync) {
        console.log(`[fisco/auto-sync] job=${jobId} phase=sync_incremental started`);
        await this.updateJob(jobId, { current_phase: "sync_incremental" });

        const syncResult = await this.withTimeout(
          fiscoSyncService.syncIncremental(),
          5 * 60 * 1000, // 5 minutes
          "syncIncremental"
        );
        newOpsCount = syncResult.totalInserted;
        newOpsByExchange = syncResult.byExchange;
        syncErrors = syncResult.errors ?? [];

        console.log(`[fisco/auto-sync] job=${jobId} phase=sync_incremental completed totalInserted=${newOpsCount} errors=${syncErrors.length}`);

        // If sync failed, mark job failed and schedule retry
        if (syncErrors.length > 0) {
          console.log(`[fisco/auto-sync] job=${jobId} Sync failed with errors: ${syncErrors.join(", ")}`);
          await this.updateJob(jobId, {
            status: "failed",
            completed_at: new Date(),
            current_phase: "failed",
            error_message: `Sync failed: ${syncErrors.join(", ")}`,
          });

          const nextRetryAt = this.calculateNextRetry(scheduledFor, 1, timezone);
          await this.sendTelegramError(year, 1, 5, `Sync failed: ${syncErrors.join(", ")}`, nextRetryAt, jobId);
          await this.updateJob(jobId, { telegram_sent: true, next_retry_at: nextRetryAt });

          return {
            jobId,
            status: "failed",
            newOperationsCount: 0,
            dryRunResult: null,
            commitResult: null,
            finalizationStatus: null,
            portfolioStatus: null,
            warnings: syncErrors,
            error: `Sync failed: ${syncErrors.join(", ")}`,
            telegramSent: true,
            nextRetryAt,
          };
        }

        if (newOpsCount === 0) {
          console.log(`[fisco/auto-sync] job=${jobId} No new operations detected after incremental sync`);
          await this.updateJob(jobId, {
            status: "skipped_no_changes",
            completed_at: new Date(),
            current_phase: "completed",
            new_operations_count: 0,
            new_operations_by_exchange: newOpsByExchange,
          });

          // Light validation to confirm FISCO still OK
          const validation = await this.runLightValidation(year);
          await this.updateJob(jobId, {
            finalization_status: validation.finalization,
            portfolio_status: validation.portfolio,
          });

          // Send Telegram "no changes" with sync info
          await this.sendTelegramNoChanges(year, validation.finalization, validation.portfolio, jobId, true, syncErrors);

          await this.updateJob(jobId, { telegram_sent: true });

          console.log(`[fisco/auto-sync] job=${jobId} phase=done status=skipped_no_changes`);

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

      console.log(`[fisco/auto-sync] job=${jobId} ${newOpsCount} new operations detected`);

      // Step 2: Run dry_run
      console.log(`[fisco/auto-sync] job=${jobId} phase=dry_run started`);
      await this.updateJob(jobId, { current_phase: "dry_run" });

      const rebuildService = FiscoRebuildService.getInstance();
      const dryRunResult = await this.withTimeout(
        rebuildService.rebuild({
          mode: "dry_run",
          triggeredBy: "auto-sync",
          fullSync: true,
        }),
        3 * 60 * 1000, // 3 minutes
        "dry_run"
      );

      await this.updateJob(jobId, {
        dry_run_id: dryRunResult.runId ? parseInt(dryRunResult.runId.replace(/-/g, "").substring(0, 8), 16) : null,
        dry_run_rebuild_id: dryRunResult.runId ?? null,
        new_operations_count: newOpsCount,
        new_operations_by_exchange: newOpsByExchange,
        warnings: dryRunResult.warnings as any[],
      });

      console.log(`[fisco/auto-sync] job=${jobId} phase=dry_run completed`);

      // Step 3: Run full validation to get portfolio and finalization status
      console.log(`[fisco/auto-sync] job=${jobId} phase=validation started`);
      await this.updateJob(jobId, { current_phase: "validation" });

      const fullValidation = await this.withTimeout(
        this.runFullValidation(year),
        2 * 60 * 1000, // 2 minutes
        "validation"
      );
      await this.updateJob(jobId, {
        finalization_status: fullValidation.finalization,
        portfolio_status: fullValidation.portfolio,
      });

      console.log(`[fisco/auto-sync] job=${jobId} phase=validation completed`);

      // Step 4: Check if safe for auto-commit with hardened conditions
      const isSafeForAutoCommit = this.isSafeForAutoCommit(
        dryRunResult,
        fullValidation.portfolio,
        fullValidation.finalization,
        syncErrors
      );

      if (!isSafeForAutoCommit) {
        console.log(`[fisco/auto-sync] job=${jobId} Not safe for auto-commit after hardened validation`);
        await this.updateJob(jobId, {
          status: "failed",
          completed_at: new Date(),
          current_phase: "failed",
          error_message: `Not safe for auto-commit: hardened validation failed`,
        });

        // Send Telegram error with retry info
        const nextRetryAt = this.calculateNextRetry(scheduledFor, 1, timezone);
        await this.sendTelegramError(year, 1, 5, "Not safe for auto-commit (hardened validation)", nextRetryAt, jobId);

        await this.updateJob(jobId, { telegram_sent: true, next_retry_at: nextRetryAt });

        return {
          jobId,
          status: "failed",
          newOperationsCount: newOpsCount,
          dryRunResult,
          commitResult: null,
          finalizationStatus: fullValidation.finalization,
          portfolioStatus: fullValidation.portfolio,
          warnings: dryRunResult.warnings,
          error: "Not safe for auto-commit (hardened validation)",
          telegramSent: true,
          nextRetryAt,
        };
      }

      // Step 4: Run commit
      console.log(`[fisco/auto-sync] job=${jobId} phase=commit started`);
      await this.updateJob(jobId, { current_phase: "commit" });

      const commitResult = await this.withTimeout(
        rebuildService.rebuild({
          mode: "commit",
          triggeredBy: "auto-sync",
          fullSync: true,
        }),
        3 * 60 * 1000, // 3 minutes
        "commit"
      );

      await this.updateJob(jobId, {
        commit_run_id: commitResult.runId ? parseInt(commitResult.runId.replace(/-/g, "").substring(0, 8), 16) : null,
        commit_rebuild_id: commitResult.runId ?? null,
      });

      console.log(`[fisco/auto-sync] job=${jobId} phase=commit completed status=${commitResult.status}`);

      // Guard: commit must have status === 'committed' — never mark success if it failed
      if (commitResult.status !== "committed") {
        const commitErrMsg = commitResult.error ?? `Commit ended with status '${commitResult.status}' instead of 'committed'`;
        console.error(`[fisco/auto-sync] job=${jobId} COMMIT FAILED: ${commitErrMsg}`);
        await this.updateJob(jobId, {
          status: "failed_commit",
          completed_at: new Date(),
          current_phase: "failed_commit",
          error_message: commitErrMsg,
        });
        const nextRetryAt = this.calculateNextRetry(scheduledFor, 1, timezone);
        await this.sendTelegramError(year, 1, 5, `Dry-run OK pero commit FIFO falló: ${commitErrMsg}. Resultado anterior conservado. Operaciones pendientes de contabilizar.`, nextRetryAt, jobId);
        await this.updateJob(jobId, { telegram_sent: true, next_retry_at: nextRetryAt });
        return {
          jobId, status: "failed_commit",
          newOperationsCount: newOpsCount,
          dryRunResult, commitResult,
          finalizationStatus: null, portfolioStatus: null,
          warnings: dryRunResult.warnings,
          error: commitErrMsg,
          telegramSent: true, nextRetryAt,
        };
      }

      // Step 5: Run full validation again after commit
      const postCommitValidation = await this.runFullValidation(year);
      await this.updateJob(jobId, {
        finalization_status: postCommitValidation.finalization,
        portfolio_status: postCommitValidation.portfolio,
      });

      // Step 6: Determine final status
      const hasWarnings = dryRunResult.warnings.length > 0 || postCommitValidation.finalization.warnings.length > 0;
      const finalStatus: AutoSyncStatus = hasWarnings ? "success_with_warnings" : "success";

      await this.updateJob(jobId, {
        status: finalStatus,
        completed_at: new Date(),
        current_phase: "completed",
        warnings: [...dryRunResult.warnings, ...postCommitValidation.finalization.warnings],
      });

      // Step 7: Send Telegram
      console.log(`[fisco/auto-sync] job=${jobId} phase=telegram started`);
      await this.updateJob(jobId, { current_phase: "telegram" });

      await this.withTimeout(
        (async () => {
          if (hasWarnings) {
            await this.sendTelegramWithWarnings(year, newOpsCount, newOpsByExchange, postCommitValidation.finalization, dryRunResult.warnings, jobId);
          } else {
            await this.sendTelegramSuccess(year, newOpsCount, newOpsByExchange, postCommitValidation.finalization, jobId);
          }
        })(),
        30 * 1000, // 30 seconds
        "telegram"
      );

      await this.updateJob(jobId, { telegram_sent: true });

      console.log(`[fisco/auto-sync] job=${jobId} phase=done status=${finalStatus}`);

      return {
        jobId,
        status: finalStatus,
        newOperationsCount: newOpsCount,
        dryRunResult,
        commitResult,
        finalizationStatus: postCommitValidation.finalization,
        portfolioStatus: postCommitValidation.portfolio,
        warnings: [...dryRunResult.warnings, ...postCommitValidation.finalization.warnings] as string[],
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
      const nextRetryAt = this.calculateNextRetry(scheduledFor, 1, timezone);
      await this.sendTelegramError(year, 1, 5, error.message, nextRetryAt, jobId);
      await this.updateJob(jobId, { telegram_sent: true, next_retry_at: nextRetryAt });

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

    // Use existing retry_group_id or create new one
    const retryGroupId = job.retry_group_id || randomUUID();

    // Create new job record for retry with retry_group_id and parent_job_id
    const newJobId = await this.createJob(scheduledFor, job.timezone, nextAttempt, job.max_attempts, retryGroupId, jobId);

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
        dry_run_rebuild_id: dryRunResult.runId ?? null,
        warnings: dryRunResult.warnings,
      });

      // Run full validation to get portfolio and finalization status
      const validation = await this.runFullValidation(year);
      await this.updateJob(newJobId, {
        finalization_status: validation.finalization,
        portfolio_status: validation.portfolio,
      });

      // Check if safe for auto-commit with hardened conditions
      const syncErrors: string[] = [];
      const isSafeForAutoCommit = this.isSafeForAutoCommit(
        dryRunResult,
        validation.portfolio,
        validation.finalization,
        syncErrors
      );

      if (!isSafeForAutoCommit) {
        await this.updateJob(newJobId, {
          status: "failed",
          completed_at: new Date(),
          error_message: `Not safe for auto-commit: hardened validation failed`,
        });

        const nextRetryAt = this.calculateNextRetry(job.scheduled_for, nextAttempt, job.timezone);
        if (nextRetryAt) {
          await this.sendTelegramError(year, nextAttempt, job.max_attempts, "Not safe for auto-commit (hardened validation)", nextRetryAt, newJobId);
        } else {
          await this.sendTelegramAllFailed(year, nextAttempt, job.max_attempts, newJobId);
        }

        await this.updateJob(newJobId, { telegram_sent: true, next_retry_at: nextRetryAt });

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
        commit_rebuild_id: commitResult.runId ?? null,
      });

      // Guard: commit must be committed — never mark success if it failed
      if (commitResult.status !== "committed") {
        const commitErrMsg = commitResult.error ?? `Commit ended with status '${commitResult.status}' instead of 'committed'`;
        console.error(`[fisco/auto-sync] retry job=${newJobId} COMMIT FAILED: ${commitErrMsg}`);
        await this.updateJob(newJobId, {
          status: "failed_commit",
          completed_at: new Date(),
          current_phase: "failed_commit",
          error_message: commitErrMsg,
        });
        const nextRetryAt = this.calculateNextRetry(job.scheduled_for, nextAttempt, job.timezone);
        await this.sendTelegramError(year, nextAttempt, job.max_attempts, `Dry-run OK pero commit FIFO falló: ${commitErrMsg}. Resultado anterior conservado.`, nextRetryAt, newJobId);
        await this.updateJob(newJobId, { telegram_sent: true, next_retry_at: nextRetryAt });
        return {
          jobId: newJobId, status: "failed_commit",
          newOperationsCount: 0,
          dryRunResult, commitResult,
          finalizationStatus: null, portfolioStatus: null,
          warnings: dryRunResult.warnings,
          error: commitErrMsg,
          telegramSent: true, nextRetryAt,
        };
      }

      // Run validation again after commit
      const postCommitValidation = await this.runFullValidation(year);
      await this.updateJob(newJobId, {
        finalization_status: postCommitValidation.finalization,
        portfolio_status: postCommitValidation.portfolio,
      });

      const hasWarnings = dryRunResult.warnings.length > 0 || postCommitValidation.finalization.warnings.length > 0;
      const finalStatus: AutoSyncStatus = hasWarnings ? "success_with_warnings" : "success";

      await this.updateJob(newJobId, {
        status: finalStatus,
        completed_at: new Date(),
        warnings: [...dryRunResult.warnings, ...postCommitValidation.finalization.warnings],
      });

      await this.sendTelegramSuccess(year, 0, {}, postCommitValidation.finalization, newJobId);
      await this.updateJob(newJobId, { telegram_sent: true });

      return {
        jobId: newJobId,
        status: finalStatus,
        newOperationsCount: 0,
        dryRunResult,
        commitResult,
        finalizationStatus: postCommitValidation.finalization,
        portfolioStatus: postCommitValidation.portfolio,
        warnings: [...dryRunResult.warnings, ...postCommitValidation.finalization.warnings] as string[],
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

      const nextRetryAt = this.calculateNextRetry(job.scheduled_for, nextAttempt, job.timezone);
      if (nextRetryAt) {
        await this.sendTelegramError(year, nextAttempt, job.max_attempts, error.message, nextRetryAt, newJobId);
      } else {
        await this.sendTelegramAllFailed(year, nextAttempt, job.max_attempts, newJobId);
      }

      await this.updateJob(newJobId, { telegram_sent: true, next_retry_at: nextRetryAt });

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

  private async createJob(
    scheduledFor: Date,
    timezone: string,
    attemptNumber: number,
    maxAttempts: number,
    retryGroupId?: string,
    parentJobId?: number
  ): Promise<number> {
    const result = await pool.query(
      `INSERT INTO fisco_auto_sync_jobs (scheduled_for, timezone, attempt_number, max_attempts, status, retry_group_id, parent_job_id)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)
       RETURNING id`,
      [scheduledFor, timezone, attemptNumber, maxAttempts, retryGroupId || null, parentJobId || null]
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
       AND status IN ('pending', 'running', 'success', 'success_with_warnings', 'skipped_no_changes')
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
    lastJobIsStale: boolean;
    runningForSeconds: number | null;
    nextScheduled: Date | null;
    nextRetry: Date | null;
    nextRetrySource: "db" | null;
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

    // Use next_retry_at from DB directly (no recalculation)
    const nextRetry = lastJob?.next_retry_at ?? null;
    const nextRetrySource = nextRetry ? "db" : null;

    // Detect if last job is stale (running > 15 minutes)
    let lastJobIsStale = false;
    let runningForSeconds = null;
    if (lastJob && lastJob.status === "running" && lastJob.started_at) {
      runningForSeconds = Math.floor((now.getTime() - lastJob.started_at.getTime()) / 1000);
      lastJobIsStale = runningForSeconds > 15 * 60; // > 15 minutes
    }

    return { lastJob, lastJobIsStale, runningForSeconds, nextScheduled, nextRetry, nextRetrySource };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private snakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout in phase: ${label} (${ms}ms)`)), ms);
    });
    return Promise.race([promise, timeout]);
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
      current_phase: row.current_phase,
      exchanges_synced: row.exchanges_synced,
      new_operations_count: row.new_operations_count,
      new_operations_by_exchange: row.new_operations_by_exchange,
      dry_run_id: row.dry_run_id,
      commit_run_id: row.commit_run_id,
      dry_run_rebuild_id: row.dry_run_rebuild_id ?? null,
      commit_rebuild_id: row.commit_rebuild_id ?? null,
      finalization_status: row.finalization_status,
      portfolio_status: row.portfolio_status,
      warnings: row.warnings,
      error_message: row.error_message,
      telegram_sent: row.telegram_sent,
      telegram_message_id: row.telegram_message_id,
      next_retry_at: row.next_retry_at,
      retry_group_id: row.retry_group_id,
      parent_job_id: row.parent_job_id,
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

  private calculateNextRetry(baseScheduledFor: Date, attemptNumber: number, timezone = "Europe/Madrid"): Date | null {
    const retryOffsetsMinutes: Record<number, number> = {
      1: 15,   // 00:15
      2: 60,   // 01:00
      3: 180,  // 03:00
      4: 360,  // 06:00
    };

    if (attemptNumber > 4) {
      return null;
    }

    const offsetMinutes = retryOffsetsMinutes[attemptNumber];
    if (offsetMinutes === undefined) {
      return null;
    }

    // Calculate from baseScheduledFor (00:00 Europe/Madrid), not from now
    const baseDate = new Date(baseScheduledFor.toLocaleString("en-US", { timeZone: timezone }));
    baseDate.setHours(0, 0, 0, 0);
    const nextRetry = new Date(baseDate.getTime() + offsetMinutes * 60 * 1000);
    return nextRetry;
  }

  // ============================================================
  // Testing helpers (public for unit testing)
  // ============================================================

  /**
   * Testing method: calculate next retry time for a given attempt
   * @internal
   */
  public testCalculateNextRetry(baseScheduledFor: Date, attemptNumber: number, timezone = "Europe/Madrid"): Date | null {
    return this.calculateNextRetry(baseScheduledFor, attemptNumber, timezone);
  }

  private isSafeForAutoCommit(
    dryRunResult: RebuildResult,
    portfolioStatus: PortfolioValidationResult | null,
    finalizationStatus: FinalizationStatus | null,
    syncErrors: string[]
  ): boolean {
    // 1. No errores críticos de FIFO
    if (dryRunResult.criticalErrorsCount !== 0) {
      console.log(`[isSafeForAutoCommit] Blocked: ${dryRunResult.criticalErrorsCount} critical errors`);
      return false;
    }

    // 2. isSafeForReport debe ser true
    if (!dryRunResult.isSafeForReport) {
      console.log('[isSafeForAutoCommit] Blocked: isSafeForReport is false');
      return false;
    }

    // 3. No errores de importación de exchanges
    if (syncErrors.length > 0) {
      console.log(`[isSafeForAutoCommit] Blocked: ${syncErrors.length} sync errors`);
      return false;
    }

    // 4. No errores críticos de tipo STABLECOIN_ZERO_COST_BASIS
    const stablecoinErrors = dryRunResult.criticalErrors.filter(e => e.code === "STABLECOIN_ZERO_COST_BASIS");
    if (stablecoinErrors.length > 0) {
      console.log(`[isSafeForAutoCommit] Blocked: ${stablecoinErrors.length} stablecoin zero cost basis errors`);
      return false;
    }

    // 5. No errores críticos de tipo NEGATIVE_INVENTORY (FIFO negativo)
    const negativeInventoryErrors = dryRunResult.criticalErrors.filter(e => e.code === "NEGATIVE_INVENTORY");
    if (negativeInventoryErrors.length > 0) {
      console.log(`[isSafeForAutoCommit] Blocked: ${negativeInventoryErrors.length} negative inventory errors`);
      return false;
    }

    // 6. No portfolio DIFFERENCES bloqueante
    if (portfolioStatus && portfolioStatus.portfolio_status === "DIFFERENCES" && !portfolioStatus.report_can_be_finalized) {
      console.log('[isSafeForAutoCommit] Blocked: portfolio differences blocking finalization');
      return false;
    }

    // 7. No conservative disposals nuevos pendientes de revisión manual
    if (finalizationStatus && finalizationStatus.conservative_disposals_status === "ACTIVE") {
      console.log('[isSafeForAutoCommit] Blocked: active conservative disposals pending manual review');
      return false;
    }

    // 8. Finalization status debe ser finalizable
    if (finalizationStatus && !finalizationStatus.report_can_be_finalized) {
      console.log('[isSafeForAutoCommit] Blocked: report cannot be finalized');
      return false;
    }

    // 9. No withdrawals en estado CONSERVATIVE o PENDING
    if (finalizationStatus && (finalizationStatus.withdrawals_status === "CONSERVATIVE" || finalizationStatus.withdrawals_status === "PENDING")) {
      console.log('[isSafeForAutoCommit] Blocked: withdrawals in conservative/pending status');
      return false;
    }

    return true;
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
        timestamp: new Date(),
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
    jobId: number,
    syncExecuted: boolean = true,
    syncErrors: string[] = []
  ): Promise<void> {
    try {
      const context = validateContext(FiscoAutoSyncNoChangesContextSchema, {
        env: environment.envTag,
        year,
        scheduledTime: new Date(),
        syncExecuted,
        syncErrors: syncErrors.length > 0 ? syncErrors : undefined,
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
