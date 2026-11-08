import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 2048,
    rollupOptions: {
      output: {
        // Libraries change rarely: keep them in their own file so phones keep them cached across app updates
        manualChunks: (id) => (id.includes('node_modules/react') || id.includes('node_modules/scheduler') ? 'react'
          : id.includes('node_modules/socket.io') || id.includes('node_modules/engine.io') ? 'socket' : undefined),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
