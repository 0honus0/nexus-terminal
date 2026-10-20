import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-monitoring-config-'));
let app;
let vite;
let browser;
const encryptionKey = randomBytes(32);

try {
	const net = createNetServer();
	await new Promise((resolve) => net.listen(0, '127.0.0.1', resolve));
	const port = net.address().port;
	await new Promise((resolve, reject) => net.close((cause) => (cause ? reject(cause) : resolve())));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'overview.db'), { encryptionKey });
	const backend = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	const viteOptions = {
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: {
			host: '127.0.0.1',
			port,
			strictPort: true,
			proxy: { '/api': { target: 'http://' + backend, changeOrigin: false } },
		},
		plugins: [
			{
				name: 'monitoring-fixture',

				resolveId(id) {
					if (id === 'virtual:monitoring-fixture') return '\0virtual:monitoring-fixture';
				},

				load(id) {
					if (id === '\0virtual:monitoring-fixture')
						return `
						export { createApp, h, nextTick } from 'vue';
						export { createPinia } from 'pinia';
						export { Chart } from 'chart.js';
						export { readSettingsResponse } from '@nexus-terminal/shared/preferences/configuration/http-codec';
					`;
				},

				configureServer(server) {
					server.middlewares.use('/__monitoring', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Monitoring configuration fixture</title>');
					});
				},
			},
		],
	};
	vite = await createServer(viteOptions);
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto(origin + '/__monitoring');

	const real = await page.evaluate(async () => {
		const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
		const { configurationApi } = await import('/src/features/preferences/api/configuration-api.ts');
		const { ConfigurationFailure } = await import('/src/features/preferences/model/configuration-types.ts');
		const access = createAccessApi();
		await access.setup({
			username: 'admin',
			password: 'fixture-password-123',
			confirmPassword: 'fixture-password-123',
		});
		await access.login({ username: 'admin', password: 'fixture-password-123' });
		const before = await configurationApi.get();
		const after = await configurationApi.saveMonitoring(before, {
			statusIntervalSeconds: 7,
			hostIntervalSeconds: 47,
		});
		if (
			after.revision !== before.revision + 1 ||
			after.statusIntervalSeconds !== 7 ||
			after.hostIntervalSeconds !== 47 ||
			after.effectiveMonitoring.statusIntervalSeconds !== 3 ||
			after.effectiveMonitoring.hostIntervalSeconds !== 30 ||
			!after.pendingRestart
		)
			throw Error('saved/effective facts diverged');
		if (
			JSON.stringify(after.network) !== JSON.stringify(before.network) ||
			JSON.stringify(after.passkeySites) !== JSON.stringify(before.passkeySites) ||
			JSON.stringify(after.captcha) !== JSON.stringify(before.captcha)
		)
			throw Error('unrelated configuration changed');
		try {
			await configurationApi.saveMonitoring(before, { statusIntervalSeconds: 9, hostIntervalSeconds: 49 });
			throw Error('stale CAS accepted');
		} catch (cause) {
			if (!(cause instanceof ConfigurationFailure) || cause.code !== 'version_conflict') throw cause;
		}
		const saved = await configurationApi.get();
		if (saved.statusIntervalSeconds !== 7 || saved.effectiveRevision !== before.effectiveRevision)
			throw Error('CAS changed saved authority');
		return [
			'real HTTP save and startup-effective separation',
			'unrelated configuration preserved',
			'stale CAS refused and read-only authority',
		];
	});
	await app.close();
	app = await createApp(join(directory, 'overview.db'), { encryptionKey });
	const restarted = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	await vite.close();
	viteOptions.server.proxy['/api'].target = 'http://' + restarted;
	vite = await createServer(viteOptions);
	await vite.listen();
	await page.goto(origin + '/__monitoring');
	const restart = await page.evaluate(async () => {
		const { configurationApi } = await import('/src/features/preferences/api/configuration-api.ts');
		const value = await configurationApi.get();
		if (
			value.pendingRestart ||
			value.revision !== value.effectiveRevision ||
			value.effectiveMonitoring.statusIntervalSeconds !== 7 ||
			value.effectiveMonitoring.hostIntervalSeconds !== 47
		)
			throw Error('restart did not install saved monitoring');
		return 'real SQLite restart installs saved monitoring';
	});
	const controlled = await page.evaluate(async () => {
		const { createMonitoringConfiguration } =
			await import('/src/features/preferences/composables/use-monitoring-configuration.ts');
		const { readSettingsResponse, createApp, h, nextTick, createPinia, Chart } =
			await import('/@id/__x00__virtual:monitoring-fixture');
		const { authenticatedSessionLifecycle } = await import('/src/shared/session/public.ts');
		const { default: i18n } = await import('/src/app/i18n/index.ts');
		const { default: Panel } =
			await import('/src/features/preferences/components/MonitoringConfigurationPanel.vue');
		const { default: PreferencesPanel } =
			await import('/src/features/preferences/components/PreferencesSettingsPanel.vue');
		const { default: WorkspacePanel } =
			await import('/src/features/preferences/components/WorkspacePreferencesPanel.vue');
		const { default: StatusCharts } = await import('/src/features/status-monitor/components/StatusCharts.vue');
		const nativeFetch = window.fetch;
		const baseline = await (await nativeFetch('/api/v1/settings')).json();
		const checks = [];
		const owners = [];
		let mounted;
		let node;

		const check = (value, name) => {
			if (!value) throw Error(name);
			checks.push(name);
		};

		const wire = () => structuredClone(baseline);

		const json = (value, status = 200) =>
			new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

		async function until(predicate) {
			for (let i = 0; i < 200; i++) {
				if (predicate()) return;
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			throw Error('monitoring UI did not converge');
		}

		function controller() {
			const owner = createMonitoringConfiguration();
			owners.push(owner);
			return owner;
		}

		function invalid(value, name) {
			let rejected = false;
			try {
				readSettingsResponse(value);
			} catch {
				rejected = true;
			}
			check(rejected, name);
		}

		try {
			let value = wire();
			delete value.effectiveMonitoring;
			invalid(value, 'missing effective object rejected');
			value = wire();
			value.effectiveMonitoring.secret = 'private';
			invalid(value, 'nested private field rejected');
			value = wire();
			value.effectiveMonitoring.statusMonitorIntervalSeconds++;
			invalid(value, 'equal versions require equal effective policy');
			for (const limit of [0, 86401, 1.5, '3']) {
				value = wire();
				value.effectiveMonitoring.statusMonitorIntervalSeconds = limit;
				invalid(value, 'invalid effective interval rejected');
			}
			for (const limit of [1, 86400]) {
				value = wire();
				value.policy.statusMonitorIntervalSeconds = limit;
				value.effectiveMonitoring.statusMonitorIntervalSeconds = limit;
				check(
					readSettingsResponse(value).policy.statusMonitorIntervalSeconds === limit,
					'Shared interval boundary accepted',
				);
			}
			let reads = 0,
				writes = 0,
				mode = 'normal',
				release;
			window.fetch = async (_url, options) => {
				if (options?.method === 'PUT') {
					writes++;
					if (mode === 'lost') throw new TypeError('controlled network loss');
					if (mode === 'stream')
						return new Response(
							new ReadableStream({
								start(c) {
									c.enqueue(new TextEncoder().encode('{'));
									c.error(new Error('controlled body loss'));
								},
							}),
							{ headers: { 'Content-Type': 'application/json' } },
						);
					if (mode === 'conflict') return json({ code: 'version_conflict' }, 409);
					if (mode === 'wrong-status') return json({ code: 'version_conflict' }, 400);
					if (mode === 'invalid') return json({ code: 'invalid_input' }, 400);
					const command = JSON.parse(options.body),
						result = wire();
					if (
						command.captcha.secret.action !== 'keep' ||
						'effectiveMonitoring' in command ||
						JSON.stringify(command.policy.passkeys) !== JSON.stringify(baseline.policy.passkeys)
					)
						throw Error('incorrect configuration write projection');
					result.version = command.expectedVersion + 1;
					result.requiresRestart = true;
					result.policy = command.policy;
					if (mode === 'wrong-value') result.policy.statusMonitorIntervalSeconds++;
					return json(result);
				}
				reads++;
				if (mode === 'late')
					return new Promise((resolve) => {
						release = () => resolve(json(wire()));
					});
				return json(wire());
			};
			const owner = controller();
			check(owner.snapshot.value === null && !owner.canSave.value, 'no invented initial interval');
			await owner.refresh();
			for (const fault of ['lost', 'stream', 'conflict', 'wrong-status', 'wrong-value']) {
				mode = fault;
				owner.draft.value.statusIntervalSeconds = 11;
				const count = writes;
				await owner.save();
				check(
					writes === count + 1 &&
						owner.needsRefresh.value &&
						!owner.canSave.value &&
						owner.feedback.value === (fault === 'conflict' ? 'conflict' : 'unknown'),
					fault + ' preserves read-only recovery fence',
				);
				await owner.save();
				check(writes === count + 1, fault + ' never replays a write');
				mode = 'normal';
				await owner.refresh();
				check(
					!owner.needsRefresh.value && owner.draft.value.statusIntervalSeconds === 7,
					fault + ' refresh restores authority',
				);
			}
			mode = 'invalid';
			owner.draft.value.statusIntervalSeconds = 12;
			await owner.save();
			check(
				!owner.needsRefresh.value && owner.canSave.value && owner.feedback.value === 'invalid_input',
				'confirmed input refusal remains editable',
			);
			mode = 'normal';
			await owner.save();
			check(
				owner.feedback.value === 'saved' &&
					owner.snapshot.value.effectiveMonitoring.statusIntervalSeconds === 7,
				'save never activates pending interval',
			);
			mode = 'late';
			const late = owner.refresh();
			await until(() => release);
			const finish = release;
			owner.deactivate();
			mode = 'normal';
			owner.activate();
			await until(() => owner.snapshot.value !== null);
			const current = owner.snapshot.value;
			finish();
			await late;
			check(
				owner.snapshot.value === current && !owner.loading.value,
				'old result and finally cannot overwrite reactivated owner',
			);
			mode = 'late';
			release = null;
			const obsolete = owner.refresh();
			await until(() => release);
			const finishSession = release;
			authenticatedSessionLifecycle.attach(1);
			mode = 'normal';
			// Attach starts a new read; release both retained controlled requests independently.
			if (release !== finishSession) release();
			finishSession();
			await obsolete;
			await until(() => !owner.loading.value);
			check(owner.snapshot.value !== null, 'first login invalidates old read and refreshes current authority');
			authenticatedSessionLifecycle.logout();
			check(
				owner.snapshot.value === null && owner.draft.value === null,
				'logout clears configuration and editable draft',
			);
			owner.dispose();
			const count = reads;
			owner.activate();
			await owner.refresh();
			check(reads === count, 'disposed owner cannot restart');
			for (const component of [Panel, PreferencesPanel, WorkspacePanel]) {
				node = document.createElement('div');
				document.body.append(node);
				mounted = createApp({ render: () => h(component) });
				mounted.use(createPinia()).use(i18n).mount(node);
				await until(() => node.querySelector('input[data-monitoring-status]'));
				check(
					node.querySelectorAll('[data-monitoring-configuration]').length === 1,
					component.__name + ' exposes independent core configuration',
				);
				const control = node.querySelector('input[data-monitoring-status]');
				control.value = '13';
				control.dispatchEvent(new Event('input', { bubbles: true }));
				await nextTick();
				check(
					!node.querySelector('[data-monitoring-save]').disabled,
					component.__name + ' numeric input enables CAS save',
				);
				const count = writes;
				node.querySelector('[data-monitoring-configuration] form').dispatchEvent(
					new Event('submit', { bubbles: true, cancelable: true }),
				);
				await nextTick();
				await until(() => writes > count && node.querySelector('[data-monitoring-feedback]'));
				check(
					!node.querySelector('[data-monitoring-refresh]'),
					component.__name + ' hides recovery refresh after a confirmed save',
				);
				check(
					writes === count + 1 && node.querySelector('[data-monitoring-feedback]'),
					component.__name + ' performs one write and renders feedback',
				);
				for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
					i18n.global.locale.value = locale;
					await nextTick();
					check(
						!node
							.querySelector('[data-monitoring-configuration]')
							.textContent.includes('settings.monitoring.'),
						component.__name + ' translates ' + locale,
					);
				}
				mounted.unmount();
				mounted = null;
				node.remove();
				node = null;
			}
			node = document.createElement('div');
			document.body.append(node);
			const time = 1700000000000;
			const history = {
				cpu: [
					{ time, value: 0, sequence: 1 },
					{ time: time + 60000, value: 25, sequence: 2 },
				],
				memory: [],
				swap: [],
				disk: [],
				networkRx: [],
				networkTx: [],
			};
			mounted = createApp({ render: () => h(StatusCharts, { history, metric: 'cpu', rangeMinutes: 5 }) });
			mounted.use(i18n).mount(node);
			await until(() => Chart.getChart(node.querySelector('canvas')));
			const chart = Chart.getChart(node.querySelector('canvas'));
			const samples = chart.data.datasets[0].data;
			check(
				samples.length === 2 && samples[0].x === time && samples[1].x === time + 60000 && samples[0].y === 0,
				'chart preserves real sample timestamps and zero without interval prop',
			);
			mounted.unmount();
			mounted = null;
			node.remove();
			node = null;
			return checks;
		} finally {
			mounted?.unmount();
			node?.remove();
			owners.forEach((owner) => owner.dispose());
			authenticatedSessionLifecycle.dispose();
			window.fetch = nativeFetch;
		}
	});
	assert.ok(real.length && controlled.length);
	console.log(
		`Monitoring configuration: real HTTP/restart ${real.length + 1}; controlled codecs/controller/components/locales ${controlled.length} PASS`,
	);
	console.log([...real, restart, ...controlled].join('\n'));
} finally {
	const cleanup = await Promise.allSettled(
		[() => browser?.close(), () => vite?.close(), () => app?.close()].map((task) => Promise.resolve().then(task)),
	);
	const failures = cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason);
	if (failures.length) {
		throw new AggregateError(failures, 'Monitoring configuration fixture cleanup failed');
	}
	await rm(directory, { recursive: true, force: true });
}
