/**
 * Visual audit for /grid-isolated at 360/390/768/1280px.
 * Serves the built client from dist/public, mocks the Grid API, and uses
 * the locally installed Edge browser via puppeteer-core.
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist", "public");
const outDir = path.join(root, "visual-audit");
await fs.mkdir(outDir, { recursive: true });

// ── Static SPA server ─────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = url.pathname;

  const send = async (filePath, contentType) => {
    try {
      const data = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  };

  if (pathname.startsWith("/assets/")) {
    const asset = path.join(distDir, pathname);
    const ext = path.extname(asset);
    const ct = ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
    return send(asset, ct);
  }
  if (pathname === "/" || pathname === "/grid-isolated") {
    return send(path.join(distDir, "index.html"), "text/html");
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/grid-isolated`;

// ── Mock data ─────────────────────────────────────────────────────
const mockConfig = {
  id: 1,
  pair: "BTC/USD",
  mode: "SHADOW",
  isActive: true,
  executionPolicy: "MAKER_ONLY",
  capitalProfile: "balanced",
  gridWalletMaxUsd: 5000,
  gridWalletUseProfits: true,
  gridWalletCompoundProfits: true,
  adaptiveRangeMinViableLevels: 4,
  netProfitTargetPct: 0.8,
  adaptiveRangeProfile: "balanced",
  hodlRecoveryEnabled: true,
  maxOpenCycles: 10,
  maxDailyOrders: 300,
  takerFallbackEnabled: false,
  takerFallbackAttemptNumber: 4,
  makerAttemptsBeforeTaker: 3,
};

const mockStatus = {
  isRunning: true,
  activeRangeVersionId: "r1",
  activeRangeVersionNumber: 1,
  currentPrice: 95000,
  currentBid: 94990,
  currentAsk: 95010,
  priceSource: "kraken",
  priceFresh: true,
  realOpenOrdersCount: 0,
};

const operational = {
  header: {
    title: "GRID AISLADO BTC/USD",
    mode: "SHADOW",
    isActive: true,
    isRunning: true,
    makerOnly: true,
    currentPrice: 95000,
    currentBid: 94990,
    currentAsk: 95010,
    priceSource: "kraken",
    priceFresh: true,
    openCycles: 1,
    totalNetPnlUsd: 12.34,
    realOpenOrdersCount: 0,
  },
  overview: {
    summary: "Rango activo en simulación",
    problem: null,
    nextAction: "Revisa los niveles generados",
    canAnalyzeNow: true,
    hasActiveRange: true,
    primaryRecommendation: {
      title: "Ajustar objetivo neto",
      explanation: "Baja el objetivo para encajar más niveles.",
      ctaLabel: "Probar ajuste",
    },
  },
  currentRange: {
    exists: true,
    lowerPrice: 93000,
    centerPrice: 95000,
    upperPrice: 97000,
  },
  openCycles: [
    {
      id: "c25",
      cycleNumber: 25,
      pair: "BTC/USD",
      status: "buy_filled",
      color: "cyan",
      statusLabel: "Compra ejecutada",
      buyPrice: 93000,
      targetSellPrice: 95000,
      currentBid: 94000,
      currentPrice: 94000,
      progressPct: 35,
      estimatedNetPnl: 5.5,
      rangeRelation: "previous",
      durationLabel: "2 h",
    },
  ],
  closedCycles: [
    {
      id: "c10",
      cycleNumber: 10,
      pair: "BTC/USD",
      status: "completed",
      color: "green",
      statusLabel: "Completado",
      buyPrice: 90000,
      targetSellPrice: 92000,
      estimatedNetPnl: 10,
    },
  ],
  cancelledCycles: [
    {
      id: "c5",
      cycleNumber: 5,
      pair: "BTC/USD",
      status: "cancelled",
      color: "red",
      statusLabel: "Cancelado",
      buyPrice: 91000,
      targetSellPrice: 93000,
      estimatedNetPnl: -1,
    },
  ],
  levels: {
    activeRangeLevels: [
      { id: "l1", side: "BUY", price: 94000, quantity: 0.01, status: "planned", statusLabel: "Planificado", targetOfOpenCycle: false, rangeRelation: "current", rangeLabel: "Rango vigente" },
      { id: "l1s", side: "SELL", price: 96000, quantity: 0.01, status: "open", statusLabel: "Objetivo", targetOfOpenCycle: true, cycleNumber: 1, rangeRelation: "current", rangeLabel: "Rango vigente" },
    ],
    openCycleTargetLevels: [
      { id: "l2", side: "SELL", price: 96000, quantity: 0.01, status: "open", statusLabel: "Objetivo", targetOfOpenCycle: true, cycleNumber: 1, rangeRelation: "current", rangeLabel: "Ciclo 1" },
    ],
    historicalLevels: [
      { id: "l3", side: "BUY", price: 90000, quantity: 0.01, status: "replaced", statusLabel: "Reemplazado", targetOfOpenCycle: false, rangeRelation: "previous", rangeLabel: "Histórico" },
    ],
  },
  capital: {
    configuredMax: 5000,
    reservedUsd: 1200,
    freeUsd: 3800,
    accumulatedProfit: 12.34,
  },
  notifications: [
    {
      severity: "warning",
      count: 2,
      items: [
        { id: "1", title: "Rango compacto", shortText: "La banda es muy estrecha", count: 1 },
        { id: "2", title: "Objetivo exigente", shortText: "Pocos niveles caben", count: 1 },
      ],
    },
    {
      severity: "info",
      count: 1,
      items: [{ id: "3", title: "Modo SHADOW", shortText: "Sin órdenes reales", count: 1 }],
    },
  ],
  execution: {
    policy: "MAKER_ONLY",
    policyLabel: "Solo maker",
    takerFallbackEnabled: false,
    takerFallbackAllowed: false,
    makerOnly: true,
    takerFallbackLabel: "Solo maker — fallback taker desactivado",
  },
  settings: {
    simple: {
      capitalMax: 5000,
      minViableLevels: 4,
      netProfitTargetPct: 0.8,
      rangeProfile: "balanced",
      protection: "hold",
      reinvestProfits: true,
    },
    expertBlocks: [
      { id: "limits", title: "Límites operativos", description: "Máximos", fields: ["maxOpenCycles", "maxDailyOrders"] },
      { id: "capital", title: "Capital", description: "Cartera", fields: ["gridWalletMaxUsd", "gridWalletUseProfits", "gridWalletCompoundProfits"] },
    ],
  },
};

const mockAudit = {
  operational,
  currentOperationalState: {
    status: "shadow_has_range",
    title: "Rango activo",
    plainSummary: "El Grid está activo, en SHADOW y tiene un rango activo con niveles.",
    plainProblem: null,
    plainNextAction: "Revisa niveles.",
    canAnalyzeNow: true,
    canGenerateSimulatedRange: true,
    canTradeReal: false,
    safe: true,
    hasRealOrders: false,
    hasOpenCycles: true,
    hasActiveRange: true,
  },
};

// ── Puppeteer + API interception ──────────────────────────────────
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await puppeteer.launch({
  executablePath: edgePath,
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();

await page.setRequestInterception(true);
page.on("request", (req) => {
  const url = req.url();
  if (url.includes("/api/grid-isolated/config")) {
    return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(mockConfig) });
  }
  if (url.includes("/api/grid-isolated/status")) {
    return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(mockStatus) });
  }
  if (url.includes("/api/grid-isolated/monitor/audit")) {
    return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(mockAudit) });
  }
  if (url.includes("/api/grid-isolated/")) {
    return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  }
  return req.continue();
});

const widths = [360, 390, 768, 1280];
const results = [];

for (const w of widths) {
  await page.setViewport({ width: w, height: 800 });
  await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes("GRID AISLADO"), { timeout: 15000 });

  const { scrollWidth, clientWidth, overflowX, overflowers } = await page.evaluate(() => {
    const clientW = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollWidth > clientW) {
        out.push({
          tag: el.tagName,
          class: el.className,
          scrollWidth: el.scrollWidth,
          clientWidth: clientW,
          text: el.textContent?.slice(0, 120) || "",
        });
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflowX: window.getComputedStyle(document.body).overflowX,
      overflowers: out.slice(0, 5),
    };
  });

  const screenshotPath = path.join(outDir, `grid-${w}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  results.push({
    width: w,
    scrollWidth,
    clientWidth,
    overflowX,
    horizontalOverflow: scrollWidth > clientWidth,
    overflowers,
    screenshot: screenshotPath,
  });
}

await browser.close();
server.close();

const reportPath = path.join(outDir, "report.json");
await fs.writeFile(reportPath, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
