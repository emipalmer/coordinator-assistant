import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Served by the dashboard Lambda under /dashboard/ (assets at /dashboard/assets/*).
  base: '/dashboard/',
  server: { port: 5173 },
  build: { outDir: 'dist' },
});
