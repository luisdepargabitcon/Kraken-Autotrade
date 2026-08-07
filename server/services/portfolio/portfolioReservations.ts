/**
 * Portfolio Reservations & Coordination — Fase 5
 *
 * Reservations, order locks, idempotency.
 * No cross-mode capital sharing. No double-reservation.
 */

import type { StrategyMode } from "./portfolioTypes";

export type ReservationStatus =
  | "PENDING"
  | "CONFIRMED"
  | "RELEASED"
  | "EXPIRED"
  | "CONVERTED";

export interface Reservation {
  reservationId: string;
  mode: StrategyMode;
  exchange: string;
  asset: string;
  amountUsd: number;
  status: ReservationStatus;
  createdAt: string;
  expiresAt: string;
  convertedToOrderId: string | null;
  releasedAt: string | null;
  releasedReason: string | null;
}

export type LockStatus = "ACQUIRED" | "RELEASED" | "EXPIRED" | "DENIED";

export interface OrderLock {
  lockId: string;
  mode: StrategyMode;
  exchange: string;
  asset: string;
  status: LockStatus;
  acquiredAt: string;
  expiresAt: string;
  releasedAt: string | null;
}

class ReservationCoordinator {
  private reservations: Map<string, Reservation> = new Map();
  private locks: Map<string, OrderLock> = new Map();
  private idempotencyKeys: Set<string> = new Set();

  // ─── Reservations ─────────────────────────────────────────────────

  createReservation(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    amountUsd: number,
    ttlSeconds: number = 300,
    idempotencyKey?: string,
  ): Reservation | null {
    // Idempotency check
    if (idempotencyKey && this.idempotencyKeys.has(idempotencyKey)) {
      return null;
    }
    if (idempotencyKey) {
      this.idempotencyKeys.add(idempotencyKey);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    const reservation: Reservation = {
      reservationId: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mode,
      exchange,
      asset,
      amountUsd,
      status: "PENDING",
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      convertedToOrderId: null,
      releasedAt: null,
      releasedReason: null,
    };

    this.reservations.set(reservation.reservationId, reservation);
    return reservation;
  }

  confirmReservation(reservationId: string): boolean {
    const res = this.reservations.get(reservationId);
    if (!res || res.status !== "PENDING") return false;
    if (new Date() >= new Date(res.expiresAt)) {
      res.status = "EXPIRED";
      return false;
    }
    res.status = "CONFIRMED";
    return true;
  }

  releaseReservation(reservationId: string, reason: string): boolean {
    const res = this.reservations.get(reservationId);
    if (!res) return false;
    if (res.status === "RELEASED" || res.status === "CONVERTED") return false;
    res.status = "RELEASED";
    res.releasedAt = new Date().toISOString();
    res.releasedReason = reason;
    return true;
  }

  convertReservation(reservationId: string, orderId: string): boolean {
    const res = this.reservations.get(reservationId);
    if (!res || res.status !== "CONFIRMED") return false;
    res.status = "CONVERTED";
    res.convertedToOrderId = orderId;
    return true;
  }

  expireReservations(): number {
    let count = 0;
    const now = new Date();
    for (const res of this.reservations.values()) {
      if (res.status === "PENDING" && now >= new Date(res.expiresAt)) {
        res.status = "EXPIRED";
        count++;
      }
    }
    return count;
  }

  getReservation(reservationId: string): Reservation | null {
    return this.reservations.get(reservationId) ?? null;
  }

  getActiveReservations(mode?: StrategyMode): Reservation[] {
    return Array.from(this.reservations.values()).filter(
      (r) =>
        (r.status === "PENDING" || r.status === "CONFIRMED") &&
        (mode === undefined || r.mode === mode),
    );
  }

  // ─── Order Locks ──────────────────────────────────────────────────

  acquireLock(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    ttlSeconds: number = 60,
  ): OrderLock | null {
    const key = `${mode}:${exchange}:${asset}`;

    // Check for existing active lock
    const existing = this.locks.get(key);
    if (existing && existing.status === "ACQUIRED" && new Date() < new Date(existing.expiresAt)) {
      return null; // Lock denied — already held
    }

    const now = new Date();
    const lock: OrderLock = {
      lockId: `lock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mode,
      exchange,
      asset,
      status: "ACQUIRED",
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      releasedAt: null,
    };

    this.locks.set(key, lock);
    return lock;
  }

  releaseLock(mode: StrategyMode, exchange: string, asset: string): boolean {
    const key = `${mode}:${exchange}:${asset}`;
    const lock = this.locks.get(key);
    if (!lock || lock.status !== "ACQUIRED") return false;
    lock.status = "RELEASED";
    lock.releasedAt = new Date().toISOString();
    return true;
  }

  expireLocks(): number {
    let count = 0;
    const now = new Date();
    for (const lock of this.locks.values()) {
      if (lock.status === "ACQUIRED" && now >= new Date(lock.expiresAt)) {
        lock.status = "EXPIRED";
        count++;
      }
    }
    return count;
  }

  getLock(mode: StrategyMode, exchange: string, asset: string): OrderLock | null {
    return this.locks.get(`${mode}:${exchange}:${asset}`) ?? null;
  }

  // ─── Reset ────────────────────────────────────────────────────────

  reset(): void {
    this.reservations.clear();
    this.locks.clear();
    this.idempotencyKeys.clear();
  }
}

export const reservationCoordinator = new ReservationCoordinator();
