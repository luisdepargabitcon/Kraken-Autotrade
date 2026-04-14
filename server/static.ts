import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(process.cwd(), "dist", "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  // IMPORTANT: app.use("*") sets req.path to "/" in Express 4 — use req.originalUrl
  app.use("*", (req, res, next) => {
    const url = req.originalUrl || req.path;
    if (url.startsWith("/api")) {
      return res.status(404).json({
        error: "NOT_FOUND",
        path: url,
      });
    }

    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
