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
   * Envía mensaje al chat configurado en FISCO alert config
   */
  private async sendToConfiguredChat(message: string, alertType: string): Promise<void> {
    try {
      const config = await this.getAlertConfig();
      const chatId = config?.chatId;
      if (!chatId || chatId === 'not_configured') {
        console.warn(`[FISCO Telegram] No FISCO chat configured for ${alertType} alert`);
        return;
      }

      await telegramService.sendToChat(chatId, message, { parseMode: 'HTML' });

      console.log(`[FISCO Telegram] ${alertType} alert sent to chat ${chatId}`);
    } catch (error: any) {
      console.error(`[FISCO Telegram] Failed to send ${alertType} alert:`, error?.message || error);
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
      case 'scheduler': return 'Programador (08:00)';
      case 'ui_button': return 'Botón UI';
      case 'telegram_command': return 'Comando Telegram';
      default: return triggeredBy;
    }
  }
}

export const fiscoTelegramNotifier = FiscoTelegramNotifier.getInstance();
