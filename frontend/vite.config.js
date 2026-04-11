import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          const packagePath = id.split('node_modules/')[1];
          const packageName = packagePath.startsWith('@')
            ? packagePath.split('/').slice(0, 2).join('/')
            : packagePath.split('/')[0];

          if (['react', 'react-dom', 'react-router-dom', 'scheduler'].includes(packageName)) {
            return 'vendor';
          }

          if (['monaco-editor', '@monaco-editor/react'].includes(packageName)) {
            return 'monaco';
          }

          if (['xterm', 'xterm-addon-fit', 'xterm-addon-web-links'].includes(packageName)) {
            return 'xterm';
          }

          return 'ui';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3220',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3220',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
