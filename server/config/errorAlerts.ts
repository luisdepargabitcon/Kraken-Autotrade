import type { ErrorSeverity } from "../services/ErrorAlertService";

/**
 * Configuración del sistema de alertas de errores críticos
 */
export const ERROR_ALERT_CONFIG = {
  // Habilitar/deshabilitar el sistema de alertas
  enabled: true,
  
  // Severidad mínima para enviar alertas
  minSeverity: 'MEDIUM' as ErrorSeverity,
  
  // Rate limiting: minutos entre alertas del mismo tipo
  rateLimitMinutes: 5,
  
  // Incluir fragmentos de código fuente en las alertas
  includeCodeSnippet: true,
  
  // Máximo número de líneas de código a mostrar
  maxCodeLines: 10,
  
  // Límite de caracteres por mensaje de Telegram
  maxMessageLength: 4000,
  
  // Configuración específica por tipo de error
  typeConfig: {
    PRICE_INVALID: {
      severity: 'HIGH' as ErrorSeverity,
      rateLimitMinutes: 3, // Más frecuente para precios
      includeContext: true
    },
    API_ERROR: {
      severity: 'MEDIUM' as ErrorSeverity,
      rateLimitMinutes: 5,
      includeContext: true
    },
    DATABASE_ERROR: {
      severity: 'CRITICAL' as ErrorSeverity,
      rateLimitMinutes: 2, // Muy crítico
      includeContext: true
    },
    TRADING_ERROR: {
      severity: 'CRITICAL' as ErrorSeverity,
      rateLimitMinutes: 1, // Inmediato para trading
      includeContext: true
    },
    SYSTEM_ERROR: {
      severity: 'HIGH' as ErrorSeverity,
      rateLimitMinutes: 5,
      includeContext: true
    }
  },
  
  // Patrones de errores a ignorar (para evitar spam)
  ignorePatterns: [
    /connection.*timeout/i,
    /temporary.*unavailable/i,
    /rate.*limit.*exceeded/i
  ],
  
  // Configuración de contexto adicional
  contextConfig: {
    // Incluir información del sistema en alertas críticas
    includeSystemInfo: true,
    
    // Incluir stack trace simplificado
    includeStackTrace: true,
    
    // Incluir información del usuario/request cuando aplique
    includeRequestInfo: true
  }
};

/**
 * Mensajes de acción recomendada por tipo de error
 */
export const ERROR_ACTION_MESSAGES = {
  PRICE_INVALID: "🔧 Verificar conexión con exchange de datos y validar configuración de API",
  API_ERROR: "🌐 Revisar conectividad de red y estado de APIs externas",
  DATABASE_ERROR: "🗄️ Verificar estado de PostgreSQL y conexiones de base de datos",
  TRADING_ERROR: "📈 Revisar configuración de trading y estado de exchanges",
  SYSTEM_ERROR: "⚙️ Verificar recursos del sistema y logs de aplicación"
};

/**
 * Emojis por severidad de error
 */
export const SEVERITY_EMOJIS = {
  LOW: '⚠️',
  MEDIUM: '🟡', 
  HIGH: '🔴',
  CRITICAL: '🚨'
};

/**
 * Emojis por tipo de error
 */
export const ERROR_TYPE_EMOJIS = {
  PRICE_INVALID: '💰',
  API_ERROR: '🌐',
  DATABASE_ERROR: '🗄️',
  TRADING_ERROR: '📈',
  SYSTEM_ERROR: '⚙️'
};
