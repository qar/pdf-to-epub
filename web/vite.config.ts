import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  preview: {
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self';",
    },
  },
  build: {
    assetsInlineLimit: 0,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
});
