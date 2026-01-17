// Vitest setup for server-side tests
// Ensures imports that require DATABASE_URL do not crash the test runner.

if (!process.env.DATABASE_URL) {
  // Dummy value; tests that require a live DB should create their own connection.
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
}
