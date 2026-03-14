/**
 * FISCO Telegram Notifier - Envío de alertas configurables para FISCO
 */

import { 
  FiscoSyncResult, 
  FiscoAlertConfigRow,
  FiscoSyncHistoryRow 
} from "@shared/schema";
import { 
  buildHeader, 
  escapeHtml, 
  formatSpanishDate 
} from "./telegram/templates";
import { telegramService } from "./telegram";
import { db } from "../db";
import { fiscoAlertConfig } from "@shared/schema";

export interface SyncAlertOptions {
  results: FiscoSyncResult[];
  mode: 'auto' | 'manual';
  runId: string;
  triggeredBy: string;
  summaryThreshold?: number;
}

export interface ReportAlertOptions {
  reportContent: string; // El informe fiscal generado (HTML o texto)
  reportFormat: 'html' | 'text';
  runId: string;
}

export class FiscoTelegramNotifier {
  private static instance: FiscoTelegramNotifier;

  public static getInstance(): FiscoTelegramNotifier {
    if (!FiscoTelegramNotifier.instance) {
      FiscoTelegramNotifier.instance = new FiscoTelegramNotifier();
    }
    return FiscoTelegramNotifier.instance;
  }

  /**
   * Envía alerta de sincronización diaria
   */
  async sendSyncDailyAlert(options: SyncAlertOptions): Promise<void> {
    const config = await this.getAlertConfig();
    if (!config?.syncDailyEnabled) return;

    // Verificar si hay operaciones nuevas
    const totalOps = options.results.reduce((sum, r) => sum + r.totalOperations, 0);
    if (totalOps === 0 && !config.notifyAlways) return;

    const message = this.buildSyncMessage(options, config);
    await this.sendToConfiguredChat(message, 'sync_daily');
  }

  /**
   * Envía alerta de sincronización manual
   */
  async sendSyncManualAlert(options: SyncAlertOptions): Promise<void> {
    const config = await this.getAlertConfig();
    if (!config?.syncManualEnabled) return;

    const message = this.buildSyncMessage(options, config);
    await this.sendToConfiguredChat(message, 'sync_manual');
  }

  /**
   * Envía alerta de informe fiscal generado
   */
  async sendReportGeneratedAlert(options: ReportAlertOptions): Promise<void> {
    const config = await this.getAlertConfig();
    if (!config?.reportGeneratedEnabled) return;

    // Enviar mensaje de notificación
    const notificationMessage = this.buildReportNotificationMessage(options);
    await this.sendToConfiguredChat(notificationMessage, 'report_generated');

    // Enviar el informe como archivo o mensaje
    if (options.reportFormat === 'html') {
      // Para HTML, enviar como archivo
      await this.sendHtmlReport(options.reportContent, options.runId);
    } else {
      // Para texto, enviar como mensaje
      await this.sendTextReport(options.reportContent);
    }
  }

  /**
   * Notifica que Kraken falló por RATE_LIMIT y se programó reintento
   */
  async sendKrakenRetryScheduled(nextRetryAt: Date, retryCount: number, errorCode: string): Promise<void> {
    const config = await this.getAlertConfig();
    if (!config?.errorSyncEnabled) return;
    const hhmm = nextRetryAt.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
    const message = [
      `⚠️ <b>FISCO — Kraken RATE_LIMIT</b>`,
      `━━━━━━━━━━━━━━━━━━━`,
      `🏦 <b>Exchange:</b> Kraken`,
      `❌ <b>Error:</b> <code>${escapeHtml(errorCode)}</code>`,
      `🔄 <b>Intento:</b> ${retryCount + 1}`,
      `⏰ <b>Reintento programado:</b> ${hhmm} (Europe/Madrid)`,
      ``,
      `<i>El bot reintentará automáticamente hasta 6 veces con backoff exponencial.</i>`,
    ].join('\n');
    await this.sendToConfiguredChat(message, 'kraken_retry_scheduled');
  }

