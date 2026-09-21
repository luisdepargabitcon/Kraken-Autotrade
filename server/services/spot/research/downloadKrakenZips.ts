/**
 * Download Kraken quarterly ZIPs from Google Drive.
 * Downloads only the minimum quarters needed for >= 180 days of 5m data.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";

const RAW_DIR = process.env.KRAKEN_DATA_ROOT
  ? path.join(process.env.KRAKEN_DATA_ROOT, "raw")
  : "C:\\Users\\JSLUI\\Qsync\\BOT_NAS\\BOT_AUTOTRADE_SPOT_ADAPTIVE_V3_DATA\\kraken\\raw";

if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

// Quarterly ZIPs from https://drive.google.com/drive/folders/15RSlNuW_h0kVM8or8McOGOMfHeBFvFGI
const QUARTERLY_ZIPS = [
  { name: "Kraken_OHLCVT_Q3_2025.zip", gdriveId: "1N6fg5ceXx9iQHEGHyvqUUlgo3NPsRpT7", quarter: "Q3_2025" },
  { name: "Kraken_OHLCVT_Q4_2025.zip", gdriveId: "1QbPHLP0TTGo-lqwKn8M-_Xo_oexXlEnB", quarter: "Q4_2025" },
  { name: "Kraken_OHLCVT_Q1_2026.zip", gdriveId: "15QxEf_-rRS-Yt7uERCI41HMcQQPKzSHq", quarter: "Q1_2026" },
];

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function main() {
  const manifest: any[] = [];

  for (const zip of QUARTERLY_ZIPS) {
    const zipPath = path.join(RAW_DIR, zip.name);

    if (fs.existsSync(zipPath)) {
      const stat = fs.statSync(zipPath);
      console.log(`[Download] ${zip.name} already exists (${(stat.size / 1024 / 1024).toFixed(1)} MB), skipping`);
      const sha = sha256File(zipPath);
      manifest.push({
        filename: zip.name,
        gdrive_id: zip.gdriveId,
        size_bytes: stat.size,
        sha256: sha,
        downloaded_at_utc: new Date().toISOString(),
        source: "KRAKEN_OFFICIAL_GOOGLE_DRIVE_OHLCVT",
      });
      continue;
    }

    console.log(`[Download] Downloading ${zip.name} from Google Drive (id=${zip.gdriveId})...`);

    // Use gdown via child process
    try {
      execSync(
        `python -c "import gdown; gdown.download('https://drive.google.com/uc?id=${zip.gdriveId}', '${zipPath.replace(/\\/g, "\\\\")}', quiet=False)"`,
        { stdio: "inherit", timeout: 600000 }
      );

      if (fs.existsSync(zipPath)) {
        const stat = fs.statSync(zipPath);
        const sha = sha256File(zipPath);
        console.log(`[Download] ${zip.name} downloaded: ${(stat.size / 1024 / 1024).toFixed(1)} MB, sha256=${sha.substring(0, 16)}...`);
        manifest.push({
          filename: zip.name,
          gdrive_id: zip.gdriveId,
          size_bytes: stat.size,
          sha256: sha,
          downloaded_at_utc: new Date().toISOString(),
          source: "KRAKEN_OFFICIAL_GOOGLE_DRIVE_OHLCVT",
        });
      } else {
        console.error(`[Download] FAILED: ${zip.name} not found after download`);
      }
    } catch (e: any) {
      console.error(`[Download] ERROR downloading ${zip.name}: ${e.message}`);
    }
  }

  // Save ZIP manifest
  const manifestPath = path.join(RAW_DIR, "zip_manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n[Download] ZIP manifest saved to: ${manifestPath}`);
  console.log(`[Download] Downloaded ${manifest.length} ZIPs.`);
}

main().catch(e => {
  console.error("[Download] Fatal:", e);
  process.exit(1);
});
