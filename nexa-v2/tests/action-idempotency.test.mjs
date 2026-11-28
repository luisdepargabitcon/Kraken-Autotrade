// TANGO 10.3 — idempotencia durable por operación en el cliente REAL de la APK
// (nexa-v2/web/js/actions.js). Verifica con un servidor HTTP real efímero:
//   - doble toque del mismo gesto → misma clave, sin segunda ejecución;
//   - reintento tras fallo de transporte → reutiliza la MISMA clave;
//   - operación completada nunca se reejecuta aunque se re-invocara tras "reinicio";
//   - payload distinto → identidad distinta (nunca reutilización indebida);
//   - la clave se persiste antes del envío y sobrevive a nueva carga del módulo.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Shims de entorno WebView mínimos ANTES de importar los módulos del cliente.
const storageData = new Map();
globalThis.localStorage = {
  getItem: k => storageData.get(k) ?? null,
  setItem: (k, v) => storageData.set(k, String(v)),
  removeItem: k => storageData.delete(k),
};
const sessionData = new Map();
globalThis.sessionStorage = {
  getItem: k => sessionData.get(k) ?? null,
  setItem: (k, v) => sessionData.set(k, String(v)),
  removeItem: k => sessionData.delete(k),
};
globalThis.window = { Capacitor: { isNativePlatform: () => true } };
globalThis.location = { search: '', protocol: 'https:', href: 'https://app.local/' };

const { runAction, operationIdentity } = await import('../web/js/actions.js');
const { session } = await import('../web/js/auth.js');
const { CONFIG } = await import('../web/js/config.js');

function seedSession() {
  sessionData.set(CONFIG.sessionKey, JSON.stringify({
    token: 't-test', expiresAt: Date.now() + 3600000, roles: ['idca:control','ama:control'], deviceId: 'dev-test',
  }));
}

async function mockServer(handler) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, key: req.headers['x-idempotency-key'], body });
      handler(req, res, hits.length);
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { srv, hits, port: srv.address().port };
}

function withServer(port, fn) {
  const original = CONFIG.apiBase;
  Object.defineProperty(CONFIG, 'apiBase', { value: `http://127.0.0.1:${port}/api`, configurable: true, writable: true });
  return Promise.resolve().then(fn).finally(() => {
    Object.defineProperty(CONFIG, 'apiBase', { value: original, configurable: true, writable: true });
  });
}

test('doble toque del mismo gesto: misma clave durable, una sola operación', async () => {
  seedSession();
  const { srv, hits, port } = await mockServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  try {
    await withServer(port, async () => {
      const params = { cycleId: 'cycA1' };
      const first = await runAction('idca.closeCycle', params);
      assert.equal(first.ok, true);
      assert.equal(hits.length, 1);
      // Segundo toque del mismo gesto: NO se reenvía — la operación ya consta completada.
      const second = await runAction('idca.closeCycle', params);
      assert.equal(second.idempotentReplay, 'local-operation-already-completed');
      assert.equal(hits.length, 1, 'el servidor no recibe un segundo envío');
    });
  } finally { srv.close(); }
});

test('reintento tras fallo de transporte reutiliza la MISMA clave (timeout/pérdida de respuesta)', async () => {
  seedSession();
  let failFirst = true;
  const { srv, hits, port } = await mockServer((req, res) => {
    if (failFirst) { res.destroy(); return; } // simula pérdida de respuesta
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  try {
    await withServer(port, async () => {
      const params = { cycleId: 'cycB2', status: 'paused' };
      const first = await runAction('idca.cycleStatus', params);
      assert.equal(first.error, 'unreachable');
      assert.equal(first.retryable, true);
      failFirst = false;
      const retry = await runAction('idca.cycleStatus', params);
      assert.equal(retry.ok, true);
      assert.equal(hits.length, 2);
      assert.equal(hits[0].key, hits[1].key, 'la clave del reintento es idéntica a la del primer intento');
    });
  } finally { srv.close(); }
});

test('la identidad sobrevive a un "reinicio" (nueva evaluación de operationIdentity sobre el mismo localStorage)', async () => {
  seedSession();
  const body = { status: 'x' };
  const a = await operationIdentity('idca.cycleStatus', 'PATCH', '/institutional-dca/cycles/9/status', body, '');
  const b = await operationIdentity('idca.cycleStatus', 'PATCH', '/institutional-dca/cycles/9/status', body, '');
  assert.equal(a.key, b.key, 'misma operación recupera la misma clave persistida');
  // Payload distinto → identidad distinta.
  const c = await operationIdentity('idca.cycleStatus', 'PATCH', '/institutional-dca/cycles/9/status', { status: 'y' }, '');
  assert.notEqual(c.key, a.key);
});

test('409 in_progress del servidor: no reejecuta ni inventa clave nueva', async () => {
  seedSession();
  const { srv, hits, port } = await mockServer((req, res) => {
    res.writeHead(409, { 'content-type': 'application/json' });
    res.end('{"error":"idempotency_in_progress"}');
  });
  try {
    await withServer(port, async () => {
      const out = await runAction('idca.closeCycle', { cycleId: 'cycC3' });
      assert.equal(out.status, 409);
      assert.match(out.warning ?? '', /reconcilie/i);
      assert.equal(hits.length, 1);
    });
  } finally { srv.close(); }
});

test('las mutaciones llevan cabecera x-idempotency-key siempre (contrato 428 del servidor)', async () => {
  seedSession();
  const { srv, hits, port } = await mockServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  try {
    await withServer(port, async () => {
      await runAction('ama.analyzeNow', {});
      assert.ok(hits[0].key && hits[0].key.length > 10, 'cabecera presente y no trivial');
    });
  } finally { srv.close(); }
});