  /**
   * Notifica que Kraken sync se recuperó correctamente tras reintentos
   */
  async sendKrakenRetryRecovered(totalAttempts: number, opsImported: number): Promise<void> {
    const config = await this.getAlertConfig();
    if (!config?.syncDailyEnabled && !config?.errorSyncEnabled) return;
    const message = [
      `✅ <b>FISCO — Kraken RECUPERADO</b>`,
      `━━━━━━━━━━━━━━━━━━━`,
      `🏦 <b>Exchange:</b> Kraken`,
      `🔄 <b>Intentos necesarios:</b> ${totalAttempts}`,
      `📦 <b>Operaciones importadas:</b> ${opsImported}`,
      `📅 <b>Fecha:</b> ${formatSpanishDate(new Date())}`,
    ].join('\n');
    await this.sendToConfiguredChat(message, 'kraken_retry_recovered');
  }

  /**
   * Notifica que se agotaron todos los reintentos de Kraken
   */
  async sendKrakenRetryExhausted(totalAttempts: number, lastErrorCode: string): Promise<void> {
    const config = await this.getAlertConfig();
    if (!config?.errorSyncEnabled) return;
    const message = [
      `🔴 <b>FISCO — Kraken REINTENTOS AGOTADOS</b>`,
      `━━━━━━━━━━━━━━━━━━━`,
      `🏦 <b>Exchange:</b> Kraken`,
      `❌ <b>Último error:</b> <code>${escapeHtml(lastErrorCode)}</code>`,
      `🔄 <b>Intentos realizados:</b> ${totalAttempts}`,
      `📅 <b>Fecha:</b> ${formatSpanishDate(new Date())}`,
      ``,
      `<i>⚠️ Kraken no pudo sincronizarse. Se reintentará mañana a las 08:30.</i>`,
    ].join('\n');
    await this.sendToConfiguredChat(message, 'kraken_retry_exhausted');
  }

  /**
   * Envía alerta de error en sincronización
   */
  async sendSyncErrorAlert(error: string, runId: string, exchange?: string): Promise<void> {
    const config = await this.getAlertConfig();
    if (!config?.errorSyncEnabled) return;

    const message = this.buildErrorMessage(error, runId, exchange);
    await this.sendToConfiguredChat(message, 'sync_error');
  }

  /**
   * Construye mensaje de sincronización
   */
  private buildSyncMessage(options: SyncAlertOptions, config: FiscoAlertConfigRow): string {
    const { results, mode, runId, triggeredBy } = options;
    const threshold = config.summaryThreshold || 30;
    
    const header = buildHeader();
    const modeEmoji = mode === 'auto' ? '🔄' : '🔧';
    const triggerLabel = this.getTriggerLabel(triggeredBy);
    
    const lines: string[] = [
      `${header}`,
      ``,
      `${modeEmoji} <b>Sincronización ${mode === 'auto' ? 'Automática' : 'Manual'}</b>`,
      `━━━━━━━━━━━━━━━━━━━`,
      `🕐 <b>Ejecución:</b> ${escapeHtml(triggerLabel)}`,
      `🆔 <b>ID:</b> <code>${escapeHtml(runId)}</code>`,
      `📅 <b>Fecha:</b> ${formatSpanishDate(new Date())}`,
      ``
    ];

    // Resumen general
    const totalOps = results.reduce((sum, r) => sum + r.totalOperations, 0);
    const successfulExchanges = results.filter(r => r.status === 'success').length;
    const warningExchanges = results.filter(r => r.status === 'warning').length;
    const errorExchanges = results.filter(r => r.status === 'error').length;

    lines.push(`📊 <b>Resumen General:</b>`);
    lines.push(`   • Exchanges: ${results.length} (${successfulExchanges} ✅ ${warningExchanges > 0 ? warningExchanges + ' ⚠️' : ''}${errorExchanges > 0 ? errorExchanges + ' ❌' : ''})`);
    lines.push(`   • Operaciones totales: <b>${totalOps}</b>`);
    lines.push(``);

    // Detalle por exchange
    if (totalOps <= threshold) {
      // Detalle completo
      lines.push(`📋 <b>Detalle Completo:</b>`);
      for (const result of results) {
        const statusEmoji = this.getStatusEmoji(result.status);
        lines.push(``);
        lines.push(`${statusEmoji} <b>${escapeHtml(result.exchange)}</b>`);
        
        if (result.error) {
          lines.push(`   ❌ <b>Error:</b> ${escapeHtml(result.error)}`);
        } else {
          lines.push(`   📈 Trades: <b>${result.tradesImported}</b>`);
          lines.push(`   💰 Depósitos: <b>${result.depositsImported}</b>`);
          lines.push(`   💸 Retiros: <b>${result.withdrawalsImported}</b>`);
          lines.push(`   🎁 Staking/Rewards: <b>${result.stakingRewardsImported}</b>`);
          lines.push(`   📦 Total: <b>${result.totalOperations}</b>`);
          
          if (result.assetsAffected.length > 0) {
            const assetsList = result.assetsAffected.slice(0, 10).join(', ');
            const moreText = result.assetsAffected.length > 10 ? ` +${result.assetsAffected.length - 10} más` : '';
            lines.push(`   🪙 Activos: <code>${assetsList}${moreText}</code>`);
          }
          
          if (result.lastSyncAt) {
            lines.push(`   🕐 Última sync: ${formatSpanishDate(result.lastSyncAt)}`);
          }
        }
      }
    } else {
      // Resumen
      lines.push(`📋 <b>Resumen por Exchange:</b>`);
      for (const result of results) {
        const statusEmoji = this.getStatusEmoji(result.status);
        const summaryText = result.error 
          ? `❌ Error: ${escapeHtml(result.error).substring(0, 50)}...`
          : `📦 ${result.totalOperations} ops (${result.assetsAffected.length} activos)`;
        
        lines.push(`${statusEmoji} <b>${escapeHtml(result.exchange)}:</b> ${summaryText}`);
      }
      
      lines.push(``);
      lines.push(`💡 <i>Se muestran resúmenes por superar ${threshold} operaciones totales</i>`);
    }

    lines.push(``);
    lines.push(`━━━━━━━━━━━━━━━━━━━`);
    lines.push(`<i>sincronizado: ${formatSpanishDate(new Date())} (Europe/Madrid)</i>`);

    return lines.join('\n');
  }

