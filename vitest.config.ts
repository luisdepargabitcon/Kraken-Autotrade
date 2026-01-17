import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./shared"),
      "@": path.resolve(__dirname, "./client/src"),
    },
  },
  test: {
    include: ["server/**/*.test.ts"],
    exclude: ["node_modules", "dist", "build"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
