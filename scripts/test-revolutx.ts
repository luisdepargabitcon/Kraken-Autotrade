// This script is intended to be read-only.
// Some server modules require DATABASE_URL at import-time; set a harmless default to avoid boot failure.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://readonly:readonly@127.0.0.1:5432/readonly';
}

async function testRevolutX() {
  console.log('=== TEST REVOLUT X API ===\n');

  // Load RevolutX credentials from database like the main bot does
  const { storage } = await import('../server/storage');
  const { revolutXService } = await import('../server/services/exchanges/RevolutXService');
  
  try {
    const apiConfig = await storage.getApiConfig();
    if (!apiConfig?.revolutxApiKey || !apiConfig?.revolutxPrivateKey) {
      console.error('ERROR: RevolutX credentials not found in database');
      process.exit(1);
    }
    
    const apiKey = apiConfig.revolutxApiKey;
    const privateKey = apiConfig.revolutxPrivateKey;
    
    console.log('API Key:', apiKey.substring(0, 10) + '...');
    console.log('Private Key present:', privateKey.length > 0 ? 'YES' : 'NO');
    console.log('Private Key starts with:', privateKey.substring(0, 30));
    console.log('');
    
    try {
      revolutXService.initialize({
        apiKey,
        apiSecret: '',
        privateKey
      });
      console.log('[OK] RevolutXService inicializado\n');
    } catch (err: any) {
      console.error('[ERROR] Al inicializar:', err.message);
      process.exit(1);
    }
  } catch (err: any) {
    console.error('[ERROR] loading credentials from database:', err.message);
    process.exit(1);
  }
  
  console.log('--- TEST 1: getBalance() ---');
  try {
    const balances = await revolutXService.getBalance();
    console.log('[OK] Balances:', JSON.stringify(balances, null, 2));
  } catch (err: any) {
    console.error('[ERROR] getBalance:', err.message);
  }
  
  console.log('\n--- TEST 2: getTicker("BTC/USD") ---');
  try {
    const ticker = await revolutXService.getTicker('BTC/USD');
    console.log('[OK] Ticker BTC/USD:', JSON.stringify(ticker, null, 2));
  } catch (err: any) {
    console.error('[ERROR] getTicker:', err.message);
  }
  
  console.log('\n--- TEST 3: getOHLC("BTC/USD", 5) ---');
  try {
    const ohlc = await revolutXService.getOHLC('BTC/USD', 5);
    console.log('[OK] OHLC count:', ohlc.length, 'candles');
    if (ohlc.length > 0) {
      console.log('Last candle:', JSON.stringify(ohlc[ohlc.length - 1], null, 2));
    }
  } catch (err: any) {
    console.error('[ERROR] getOHLC:', err.message);
  }
  
  console.log('\n=== FIN TEST ===');
}

testRevolutX().catch(console.error);
