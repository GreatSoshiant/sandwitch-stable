import { defineConfig, devices } from "@playwright/test";

process.loadEnvFile(".env.local");
const hostedUrl = process.env.TIDEWATER_TEST_BASE_URL;

export default defineConfig({
  testDir: "./tests/testnet",
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 90_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: hostedUrl || "http://localhost:3001",
    // Do not capture passkey registration/signature payloads in trace archives.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: hostedUrl
    ? undefined
    : {
        command: "npx next dev --hostname localhost --port 3001",
        url: "http://localhost:3001",
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
