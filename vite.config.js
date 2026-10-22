import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, /api requests go to dev-api.mjs, which runs the same handlers Vercel runs.
const apiPort = Number(process.env.DEV_API_PORT) || 5288;

export default defineConfig({
  plugins: [react()],
  build: {
    // The editor chunk (TipTap and ProseMirror) is loaded only when a document opens.
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5200,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}` },
    },
  },
  preview: {
    port: 5201,
    strictPort: true,
  },
});
