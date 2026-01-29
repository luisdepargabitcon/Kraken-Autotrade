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
  private telegramService: any; // TelegramService inyectado dinámicamente
  private rateLimits: Map<string, AlertRateLimit> = new Map();
  
  // Configuración de alertas
  private config = {
    enabled: true,
    minSeverity: 'MEDIUM' as ErrorSeverity,
    rateLimitMinutes: 5,  // Máximo 1 alerta cada 5 min por tipo
    includeCodeSnippet: true,
    maxCodeLines: 10,
    maxCodeLinesHigh: 15,      // Más líneas para errores HIGH
    maxCodeLinesCritical: 25,  // Aún más líneas para errores CRITICAL
    maxMessageLength: 4000,    // Límite de Telegram menos margen
    maxMessageLengthCritical: 4000  // Mantener límite para errores críticos
  };

  private constructor() {
    // TelegramService se inyectará dinámicamente para evitar import circular
  }

  // Inyectar TelegramService dinámicamente
  setTelegramService(telegramService: any): void {
    this.telegramService = telegramService;
  }

  // Obtener TelegramService inyectado
  private async getTelegramService(): Promise<any> {
    // Si ya hay una instancia inyectada, usarla (evita conflicto 409)
    if (this.telegramService) {
      return this.telegramService;
    }
    
    // Import dinámico solo cuando se necesita (ESM compatible)
    const telegramModule = await import("./telegram");
    this.telegramService = new telegramModule.TelegramService();
    
    // Inicializar con token de apiConfig
    const apiConfig = await storage.getApiConfig();
    if (apiConfig?.telegramToken && apiConfig?.telegramChatId) {
      this.telegramService.initialize({
        token: apiConfig.telegramToken,
        chatId: apiConfig.telegramChatId,
      });
    }
    return this.telegramService;
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
      
      const telegramService = await this.getTelegramService();
      if (!telegramService.isInitialized()) return;

      const message = await this.formatAlertMessage(alert);
      
      // Obtener configuración del chat específico para alertas de errores
      const botConfig = await storage.getBotConfig();
      const errorAlertChatId = botConfig?.errorAlertChatId;
      
      if (errorAlertChatId) {
        // Enviar solo al chat específico configurado
        await telegramService.sendToSpecificChat(message, errorAlertChatId);
        console.log(`[ErrorAlert] Sent ${alert.type} alert to specific chat: ${errorAlertChatId}`);
      } else {
        // Enviar a todos los chats activos (comportamiento por defecto)
        await telegramService.sendAlertWithSubtype(message, "errors", "error_api");
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

    // Colores según severidad para Telegram
    const severityColors = {
      LOW: '', // Sin color (gris por defecto)
      MEDIUM: '🟡', // Amarillo/naranja
      HIGH: '🔴', // Rojo
      CRITICAL: '🚨' // Rojo crítico
    };

    const colorEnd = '';
    const currentColor = severityColors[alert.severity];

    let message = `${severityEmoji[alert.severity]} ${currentColor}<b>ERROR ${alert.severity}</b>${colorEnd} ${typeEmoji[alert.type]}
━━━━━━━━━━━━━━━━━━━
📦 ${currentColor}<b>Tipo:</b>${colorEnd} <code>${alert.type}</code>`;

    if (alert.pair) {
      message += `\n🔍 ${currentColor}<b>Par:</b>${colorEnd} <code>${alert.pair}</code>`;
    }

    message += `\n⏰ ${currentColor}<b>Hora:</b>${colorEnd} <code>${alert.timestamp.toLocaleString('es-ES')}</code>
📍 ${currentColor}<b>Archivo:</b>${colorEnd} <code>${alert.fileName}</code>
📍 ${currentColor}<b>Función:</b>${colorEnd} <code>${alert.function}()</code>`;

    if (alert.lineNumber) {
      message += `\n📍 ${currentColor}<b>Línea:</b>${colorEnd} <code>${alert.lineNumber}</code>`;
    }

    message += `\n\n❌ ${currentColor}<b>Error:</b>${colorEnd} ${alert.message}`;

    // Añadir contexto si existe
    if (alert.context && Object.keys(alert.context).length > 0) {
      message += `\n\n📋 ${currentColor}<b>Contexto:</b>${colorEnd}`;
      for (const [key, value] of Object.entries(alert.context)) {
        message += `\n   • ${currentColor}<b>${key}:</b>${colorEnd} <code>${JSON.stringify(value)}</code>`;
      }
    }

    // Añadir código fuente si está habilitado
    if (this.config.includeCodeSnippet) {
      const codeSnippet = await this.getRelevantCodeSnippet(alert);
      if (codeSnippet) {
        // Para errores críticos, añadir instrucción de copiado
        let copyInstruction = '';
        if (alert.severity === 'CRITICAL') {
          copyInstruction = `\n💡 <b>Para copiar:</b> Selecciona el código y usa Ctrl+C`;
        } else if (alert.severity === 'HIGH') {
          copyInstruction = `\n📋 <b>Código contextual:</b>`;
        } else {
          copyInstruction = `\n📋 <b>Código implicado:</b>`;
        }
        
        message += `\n\n📋 ${currentColor}<b>Código Fuente:</b>${colorEnd}${copyInstruction}\n<pre><code>${codeSnippet}</code></pre>`;
      }
    }

    // Añadir stack trace simplificado si existe
    if (alert.stackTrace) {
      const simplifiedStack = this.simplifyStackTrace(alert.stackTrace);
      if (simplifiedStack) {
        message += `\n\n🔍 ${currentColor}<b>Stack Trace:</b>${colorEnd}\n<pre><code>${simplifiedStack}</code></pre>`;
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

      // Determinar cuántas líneas mostrar según la severidad
      let contextLines = 5; // Por defecto: 5 antes, 4 después (10 total)
      
      if (alert.severity === 'HIGH') {
        contextLines = 7; // 7 antes, 7 después (15 total)
      } else if (alert.severity === 'CRITICAL') {
        contextLines = 12; // 12 antes, 12 después (25 total)
      }

      const startLine = Math.max(0, alert.lineNumber - contextLines);
      const endLine = Math.min(lines.length - 1, alert.lineNumber + (contextLines - 1));

      const snippet = lines
        .slice(startLine, endLine + 1)
        .map((line, index) => {
          const lineNum = startLine + index + 1;
          const marker = lineNum === alert.lineNumber ? '→' : ' ';
          return `${lineNum.toString().padStart(4)}${marker} ${line}`;
        })
        .join('\n');

      // Añadir información del archivo para facilitar la copia
      const fileInfo = `📁 Archivo: ${alert.fileName}:${alert.lineNumber}\n`;
      
      return fileInfo + snippet;
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
