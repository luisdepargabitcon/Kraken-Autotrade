/**
 * Contraste de series 1h de fuentes públicas secundarias frente a Kraken (referencia primaria).
 *
 * Uso: npx tsx scripts/compare_secondary_sources.ts
 *
 * - Offline si existen los snapshots en data_public/secondary/ (reproducible).
 * - Si no existen, descarga SOLO endpoints públicos sin clave: 1 petición por fuente y par
 *   (Bitstamp, Bitfinex, Binance Spot; BTC y ETH) = 6 peticiones. Nota: la primera ejecución de Bitfinex usó sort=1 (devuelve el histórico más antiguo, error del script) y se repitió sin sort (newest-first, orden por defecto): 8 peticiones públicas en total.
 * - NO mezcla series ni volúmenes: cada fuente se mantiene separada; solo se alinean
 *   por hora de apertura para medir divergencia de cierre y ratio de volumen.
 * - Binance cotiza en USDT, no USD: la divergencia incluye la base USDT/USD y NO se
 *   trata como equivalente.
 *
 * Límites: ~30 días, una ventana, divergencia observada no es garantía futura.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const OUT = "AUDITORIAS/NEXA_INTEGRAL_2026-11-27";
const SEC_DIR = path.join(OUT, "data_public", "secondary");
const KRAKEN_DIR = path.join(OUT, "data_public");
const HOUR = 3_600_000;

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

const SOURCES = [
  {
    id: "bitstamp", quote: "USD",
    url: (p: string) => `https://www.bitstamp.net/api/v2/ohlc/${p === "BTC" ? "btcusd" : "ethusd"}/?step=3600&limit=720&exclude_current_candle=true`,
    parse: (j: any): Candle[] => j.data.ohlc.map((r: any) => ({ time: +r.timestamp * 1000, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.volume })),
  },
  {
    id: "bitfinex", quote: "USD",
    url: (p: string) => `https://api-pub.bitfinex.com/v2/candles/trade:1h:t${p}USD/hist?limit=720`,
    // Bitfinex orden documentado: [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME]
    parse: (j: any[]): Candle[] => j.map((r) => ({ time: r[0], open: r[1], close: r[2], high: r[3], low: r[4], volume: r[5] })),
  },
  {
    id: "binance_spot", quote: "USDT",
    url: (p: string) => `https://api.binance.com/api/v3/klines?symbol=${p}USDT&interval=1h&limit=720`,
    // Binance: [openTime, open, high, low, close, volume, closeTime, ...]
    parse: (j: any[]): Candle[] => j.map((r) => ({ time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] })),
  },
];

const sha = (c: Candle[]) => crypto.createHash("sha256").update(JSON.stringify(c)).digest("hex");

async function load(sourceId: string, asset: string) {
  fs.mkdirSync(SEC_DIR, { recursive: true });
  const file = path.join(SEC_DIR, `${sourceId}_${asset}_1h.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const src = SOURCES.find((s) => s.id === sourceId)!;
  const url = src.url(asset);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const status = res.status;
  const json: any = await res.json();
  const candles = src.parse(json).sort((a, b) => a.time - b.time);
  const snap = {
    source: sourceId, quote: src.quote, url, httpStatus: status, fetchedAt: new Date().toISOString(),
    count: candles.length, first: new Date(candles[0].time).toISOString(), last: new Date(candles.at(-1)!.time).toISOString(),
    sha256: sha(candles), candles,
  };
  fs.writeFileSync(file, JSON.stringify(snap, null, 2));
  return snap;
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r = (x: number | null, d = 4) => (x == null ? null : +x.toFixed(d));

async function main() {
  const results: any[] = [];
  const manifest: any[] = [];
  for (const asset of ["BTC", "ETH"]) {
    const krakenFile = path.join(KRAKEN_DIR, `${asset === "BTC" ? "XBTUSD" : "ETHUSD"}_60.json`);
    const kraken = JSON.parse(fs.readFileSync(krakenFile, "utf8"));
    const kMap = new Map<number, Candle>(kraken.candles.map((c: Candle) => [c.time, c]));
    for (const src of SOURCES) {
      const snap = await load(src.id, asset);
      manifest.push({ source: snap.source, asset, quote: snap.quote, url: snap.url, fetchedAt: snap.fetchedAt, candles: snap.count, first: snap.first, last: snap.last, sha256: snap.sha256 });
      const aligned: { k: Candle; s: Candle }[] = [];
      let timeMisaligned = 0, invalidOhlc = 0, dupTs = 0;
      const seen = new Set<number>();
      for (const c of snap.candles as Candle[]) {
        if (seen.has(c.time)) dupTs++;
        seen.add(c.time);
        if (c.time % HOUR !== 0) timeMisaligned++;
        if (!(c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close)) || c.close <= 0) invalidOhlc++;
        const k = kMap.get(c.time);
        if (k) aligned.push({ k, s: c });
      }
      const closeDiffPct = aligned.map(({ k, s }) => ((s.close - k.close) / k.close) * 100);
      const absDiff = closeDiffPct.map(Math.abs);
      const volRatio = aligned.filter(({ k }) => k.volume > 0).map(({ k, s }) => s.volume / k.volume);
      const gaps = (() => { const ts = (snap.candles as Candle[]).map((c) => c.time); let g = 0; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] !== HOUR) g++; return g; })();
      results.push({
        asset, source: src.id, quote: snap.quote, candles: snap.count, alignedWithKraken: aligned.length,
        gapsInSource: gaps, duplicateTimestamps: dupTs, nonHourAlignedTimestamps: timeMisaligned, invalidOhlcRows: invalidOhlc,
        closeDiffPct: { mean: r(mean(closeDiffPct)), meanAbs: r(mean(absDiff)), p95Abs: r(pct(absDiff, 95)), maxAbs: r(absDiff.length ? Math.max(...absDiff) : null) },
        volumeRatioVsKraken: { median: r(pct(volRatio, 50), 3), p5: r(pct(volRatio, 5), 3), p95: r(pct(volRatio, 95), 3) },
        note: src.quote === "USDT" ? "Cotización en USDT: la divergencia incluye la base USDT/USD; no es equivalente a USD." : "Cotización en USD.",
      });
    }
  }
  const out = {
    generatedAt: new Date().toISOString(),
    limits: "Una ventana de ~30 días; divergencia observada no garantiza el futuro; volúmenes de cada venue NO son sumables ni equivalentes.",
    results,
  };
  fs.writeFileSync(path.join(OUT, "ESTUDIO_FUENTES_RESULTADOS.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(SEC_DIR, "MANIFEST.json"), JSON.stringify({ generatedAt: out.generatedAt, files: manifest }, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
