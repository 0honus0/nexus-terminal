import { copyFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

test('仅类型文件变化时，热更新同步 Vue 组件的运行时属性', async ({ page }) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-vite-type-'));
	const entry = join(directory, 'src/app/browser');
	const components = join(directory, 'src/ui/browser');
	const types = join(components, 'menu-types.ts');
	const config = join(directory, 'vite.config.ts');
	const modules = fileURLToPath(new URL('../../node_modules', import.meta.url));
	let server: ViteDevServer | undefined;

	try {
		await Promise.all([mkdir(entry, { recursive: true }), mkdir(components, { recursive: true })]);
		await Promise.all([
			copyFile(new URL('../../vite.config.ts', import.meta.url), config),
			symlink(modules, join(directory, 'node_modules'), 'dir'),
			writeFile(join(entry, 'index.html'), '<div id="app"></div><script type="module" src="/main.ts"></script>'),
			writeFile(
				join(entry, 'main.ts'),
				"import { createApp } from 'vue'; import Menu from '../../ui/browser/Menu.vue'; createApp(Menu, { transition: 'drop' }).mount('#app');",
			),
			writeFile(types, 'export interface MenuProps { label?: string }'),
			writeFile(
				join(components, 'Menu.vue'),
				`<script setup lang="ts">
import { computed } from 'vue';
import type { MenuProps } from './menu-types.js';
defineOptions({ inheritAttrs: false });
const props = defineProps<MenuProps>();
const transition = computed(() => Reflect.get(props, 'transition'));
</script>
<template><button :data-transition="transition">Menu</button></template>`,
			),
		]);
		server = await createServer({
			configFile: config,
			configLoader: 'runner',
			cacheDir: join(directory, 'cache'),
			server: { host: '127.0.0.1', port: 0, fs: { allow: [directory, modules] } },
		});
		await server.listen();
		const { port } = server.httpServer!.address() as AddressInfo;
		const connected = page.waitForEvent('console', (message) => message.text() === '[vite] connected.');
		await page.goto('http://127.0.0.1:' + port);
		await connected;
		const menu = page.getByRole('button', { name: 'Menu' });
		await expect(menu).toBeVisible();
		await expect(menu).not.toHaveAttribute('data-transition', 'drop');
		await expect.poll(() => server?.watcher.getWatched()[components]?.includes('menu-types.ts')).toBe(true);

		const replacement = join(directory, 'menu-types.next');
		await writeFile(replacement, "export interface MenuProps { label?: string; transition?: 'fade' | 'drop' }");
		await rename(replacement, types);
		await expect(menu).toHaveAttribute('data-transition', 'drop');
	} finally {
		await server?.close();
		await rm(directory, { recursive: true, force: true });
	}
});
