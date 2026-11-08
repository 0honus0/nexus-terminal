import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { configureSshE2eSettings } from '../../support/ssh';
import { restartTestBackend } from '../../support/settings';
import { E2E_URLS } from '../../../support/protocols/test-environment';
import { openSshd } from '../../../support/protocols/openssh-fixture.mjs';
import { readSshKeyView } from '../../../../packages/shared/src/targets/ssh-keys/http-codec';
import {
	readConnectionImportResponse,
	readConnectionView,
} from '../../../../packages/shared/src/targets/connections/http-codec';
import { readAuditResponse } from '../../../../packages/shared/src/operations/http-codec';
import { readSuspendedCatalogEvent } from '../../../../packages/shared/src/remote/suspend/events';

test.use({ e2eServices: ['ssh'] });

declare global {
	interface Window {
		__releaseLifecycleCommand?: () => void;
		__lifecycleCommandReached: boolean;
		__lifecycleCommandSettled: boolean;
		__disposeLifecycleSession: () => Promise<unknown>;
		__readLifecycleHistory: () => string[];
		__lifecycleCachesEmpty: () => boolean;
	}
}

test('formal App retains one real SSH session, fences old page effects and revokes it on same-tick authentication replacement', async ({
	page,
	context,
}) => {
	const root = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, 'app-workspace-'));
	const ssh = await openSshd(directory);
	const headers = { Origin: E2E_URLS.frontendOrigin };
	const errors: string[] = [];
	const sockets: { closed: boolean }[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	page.on('websocket', (socket) => {
		if (new URL(socket.url()).pathname !== '/ws/workspace') return;
		const state = { closed: false };
		sockets.push(state);
		socket.on('close', () => {
			state.closed = true;
		});
	});
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const delivered = Promise.withResolvers<void>();
	try {
		await loginAsInitialAdmin(context.request);
		await setUiLanguage(context.request);
		await configureSshE2eSettings(context.request);
		expect(
			(
				await context.request.post('/api/v1/targets/host-keys/confirm', {
					headers,
					data: { host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint },
				})
			).status(),
		).toBe(201);
		const keyResponse = await context.request.post('/api/v1/targets/ssh-keys', {
			headers,
			data: { name: 'App lifecycle key', privateKey: ssh.privateKey },
		});
		expect(keyResponse.status()).toBe(201);
		const key = readSshKeyView(await keyResponse.json());
		const importing = await context.request.post('/api/v1/targets/connections/import', {
			headers,
			data: {
				items: [
					{
						connection: {
							name: 'App lifecycle connection',
							type: 'SSH',
							host: '127.0.0.1',
							port: ssh.port,
							username: ssh.user,
							route: 'direct',
							proxyId: null,
							notes: null,
							tagIds: [],
							jumpIds: [],
						},
						credential: { kind: 'ssh_key', sshKeyId: key.id },
					},
				],
			},
		});
		expect(importing.status()).toBe(200);
		const imported = readConnectionImportResponse(await importing.json()).items[0];
		if (imported.status !== 'ok') throw Error('Actual lifecycle connection import failed');
		const targetId = imported.id;
		const occupiedId = 'controlled-lifecycle-occupied';
		// Only the catalog producer is controlled. App, stream decoder, panel and confirmation stay real.
		await page.routeWebSocket('**/ws/suspended-sessions', (socket) => {
			const server = socket.connectToServer();
			server.onMessage((message) => {
				const event = readSuspendedCatalogEvent(JSON.parse(String(message)));
				socket.send(
					event.type === 'heartbeat'
						? message
						: JSON.stringify({
								type: 'snapshot',
								revision: event.revision,
								sessions: [
									{
										id: occupiedId,
										originalWorkspaceId: 'controlled-original-workspace',
										connectionId: targetId,
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
			});
		});
		let holdMetadata = true;
		await page.route('**/api/v1/targets/connections/' + targetId, async (route) => {
			const response = await route.fetch();
			if (holdMetadata) {
				holdMetadata = false;
				entered.resolve();
				await release.promise;
			}
			try {
				await route.fulfill({ response });
			} catch (cause) {
				if (!route.request().failure()) throw cause;
			} finally {
				delivered.resolve();
			}
		});
		await page.goto('/');
		const nav = page.locator('.app-nav-links');
		await page.getByRole('button', { name: 'Connect App lifecycle connection', exact: true }).click();
		await entered.promise;
		await nav.getByRole('link', { name: 'Dashboard', exact: true }).click();
		await nav.getByRole('link', { name: 'Terminal', exact: true }).click();
		release.resolve();
		await delivered.promise;
		await expect(page.locator('[data-session-id]')).toHaveCount(0);
		expect(sockets).toHaveLength(0);
		await page.unroute('**/api/v1/targets/connections/' + targetId);
		await nav.getByRole('link', { name: 'Dashboard', exact: true }).click();
		await page.getByRole('button', { name: 'Connect App lifecycle connection', exact: true }).click();
		await expect(page.locator('[data-session-state="connected"]')).toBeVisible();
		await expect(page.locator('.xterm-screen')).toBeVisible();
		await expect(page.locator('[data-focus-id="fileManagerPathInput"]')).toBeVisible();
		await expect(page.locator('[data-runtime-boundary]')).toHaveCount(0);
		const workspaceId = await page.locator('[data-session-id]').getAttribute('data-session-id');
		expect(sockets).toHaveLength(1);
		await nav.getByRole('link', { name: 'Dashboard', exact: true }).click();
		const targetResponse = await context.request.get('/api/v1/targets/connections/' + targetId);
		expect(targetResponse.status()).toBe(200);
		const target = readConnectionView(await targetResponse.json());
		expect(target.lastConnectedAt).toBeGreaterThan(1_000_000_000_000);
		const card = page.getByRole('listitem').filter({ hasText: 'App lifecycle connection' });
		await expect(card).toHaveAttribute('data-last-connected-at', String(target.lastConnectedAt));
		await expect(card.locator('.dashboard-connection-card__last-connected')).toHaveText(
			/^(?:now|\d+ seconds? ago)$/u,
		);
		await nav.getByRole('link', { name: 'Terminal', exact: true }).click();
		await expect(page.locator('[data-session-state="connected"]')).toBeVisible();
		await expect(page.locator('[data-session-id]')).toHaveAttribute('data-session-id', workspaceId ?? '');
		expect(sockets).toHaveLength(1);
		const history: string[] = [];
		page.on('request', (request) => {
			if (new URL(request.url()).pathname === '/api/v1/command-history' && request.method() === 'POST')
				history.push(request.postDataJSON().command);
		});
		const command = page.locator('[data-focus-id="commandInput"]');
		await command.fill('printf current-page-command');
		const historySaved = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/v1/command-history' &&
				response.request().method() === 'POST',
		);
		await command.press('Enter');
		expect((await historySaved).status()).toBe(201);
		await expect.poll(() => history).toEqual(['printf current-page-command']);
		await page.evaluate(() => {
			function object(value: unknown): value is Record<string, unknown> {
				return typeof value === 'object' && value !== null;
			}

			const visited = new Set<unknown>();

			function find(value: unknown): Record<string, unknown> | undefined {
				if (!object(value) || visited.has(value)) return;
				visited.add(value);
				if (object(value.component)) {
					const props = value.component.props;
					if (object(props) && object(props.session) && object(props.session.adapters)) return props.session;
					const nested = find(value.component.subTree);
					if (nested) return nested;
				}
				if (Array.isArray(value.children)) {
					for (const child of value.children) {
						const found = find(child);
						if (found) return found;
					}
				}
			}

			const root = document.querySelector('#app');
			const application: unknown = root ? Reflect.get(root, '__vue_app__') : null;
			if (!object(application) || !object(application.config) || !object(application.config.globalProperties))
				throw Error('Actual App missing');
			const pinia = application.config.globalProperties.$pinia;
			if (!object(pinia) || !(pinia._s instanceof Map)) throw Error('Actual App store registry missing');
			const history: unknown = pinia._s.get('command-history');
			if (!object(history)) throw Error('Actual command history store missing');
			window.__readLifecycleHistory = () => {
				if (!Array.isArray(history.items)) throw Error('Actual command history items missing');
				return history.items.map((item: unknown) => {
					if (!object(item) || typeof item.command !== 'string') throw Error('Invalid actual history item');
					return item.command;
				});
			};
			const session = root ? find(Reflect.get(root, '_vnode')) : undefined;
			if (
				!session ||
				!object(session.adapters) ||
				!object(session.adapters.terminal) ||
				typeof session.dispose !== 'function'
			)
				throw Error('Actual rendered session missing');
			const dispose = session.dispose;
			window.__disposeLifecycleSession = () => dispose.call(session);
			const terminal = session.adapters.terminal;
			const original = terminal.sendInput;
			if (typeof original !== 'function') throw Error('Actual terminal input capability missing');
			window.__lifecycleCommandReached = false;
			window.__lifecycleCommandSettled = false;
			terminal.sendInput = async (...args: unknown[]) => {
				try {
					await original.apply(terminal, args);
					window.__lifecycleCommandReached = true;
					await new Promise<void>((resolve) => {
						window.__releaseLifecycleCommand = resolve;
					});
				} finally {
					terminal.sendInput = original;
					window.__lifecycleCommandSettled = true;
				}
			};
		});
		await expect
			.poll(() => page.evaluate(() => window.__readLifecycleHistory()))
			.toContain('printf current-page-command');
		await command.fill('printf departed-page-command');
		await command.press('Enter');
		await page.waitForFunction(() => window.__lifecycleCommandReached);
		await nav.getByRole('link', { name: 'Dashboard', exact: true }).click();
		await nav.getByRole('link', { name: 'Terminal', exact: true }).click();
		await page.evaluate(() => window.__releaseLifecycleCommand?.());
		await page.waitForFunction(() => window.__lifecycleCommandSettled);
		expect(history).toEqual(['printf current-page-command']);
		expect(await page.evaluate(() => window.__readLifecycleHistory())).not.toContain(
			'printf departed-page-command',
		);
		await expect(page.locator('[data-session-id]')).toHaveAttribute('data-session-id', workspaceId ?? '');
		await nav.locator('a[href="/audit-logs"]').click();
		await expect(page.locator('[data-audit-id]').first()).toBeVisible();
		const filtering = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return url.pathname === '/api/v1/settings/audit-logs' && url.searchParams.get('q') === 'HTTP_MUTATION';
		});
		await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('HTTP_MUTATION');
		const filtered = await filtering;
		expect(filtered.status()).toBe(200);
		const activities = readAuditResponse(await filtered.json()).items;
		expect(activities.length).toBeGreaterThan(0);
		expect(activities.every((entry) => entry.event.includes('HTTP_MUTATION'))).toBe(true);
		await expect(page.locator('[data-runtime-boundary]')).toHaveCount(0);
		await nav.getByRole('link', { name: 'Terminal', exact: true }).click();
		await page.getByRole('button', { name: 'Suspended SSH Sessions', exact: true }).click();
		await page.locator('[data-suspend-id="' + occupiedId + '"] .action-resume').click();
		await expect(page.getByRole('dialog').filter({ hasText: 'currently owned by another device' })).toBeVisible();
		await page.evaluate(async () => {
			function object(value: unknown): value is Record<string, unknown> {
				return typeof value === 'object' && value !== null;
			}

			const root = document.querySelector('#app');
			const application: unknown = root ? Reflect.get(root, '__vue_app__') : null;
			if (!object(application) || !object(application.config) || !object(application.config.globalProperties))
				throw Error('Actual App missing');
			const router = application.config.globalProperties.$router;
			if (!object(router) || typeof router.push !== 'function') throw Error('Actual App router missing');
			await router.push({ name: 'Dashboard' });
		});
		await expect(page.getByRole('dialog').filter({ hasText: 'currently owned by another device' })).toHaveCount(0);
		const replacement = await page.evaluate(async () => {
			function object(value: unknown): value is Record<string, unknown> {
				return typeof value === 'object' && value !== null;
			}

			const root = document.querySelector('#app');
			const application: unknown = root ? Reflect.get(root, '__vue_app__') : null;
			if (!object(application) || !object(application.config) || !object(application.config.globalProperties))
				throw Error('Actual App missing');
			const pinia = application.config.globalProperties.$pinia;
			if (!object(pinia) || !(pinia._s instanceof Map)) throw Error('Actual App store registry missing');
			const dialog: unknown = pinia._s.get('shared-dialog');
			const commands: unknown = pinia._s.get('quick-commands');
			const catalog: unknown = pinia._s.get('filesystem-catalog');
			const auth: unknown = pinia._s.get('auth');
			if (
				!object(dialog) ||
				!object(dialog.state) ||
				typeof dialog.confirm !== 'function' ||
				typeof dialog.accept !== 'function' ||
				!object(auth) ||
				typeof auth.beginAuthentication !== 'function' ||
				!object(commands) ||
				typeof commands.save !== 'function' ||
				!object(catalog) ||
				typeof catalog.saveFavorite !== 'function'
			)
				throw Error('Actual application lifecycle owners missing');
			const originalVisible = dialog.state.visible;
			const confirmation = dialog.confirm({ message: 'New page confirmation' });
			dialog.accept();
			const nextAccepted: unknown = await confirmation;
			await commands.save({ name: 'Lifecycle revoke', command: 'true', variables: {}, tagIds: [] });
			await catalog.saveFavorite({ name: 'Lifecycle revoke', path: '/lifecycle-revoke' });
			if (
				!Array.isArray(commands.items) ||
				!commands.items.length ||
				!Array.isArray(catalog.favorites) ||
				!catalog.favorites.length
			)
				throw Error('Actual personal cache baseline missing');
			window.__lifecycleCachesEmpty = () =>
				Array.isArray(commands.items) &&
				!commands.items.length &&
				Array.isArray(catalog.favorites) &&
				!catalog.favorites.length;
			const user = auth.user;
			auth.beginAuthentication();
			auth.user = user;
			auth.sessionState = 'authenticated';
			return { originalVisible, nextAccepted, cachesEmpty: window.__lifecycleCachesEmpty() };
		});
		expect(replacement).toEqual({ originalVisible: false, nextAccepted: true, cachesEmpty: true });
		expect(await page.evaluate(() => window.__disposeLifecycleSession())).toBe('closed');
		await expect.poll(() => sockets[0].closed).toBe(true);
		await nav.getByRole('link', { name: 'Terminal', exact: true }).click();
		await expect(page.locator('[data-session-id]')).toHaveCount(0);
		expect(sockets).toHaveLength(1);
		expect(await page.evaluate(() => window.__lifecycleCachesEmpty())).toBe(true);
		expect(errors).toEqual([]);
	} finally {
		release.resolve();
		const failures: unknown[] = [];
		for (const close of [
			() => page.evaluate(() => window.__releaseLifecycleCommand?.()),
			() => page.close(),
			() => restartTestBackend(),
			() => ssh.close(),
		]) {
			try {
				await close();
			} catch (cause) {
				failures.push(cause);
			}
		}
		if (failures.length) throw new AggregateError(failures, 'App lifecycle browser cleanup failed');
	}
});
