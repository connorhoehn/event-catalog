import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const uiComponentsSrc = path.resolve(__dirname, '../../../ui-components/src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ui': uiComponentsSrc,
    },
  },
  server: {
    port: 3011,
    proxy: {
      '/api': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
