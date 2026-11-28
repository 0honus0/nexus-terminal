import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import vue from '@vitejs/plugin-vue';
import { list as listArchive } from 'tar';
import { build, preview } from 'vite';
import pkg from '../../../package.json' with { type: 'json' };
import { App } from '../../../src/app/node/app.js';
import { HttpProblemSchema } from '../../../src/http/http-problem-http-types.js';
import { MarketplaceRepositorySchema } from '../../../src/marketplace/marketplace-catalog-types.js';
import {
	MarketplacePluginListSchema,
	MarketplaceRuntimeImpactSchema,
	MarketplaceUninstallPlanSchema,
} from '../../../src/marketplace/marketplace-http-types.js';
import { MarketplaceInstallPlanSchema } from '../../../src/marketplace/marketplace-install-types.js';
import { MarketplaceOperationSchema, MarketplacePluginId } from '../../../src/marketplace/marketplace-types.js';
import { inspectPluginPackage } from '../../../src/plugin/plugin-api.node.js';

import fixture from '../../fixtures/plugins/test/package.json' with { type: 'json' };
import { backendProxy } from '../../../vite.config.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const pluginId = fixture.name;
const marketplace = `/api/plugins/${encodeURIComponent(MarketplacePluginId)}`;
const manager = marketplace + '/manager';
const pluginPath = `/api/plugins/${encodeURIComponent(pluginId)}`;
const publicEntries = Object.keys(pkg.exports).map((name) => 'nexus-terminal/' + name.slice(2));

async function command(cwd: string, executable: string, ...args: string[]): Promise<string> {
	try {
		return (await exec(executable, args, { cwd, timeout: 90_000 })).stdout;
	} catch (cause) {
		const error = cause as { stdout?: string; stderr?: string };
		throw new Error([executable, ...args].join(' ') + '\n' + error.stdout + error.stderr, { cause });
	}
}

async function buildPlugin(directory: string): Promise<{ archive: Buffer; manifest: unknown }> {
	await mkdir(directory);
	await Promise.all([
		cp(join(root, 'dist', `nexus-terminal-${pkg.version}.tgz`), join(directory, 'sdk.tgz')),
		cp(join(root, 'tests/fixtures/plugins/test/src'), join(directory, 'src'), { recursive: true }),
	]);

	const manifest = {
		name: pluginId,
		version: fixture.version,
		type: 'module',
		files: ['dist'],
		peerDependencies: { 'nexus-terminal': '^' + pkg.version },
		devDependencies: {
			'nexus-terminal': 'file:./sdk.tgz',
			'@lucide/vue': pkg.devDependencies['@lucide/vue'],
			typescript: pkg.devDependencies.typescript,
			vue: pkg.devDependencies.vue,
			'vue-i18n': pkg.devDependencies['vue-i18n'],
			kysely: pkg.dependencies.kysely,
			zod: pkg.dependencies.zod,
		},
		nexus: { kind: 'application', entry: { backend: 'dist/node/index.js', frontend: 'dist/browser/index.js' } },
	};

	const files = {
		'package.json': JSON.stringify(manifest),
		'tsconfig.json': JSON.stringify({
			compilerOptions: {
				target: 'ES2022',
				module: 'ESNext',
				moduleResolution: 'Bundler',
				strict: true,
				skipLibCheck: true,
				noEmit: true,
			},
			include: ['src/**/*.ts', 'src/**/*.vue'],
		}),
	};
	await Promise.all(Object.entries(files).map(([name, value]) => writeFile(join(directory, name), value)));
	await command(directory, 'pnpm', 'install', '--ignore-scripts', '--no-frozen-lockfile');
	await command(directory, process.execPath, join(root, 'node_modules/vue-tsc/bin/vue-tsc.js'), '--noEmit');
	const installedSdk = JSON.parse(
		await readFile(join(directory, 'node_modules/nexus-terminal/package.json'), 'utf8'),
	);
	assert.equal(installedSdk.version, pkg.version);
	assert.deepEqual(Object.keys(installedSdk.exports), Object.keys(pkg.exports));
	assert.ok(installedSdk.exports['./browser/ui'].types.endsWith('.d.ts'));
	await command(
		directory,
		process.execPath,
		'--input-type=module',
		'--eval',
		`
		import assert from 'node:assert/strict';
		import { PluginLogInputSchema } from 'nexus-terminal/node';
		import { PluginHttpError } from 'nexus-terminal/browser';
		import { UiButton } from 'nexus-terminal/browser/ui';
		assert.ok(PluginLogInputSchema && PluginHttpError && UiButton);
		await assert.rejects(import('nexus-terminal/src/app/node/app.ts'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	`,
	);

	// 浏览器资源单独交付，避免和 Node 入口或其依赖共享可下载目录。
	const sources = { node: 'src/index.ts', browser: 'src/browser/index.ts' };
	for (const [target, source] of Object.entries(sources)) {
		await build({
			root: directory,
			configFile: false,
			publicDir: false,
			logLevel: 'error',
			plugins: target === 'browser' ? [vue()] : [],
			build: {
				outDir: 'dist/' + target,
				target: 'es2022',
				lib: {
					entry: join(directory, source),
					formats: ['es'],
					fileName: 'index',
				},
				rolldownOptions: { external: [...publicEntries, 'vue', 'vue-i18n'] },
			},
		});
	}
	for (const [file, entry] of [
		['node', 'node'],
		['browser', 'browser'],
		['browser', 'browser/ui'],
	]) {
		assert.ok(
			(await readFile(join(directory, 'dist', file, 'index.js'), 'utf8')).includes('nexus-terminal/' + entry),
		);
	}
	const archivePath = join(directory, `nexus-terminal-test-${fixture.version}.tgz`);
	await command(directory, 'pnpm', 'pack');
	const contents: string[] = [];
	await listArchive({
		file: archivePath,

		onentry: (entry) => contents.push(entry.path),
	});
	assert.ok(contents.includes('package/dist/browser/index.js'));
	assert.ok(contents.includes('package/dist/node/index.js'));
	assert.ok(contents.every((name) => name === 'package/package.json' || name.startsWith('package/dist/')));
	return { archive: await readFile(archivePath), manifest: (await inspectPluginPackage(directory)).package };
}

