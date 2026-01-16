import { TelegramService } from "./telegram";
import { readFileSync } from "fs";
import { join } from "path";
import { storage } from "../storage";

export type ErrorType = 'PRICE_INVALID' | 'API_ERROR' | 'DATABASE_ERROR' | 'TRADING_ERROR' | 'SYSTEM_ERROR';
export type ErrorSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ErrorAlert {
  type: ErrorType;
  message: string;
  pair?: string;
  function: string;
  fileName: string;
  lineNumber?: number;
  stackTrace?: string;
  timestamp: Date;
  severity: ErrorSeverity;
  context?: Record<string, any>;
}

interface AlertRateLimit {
  lastSent: number;
  count: number;
}

export class ErrorAlertService {
  private static instance: ErrorAlertService;
  private telegramService: TelegramService;
  private rateLimits: Map<string, AlertRateLimit> = new Map();
  
  // Configuración de alertas
  private config = {
    enabled: true,
    minSeverity: 'MEDIUM' as ErrorSeverity,
    rateLimitMinutes: 5,  // Máximo 1 alerta cada 5 min por tipo
    includeCodeSnippet: true,
    maxCodeLines: 10,
    maxMessageLength: 4000  // Límite de Telegram menos margen
  };

  private constructor() {
    this.telegramService = new TelegramService();
  }

  static getInstance(): ErrorAlertService {
    if (!ErrorAlertService.instance) {
      ErrorAlertService.instance = new ErrorAlertService();
    }
    return ErrorAlertService.instance;
  }

  /**
   * Envía una alerta de error crítico a Telegram
   */
  async sendCriticalError(alert: ErrorAlert): Promise<void> {
    try {
      if (!this.config.enabled) return;
      if (!this.shouldSendAlert(alert)) return;
      if (!this.telegramService.isInitialized()) return;

      const message = await this.formatAlertMessage(alert);
      
      // Obtener configuración del chat específico para alertas de errores
      const config = await storage.getBotConfig();
      const errorAlertChatId = config?.errorAlertChatId;
      
      if (errorAlertChatId) {
        // Enviar solo al chat específico configurado
        await this.telegramService.sendToSpecificChat(message, errorAlertChatId);
        console.log(`[ErrorAlert] Sent ${alert.type} alert to specific chat: ${errorAlertChatId}`);
      } else {
        // Enviar a todos los chats activos (comportamiento por defecto)
        await this.telegramService.sendAlertWithSubtype(message, "errors", "error_api");
        console.log(`[ErrorAlert] Sent ${alert.type} alert to all active chats`);
      }
      
      this.updateRateLimit(alert);
    } catch (error: any) {
      console.error('[ErrorAlert] Failed to send alert:', error.message);
    }
  }

  /**
   * Determina si se debe enviar la alerta basado en severidad y rate limiting
   */
  private shouldSendAlert(alert: ErrorAlert): boolean {
    // Verificar severidad mínima
    const severityLevels = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    const minLevel = severityLevels[this.config.minSeverity];
    const alertLevel = severityLevels[alert.severity];
    
    if (alertLevel < minLevel) return false;

    // Verificar rate limiting
    const key = `${alert.type}_${alert.function}`;
    const rateLimit = this.rateLimits.get(key);
    
    if (rateLimit) {
      const minutesSinceLastSent = (Date.now() - rateLimit.lastSent) / (1000 * 60);
      if (minutesSinceLastSent < this.config.rateLimitMinutes) {
        return false;
      }
    }

    return true;
  }

  /**
   * Actualiza el rate limiting para el tipo de alerta
   */
  private updateRateLimit(alert: ErrorAlert): void {
    const key = `${alert.type}_${alert.function}`;
    const existing = this.rateLimits.get(key);
    
    this.rateLimits.set(key, {
      lastSent: Date.now(),
      count: (existing?.count || 0) + 1
    });
  }

