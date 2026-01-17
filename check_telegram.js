import { storage } from './server/storage.js';

async function checkTelegramConfig() {
  try {
    const apiConfig = await storage.getApiConfig();
    console.log('=== CONFIGURACIÓN TELEGRAM EN BASE DE DATOS ===');
    console.log('Token:', apiConfig?.telegramToken || 'NO CONFIGURADO');
    console.log('Chat ID:', apiConfig?.telegramChatId || 'NO CONFIGURADO');
    console.log('Conectado:', apiConfig?.telegramConnected || false);
    console.log('==========================================');
    
    if (apiConfig?.telegramToken) {
      console.log('Token length:', apiConfig.telegramToken.length);
      console.log('Token starts with:', apiConfig.telegramToken.substring(0, 10) + '...');
    }
    
    if (apiConfig?.telegramChatId) {
      console.log('Chat ID length:', apiConfig.telegramChatId.length);
      console.log('Chat ID type:', typeof apiConfig.telegramChatId);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkTelegramConfig();
