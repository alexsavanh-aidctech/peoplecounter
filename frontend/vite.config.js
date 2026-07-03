import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the backend so the frontend can call same-origin
// paths in dev exactly like it will in production (behind one host).
// Override the backend target with VITE_API_TARGET if the port differs.
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:4100';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
});
