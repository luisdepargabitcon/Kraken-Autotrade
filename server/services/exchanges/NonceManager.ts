/**
 * NonceManager — Generador monotónico de nonce para Kraken API
 *
 * Propiedades:
 * - Monotónicamente creciente (nunca retrocede)
 * - Tolera múltiples llamadas en el mismo milisegundo
 * - Añade padding de arranque para tolerar overlap de deploy
 *   (viejo contenedor aún procesando mientras nuevo arranca)
 * - Log de cada nonce generado con origen del módulo
 *
 * Diseño:  nonce = max(Date.now() * 1000, lastNonce + 1)
 *          Al inicializar: lastNonce = (Date.now() + paddingMs) * 1000
 */

const TAG = '[NonceManager]';

export class NonceManager {
  private lastNonce: number;
  private readonly startupPaddingMs: number;
  private callCount = 0;

  /**
   * @param startupPaddingMs  Milisegundos añadidos al nonce inicial para
   *                          garantizar que es mayor que cualquier nonce
   *                          generado por una instancia anterior del proceso.
   *                          Default: 10 000 ms (10 s).
   */
  constructor(startupPaddingMs = 10_000) {
    this.startupPaddingMs = startupPaddingMs;
    // El nonce inicial es "ahora + padding" en microsegundos.
    // Esto garantiza que incluso si el proceso anterior generó nonces
    // hasta el momento de su muerte, el nuevo proceso arranca por encima.
    this.lastNonce = (Date.now() + this.startupPaddingMs) * 1000;
    console.log(
      `${TAG} Initialized — padding=${startupPaddingMs}ms, ` +
      `initialNonce=${this.lastNonce} (${new Date(this.lastNonce / 1000).toISOString()})`
    );
  }

  /**
   * Genera el siguiente nonce monotónico.
   * Nunca retrocede, nunca se duplica.
   */
  generate(origin?: string): number {
    this.callCount++;
    const nowBased = Date.now() * 1000;
    const nonce = Math.max(nowBased, this.lastNonce + 1);
    this.lastNonce = nonce;

    if (origin) {
      console.log(`${TAG} #${this.callCount} nonce=${nonce} origin=${origin}`);
    }

    return nonce;
  }

  /** Último nonce generado (para diagnóstico) */
  getLastNonce(): number {
    return this.lastNonce;
  }

  /** Total de nonces generados en esta sesión */
  getCallCount(): number {
    return this.callCount;
  }

  /** Diagnóstico completo */
  getStats(): { lastNonce: number; callCount: number; startupPaddingMs: number } {
    return {
      lastNonce: this.lastNonce,
      callCount: this.callCount,
      startupPaddingMs: this.startupPaddingMs,
    };
  }
}

/** Singleton compartido para Kraken */
export const krakenNonceManager = new NonceManager(10_000);
