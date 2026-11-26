import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Mọi dữ liệu nghiệp vụ đi qua API máy chủ; cổng thanh toán vẫn là sandbox riêng.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    },
    proxy: {
      '/api/app': {
        target: process.env.EMSYSTEMS_API_PROXY_TARGET || 'http://127.0.0.1:5176',
        changeOrigin: false,
      },
      '/api/payments': {
        target: process.env.EMSYSTEMS_PAYMENT_PROXY_TARGET || 'http://127.0.0.1:5175',
        changeOrigin: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Tách thư viện nền khỏi trang nghiệp vụ để tránh một bundle chính quá lớn.
        manualChunks(id) {
          if (id.includes('node_modules/react-router')) return 'router-vendor';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react-vendor';
        },
      },
    },
  },
  preview: {
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cdn.dummyjson.com data:; connect-src 'self' https://dummyjson.com; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    },
  },
});