  /**
   * Construye mensaje de notificación de informe
   */
  private buildReportNotificationMessage(options: ReportAlertOptions): string {
    const header = buildHeader();
    
    const lines: string[] = [
      `${header}`,
      ``,
      `📄 <b>Informe Fiscal Generado</b>`,
      `━━━━━━━━━━━━━━━━━━━`,
      `🆔 <b>ID Ejecución:</b> <code>${escapeHtml(options.runId)}</code>`,
      `📅 <b>Fecha:</b> ${formatSpanishDate(new Date())}`,
      `📋 <b>Formato:</b> ${options.reportFormat === 'html' ? 'HTML (archivo adjunto)' : 'Texto plano'}`,
      ``,
      `✅ El informe fiscal ha sido generado y se enviará a continuación.`,
      ``,
      `━━━━━━━━━━━━━━━━━━━`
    ];

    return lines.join('\n');
  }

  /**
   * Construye mensaje de error
   */
  private buildErrorMessage(error: string, runId: string, exchange?: string): string {
    const header = buildHeader();
    
    const lines: string[] = [
      `${header}`,
      ``,
      `🔴 <b>ERROR en Sincronización FISCO</b>`,
      `━━━━━━━━━━━━━━━━━━━`,
      `🆔 <b>ID Ejecución:</b> <code>${escapeHtml(runId)}</code>`,
      `📅 <b>Fecha:</b> ${formatSpanishDate(new Date())}`,
      ``
    ];

    if (exchange) {
      lines.push(`🏦 <b>Exchange:</b> <code>${escapeHtml(exchange)}</code>`);
      lines.push(``);
    }

    lines.push(`❌ <b>Error:</b>`);
    lines.push(`<code>${escapeHtml(error)}</code>`);
    lines.push(``);
    lines.push(`━━━━━━━━━━━━━━━━━━━`);

    return lines.join('\n');
  }

  /**
   * Maps internal FISCO alert types to unified AlertSubtype for sendAlertWithSubtype
   */
  private mapToUnifiedSubtype(alertType: string): string | null {
    const mapping: Record<string, string> = {
      'sync_daily': 'fisco_sync_daily',
      'sync_manual': 'fisco_sync_manual',
      'report_generated': 'fisco_report_generated',
      'sync_error': 'fisco_error_sync',
      'kraken_retry_scheduled': 'fisco_error_sync',
      'kraken_retry_recovered': 'fisco_sync_daily',
      'kraken_retry_exhausted': 'fisco_error_sync',
    };
    return mapping[alertType] || null;
  }

