import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const resolveLocalModule = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  cacheDir: process.env.NEXUS_VITE_CACHE_DIR || undefined,
  resolve: {
    alias: {
      '@': resolveLocalModule('./src'),
      '@monaco-editor-api': resolveLocalModule('./node_modules/monaco-editor/esm/vs/editor/editor.api.js'),
      '@monaco-basic-languages': resolveLocalModule(
        './node_modules/monaco-editor/esm/vs/basic-languages/monaco.contribution.js',
      ),
      '@monaco-json-language': resolveLocalModule(
        './node_modules/monaco-editor/esm/vs/language/json/monaco.contribution.js',
      ),
      '@monaco-editor-worker': resolveLocalModule('./node_modules/monaco-editor/esm/vs/editor/editor.worker.js'),
      '@monaco-json-worker': resolveLocalModule('./node_modules/monaco-editor/esm/vs/language/json/json.worker.js'),
    },
  },
  plugins: [vue(), tailwindcss()],
  oxc: {
    target: 'es2025',
  },
  build: {
    target: 'es2025',
    // Monaco and its language workers are intentionally emitted as large,
    // independently cached chunks. The default 500 kB threshold reports these
    // expected editor assets as warnings even though they are already split.
    chunkSizeWarningLimit: 3000,
  },
  server: {
    proxy: {
      // 将所有 /api 开头的请求代理到后端服务器
      '/api': {
        target: 'http://localhost:3001', // 后端服务器地址
        changeOrigin: true, // 需要虚拟主机站点
        // 可选：如果后端 API 路径没有 /api 前缀，可以在这里重写路径
        // rewrite: (path) => path.replace(/^\/api/, '')
      },
      // 将所有 /uploads 开头的请求也代理到后端服务器
      '/uploads': {
        target: 'http://localhost:3001', // 后端服务器地址
        changeOrigin: true, // 对于静态资源通常也建议开启
        // 通常不需要重写静态资源的路径
      },
      // Keep the clean WebSocket families on independent proxy instances. Upload sockets can
      // be numerous and short-lived under cancellation/network-failure tests; sharing one broad
      // /ws proxy lets that churn affect later Workspace control upgrades in the dev/E2E ingress.
      '/ws/workspace': {
        target: 'ws://localhost:3001',
        ws: true,
        // Preserve the browser-facing Host so Backend same-origin validation sees the real origin.
        changeOrigin: false,
      },
      '/ws/uploads': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: false,
      },
      '/ws/remote-desktop': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: false,
      },
    },
  },
});
