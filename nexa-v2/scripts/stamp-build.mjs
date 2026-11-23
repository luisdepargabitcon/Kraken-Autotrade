// Sella web/js/build-info.js con la versión y commit reales antes de compilar.
// Uso: node scripts/stamp-build.mjs [--version 0.7.0] [--channel qa]
// El commit se lee de `git rev-parse --short HEAD`; el sello NO se commitea.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let version = arg('version', '0.0.0');
try {
  const gradle = readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
  const m = gradle.match(/versionName\s+"([^"]+)"/);
  if (m) version = arg('version', m[1]);
} catch {}
let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch {}

const channel = arg('channel', 'qa');
const builtAt = new Date().toISOString();
const file = path.join(root, 'web/js/build-info.js');
writeFileSync(file,
`// Sello de compilación de NEXA V2. Generado por scripts/stamp-build.mjs.
export const BUILD_INFO = {
  version: ${JSON.stringify(version)},
  commit: ${JSON.stringify(commit)},
  channel: ${JSON.stringify(channel)},
  builtAt: ${JSON.stringify(builtAt)},
};
`);
console.log(`[stamp-build] ${version} · ${commit} · ${channel} · ${builtAt}`);
