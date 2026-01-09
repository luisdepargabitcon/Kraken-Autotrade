import crypto from 'crypto';

const privateKeyRaw = process.env.REVOLUTX_PRIVATE_KEY || '';
const apiKey = process.env.REVOLUTX_API_KEY || '';

function normalizePemKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes('\n')) {
    return trimmed;
  }
  
  const beginPrivate = '-----BEGIN PRIVATE KEY-----';
  const endPrivate = '-----END PRIVATE KEY-----';
  
  let cleaned = trimmed
    .replace(beginPrivate, '')
    .replace(endPrivate, '')
    .replace(/\s+/g, '');
  
  return `${beginPrivate}\n${cleaned}\n${endPrivate}`;
}

async function debug() {
  const privateKey = normalizePemKey(privateKeyRaw);
  console.log('=== DEBUG REVOLUT X ===\n');
  console.log('API Key:', apiKey.substring(0, 20) + '...');
  console.log('Private Key (normalized):\n', privateKey, '\n');

  // Test key parsing
  try {
    const keyObject = crypto.createPrivateKey(privateKey);
    console.log('[OK] Key type:', keyObject.type);
    console.log('[OK] asymmetricKeyType:', keyObject.asymmetricKeyType);
  } catch (err: any) {
    console.log('[ERROR] Key parse failed:', err.message);
    process.exit(1);
  }

  // Test signature
  const timestamp = Date.now().toString();
  const method = 'GET';
  const path = '/api/1.0/balances';
  const message = timestamp + method + path;

  console.log('\n--- Signature Test ---');
  console.log('Message:', message);

  try {
    const signatureBuffer = crypto.sign(null, Buffer.from(message), privateKey);
    const signature = signatureBuffer.toString('base64');
    console.log('[OK] Signature:', signature.substring(0, 50) + '...');
    
    // Now make actual request
    console.log('\n--- API Request Test ---');
    const headers = {
      'Content-Type': 'application/json',
      'X-Revx-Api-Key': apiKey,
      'X-Revx-Timestamp': timestamp,
      'X-Revx-Signature': signature
    };
    
    console.log('Headers:', JSON.stringify(headers, null, 2));
    
    const response = await fetch('https://revx.revolut.com' + path, { headers });
    console.log('Status:', response.status, response.statusText);
    const body = await response.text();
    console.log('Body:', body.substring(0, 500));
    
  } catch (err: any) {
    console.log('[ERROR]', err.message);
  }
}

debug();
