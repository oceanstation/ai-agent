/// <reference types='vitest' />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(() => ({
  root: import.meta.dirname,
  // 打包后 Electron 通过 `file://` / `app://` 加载 index.html，
  // 资源引用必须是相对路径，否则 `/assets/...` 会被解析到文件系统根。
  base: './',
  cacheDir: '../../node_modules/.vite/apps/ui',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server:{
    port: 4200,
    host: 'localhost',
    proxy: {
      '/agent': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview:{
    port: 4300,
    host: 'localhost',
  },
  plugins: [vue()],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: '@ai-agent/ui',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    }
  },
}));
