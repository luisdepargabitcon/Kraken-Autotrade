import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes, initializeWebSockets } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { logStreamService } from "./services/logStreamService";
import { log } from "./utils/logger";
import { MarketDataService } from "./services/MarketDataService";
import { runIdcaHistoricalDuplicateCleanupOnce } from "./services/institutionalDca/IdcaHistoricalDuplicateCleanupService";
import fs from "fs";
import path from "path";

// BUILD STAMP: Log commit hash at startup for debugging
const versionFile = path.join(process.cwd(), 'VERSION');
let buildCommit = 'unknown';
try {
  if (fs.existsSync(versionFile)) {
    buildCommit = fs.readFileSync(versionFile, 'utf-8').trim();
  }
} catch (e) { /* ignore */ }
console.log(`[startup] BUILD_COMMIT: ${buildCommit}`);

logStreamService.initialize();

const app = express();
const httpServer = createServer(app);

initializeWebSockets(httpServer);

// Body parsers - IMPORTANTE: solo una vez y en este orden
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  // Limpieza automática de duplicados históricos IDCA (idempotente, non-blocking)
  console.log("[startup] About to run IDCA historical duplicate cleanup");
  runIdcaHistoricalDuplicateCleanupOnce().catch((err) => {
    console.warn("[startup] IDCA historical duplicate cleanup failed (non-blocking):", err);
  });
  console.log("[startup] IDCA historical duplicate cleanup hook scheduled");

  // Cleanup de velas antiguas (retención) - máximo 1 vez cada 24h por throttle interno
  MarketDataService.cleanupOldCandles().catch((err) => {
    console.warn("[startup] Candle retention cleanup failed (non-blocking):", err);
  });

  // Scheduler diario para cleanup de velas (24h = 86400000ms)
  // Non-blocking: errores solo se loguean, no rompen la app
  setInterval(() => {
    MarketDataService.cleanupOldCandles()
      .then((deleted) => {
        if (deleted > 0) {
          console.log(`[MARKET_CANDLES][RETENTION] deleted=${deleted} (scheduled cleanup)`);
        }
      })
      .catch((err) => {
        console.warn("[MARKET_CANDLES][RETENTION] Scheduled cleanup failed (non-blocking):", err);
      });
  }, 24 * 60 * 60 * 1000); // 24 horas

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(
    {
      port,
      host,
      // Disable reusePort on Windows to avoid ENOTSUP errors
      reusePort: process.platform !== 'win32',
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
