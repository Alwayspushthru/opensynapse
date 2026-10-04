import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({mode}) => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      commonjsOptions: {
        transformMixedEsModules: true,
      },
      rollupOptions: {
        external: [
          'firebase-admin',
          'google-auth-library',
          'node-fetch',
          'express',
          'fs',
          'path',
          'os',
          'crypto',
          'http',
          'https',
        ],
      },
    },
    optimizeDeps: {
      exclude: [
        'firebase-admin',
        'google-auth-library',
        'node-fetch',
        'express',
      ],
    },
  };
});
