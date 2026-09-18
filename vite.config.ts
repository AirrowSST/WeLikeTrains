import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:8080" },
    watch: {
      ignored: [
        "**/.local/**",
        "**/.cache/**",
        "**/data/**",
        "**/dist-server/**",
      ],
    },
  },
  build: { chunkSizeWarningLimit: 650 },
});
