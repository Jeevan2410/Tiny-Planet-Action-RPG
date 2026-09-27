import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so a production build can be dropped on any static host
  // (GitHub Pages project sites included) without rewriting asset URLs.
  base: './',
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
