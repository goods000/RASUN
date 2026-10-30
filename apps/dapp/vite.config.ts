import { uiReadiness } from "../../scripts/ui-ports.mjs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);
import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

export default defineConfig({
  plugins: [uni(), uiReadiness("dapp")],
  resolve: {
    alias: {
      ethers: resolve(
        dirname(require.resolve("ethers")),
        "../lib.esm/index.js",
      ),
    },
  },
  server: {
    host: "0.0.0.0",
    port: Number(process.env.RASUN_DAPP_PORT || 5173),
    strictPort: process.env.RASUN_UI_STRICT_PORT === "1",
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true } },
  },
});
