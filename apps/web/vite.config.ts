import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Baseline Vite config. In production the built assets are served by the API
// process (single image, TASK-005); `/api` is proxied to the API in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
