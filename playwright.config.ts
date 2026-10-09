import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run db:migrate:local && npm run worker:dev",
    url: "http://127.0.0.1:8787/vi/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
