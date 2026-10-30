import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "testnet-tests",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: process.env.RASUN_DAPP_URL || "http://127.0.0.1:5173",
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
