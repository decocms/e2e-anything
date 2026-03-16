import { defineConfig, devices } from "@playwright/test";
import { loadSiteConfig } from "./lib/config";

const siteName = process.env.SITE || "casaevideo-tanstack";

let baseURL: string;
try {
  const config = loadSiteConfig(siteName);
  baseURL = config.baseUrl;
} catch {
  baseURL = "https://example.com";
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 60_000,

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
