import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  // Inline, empty PostCSS config so Vite doesn't try to load postcss.config.mjs
  // — that one is written for Next/Tailwind's own pipeline (a bare plugin-name
  // string), which isn't a shape Vite's loader accepts, and these tests never
  // import CSS anyway.
  css: { postcss: {} },
  test: {
    environment: "node",
  },
});
