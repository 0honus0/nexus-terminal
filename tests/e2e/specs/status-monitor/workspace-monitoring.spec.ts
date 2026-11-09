import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { configureSshE2eSettings } from '../../support/ssh';
import { updateTestSettings, restartTestBackend } from '../../support/settings';
import { E2E_URLS } from '../../../support/protocols/test-environment';
import { openSshd } from '../../../support/protocols/openssh-fixture.mjs';
import { readSshKeyView } from '../../../../packages/shared/src/targets/ssh-keys/http-codec';
import {
	readConnectionView,
	readCredentialMutation,
} from '../../../../packages/shared/src/targets/connections/http-codec';
import { readSshResourceStatus } from '../../../../packages/shared/src/remote/monitoring/http-codec';
import type { SshResourceStatusResponse } from '../../../../packages/shared/src/remote/monitoring/http';

test.use({ e2eServices: ['ssh'] });

declare global {
	interface Window {
		__readMonitoringSnapshot(): { sessionId: string; history: { time: number; value: number }[] };
	}
}

test('Workspace and Dashboard consume real Linux samples, natural cache expiry and retain one session across a short page switch', async ({
	page,
	context,
}) => {
	const root = process.env.NEXUS_TEST_ARTIFACT_DIR ?? process.env.NEXUS_E2E_DATA_ROOT ?? tmpdir();
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, 'workspace-monitoring-'));
	const ssh = await openSshd(directory);
	const headers = { Origin: E2E_URLS.frontendOrigin };
	const controls: unknown[] = [];
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	page.on('websocket', (socket) => {
		if (!socket.url().includes('/ws/workspace')) return;
		socket.on('framesent', ({ payload }) => {
			if (typeof payload === 'string') controls.push(JSON.parse(payload));
		});
	});
	try {
		await loginAsInitialAdmin(context.request);
		await configureSshE2eSettings(context.request);
		const policy = await updateTestSettings(context.request, (input) => {
			input.policy.statusMonitorIntervalSeconds = 1;
			input.policy.remoteHostRefreshIntervalSeconds = 5;
		});
		expect(policy.effectiveMonitoring).toEqual({
			statusMonitorIntervalSeconds: 1,
			remoteHostRefreshIntervalSeconds: 5,
		});
		const trusted = await context.request.post('/api/v1/targets/host-keys/confirm', {
			headers,
			data: { host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint },
		});
		expect(trusted.status()).toBe(201);
		const keyResponse = await context.request.post('/api/v1/targets/ssh-keys', {
			headers,
			data: { name: 'Monitoring key', privateKey: ssh.privateKey },
		});
		expect(keyResponse.status()).toBe(201);
		const key = readSshKeyView(await keyResponse.json());
		const connection = await context.request.post('/api/v1/targets/connections', {
			headers,
			data: {
				name: 'Monitoring OpenSSH',
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
		});
		expect(connection.status()).toBe(201);
		const target = readConnectionView(await connection.json());
		const credential = await context.request.put('/api/v1/targets/connections/' + target.id + '/credential', {
			headers,
			data: { version: target.version, credential: { kind: 'ssh_key', sshKeyId: key.id } },
		});
		expect(credential.status()).toBe(200);
		expect(readCredentialMutation(await credential.json()).status).toBe('updated');
		await page.goto('/workspace?connectionId=' + target.id);
		await expect(page.locator('[data-session-state="connected"]')).toBeVisible();
		// Observe the actual session bound to the rendered surface. No product hook,
		// second Registry bundle or replacement status controller is installed.
		await page.evaluate(() => {
			function object(value: unknown): value is Record<string, unknown> {
				return typeof value === 'object' && value !== null;
			}

			const visited = new Set<unknown>();

			function find(value: unknown): Record<string, unknown> | undefined {
				if (!object(value) || visited.has(value)) return;
				visited.add(value);
				const component = value.component;
				if (object(component)) {
					const props = component.props;
					if (object(props) && object(props.session) && object(props.session.statusController))
						return props.session;
					const nested = find(component.subTree);
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
			const session = root ? find(Reflect.get(root, '_vnode')) : undefined;
			if (!session) throw new Error('Rendered Workspace session missing');
			window.__readMonitoringSnapshot = () => {
				const controller = session.statusController;
				if (
					typeof session.id !== 'string' ||
					!object(controller) ||
					!object(controller.history) ||
					!object(controller.history.value) ||
					!Array.isArray(controller.history.value.cpu)
				)
					throw new Error('Actual status history missing');
				return {
					sessionId: session.id,
					history: controller.history.value.cpu.map((point: unknown) => {
						if (!object(point) || typeof point.time !== 'number' || typeof point.value !== 'number')
							throw new Error('Invalid actual history point');
						return { time: point.time, value: point.value };
					}),
				};
			};
		});
		await expect
			.poll(() => page.evaluate(() => window.__readMonitoringSnapshot().history.length))
			.toBeGreaterThanOrEqual(3);
		const initial = await page.evaluate(() => window.__readMonitoringSnapshot());
		for (let index = 1; index < initial.history.length; index++) {
			expect(initial.history[index].time - initial.history[index - 1].time).toBeGreaterThanOrEqual(800);
		}
		await expect(page.getByRole('button', { name: /^CPU / }).first()).toBeVisible();
		await expect(page.locator('[data-runtime-boundary]')).toHaveCount(0);
		const resourcePath = '/api/v1/system/ssh-resources/' + target.id;
		const samples: SshResourceStatusResponse[] = [];
		// Observe the actual server bytes before forwarding them unchanged. CDP can
		// retire a response body even when eagerly read from the response event.
		await page.route(
			(url) => url.pathname === resourcePath,
			async (route) => {
				const response = await route.fetch();
				try {
					expect(response.status()).toBe(200);
					const bytes = await response.body();
					const sample = readSshResourceStatus(JSON.parse(bytes.toString('utf8')));
					await route.fulfill({ response, body: bytes });
					samples.push(sample);
				} finally {
					await response.dispose();
				}
			},
		);
		await page.locator('.app-nav-links').getByRole('link', { name: 'Dashboard', exact: true }).click();
		await expect.poll(() => samples.length).toBeGreaterThan(0);
		const first = samples[0];
		expect(first.status?.memTotal).toBeGreaterThan(0);
		const card = page.locator('.dashboard-connection-card').filter({ hasText: target.name ?? '' });
		await expect(card).toContainText('CPU');
		const cachedResponse = await context.request.get(resourcePath);
		expect(cachedResponse.status()).toBe(200);
		const cached = readSshResourceStatus(await cachedResponse.json());
		expect(cached.checkedAt).toBe(first.checkedAt);
		// Wait for a real SSH sample; the subscription grace deadline itself is tested with a virtual clock below UI.
		const paused = await page.evaluate(() => window.__readMonitoringSnapshot());
		await expect
			.poll(() => page.evaluate(() => window.__readMonitoringSnapshot().history.length))
			.toBeGreaterThan(paused.history.length);
		const grace = await page.evaluate(() => window.__readMonitoringSnapshot());
		expect(grace.sessionId).toBe(paused.sessionId);
		expect(grace.history.length).toBeGreaterThan(paused.history.length);
		expect(
			controls.filter(
				(item) => typeof item === 'object' && item !== null && Reflect.get(item, 'type') === 'status.stop',
			),
		).toHaveLength(0);
		await expect.poll(() => samples.at(-1)?.checkedAt ?? 0, { timeout: 15_000 }).toBeGreaterThan(first.checkedAt);
		const recollected = samples[samples.length - 1];
		expect(recollected.status?.memTotal).toBeGreaterThan(0);
		expect(recollected.checkedAt).toBeGreaterThan(first.checkedAt);
		await page.locator('.app-nav-links').getByRole('link', { name: 'Terminal', exact: true }).click();
		await expect(page.locator('[data-session-state="connected"]')).toBeVisible();
		expect((await page.evaluate(() => window.__readMonitoringSnapshot())).sessionId).toBe(initial.sessionId);
		expect(errors).toEqual([]);
	} finally {
		const failures: unknown[] = [];
		// Drain the actual application before terminating the daemon it owns.
		for (const close of [() => page.close(), () => restartTestBackend(), () => ssh.close()]) {
			try {
				await close();
			} catch (cause) {
				failures.push(cause);
			}
		}
		if (failures.length) throw new AggregateError(failures, 'Monitoring browser cleanup failed');
	}
});