  /**
   * Formatea el mensaje de alerta para Telegram
   */
  private async formatAlertMessage(alert: ErrorAlert): Promise<string> {
    const severityEmoji = {
      LOW: '⚠️',
      MEDIUM: '🟡',
      HIGH: '🔴',
      CRITICAL: '🚨'
    };

    const typeEmoji = {
      PRICE_INVALID: '💰',
      API_ERROR: '🌐',
      DATABASE_ERROR: '🗄️',
      TRADING_ERROR: '📈',
      SYSTEM_ERROR: '⚙️'
    };

    let message = `${severityEmoji[alert.severity]} <b>ERROR ${alert.severity}</b> ${typeEmoji[alert.type]}
━━━━━━━━━━━━━━━━━━━
📦 <b>Tipo:</b> <code>${alert.type}</code>`;

    if (alert.pair) {
      message += `\n🔍 <b>Par:</b> <code>${alert.pair}</code>`;
    }

    message += `\n⏰ <b>Hora:</b> <code>${alert.timestamp.toLocaleString('es-ES')}</code>
📍 <b>Archivo:</b> <code>${alert.fileName}</code>
📍 <b>Función:</b> <code>${alert.function}()</code>`;

    if (alert.lineNumber) {
      message += `\n📍 <b>Línea:</b> <code>${alert.lineNumber}</code>`;
    }

    message += `\n\n❌ <b>Error:</b> ${alert.message}`;

    // Añadir contexto si existe
    if (alert.context && Object.keys(alert.context).length > 0) {
      message += `\n\n📋 <b>Contexto:</b>`;
      for (const [key, value] of Object.entries(alert.context)) {
        message += `\n   • <b>${key}:</b> <code>${JSON.stringify(value)}</code>`;
      }
    }

    // Añadir código fuente si está habilitado
    if (this.config.includeCodeSnippet) {
      const codeSnippet = await this.getRelevantCodeSnippet(alert);
      if (codeSnippet) {
        message += `\n\n📋 <b>Código Implicado:</b>\n<pre><code>${codeSnippet}</code></pre>`;
      }
    }

    // Añadir stack trace simplificado si existe
    if (alert.stackTrace) {
      const simplifiedStack = this.simplifyStackTrace(alert.stackTrace);
      if (simplifiedStack) {
        message += `\n\n🔍 <b>Stack Trace:</b>\n<pre><code>${simplifiedStack}</code></pre>`;
      }
    }

    message += `\n━━━━━━━━━━━━━━━━━━━`;

    // Truncar si es muy largo
    if (message.length > this.config.maxMessageLength) {
      message = message.substring(0, this.config.maxMessageLength - 50) + '\n...\n━━━━━━━━━━━━━━━━━━━';
    }

    return message;
  }

  /**
   * Obtiene un fragmento de código relevante del archivo fuente
   */
  private async getRelevantCodeSnippet(alert: ErrorAlert): Promise<string | null> {
    try {
      if (!alert.lineNumber) return null;

      const filePath = join(process.cwd(), alert.fileName);
      const fileContent = readFileSync(filePath, 'utf-8');
      const lines = fileContent.split('\n');

      const startLine = Math.max(0, alert.lineNumber - 5);
      const endLine = Math.min(lines.length - 1, alert.lineNumber + 4);

      const snippet = lines
        .slice(startLine, endLine + 1)
        .map((line, index) => {
          const lineNum = startLine + index + 1;
          const marker = lineNum === alert.lineNumber ? '→' : ' ';
          return `${lineNum.toString().padStart(4)}${marker} ${line}`;
        })
        .join('\n');

      return snippet;
    } catch (error) {
      console.error('[ErrorAlert] Failed to get code snippet:', error);
      return null;
    }
  }

  /**
   * Simplifica el stack trace para mostrar solo las líneas más relevantes
   */
  private simplifyStackTrace(stackTrace: string): string | null {
    try {
      const lines = stackTrace.split('\n');
      const relevantLines = lines
        .filter(line => 
          line.includes('server/') && 
          !line.includes('node_modules') &&
          !line.includes('internal/')
        )
        .slice(0, 3);  // Solo las 3 líneas más relevantes

      return relevantLines.join('\n');
    } catch (error) {
      return null;
    }
  }

  /**
   * Crea una alerta de error desde un Error de JavaScript
   */
  static createFromError(
    error: Error,
    type: ErrorType,
    severity: ErrorSeverity,
    functionName: string,
    fileName: string,
    pair?: string,
    context?: Record<string, any>
  ): ErrorAlert {
    // Extraer número de línea del stack trace si es posible
    let lineNumber: number | undefined;
    if (error.stack) {
      const match = error.stack.match(new RegExp(`${fileName}:(\\d+):`));
      if (match) {
        lineNumber = parseInt(match[1]);
      }
    }

    return {
      type,
      message: error.message,
      pair,
      function: functionName,
      fileName,
      lineNumber,
      stackTrace: error.stack,
      timestamp: new Date(),
      severity,
      context
    };
  }

  /**
   * Crea una alerta de error personalizada
   */
  static createCustomAlert(
    type: ErrorType,
    message: string,
    severity: ErrorSeverity,
    functionName: string,
    fileName: string,
    lineNumber?: number,
    pair?: string,
    context?: Record<string, any>
  ): ErrorAlert {
    return {
      type,
      message,
      pair,
      function: functionName,
      fileName,
      lineNumber,
      timestamp: new Date(),
      severity,
      context
    };
  }
}

// Instancia singleton para uso global
export const errorAlertService = ErrorAlertService.getInstance();
