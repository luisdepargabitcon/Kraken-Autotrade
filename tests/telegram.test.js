// Test formatSpanishDate function
const { formatSpanishDate } = require('../server/services/telegram');

function testFormatSpanishDate() {
  console.log('Testing formatSpanishDate...');
  
  // Test valid date
  const validDate = new Date('2026-01-16T12:00:00Z');
  const result1 = formatSpanishDate(validDate);
  console.log('Valid date:', result1);
  console.assert(!result1.includes('Invalid'), 'Valid date should not contain "Invalid"');
  console.assert(!result1.includes('N/A'), 'Valid date should not contain "N/A"');
  
  // Test invalid date
  const result2 = formatSpanishDate('invalid date string');
  console.log('Invalid date:', result2);
  console.assert(result2 === 'N/A', 'Invalid date should return "N/A"');
  
  // Test undefined
  const result3 = formatSpanishDate(undefined);
  console.log('Undefined date:', result3);
  console.assert(!result3.includes('Invalid'), 'Undefined date should not contain "Invalid"');
  
  console.log('✅ formatSpanishDate tests passed');
}

// Test normalizePanelUrl function
const { normalizePanelUrl } = require('../server/services/telegram');

function testNormalizePanelUrl() {
  console.log('Testing normalizePanelUrl...');
  
  // Test valid URL with protocol
  const result1 = normalizePanelUrl('https://example.com');
  console.log('Valid URL:', result1);
  console.assert(result1 === 'https://example.com', 'Valid URL should remain unchanged');
  
  // Test URL without protocol
  const result2 = normalizePanelUrl('example.com');
  console.log('URL without protocol:', result2);
  console.assert(result2 === 'https://example.com', 'URL without protocol should get https://');
  
  // Test invalid URL
  const result3 = normalizePanelUrl('not-a-url');
  console.log('Invalid URL:', result3);
  console.assert(result3 === null, 'Invalid URL should return null');
  
  // Test empty/undefined
  const result4 = normalizePanelUrl('');
  console.log('Empty URL:', result4);
  console.assert(result4 === null, 'Empty URL should return null');
  
  console.log('✅ normalizePanelUrl tests passed');
}

if (require.main === module) {
  testFormatSpanishDate();
  testNormalizePanelUrl();
  console.log('All tests completed successfully!');
}

module.exports = { testFormatSpanishDate, testNormalizePanelUrl };
