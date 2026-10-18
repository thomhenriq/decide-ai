import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em dev, /api vai para o FastAPI. Em produção, sirvam o build e o backend no mesmo domínio
// ou ajustem CORS_ORIGINS no backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } },
  },
});
