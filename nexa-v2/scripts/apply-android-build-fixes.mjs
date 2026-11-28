// NEXA v2 — fixes de build Android versionados e idempotentes.
//
// `cap sync` regenera android/capacitor-cordova-android-plugins/build.gradle
// desde plantillas de node_modules con versiones antiguas no disponibles en la
// caché Gradle offline (AGP 8.2.1, google-services 4.4.0). Este script aplica
// los reemplazos necesarios de forma idempotente para que el build sea
// reproducible desde un checkout limpio SIN ajustes manuales no versionados.
//
// Uso: node scripts/apply-android-build-fixes.mjs  (tras `npx cap sync android`)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REPLACEMENTS = [
  {
    file: "android/capacitor-cordova-android-plugins/build.gradle",
    pairs: [
      ["com.android.tools.build:gradle:8.2.1", "com.android.tools.build:gradle:8.13.0"],
      ["com.google.gms:google-services:4.4.0", "com.google.gms:google-services:4.4.4"],
    ],
  },
  {
    file: "android/build.gradle",
    pairs: [
      ["com.android.tools.build:gradle:8.2.1", "com.android.tools.build:gradle:8.13.0"],
      ["com.google.gms:google-services:4.4.0", "com.google.gms:google-services:4.4.4"],
    ],
  },
];

let changed = 0;
const report = [];
for (const spec of REPLACEMENTS) {
  const abs = path.join(root, spec.file);
  if (!fs.existsSync(abs)) {
    report.push({ file: spec.file, status: "missing_skip" });
    continue;
  }
  let content = fs.readFileSync(abs, "utf8");
  let touched = false;
  for (const [from, to] of spec.pairs) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
      touched = true;
    }
  }
  if (touched) {
    fs.writeFileSync(abs, content);
    changed++;
    report.push({ file: spec.file, status: "patched" });
  } else {
    report.push({ file: spec.file, status: "already_ok" });
  }
}
console.log(JSON.stringify({ changed, report }, null, 2));
