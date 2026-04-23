/**
 * Test básico para IdcaMarketContextService
 */
const { idcaMarketContextService } = require('../services/institutionalDca/IdcaMarketContextService');

async function testMarketContextService() {
  console.log('🧪 Testing IdcaMarketContextService...');
  
  try {
    // Test single context
    console.log('📊 Testing single context for BTC/USD...');
    const btcContext = await idcaMarketContextService.getMarketContext('BTC/USD');
    console.log('✅ BTC Context:', {
      pair: btcContext.pair,
      anchorPrice: btcContext.anchorPrice,
      currentPrice: btcContext.currentPrice,
      drawdownPct: btcContext.drawdownPct?.toFixed(2) + '%',
      vwapZone: btcContext.vwapZone,
      atrPct: btcContext.atrPct?.toFixed(2) + '%',
      dataQuality: btcContext.dataQuality,
    });
    
    // Test preview
    console.log('🔍 Testing preview context...');
    const preview = await idcaMarketContextService.getPreviewContext('BTC/USD');
    console.log('✅ Preview:', preview);
    
    // Test multiple contexts
    console.log('📈 Testing multiple contexts...');
    const contexts = await idcaMarketContextService.getMultipleContexts(['BTC/USD', 'ETH/USD']);
    console.log('✅ Multiple contexts:', contexts.map(c => ({
      pair: c.pair,
      drawdownPct: c.drawdownPct?.toFixed(2) + '%',
      dataQuality: c.dataQuality,
    })));
    
    // Test cache
    console.log('💾 Testing cache...');
    const start = Date.now();
    await idcaMarketContextService.getMarketContext('BTC/USD'); // Should hit cache
    const cachedTime = Date.now() - start;
    console.log(`✅ Cached response time: ${cachedTime}ms`);
    
    console.log('🎉 All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  testMarketContextService();
}

module.exports = { testMarketContextService };
