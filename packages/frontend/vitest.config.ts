import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@vue/test-utils': fileURLToPath(
        new URL('./node_modules/@vue/test-utils/dist/vue-test-utils.esm-bundler.mjs', import.meta.url),
      ),
    },
  },
  test: {
    include: ['../../tests/frontend/unit/**/*.test.ts', '../../tests/frontend/unit/**/*.spec.ts'],
    environment: 'node',
  },
});
