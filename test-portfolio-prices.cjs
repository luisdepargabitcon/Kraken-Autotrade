// Test de precios de portfolio desde API
// Uso: node test-portfolio-prices.cjs
const { Client } = require('pg');

async function testPortfolioPrices() {
  console.log('=== TEST PRECIOS PORTFOLIO ===\n');
  
  try {
    // 1. Obtener balances de RevolutX desde DB
    const dbClient = new Client({
      connectionString: process.env.DATABASE_URL
    });
    
    await dbClient.connect();
    console.log('✅ Conectado a PostgreSQL\n');
    
    // 2. Simular lo que hace el endpoint /api/prices/portfolio
    const coinGeckoIds = {
      "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana",
      "VET": "vechain", "FLR": "flare-networks",
      "MEW": "cat-in-a-dogs-world", "LMWR": "limewire", "ZKJ": "polyhedra-network",
      "USDC": "usd-coin", "USDT": "tether",
    };
    
    const stablecoins = ["USD", "ZUSD", "USDC", "USDT", "EUR", "GBP"];
    
    // 3. Obtener precios desde CoinGecko
    const assets = Object.keys(coinGeckoIds);
    const ids = assets.map(a => coinGeckoIds[a]).join(',');
    
    console.log('🌐 Consultando CoinGecko API...');
    console.log('   Assets:', assets.join(', '));
    console.log('   IDs:', ids.substring(0, 80) + '...\n');
    
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error('❌ Error CoinGecko:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('   Response:', errorText.substring(0, 200));
      process.exit(1);
    }
    
    const data = await response.json();
    console.log('✅ Precios obtenidos de CoinGecko\n');
    
    // 4. Mapear precios a símbolos
    const prices = {};
    for (const [symbol, geckoId] of Object.entries(coinGeckoIds)) {
      if (data[geckoId]?.usd) {
        prices[symbol] = {
          price: data[geckoId].usd,
          change: data[geckoId].usd_24h_change || 0,
          source: 'coingecko'
        };
      }
    }
    
    // Stablecoins tienen precio fijo
    for (const stable of stablecoins) {
      prices[stable] = {
        price: stable === "EUR" ? 1.08 : 1,
        change: 0,
        source: 'fixed'
      };
    }
    
    console.log('📊 Precios mapeados:\n');
    console.table(Object.entries(prices).map(([symbol, info]) => ({
      Symbol: symbol,
      Price: `$${info.price.toFixed(info.price < 1 ? 6 : 2)}`,
      Change24h: `${info.change >= 0 ? '+' : ''}${info.change.toFixed(2)}%`,
      Source: info.source
    })));
    
    // 5. Calcular valor real del portfolio
    console.log('\n💰 Calculando valor real del portfolio...\n');
    
    const testBalances = {
      'MEW': 872.74688513,
      'VET': 176.58970579,
      'FLR': 129.91076927,
      'LMWR': 40.44030040,
      'ZKJ': 21.64307209,
      'USDC': 5.605072,
      'ETH': 0.13894468,
      'USD': 1199.78
    };
    
    let totalValue = 0;
    const breakdown = [];
    
    for (const [symbol, balance] of Object.entries(testBalances)) {
      const priceInfo = prices[symbol];
      if (!priceInfo) {
        console.warn(`⚠️  No hay precio para ${symbol}`);
        continue;
      }
      
      const value = balance * priceInfo.price;
      totalValue += value;
      
      breakdown.push({
        Symbol: symbol,
        Balance: balance.toFixed(symbol === 'ETH' ? 8 : 2),
        Price: `$${priceInfo.price.toFixed(priceInfo.price < 1 ? 6 : 2)}`,
        Value: `$${value.toFixed(2)}`,
        Percent: '' // Se calcula después
      });
    }
    
    // Añadir porcentajes
    breakdown.forEach(item => {
      const value = parseFloat(item.Value.replace('$', '').replace(',', ''));
      item.Percent = `${((value / totalValue) * 100).toFixed(1)}%`;
    });
    
    // Ordenar por valor descendente
    breakdown.sort((a, b) => {
      const valA = parseFloat(a.Value.replace('$', '').replace(',', ''));
      const valB = parseFloat(b.Value.replace('$', '').replace(',', ''));
      return valB - valA;
    });
    
    console.table(breakdown);
    
    console.log(`\n✅ VALOR TOTAL REAL: $${totalValue.toFixed(2)}`);
    console.log(`   (vs $1,624.14 mostrado en dashboard - diferencia por precios incorrectos)\n`);
    
    await dbClient.end();
    
  } catch (error) {
    console.error('\n❌ Error durante el test:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testPortfolioPrices();
