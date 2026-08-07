/**
 * Portfolio Reservations & Coordination — Fase 5: tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  reservationCoordinator,
  type Reservation,
} from "../portfolioReservations";

describe("Portfolio 5 — Reservations", () => {
  beforeEach(() => {
    reservationCoordinator.reset();
  });

  it("creates a reservation", () => {
    const res = reservationCoordinator.createReservation("AMA", "kraken", "BTC", 1000);
    expect(res).not.toBeNull();
    expect(res!.status).toBe("PENDING");
    expect(res!.amountUsd).toBe(1000);
  });

  it("confirms a pending reservation", () => {
    const res = reservationCoordinator.createReservation("AMA", "kraken", "BTC", 1000);
    expect(reservationCoordinator.confirmReservation(res!.reservationId)).toBe(true);
    expect(reservationCoordinator.getReservation(res!.reservationId)!.status).toBe("CONFIRMED");
  });

  it("rejects confirmation of non-pending reservation", () => {
    const res = reservationCoordinator.createReservation("AMA", "kraken", "BTC", 1000);
    reservationCoordinator.releaseReservation(res!.reservationId, "test");
    expect(reservationCoordinator.confirmReservation(res!.reservationId)).toBe(false);
  });

  it("releases a reservation with reason", () => {
    const res = reservationCoordinator.createReservation("AMA", "kraken", "BTC", 1000);
    expect(reservationCoordinator.releaseReservation(res!.reservationId, "CANCELLED")).toBe(true);
    const retrieved = reservationCoordinator.getReservation(res!.reservationId);
    expect(retrieved!.status).toBe("RELEASED");
    expect(retrieved!.releasedReason).toBe("CANCELLED");
  });

  it("does not release already released reservation", () => {
    const res = reservationCoordinator.createReservation("AMA", "kraken", "BTC", 1000);
    reservationCoordinator.releaseReservation(res!.reservationId, "test");
    expect(reservationCoordinator.releaseReservation(res!.reservationId, "test2")).toBe(false);
  });

  it("converts confirmed reservation to order", () => {
    const res = reservationCoordinator.createReservation("AMA", "kraken", "BTC", 1000);
    reservationCoordinator.confirmReservation(res!.reservationId);
    expect(reservationCoordinator.convertReservation(res!.reservationId, "order-123")).toBe(true);
    const retrieved = reservationCoordinator.getReservation(res!.reservationId);
    expect(retrieved!.status).toBe("CONVERTED");
    expect(retrieved!.convertedToOrderId).toBe("order-123");
  });

  it("rejects conversion of non-confirmed reservation", () => {
    const res = reservationCoordinator.createReservation("AMA", "kraken", "BTC", 1000);
    expect(reservationCoordinator.convertReservation(res!.reservationId, "order-123")).toBe(false);
  });

  it("enforces idempotency on creation", () => {
    const res1 = reservationCoordinator.createReservation("AMA", "kraken", "BTC", 1000, 300, "idem-1");
    expect(res1).not.toBeNull();
    const res2 = reservationCoordinator.createReservation("AMA", "kraken", "BTC", 1000, 300, "idem-1");
    expect(res2).toBeNull();
  });

  it("expires stale pending reservations", () => {
    const res = reservationCoordinator.createReservation("AMA", "kraken", "BTC", 1000, 0); // 0 TTL = immediate expiry
    // Wait a tiny bit for expiry
    const expired = reservationCoordinator.expireReservations();
    expect(expired).toBeGreaterThanOrEqual(1);
    const retrieved = reservationCoordinator.getReservation(res!.reservationId);
    expect(retrieved!.status).toBe("EXPIRED");
  });

  it("gets active reservations filtered by mode", () => {
    reservationCoordinator.createReservation("AMA", "kraken", "BTC", 1000);
    reservationCoordinator.createReservation("IDCA", "kraken", "BTC", 2000);
    const amaActive = reservationCoordinator.getActiveReservations("AMA");
    expect(amaActive).toHaveLength(1);
    expect(amaActive[0].mode).toBe("AMA");
    const allActive = reservationCoordinator.getActiveReservations();
    expect(allActive).toHaveLength(2);
  });
});

describe("Portfolio 5 — Order Locks", () => {
  beforeEach(() => {
    reservationCoordinator.reset();
  });

  it("acquires a lock", () => {
    const lock = reservationCoordinator.acquireLock("AMA", "kraken", "BTC");
    expect(lock).not.toBeNull();
    expect(lock!.status).toBe("ACQUIRED");
  });

  it("denies lock when already held", () => {
    reservationCoordinator.acquireLock("AMA", "kraken", "BTC");
    const second = reservationCoordinator.acquireLock("AMA", "kraken", "BTC");
    expect(second).toBeNull();
  });

  it("allows lock after release", () => {
    reservationCoordinator.acquireLock("AMA", "kraken", "BTC");
    reservationCoordinator.releaseLock("AMA", "kraken", "BTC");
    const second = reservationCoordinator.acquireLock("AMA", "kraken", "BTC");
    expect(second).not.toBeNull();
  });

  it("releases a lock", () => {
    reservationCoordinator.acquireLock("AMA", "kraken", "BTC");
    expect(reservationCoordinator.releaseLock("AMA", "kraken", "BTC")).toBe(true);
    const lock = reservationCoordinator.getLock("AMA", "kraken", "BTC");
    expect(lock!.status).toBe("RELEASED");
  });

  it("expires stale locks", () => {
    reservationCoordinator.acquireLock("AMA", "kraken", "BTC", 0); // 0 TTL
    const expired = reservationCoordinator.expireLocks();
    expect(expired).toBeGreaterThanOrEqual(1);
    const lock = reservationCoordinator.getLock("AMA", "kraken", "BTC");
    expect(lock!.status).toBe("EXPIRED");
  });

  it("allows different modes to hold locks on same asset", () => {
    const amaLock = reservationCoordinator.acquireLock("AMA", "kraken", "BTC");
    expect(amaLock).not.toBeNull();
    const idcaLock = reservationCoordinator.acquireLock("IDCA", "kraken", "BTC");
    expect(idcaLock).not.toBeNull();
  });
});
