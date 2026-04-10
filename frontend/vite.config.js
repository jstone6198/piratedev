import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ['@monaco-editor/react', 'monaco-editor'],
          vendor: ['react', 'react-dom', 'axios', 'socket.io-client'],
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
