// @ts-check
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import node from '@astrojs/node';
import { fileURLToPath, URL } from 'node:url';

// https://astro.build/config
export default defineConfig({
  // 混合渲染：默认页面预渲染为静态，动态页面显式声明 export const prerender = false
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  integrations: [vue()],
  server: {
    port: 4200,
    host: 'localhost',
  },
  vite: {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/agent': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    ssr: {
      // vue3-json-viewer 是 CJS + 依赖 window，交给客户端处理
      noExternal: ['vue3-json-viewer'],
    },
  },
});
