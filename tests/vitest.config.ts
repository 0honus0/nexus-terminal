import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [vue()],
	test: {
		environment: 'jsdom',
		include: ['tests/components/**/*.test.ts', 'tests/integration/frontend/**/*.test.ts'],
		clearMocks: true,
		restoreMocks: true,
	},
});
