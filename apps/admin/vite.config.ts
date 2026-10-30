import { uiReadiness } from "../../scripts/ui-ports.mjs";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue(), uiReadiness("admin")],
  server: {
    port: Number(process.env.RASUN_ADMIN_PORT || 5174),
    strictPort: process.env.RASUN_UI_STRICT_PORT === "1",
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true } },
  },
});
