import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';
import { openSshd } from '../backend/remote/openssh-fixture.mjs';

const { chromium } = createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-app-lifecycle-'));
const checks = [];
let app;
let vite;
let browser;
let ssh;
let releaseMetadata;
try {
	ssh = await openSshd(directory);
	const net = createNetServer();
	await new Promise((resolve) => net.listen(0, '127.0.0.1', resolve));
	const port = net.address().port;
	await new Promise((resolve) => net.close(resolve));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'app.db'), { encryptionKey: randomBytes(32) });
	const backend = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: {
			host: '127.0.0.1',
			port,
			strictPort: true,
			proxy: {
				'/api': { target: 'http://' + backend, changeOrigin: false },
				'/ws/workspace': { target: 'ws://' + backend, ws: true },
			},
		},
		plugins: [
			{
				name: 'app-lifecycle-imports',

				resolveId(id) {
					if (id === '/__lifecycle_imports.js') return id;
				},

				load(id) {
					if (id === '/__lifecycle_imports.js')
						return 'export {getActivePinia} from "pinia"; export {nextTick,reactive} from "vue";';
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	page.setDefaultTimeout(15000);
	let delayed;
	let auditIndex = 0;
	let delayAudit = false;
	await page.route('**/api/v1/settings/audit-logs?**', async (route) => {
		const index = ++auditIndex;
		if (delayAudit) {
			delayAudit = false;
			await new Promise((resolve) => {
				delayed = resolve;
			});
		}
		await route
			.fulfill({
				json: {
					items: [
						{
							id: index,
							createdAt: Date.now() - 120000,
							event: 'LOGIN_SUCCESS',
							userId: 1,
							sourceIp: null,
							subjectId: 'controlled activity ' + index,
							route: null,
							statusCode: 200,
						},
					],
					nextOffset: null,
				},
			})
			.catch(() => undefined);
	});
	await page.goto(origin + '/login');
	await page.evaluate(
		async ({ sshPort, sshUser }) => {
			const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
			const api = createAccessApi();
			await api.setup({
				username: 'admin',
				password: 'Lifecycle-fixture-2026!',
				confirmPassword: 'Lifecycle-fixture-2026!',
			});
			await api.login({ username: 'admin', password: 'Lifecycle-fixture-2026!', rememberMe: false });
			const { connectionsApi } = await import('/src/features/connections/api/connections-api.ts');
			const result = await connectionsApi.importMany([
				{
					connection: {
						name: 'lifecycle connection',
						type: 'SSH',
						host: '127.0.0.1',
						port: sshPort,
						username: sshUser,
						route: 'direct',
						proxyId: null,
						notes: null,
						tagIds: [],
						jumpIds: [],
					},
				},
			]);
			if (result[0].status !== 'ok') throw Error('real connection import failed');
		},
		{ sshPort: ssh.port, sshUser: ssh.user },
	);
	await app.targets.hostKeys.confirm({ host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint });
	const sshKey = await app.targets.sshKeys.create({ name: 'Lifecycle key', privateKey: ssh.privateKey });
	const target = (await app.targets.list())[0];
	assert.equal(
		(await app.targets.credentials.set(target.id, target.version, { kind: 'ssh_key', sshKeyId: sshKey.id })).status,
		'updated',
	);
	const configured = await app.targets.get(target.id);
	const connectedAt = Date.now();
	await app.targets.connectionUsage.recordConnected(
		configured.id,
		configured.version,
		configured.createdAt,
		'SSH',
		connectedAt,
	);
	await page.goto(origin + '/');
	await page.getByText('controlled activity 1', { exact: true }).waitFor();
	await page.locator('[data-last-connected-at]').first().waitFor();
	checks.push('formal App/router/Dashboard uses real Access and Targets HTTP');
	const expected = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }).format(-2, 'minute');
	assert.equal((await page.locator('main time').first().textContent()).trim(), expected);
	assert.equal(
		Number(await page.locator('[data-last-connected-at]').first().getAttribute('data-last-connected-at')),
		connectedAt,
	);
	assert.match(
		(await page.locator('[data-last-connected-at]').first().textContent()).trim(),
		/^(?:now|\d+ seconds? ago)$/u,
	);
	assert.equal(
		await page
			.locator('main span')
			.getByText(/^(?:now|\d+ seconds? ago)$/u)
			.count(),
		1,
	);
	checks.push('formal connection shows server milliseconds while Shared audit displays two minutes ago');
	await page.locator('.app-header a.nav-link[href="/connections"]').click();
	await page.waitForURL('**/connections');
	delayAudit = true;
	await page.locator('.app-header a.nav-link[href="/"]').click();
	await page.waitForURL(origin + '/');
	for (let attempt = 0; !delayed && attempt < 100; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(delayed, 'controlled second audit request reached actual page');
	await page.locator('.app-header a.nav-link[href="/connections"]').click();
	await page.waitForURL('**/connections');
	delayed();
	await page.locator('.app-header a.nav-link[href="/"]').click();
	await page.getByText('controlled activity 3', { exact: true }).waitFor();
	assert.equal(await page.getByText('controlled activity 2', { exact: true }).count(), 0);
	checks.push('KeepAlive deactivation cancels original audit read and reactivation publishes only current activity');
	const workspaceSockets = [];
	page.on('websocket', (socket) => {
		if (new URL(socket.url()).pathname === '/ws/workspace') workspaceSockets.push(socket);
	});
	await page.evaluate(async () => {
		const { connectionsApi } = await import('/src/features/connections/api/connections-api.ts');
		const original = connectionsApi.get;
		window.workspaceMetadataSettled = 0;
		connectionsApi.get = async (...args) => {
			try {
				return await original(...args);
			} finally {
				window.workspaceMetadataSettled += 1;
			}
		};
	});
	let holdMetadata = true;
	await page.route(origin + '/api/v1/targets/connections/' + target.id, async (route) => {
		const response = await route.fetch();
		if (holdMetadata) {
			holdMetadata = false;
			await new Promise((resolve) => {
				releaseMetadata = resolve;
			});
		}
		await route.fulfill({ response }).catch(() => undefined);
	});
	await page.evaluate(async (id) => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({
			name: 'Workspace',
			query: { connectionId: String(id) },
		});
	}, target.id);
	for (let attempt = 0; !releaseMetadata && attempt < 250; attempt++)
		await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(releaseMetadata, 'actual query metadata request reached controlled delivery gate');
	await page.locator('.app-header a.nav-link[href="/"]').click();
	await page.waitForURL(origin + '/');
	await page.locator('.app-header a.nav-link[href="/workspace"]').click();
	await page.waitForURL('**/workspace');
	releaseMetadata();
	await page.waitForFunction(() => window.workspaceMetadataSettled === 1);
	await page.evaluate(async () => {
		const { nextTick } = await import('/__lifecycle_imports.js');
		await nextTick();
		await new Promise((resolve) => requestAnimationFrame(resolve));
	});
	assert.equal(
		await page.evaluate(async () => {
			const { workspaceRuntimeRegistry } = await import('/src/runtimes/workspace/session/index.ts');
			return workspaceRuntimeRegistry.sessions.size;
		}),
		0,
	);
	assert.equal(workspaceSockets.length, 0, 'late query never opens Workspace transport');
	checks.push('formal Workspace leave/re-enter rejects old real metadata delivery before SSH dispatch');
	await page.locator('.app-header a.nav-link[href="/"]').click();
	await page.evaluate(async (id) => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({
			name: 'Workspace',
			query: { connectionId: String(id) },
		});
	}, target.id);
	await page.locator('[data-session-state="connected"]').waitFor();
	await page.locator('.xterm-screen').first().waitFor();
	assert.equal(await page.locator('[data-runtime-boundary="route"]').count(), 0);
	assert.equal(await page.locator('[data-runtime-boundary]').count(), 0);
	checks.push('Shared personal-data consumers mount in formal Workspace without runtime boundary errors');
	await page.locator('[data-focus-id="fileManagerPathInput"]').waitFor();
	assert.equal(await page.locator('[data-runtime-boundary]').count(), 0);
	const workspaceId = await page.locator('[data-session-id]').first().getAttribute('data-session-id');
	assert.equal(workspaceSockets.length, 1);
	checks.push('formal Workspace query opens real SSH and mounts the actual terminal surface');
	await page.locator('.app-header a.nav-link[href="/"]').click();
	await page.waitForURL(origin + '/');
	await page.locator('.app-header a.nav-link[href="/workspace"]').click();
	await page.locator('[data-session-state="connected"]').waitFor();
	assert.equal(await page.locator('[data-session-id]').first().getAttribute('data-session-id'), workspaceId);
	assert.equal(workspaceSockets.length, 1);
	checks.push('formal KeepAlive retains the accepted SSH instance without creating another transport');

	const historyRequests = [];

	const observeHistory = (request) => {
		if (new URL(request.url()).pathname === '/api/v1/command-history' && request.method() === 'POST')
			historyRequests.push(request.postDataJSON().command);
	};

	page.on('request', observeHistory);
	const commandInput = page.locator('[data-focus-id="commandInput"]');
	await commandInput.fill('printf current-page-command');
	await commandInput.press('Enter');
	await page.waitForFunction(async () => {
		const { useCommandHistoryStore } = await import('/src/features/command-history/store/commandHistory.store.ts');
		return useCommandHistoryStore().items.some((entry) => entry.command === 'printf current-page-command');
	});
	assert.deepEqual(historyRequests, ['printf current-page-command']);
	checks.push('formal command input dispatches real SSH and appends current-page history through Shared');
	await page.evaluate(async () => {
		const { workspaceRuntimeRegistry } = await import('/src/runtimes/workspace/session/index.ts');
		const terminal = workspaceRuntimeRegistry.activeSession.value.adapters.terminal;
		const original = terminal.sendInput;
		window.commandReturnReached = false;
		window.commandReturnSettled = false;
		terminal.sendInput = async (...args) => {
			try {
				await original(...args);
				window.commandReturnReached = true;
				await new Promise((resolve) => {
					window.releaseCommandReturn = resolve;
				});
			} finally {
				terminal.sendInput = original;
				window.commandReturnSettled = true;
			}
		};
	});
	await commandInput.fill('printf departed-page-command');
	await commandInput.press('Enter');
	await page.waitForFunction(() => window.commandReturnReached);
	await page.locator('.app-header a.nav-link[href="/"]').click();
	await page.waitForURL(origin + '/');
	await page.locator('.app-header a.nav-link[href="/workspace"]').click();
	await page.locator('[data-session-state="connected"]').waitFor();
	await page.evaluate(async () => {
		window.releaseCommandReturn();
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	assert.equal(await page.evaluate(() => window.commandReturnSettled), true);
	assert.deepEqual(historyRequests, ['printf current-page-command']);
	assert.equal(await page.locator('[data-session-id]').first().getAttribute('data-session-id'), workspaceId);
	checks.push('real SSH send returning after leave/re-enter cannot append stale page history');
	await page.evaluate(async () => {
		const { commandHistoryApi } = await import('/src/features/command-history/api/command-history-api.ts');
		const { useCommandHistoryStore } = await import('/src/features/command-history/store/commandHistory.store.ts');
		const { PreferenceRequestFailure } = await import('/src/client/preferences/preference-request.ts');
		const history = useCommandHistoryStore();
		const original = commandHistoryApi.list;
		let release, reached;
		const entered = new Promise((resolve) => {
			reached = resolve;
		});
		commandHistoryApi.list = async (...args) => {
			const result = await original(...args);
			reached();
			await new Promise((resolve) => {
				release = resolve;
			});
			return result;
		};
		try {
			const loading = history.load();
			await entered;
			const permission = new AbortController();
			const queued = history.add('revoked-queued-history', permission.signal).catch((cause) => cause);
			permission.abort();
			release();
			await loading;
			const failure = await queued;
			if (!(failure instanceof PreferenceRequestFailure) || failure.outcome !== 'not_dispatched')
				throw Error('revoked queued history was not rejected before dispatch');
			await history.clear();
		} finally {
			release?.();
			commandHistoryApi.list = original;
		}
	});
	assert.deepEqual(historyRequests, ['printf current-page-command']);
	page.off('request', observeHistory);
	checks.push('history intent revoked while behind an actual read never dispatches its queued POST');

	const personalChecks = await page.evaluate(async () => {
		const { filesystemCatalogApi } = await import('/src/features/filesystem/api/filesystem-catalog-api.ts');
		const { useFilesystemCatalogStore } =
			await import('/src/features/filesystem/composables/useFilesystemCatalog.ts');
		const { quickCommandsApi } = await import('/src/features/quick-commands/api/quick-commands-api.ts');
		const { useQuickCommandsStore } = await import('/src/features/quick-commands/store/quickCommands.store.ts');
		const { commandHistoryApi } = await import('/src/features/command-history/api/command-history-api.ts');
		const { useCommandHistoryStore } = await import('/src/features/command-history/store/commandHistory.store.ts');
		const { PreferenceRequestFailure } = await import('/src/client/preferences/preference-request.ts');
		const results = [];

		const expect = (condition, name) => {
			if (!condition) throw Error(name);
			results.push(name);
		};

		const catalog = useFilesystemCatalogStore();
		const favorite = await catalog.saveFavorite({ path: '/catalog-original', name: 'Original' });
		const updated = await catalog.saveFavorite({
			id: favorite.id,
			expectedVersion: favorite.version,
			path: '/catalog-updated',
			name: 'Updated',
		});
		expect(
			updated.version === favorite.version + 1 && updated.path === '/catalog-updated',
			'real favorite create/update uses Shared response and original CAS',
		);
		let conflict;
		try {
			await catalog.saveFavorite({
				id: favorite.id,
				expectedVersion: favorite.version,
				path: '/stale-overwrite',
				name: null,
			});
		} catch (cause) {
			conflict = cause;
		}
		expect(
			conflict instanceof PreferenceRequestFailure && conflict.code === 'version_conflict',
			'stale favorite editing is rejected rather than upgraded to the latest version',
		);
		await catalog.loadFavorites(true);
		expect(
			catalog.favorites.find((item) => item.id === favorite.id)?.path === '/catalog-updated',
			'explicit favorite recovery reads actual saved content',
		);
		await catalog.useFavorite(updated);
		await catalog.loadFavorites(true);
		const touched = catalog.favorites.find((item) => item.id === favorite.id);
		expect(
			touched?.version === updated.version + 1 && touched.lastUsedAt !== null,
			'favorite touch consumes versioned Shared mutation',
		);
		await catalog.removeFavorite(touched);
		expect(
			!catalog.favorites.some((item) => item.id === favorite.id),
			'favorite delete consumes original version and deleted receipt',
		);
		for (let index = 0; index < 102; index++) await filesystemCatalogApi.addHistory('/catalog-page-' + index);
		await catalog.loadHistory(true);
		expect(
			catalog.history.length >= 102 && catalog.history.some((item) => item.path === '/catalog-page-0'),
			'path history follows actual Shared pagination beyond one hundred entries',
		);
		await catalog.removeHistory(catalog.history[0].id);
		await catalog.clearHistory();
		expect(catalog.history.length === 0, 'path history delete and clear consume actual finite receipts');
		const commands = useQuickCommandsStore();
		await commands.load(true);
		const created = await commands.save({
			name: 'Shared command',
			command: 'printf shared',
			variables: { x: 'value' },
			tagIds: [],
		});
		const revised = await commands.save(
			{ name: created.name, command: 'printf updated', variables: {}, tagIds: [] },
			created,
		);
		expect(
			revised.version === created.version + 1 && revised.command === 'printf updated',
			'command create/update converts Shared wire into independent application summaries',
		);
		let stale;
		try {
			await commands.save({ name: null, command: 'stale', variables: {}, tagIds: [] }, created);
		} catch (cause) {
			stale = cause;
		}
		expect(
			stale instanceof PreferenceRequestFailure && stale.code === 'version_conflict',
			'command editing preserves its original version',
		);
		await commands.load(true);
		const assignment = await commands.createTagForCommands('Assigned tag', [revised]);
		expect(
			assignment.assigned &&
				commands.items.find((item) => item.id === revised.id)?.version === revised.version + 1,
			'tag assignment rereads authoritative command versions',
		);
		const renamed = await commands.renameTag(assignment.tag, 'Renamed tag');
		await commands.removeTag(renamed);
		const detached = commands.items.find((item) => item.id === revised.id);
		expect(
			detached.version === revised.version + 2 && detached.tagIds.length === 0,
			'tag deletion rereads cascading version changes',
		);
		await commands.recordUsage(detached.id);
		const counted = commands.items.find((item) => item.id === detached.id);
		expect(
			counted.version === detached.version + 1 && counted.usageCount === 1,
			'usage increment consumes finite versioned mutation',
		);
		await commands.remove(counted);
		for (let index = 0; index < 51; index++)
			await quickCommandsApi.create({ name: 'Page ' + index, command: 'true', variables: {}, tagIds: [] });
		await commands.load(true);
		expect(
			commands.items.length === 51,
			'commands follow Shared fifty-entry pagination without accepting a legacy array',
		);
		for (let index = 0; index < 102; index++) await commandHistoryApi.add('history-page-' + index);
		const history = useCommandHistoryStore();
		await history.load(true);
		expect(
			history.items.length === 102 && history.items.some((item) => item.command === 'history-page-0'),
			'command history follows actual Shared pagination',
		);
		await history.remove(history.items[0].id);
		await history.clear();
		expect(history.items.length === 0, 'command history delete/clear decode finite actual receipts');
		const permission = new AbortController();
		permission.abort();
		let denied;
		try {
			await commands.save(
				{ name: null, command: 'must not dispatch', variables: {}, tagIds: [] },
				undefined,
				permission.signal,
			);
		} catch (cause) {
			denied = cause;
		}
		expect(
			denied instanceof PreferenceRequestFailure && denied.outcome === 'not_dispatched',
			'revoked queued UI intent is rejected before HTTP dispatch',
		);
		return results;
	});
	checks.push(...personalChecks);
	let unknownCreated = false;
	await page.route(
		origin + '/api/v1/favorite-paths',
		async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			const response = await route.fetch();
			assert.equal(response.status(), 201);
			unknownCreated = true;
			await route.abort('failed');
		},
		{ times: 1 },
	);
	const unknown = await page.evaluate(async () => {
		const { useFilesystemCatalogStore } =
			await import('/src/features/filesystem/composables/useFilesystemCatalog.ts');
		const { PreferenceRequestFailure } = await import('/src/client/preferences/preference-request.ts');
		const store = useFilesystemCatalogStore();
		let first, second;
		try {
			await store.saveFavorite({ name: 'Unknown delivery', path: '/unknown-delivery' });
		} catch (cause) {
			first = cause;
		}
		try {
			await store.saveFavorite({ name: 'Must not replay', path: '/unknown-delivery' });
		} catch (cause) {
			second = cause;
		}
		await store.loadFavorites(true);
		return {
			unknown: first instanceof PreferenceRequestFailure && first.outcome === 'unknown',
			blocked: second instanceof PreferenceRequestFailure && second.outcome === 'not_dispatched',
			entries: store.favorites.filter((item) => item.path === '/unknown-delivery').length,
		};
	});
	assert.equal(unknownCreated, true);
	assert.deepEqual(unknown, { unknown: true, blocked: true, entries: 1 });
	checks.push('real favorite commit with controlled lost response keeps unknown fence and never replays the write');
	await page.route('**/api/v1/favorite-paths?**', (route) => route.fulfill({ json: [] }), { times: 1 });
	const oldArray = await page.evaluate(async () => {
		const { filesystemCatalogApi } = await import('/src/features/filesystem/api/filesystem-catalog-api.ts');
		const { PreferenceRequestFailure } = await import('/src/client/preferences/preference-request.ts');
		try {
			await filesystemCatalogApi.listFavorites('name');
			return false;
		} catch (cause) {
			return cause instanceof PreferenceRequestFailure && cause.code === 'protocol_failure';
		}
	});
	assert.equal(oldArray, true);
	checks.push('legacy bare array is rejected as protocol failure without a compatibility branch');
	assert.equal(await page.locator('[data-runtime-boundary]').count(), 0);

	await page.unroute('**/api/v1/settings/audit-logs?**');
	const auditChecks = await page.evaluate(async () => {
		const { auditApi } = await import('/src/features/audit/public.ts');
		const { OperationsRequestFailure } = await import('/src/client/operations/operations-request.ts');
		const first = await auditApi.list({ event: 'HTTP_MUTATION', limit: 2 });
		if (
			first.items.length !== 2 ||
			first.nextOffset !== 2 ||
			first.items.some((row) => row.event !== 'HTTP_MUTATION' || row.createdAt < 1000000000000)
		)
			throw Error('audit first page');
		const second = await auditApi.list({ event: 'HTTP_MUTATION', limit: 2, offset: first.nextOffset });
		if (second.items.some((row) => first.items.some((previous) => previous.id === row.id)))
			throw Error('audit pagination duplicate');
		try {
			await auditApi.list({ limit: 201 });
			throw Error('invalid audit query accepted');
		} catch (cause) {
			if (
				!(cause instanceof OperationsRequestFailure) ||
				cause.code !== 'invalid_input' ||
				cause.outcome !== 'not_dispatched'
			)
				throw cause;
		}
		return [
			'real audit HTTP uses finite Shared event filtering, milliseconds and server nextOffset',
			'audit pagination preserves descending unique identities and rejects invalid requests before dispatch',
		];
	});
	checks.push(...auditChecks);
	await page.route(
		'**/api/v1/settings/audit-logs?**',
		(route) => route.fulfill({ json: { logs: [], total: 0, offset: 0, limit: 5 } }),
		{ times: 1 },
	);
	const rejectedOldAudit = await page.evaluate(async () => {
		const { auditApi } = await import('/src/features/audit/public.ts');
		const { OperationsRequestFailure } = await import('/src/client/operations/operations-request.ts');
		try {
			await auditApi.list({ limit: 5 });
			return false;
		} catch (cause) {
			return cause instanceof OperationsRequestFailure && cause.code === 'protocol_failure';
		}
	});
	assert.equal(rejectedOldAudit, true);
	checks.push('audit old free-details/page shape is rejected without a protocol compatibility branch');

	const presentationChecks = await page.evaluate(async () => {
		const { usePresentationStore, usePreferences } = await import('/src/features/preferences/public.ts');
		const { reactive } = await import('/__lifecycle_imports.js');
		const { PreferenceRequestFailure } = await import('/src/client/preferences/preference-request.ts');
		const store = usePresentationStore();
		const preferences = usePreferences();
		const checks = [];
		const initial = await store.load(true);
		if (!initial.layout.id || !Number.isSafeInteger(initial.version)) throw Error('initial presentation snapshot');
		const saved = await store.update({
			action: 'preferences',
			expectedVersion: initial.version,
			preferences: { ...initial.preferences, timezone: 'Asia/Tokyo' },
		});
		if (saved.version !== initial.version + 1 || preferences.values.value.timezone !== 'Asia/Tokyo')
			throw Error('preferences receipt');
		checks.push('four real Shared reads form one coherent personal presentation snapshot');
		try {
			await store.update({ action: 'focus', expectedVersion: initial.version, focus: initial.focus });
			throw Error('stale accepted');
		} catch (cause) {
			if (!(cause instanceof PreferenceRequestFailure) || cause.code !== 'version_conflict') throw cause;
		}
		if (!store.blocked) throw Error('conflict failed to fence');
		const fresh = await store.load(true);
		if (store.blocked || fresh.preferences.timezone !== 'Asia/Tokyo') throw Error('conflict recovery');
		checks.push('personal domains share original CAS version and recover only by explicit read');
		const input = reactive({
			action: 'focus',
			expectedVersion: fresh.version,
			focus: { sequence: ['commandInput'], shortcuts: { commandInput: 'Alt+C' } },
		});
		const pending = store.update(input);
		input.focus.shortcuts.commandInput = 'Alt+D';
		const focused = await pending;
		if (focused.focus.shortcuts.commandInput !== 'Alt+C') throw Error('draft was not frozen');
		checks.push(
			'reactive focus drafts are whitelisted before queueing and later mutations cannot alter the request',
		);
		const workspace = await store.update({
			action: 'workspace',
			expectedVersion: focused.version,
			layout: focused.layout,
			sidebar: { left: ['connections'], right: ['dockerManager'] },
		});
		if (
			workspace.version !== focused.version + 1 ||
			workspace.sidebar.right[0] !== 'dockerManager' ||
			workspace.focus.shortcuts.commandInput !== 'Alt+C'
		)
			throw Error('workspace atomic write');
		checks.push('layout and sidebar update atomically while preserving the other personal domains');
		return checks;
	});
	checks.push(...presentationChecks);

	let presentationWrites = 0;
	await page.route(
		'**/api/v1/settings/preferences',
		async (route) => {
			if (route.request().method() !== 'PUT') {
				await route.continue();
				return;
			}
			presentationWrites++;
			await route.fetch();
			await route.abort('failed');
		},
		{ times: 1 },
	);
	const presentationUnknown = await page.evaluate(async () => {
		const { usePresentationStore } = await import('/src/features/preferences/public.ts');
		const { PreferenceRequestFailure } = await import('/src/client/preferences/preference-request.ts');
		const store = usePresentationStore();
		const value = store.snapshot;
		const change = {
			action: 'preferences',
			expectedVersion: value.version,
			preferences: { ...value.preferences, timezone: 'UTC' },
		};
		const pending = store.update(change).catch((cause) => cause);
		const prematureRecovery = store.load(true).catch((cause) => cause);
		const failure = await pending;
		if (!(failure instanceof PreferenceRequestFailure) || failure.outcome !== 'unknown')
			throw Error('lost write response classification');
		await prematureRecovery;
		if (!store.blocked) throw Error('premature read cleared a later unknown');
		try {
			await store.update(change);
			throw Error('unknown replay accepted');
		} catch (cause) {
			if (!(cause instanceof PreferenceRequestFailure) || cause.code !== 'refresh_required') throw cause;
		}
		const recovered = await store.load(true);
		if (store.blocked || recovered.preferences.timezone !== 'UTC') throw Error('unknown recovery');
		return true;
	});
	assert.equal(presentationUnknown, true);
	assert.equal(presentationWrites, 1);
	checks.push(
		'real presentation commit with lost response remains fenced; a previously requested refresh cannot clear it',
	);

	// A cancelled draft must not dispatch after a real in-flight read settles.
	let releasePresentationRead;
	let presentationReadStarted;
	const presentationReadReady = new Promise((resolve) => {
		presentationReadStarted = resolve;
	});
	await page.route(
		'**/api/v1/settings/sidebar',
		async (route) => {
			const response = await route.fetch();
			presentationReadStarted();
			await new Promise((resolve) => {
				releasePresentationRead = resolve;
			});
			await route.fulfill({ response }).catch(() => undefined);
		},
		{ times: 1 },
	);
	const queuedPresentation = page.evaluate(async () => {
		const { usePresentationStore } = await import('/src/features/preferences/public.ts');
		const { PreferenceRequestFailure } = await import('/src/client/preferences/preference-request.ts');
		const store = usePresentationStore();
		const value = store.snapshot;
		const read = store.load(true);
		const permission = new AbortController();
		const write = store
			.update({ action: 'focus', expectedVersion: value.version, focus: value.focus }, permission.signal)
			.catch((cause) => cause);
		permission.abort();
		await read;
		const result = await write;
		return (
			result instanceof PreferenceRequestFailure &&
			result.code === 'cancelled' &&
			result.outcome === 'not_dispatched'
		);
	});
	await presentationReadReady;
	releasePresentationRead();
	assert.equal(await queuedPresentation, true);
	checks.push('presentation drafts cancelled behind a real read never dispatch their queued write');

	await page.route(
		'**/api/v1/settings/layout',
		(route) => route.fulfill({ json: { type: 'container', id: 'legacy', children: [] } }),
		{ times: 1 },
	);
	const badLayout = await page.evaluate(async () => {
		const { presentationApi } = await import('/src/features/preferences/api/presentation-api.ts');
		try {
			await presentationApi.load();
			return false;
		} catch {
			return true;
		}
	});
	assert.equal(badLayout, true);
	checks.push('legacy bare layouts are refused without localStorage or default-value compatibility fallback');

	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/audit-logs');
	});
	await page.locator('[data-audit-id]').first().waitFor();
	const auditRows = await page.locator('[data-audit-id]').count();
	assert.ok(auditRows > 0);
	assert.equal(await page.locator('[data-runtime-boundary]').count(), 0);
	const auditSearch = page.getByRole('searchbox', { name: 'Search', exact: true });
	await auditSearch.fill('HTTP_MUTATION');
	await page.waitForFunction(async () => {
		const { useAuditStore } = await import('/src/features/audit/store/audit.store.ts');
		const store = useAuditStore();
		return (
			!store.loading && store.logs.length > 0 && store.logs.every((row) => row.event.includes('HTTP_MUTATION'))
		);
	});
	checks.push('formal audit route renders safe Shared summaries and applies real server search');
	// Exercise the real Settings route, not a component-only substitute.
	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/settings?tab=system');
	});
	await page.locator('#timezoneSelect').waitFor();
	await page.locator('#timezoneSelect').click();
	await page.getByRole('option', { name: 'Europe/London', exact: true }).click();
	await page
		.locator('form')
		.filter({ has: page.locator('#timezoneSelect') })
		.getByRole('button')
		.click();
	await page.waitForFunction(async () => {
		const { usePresentationStore } = await import('/src/features/preferences/public.ts');
		return usePresentationStore().snapshot?.preferences.timezone === 'Europe/London';
	});
	await page.locator('[data-backend-logging] #backendLogLevelSelect').waitFor();
	await page.locator('[data-backend-logging] #backendLogLevelSelect').click();
	await page.getByRole('option', { name: 'WARN', exact: true }).click();
	await page.locator('[data-backend-logging] form button[type=submit]').click();
	await page.waitForFunction(async () => {
		const response = await fetch('/api/v1/settings/logging');
		const value = await response.json();
		return value.level === 'warn';
	});
	checks.push(
		'formal Settings saves Shared preferences and independent Operations logging through their actual forms',
	);
	await page.locator('#timezoneSelect').click();
	await page.getByRole('option', { name: 'Asia/Shanghai', exact: true }).click();
	await page.evaluate(async () => {
		const { usePreferences } = await import('/src/features/preferences/public.ts');
		const preferences = usePreferences();
		await preferences.update({ showConnectionTags: false });
	});
	assert.equal(await page.locator('#timezoneSelect').getAttribute('data-value'), 'Asia/Shanghai');
	await page
		.locator('form')
		.filter({ has: page.locator('#timezoneSelect') })
		.getByRole('button')
		.click();
	await page
		.getByText('The record changed or no longer exists. Read the list again, then reopen the editor.', {
			exact: true,
		})
		.first()
		.waitFor();
	const stableTimezone = await page.evaluate(
		async () => (await (await fetch('/api/v1/settings/preferences')).json()).preferences.timezone,
	);
	assert.equal(stableTimezone, 'Europe/London');
	checks.push(
		'formal dirty settings retain their original baseline and cannot overwrite a concurrent personal-domain change',
	);
	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'Workspace' });
	});
	await page.locator('main > [role=alert] button').click();
	await page.locator('[data-focus-id="fileManagerPathInput"]').waitFor();

	const occupiedId = 'controlled-occupied-session';
	await page.route('**/api/v1/ssh-suspend/suspended-sessions', (route) =>
		route.fulfill({
			json: [
				{
					id: occupiedId,
					originalWorkspaceId: 'controlled-original-workspace',
					connectionId: target.id,
					connectionName: 'Controlled takeover candidate',
					suspendedAt: new Date().toISOString(),
					status: 'active',
					ownershipState: 'attached',
					ownershipGeneration: 1,
					ownershipLeaseExpiresAt: Date.now() + 45000,
					attachedWorkspaceId: 'controlled-other-workspace',
				},
			],
		}),
	);
	await page.evaluate(async () => {
		const { refreshSuspendedSessionsCatalog } = await import('/src/features/ssh-suspend/public.ts');
		const result = await refreshSuspendedSessionsCatalog();
		if (!result.ok) throw Error('controlled catalog rejected');
	});
	await page.getByRole('button', { name: 'Suspended SSH Sessions', exact: true }).click();
	await page.locator('[data-suspend-id="' + occupiedId + '"] .action-resume').click();
	await page
		.getByText(
			'Session "Controlled takeover candidate" is currently owned by another device. Take over this same SSH session? The existing owner will be disconnected.',
			{ exact: true },
		)
		.waitFor();
	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'Dashboard' });
	});
	const confirmation = await page.evaluate(async () => {
		const { getActivePinia } = await import('/__lifecycle_imports.js');
		const { useDialogStore } = await import('/src/shared/feedback/store/dialog.store.ts');
		const dialogs = useDialogStore(getActivePinia());
		const originalVisible = dialogs.state.visible;
		const next = dialogs.confirm({ message: 'New page confirmation' });
		dialogs.accept();
		return { originalVisible, nextAccepted: await next };
	});
	assert.deepEqual(confirmation, { originalVisible: false, nextAccepted: true });
	assert.equal(workspaceSockets.length, 1);
	checks.push('deactivation cancels original takeover confirmation without affecting the next page dialog');
	const transitions = await page.evaluate(async () => {
		const { getActivePinia, nextTick } = await import('/__lifecycle_imports.js');
		const { useAuthStore } = await import('/src/features/auth/store/auth.store.ts');
		const { registerAuthenticatedSessionOwner } = await import('/src/shared/session/public.ts');
		const auth = useAuthStore(getActivePinia());
		const events = [];
		const unregister = registerAuthenticatedSessionOwner('controlled-app-session', (event) =>
			events.push(event.type),
		);
		const { workspaceRuntimeRegistry } = await import('/src/runtimes/workspace/session/index.ts');
		const originalRuntime = workspaceRuntimeRegistry.activeSession.value;
		const user = auth.user;
		auth.beginAuthentication();
		auth.user = user;
		auth.sessionState = 'authenticated';
		unregister();
		await nextTick();
		if (!originalRuntime || (await originalRuntime.dispose()) !== 'closed')
			throw Error('original real Workspace did not confirm close');
		if (workspaceRuntimeRegistry.sessions.size !== 0) throw Error('revoked Workspace was restored');
		const { useQuickCommandsStore } = await import('/src/features/quick-commands/store/quickCommands.store.ts');
		const { useFilesystemCatalogStore } =
			await import('/src/features/filesystem/composables/useFilesystemCatalog.ts');
		if (useQuickCommandsStore().items.length || useFilesystemCatalogStore().favorites.length)
			throw Error('revoked personal data remained in application caches');
		return events;
	});
	assert.deepEqual(transitions, ['attach', 'logout', 'attach']);
	checks.push(
		'formal App observes same-tick same-user authentication replacement synchronously and closes original real SSH',
	);
	console.log('Formal App lifecycle: ' + checks.length + ' checks PASS');
	console.log(checks.join('\n'));
} finally {
	releaseMetadata?.();
	const outcomes = await Promise.allSettled([
		Promise.resolve().then(() => browser?.close()),
		Promise.resolve().then(() => vite?.close()),
		Promise.resolve().then(() => app?.close()),
	]);
	const failures = outcomes.filter((result) => result.status === 'rejected').map((result) => result.reason);
	try {
		await ssh?.close();
	} catch (cause) {
		failures.push(cause);
	}
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (cause) {
		failures.push(cause);
	}
	if (failures.length) throw new AggregateError(failures, 'App lifecycle fixture cleanup failed');
}