  /**
   * Envía mensaje usando el sistema unificado (sendAlertWithSubtype) + chat dedicado FISCO
   */
  private async sendToConfiguredChat(message: string, alertType: string): Promise<void> {
    const unifiedSubtype = this.mapToUnifiedSubtype(alertType);

    // 1) Broadcast via unified system (respects per-chat alertPreferences)
    if (unifiedSubtype) {
      try {
        await telegramService.sendAlertWithSubtype(message, 'fisco' as any, unifiedSubtype as any);
        console.log(`[FISCO Telegram] ${alertType} → sendAlertWithSubtype(fisco, ${unifiedSubtype})`);
      } catch (error: any) {
        console.error(`[FISCO Telegram] sendAlertWithSubtype failed for ${alertType}:`, error?.message || error);
      }
    }

    // 2) Also send to FISCO-dedicated chat if configured and not already covered
    try {
      const config = await this.getAlertConfig();
      const chatId = config?.chatId;
      if (!chatId || chatId === 'not_configured') return;

      // Avoid double-send: check if this chatId is already a registered telegram chat
      // If it is, sendAlertWithSubtype already sent to it
      const { storage } = await import('../storage');
      const registeredChats = await storage.getTelegramChats();
      const alreadySent = registeredChats.some(c => c.chatId === chatId && c.isActive);

      if (!alreadySent) {
        await telegramService.sendToChat(chatId, message, { parseMode: 'HTML' });
        console.log(`[FISCO Telegram] ${alertType} also sent to dedicated FISCO chat ${chatId}`);
      }
    } catch (error: any) {
      console.error(`[FISCO Telegram] Failed to send ${alertType} to dedicated chat:`, error?.message || error);
    }
  }

  /**
   * Envía informe HTML como archivo adjunto
   */
  private async sendHtmlReport(htmlContent: string, runId: string): Promise<void> {
    try {
      const config = await this.getAlertConfig();
      const chatId = config?.chatId;
      if (!chatId || chatId === 'not_configured') return;

      const year = new Date().getFullYear();
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `Informe_Fiscal_${year}_${dateStr}.html`;
      const fileBuffer = Buffer.from(htmlContent, 'utf-8');
      const caption = `📄 <b>Informe Fiscal ${year}</b>\n📅 Generado: ${formatSpanishDate(new Date())}\n💡 <i>Abrir en navegador para ver el informe completo</i>`;

      await telegramService.sendDocumentToChat(chatId, fileBuffer, filename, caption);

    } catch (error: any) {
      console.error('[FISCO Telegram] Failed to send HTML report:', error?.message || error);
    }
  }

  /**
   * Envía informe en formato texto
   */
  private async sendTextReport(textContent: string): Promise<void> {
    try {
      const config = await this.getAlertConfig();
      const chatId = config?.chatId;
      if (!chatId || chatId === 'not_configured') return;

      const truncatedContent = textContent.length > 4000 
        ? textContent.substring(0, 4000) + '...\n\n[Contenido truncado]'
        : textContent;

      await telegramService.sendToChat(chatId, `📄 <b>Informe Fiscal</b>\n\n${truncatedContent}`, { parseMode: 'HTML' });

    } catch (error: any) {
      console.error('[FISCO Telegram] Failed to send text report:', error?.message || error);
    }
  }

  /**
   * Obtiene configuración de alertas FISCO (usa el chatId propio de FISCO, no el default global)
   */
  private async getAlertConfig(): Promise<FiscoAlertConfigRow | undefined> {
    try {
      const configs = await db
        .select()
        .from(fiscoAlertConfig)
        .limit(1);

      return configs[0];
    } catch (error: any) {
      console.error('[FISCO Telegram] Error getting alert config:', error?.message || error);
      return undefined;
    }
  }

  /**
   * Obtiene emoji de estado
   */
  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'success': return '✅';
      case 'warning': return '⚠️';
      case 'error': return '❌';
      default: return '❓';
    }
  }

  /**
   * Obtiene etiqueta del trigger
   */
  private getTriggerLabel(triggeredBy: string): string {
    switch (triggeredBy) {
      case 'scheduler': return 'Programador (08:30)';
      case 'ui_button': return 'Botón UI';
      case 'telegram_command': return 'Comando Telegram';
      default: return triggeredBy;
    }
  }
}

export const fiscoTelegramNotifier = FiscoTelegramNotifier.getInstance();
