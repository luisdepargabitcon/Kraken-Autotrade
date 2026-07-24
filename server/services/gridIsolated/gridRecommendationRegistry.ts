/**
 * gridRecommendationRegistry.ts
 *
 * In-memory ephemeral registry for grid configuration recommendations.
 * No DB, no persistence. Recommendations disappear on server restart.
 *
 * Lifecycle:
 *  1. GET /monitor/audit builds a recommendation and registers it here.
 *  2. POST /config/recommendation/apply retrieves it by ID.
 *  3. After successful application, the recommendation is marked as applied.
 *  4. Expired entries are cleaned up automatically.
 */

import crypto from "crypto";
import type { ConfigurationRecommendation } from "@shared/gridRecommendationHelper";

const RECOMMENDATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface RegistryEntry {
  recommendation: ConfigurationRecommendation;
  registeredAt: number;
  expiresAt: number;
  applied: boolean;
  appliedAt: number | null;
}

class GridRecommendationRegistry {
  private entries = new Map<string, RegistryEntry>();

  /**
   * Generate a cryptographically random recommendation ID.
   */
  generateId(pair: string): string {
    const uuid = crypto.randomUUID();
    return `rec-${uuid}-${pair}`;
  }

  /**
   * Register a recommendation. Overwrites any existing entry with the same ID.
   */
  register(recommendation: ConfigurationRecommendation): void {
    const now = Date.now();
    const expiresAt = new Date(recommendation.expiresAt).getTime();
    this.entries.set(recommendation.id, {
      recommendation,
      registeredAt: now,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : now + RECOMMENDATION_TTL_MS,
      applied: false,
      appliedAt: null,
    });
  }

  /**
   * Get a recommendation by ID. Returns null if not found or expired.
   */
  get(recommendationId: string): ConfigurationRecommendation | null {
    const entry = this.entries.get(recommendationId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(recommendationId);
      return null;
    }
    return entry.recommendation;
  }

  /**
   * Check if a recommendation has already been applied.
   */
  isApplied(recommendationId: string): boolean {
    const entry = this.entries.get(recommendationId);
    return entry?.applied ?? false;
  }

  /**
   * Mark a recommendation as applied. Prevents re-use.
   */
  markApplied(recommendationId: string): boolean {
    const entry = this.entries.get(recommendationId);
    if (!entry) return false;
    if (entry.applied) return false;
    entry.applied = true;
    entry.appliedAt = Date.now();
    return true;
  }

  /**
   * Delete expired entries. Called automatically on access but can be invoked manually.
   */
  deleteExpired(): number {
    const now = Date.now();
    let deleted = 0;
    for (const [id, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Clear all entries. Mainly for testing.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get the number of active (non-expired) entries. Mainly for testing.
   */
  size(): number {
    this.deleteExpired();
    return this.entries.size;
  }
}

export const gridRecommendationRegistry = new GridRecommendationRegistry();
export { GridRecommendationRegistry };