test('独立项目使用 SDK 包编译前后端，经市场安装、启停和卸载', { timeout: 120_000 }, async (t) => {
	const resources = new AsyncDisposableStack();
	t.after(() => resources.disposeAsync());

	const directory = await mkdtemp(join(tmpdir(), 'nexus-sdk-delivery-'));
	resources.defer(() => rm(directory, { recursive: true, force: true }));
	const app = new App({ dataDirectory: join(directory, 'host'), logLevel: 'fatal' });
	resources.defer(() => app.close());

	const { archive, manifest } = await buildPlugin(join(directory, 'consumer'));
	let catalog: unknown;
	const repo = createServer((request, response) => {
		if (request.url === '/catalog.json') response.end(JSON.stringify(catalog));
		else if (request.url === '/plugin.tgz') response.end(archive);
		else response.writeHead(404).end();
	});
	repo.listen(0, '127.0.0.1');
	await once(repo, 'listening');
	resources.defer(() => {
		repo.closeAllConnections();
		return new Promise<void>((resolve) => repo.close(() => resolve()));
	});
	const address = repo.address();
	assert.ok(address && typeof address !== 'string');
	const remote = 'http://127.0.0.1:' + address.port;
	catalog = [
		{
			id: pluginId,
			versions: [
				{
					package: manifest,
					distributions: [
						{
							tarball: remote + '/plugin.tgz',
							integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64'),
						},
					],
				},
			],
		},
	];

	await app.initialize();
	await app.startBuiltinPlugins();
	await app.startExternalPlugins();
	const origin = app.services.get('http').origin;
	const auth = await fetch(origin + '/api/auth/initialize', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username: 'test', password: 'fixture-owner' }),
	});
	assert.equal(auth.status, 201);
	const sessionCookie = auth.headers.get('set-cookie')?.split(';')[0];
	assert.ok(sessionCookie);
	const cookie = sessionCookie;
	await auth.body?.cancel();

	function call(path: string, input?: object, method = input ? 'POST' : 'GET'): Promise<Response> {
		return fetch(origin + path, {
			method,
			headers: { cookie, 'content-type': 'application/json' },
			body: input && JSON.stringify(input),
		});
	}

	async function operation(path: string, input: object, method = 'POST'): Promise<void> {
		const accepted = await call(path, input, method);
		assert.equal(accepted.status, 202, await accepted.clone().text());
		const { id } = MarketplaceOperationSchema.parse(await accepted.json());
		const signal = AbortSignal.timeout(10_000);
		for (;;) {
			const status = MarketplaceOperationSchema.parse(await (await call(manager + '/operations/' + id)).json());
			if (status.finishedAt) {
				assert.equal(status.state, 'succeeded', JSON.stringify(status));
				return;
			}
			await delay(25, undefined, { signal });
		}
	}

	const registered = MarketplaceRepositorySchema.parse(
		await (await call(marketplace + '/repositories', { url: remote + '/catalog.json' })).json(),
	);
	const plan = MarketplaceInstallPlanSchema.parse(
		await (
			await call(manager + '/install-plan', {
				kind: 'repository',
				repositoryId: registered.id,
				version: fixture.version,
				pluginId,
			})
		).json(),
	);
	assert.deepEqual(plan.blockers, []);
	await operation(manager + '/install', { plan });
	assert.deepEqual(await (await call(pluginPath + '/items')).json(), { items: [{ id: 'sample', label: 'sample' }] });
	const crypto = await call(pluginPath + '/crypto', { value: '加密往返' });
	assert.equal(crypto.status, 200);
	assert.deepEqual(await crypto.json(), { value: '加密往返' });
	const problem = await call(pluginPath + '/conflict');
	assert.equal(problem.status, 409);
	assert.equal(HttpProblemSchema.parse(await problem.json()).code, 'TEST_PLUGIN_CONFLICT');

	// 从真实宿主读取已安装的前端 ESM，验证 Vue 和两个浏览器入口由 import map 供给。
	const outDir = join(directory, 'frontend');
	await build({ configFile: join(root, 'vite.config.ts'), logLevel: 'error', build: { outDir, emptyOutDir: true } });
	const frontend = await preview({
		configFile: join(root, 'vite.config.ts'),
		logLevel: 'error',
		build: { outDir },
		preview: { host: '127.0.0.1', port: 0, proxy: { '/api': backendProxy(origin) } },
	});
	resources.defer(() => frontend.close());
	const frontendAddress = frontend.httpServer.address();
	assert.ok(frontendAddress && typeof frontendAddress !== 'string');
	const browserOrigin = 'http://127.0.0.1:' + frontendAddress.port;
	const browser = await chromium.launch();
	resources.defer(() => browser.close());
	const page = await browser.newPage({ locale: 'en-US' });
	page.setDefaultTimeout(8000);
	await page.addInitScript(() => {
		window.addEventListener('nexus:test:lifecycle', (event) => {
			const lifecycle = document.documentElement.dataset;
			const phase = (event as CustomEvent<string>).detail;
			lifecycle.phases = [lifecycle.phases, phase].filter(Boolean).join(',');
		});
	});
	const [name, value] = cookie.split('=');
	await page.context().addCookies([{ name, value: decodeURIComponent(value), url: browserOrigin }]);
	await page.goto(browserOrigin + '/?host-controls');
	const launcher = page.getByRole('button', { name: 'Counter', exact: true });
	await launcher.click();
	const counter = page.getByRole('region', { name: 'Counter', exact: true });
	await expect(counter.getByText('1', { exact: true })).toBeVisible();
	await counter.getByRole('button', { name: 'Increment' }).click();
	const socket = page.waitForEvent('websocket', { predicate: (socket) => socket.url().endsWith('/echo') });
	await counter.getByRole('button', { name: 'Probe host' }).click();
	const connected = await socket;
	await expect(counter.getByText(/sample.*fixture-frame · 0,255/)).toBeVisible();
	await expect(counter.getByText('TEST_PLUGIN_CONFLICT')).toBeVisible();
	const closed = connected.waitForEvent('close', { timeout: 8000 });
	await counter.getByRole('button', { name: 'Close application' }).click();
	await expect(counter).toHaveCount(0);
	await closed;
	await expect(page.locator('html')).toHaveAttribute('data-phases', 'activated,view-disposed');
	await page.getByRole('button', { name: 'Logs', exact: true }).click();
	const logs = page.getByRole('region', { name: 'Logs', exact: true });
	await expect(logs.getByText('TEST_COUNTER_INCREMENTED').filter({ visible: true })).toBeVisible();
	await logs.getByRole('button', { name: 'Close application' }).click();

	const endpoint = manager + '/plugins/' + encodeURIComponent(pluginId);
	const impactResponse = await call(endpoint + '/runtime-impact');
	assert.equal(impactResponse.status, 200);
	const impact = MarketplaceRuntimeImpactSchema.parse(await impactResponse.json());
	await operation(endpoint, { enabled: false, impactRevision: impact.revision }, 'PATCH');
	const stopped = await call(pluginPath + '/items');
	assert.equal(stopped.status, 404);
	await stopped.body?.cancel();
	await expect(launcher).toHaveCount(0);
	await expect(page.locator('html')).toHaveAttribute(
		'data-phases',
		'activated,view-disposed,view-disposed,deactivated,plugin-disposed',
	);
	await operation(endpoint, { enabled: true }, 'PATCH');
	await expect(launcher).toBeVisible();
	assert.deepEqual(await (await call(pluginPath + '/items')).json(), { items: [{ id: 'sample', label: 'sample' }] });
	const removal = MarketplaceUninstallPlanSchema.parse(await (await call(endpoint + '/uninstall-plan')).json());
	await operation(manager + '/uninstall', { pluginId, data: 'keep', revision: removal.revision });
	assert.deepEqual(MarketplacePluginListSchema.parse(await (await call(manager + '/plugins')).json()).items, []);
	await expect(launcher).toHaveCount(0);
});
