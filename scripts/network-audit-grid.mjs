/**
 * Network audit for /grid-isolated: verify no automatic POSTs are sent on mount.
 * Serves the built client from dist/public and mocks the Grid API.
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist", "public");

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

const mockConfig = {
  id: 1,
  pair: "BTC/USD",
  mode: "SHADOW",
  isActive: true,
  executionPolicy: "MAKER_ONLY",
  gridWalletMaxUsd: 5000,
  gridWalletUseProfits: true,
  gridWalletCompoundProfits: true,
  maxOpenCycles: 10,
  maxDailyOrders: 300,
};

const mockStatus = { isRunning: true };

const mockAudit = {
  operational: {
    header: { title: "GRID AISLADO BTC/USD", mode: "SHADOW", isActive: true, isRunning: true, makerOnly: true, currentPrice: 95000, currentBid: 94990, currentAsk: 95010, priceSource: "kraken", priceFresh: true, openCycles: 1, totalNetPnlUsd: 12.34, realOpenOrdersCount: 0 },
    overview: { summary: "Rango activo en simulación", problem: null, nextAction: "Revisa", canAnalyzeNow: true, hasActiveRange: true },
    openCycles: [], closedCycles: [], cancelledCycles: [],
    levels: { activeRangeLevels: [], openCycleTargetLevels: [], historicalLevels: [] },
    capital: { configuredMax: 5000, reservedUsd: 0, freeUsd: 5000, accumulatedProfit: 0 },
    notifications: [],
  },
};

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await puppeteer.launch({
  executablePath: edgePath,
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();

const requests = [];
await page.setRequestInterception(true);
page.on("request", (req) => {
  const url = req.url();
  const method = req.method();
  requests.push({ method, url, time: Date.now() });
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

await page.setViewport({ width: 1280, height: 800 });
await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30000 });

// Wait for refetch intervals to fire (10s + small buffer)
await new Promise((resolve) => setTimeout(resolve, 11500));

await browser.close();
server.close();

const gridRequests = requests.filter((r) => r.url.includes("/api/grid-isolated/"));
const posts = gridRequests.filter((r) => r.method === "POST");
const gets = gridRequests.filter((r) => r.method === "GET");

const result = {
  total: gridRequests.length,
  gets: gets.map((r) => ({ url: r.url.replace(/^.*\/api\/grid-isolated/, "/api/grid-isolated"), time: r.time })),
  posts: posts.map((r) => ({ url: r.url.replace(/^.*\/api\/grid-isolated/, "/api/grid-isolated"), time: r.time })),
  automaticPostsDetected: posts.length > 0,
};

console.log(JSON.stringify(result, null, 2));
