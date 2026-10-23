import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import { E2E_PORTS, E2E_URLS } from '../../support/test-env';
import { readAccessStatus } from '../../../../packages/shared/src/access/http';
import {
	readPreferencesResponse,
	readLayoutResponse,
	readSidebarResponse,
	readPresentationUpdateResponse,
} from '../../../../packages/shared/src/preferences/presentation/http-codec';
import { readSettingsResponse } from '../../../../packages/shared/src/preferences/configuration/http-codec';
import type { NotificationCreateRequest } from '../../../../packages/shared/src/operations/notifications/http';
import { readNotificationResponse, readNotificationList } from '../../../../packages/shared/src/operations/http-codec';

const headers = { Origin: E2E_URLS.frontendOrigin };

test.describe('authenticated HTTP API', () => {
	test('rejects unauthenticated access to auth status', async ({ request }) => {
		const response = await request.get('/api/v1/auth/status');
		expect(response.status()).toBe(401);
		await expect(response.json()).resolves.toEqual({ code: 'unauthenticated' });
	});

	test('logs in through HTTP and accesses protected APIs', async ({ request }) => {
		await loginAsInitialAdmin(request);
		const authStatus = await request.get('/api/v1/auth/status');
		expect(authStatus.ok()).toBeTruthy();
		expect(readAccessStatus(await authStatus.json()).user.username).toBe(E2E_ADMIN.username);
		const settings = await request.get('/api/v1/settings');
		expect(settings.ok()).toBeTruthy();
		readSettingsResponse(await settings.json());
	});

	test('rejects invalid bounded settings instead of persisting them', async ({ request }) => {
		await loginAsInitialAdmin(request);
		const before = await request.get('/api/v1/settings/preferences');
		expect(before.ok()).toBeTruthy();
		const original = readPreferencesResponse(await before.json());
		for (const change of [
			{ dockerStatusIntervalSeconds: 0 },
			{ terminalScrollbackLimit: -1 },
			{ statusMonitorScale: 0.64 },
			{ fileManagerRowSizeMultiplier: 2.01 },
			{ quickCommandRowSizeMultiplier: 0.49 },
		]) {
			const response = await request.put('/api/v1/settings/preferences', {
				headers,
				data: { expectedVersion: original.version, preferences: { ...original.preferences, ...change } },
			});
			expect(response.status()).toBe(400);
		}
		const after = await request.get('/api/v1/settings/preferences');
		expect(after.ok()).toBeTruthy();
		expect(readPreferencesResponse(await after.json())).toEqual(original);
		// Core policy has its own CAS; UI validation does not cover its sampling limits.
		const core = await request.get('/api/v1/settings');
		expect(core.ok()).toBeTruthy();
		const configuration = readSettingsResponse(await core.json());
		const rejected = await request.put('/api/v1/settings', {
			headers,
			data: {
				expectedVersion: configuration.version,
				policy: { ...configuration.policy, statusMonitorIntervalSeconds: 0 },
				captcha: {
					enabled: configuration.captcha.enabled,
					provider: configuration.captcha.provider,
					siteKey: configuration.captcha.siteKey,
					secret: { action: 'keep' },
					expectedHostname: configuration.captcha.expectedHostname,
				},
			},
		});
		expect(rejected.status()).toBe(400);
		const unchanged = await request.get('/api/v1/settings');
		expect(unchanged.ok()).toBeTruthy();
		expect(readSettingsResponse(await unchanged.json())).toEqual(configuration);
	});

	test('uses a versioned preferences DTO and retires split preference endpoints', async ({ request }) => {
		await loginAsInitialAdmin(request);
		await updateUiPreferences(request, (preferences) => {
			preferences.navBarVisible = false;
			preferences.showConnectionTags = false;
			preferences.showQuickCommandTags = false;
			preferences.showStatusMonitorIpAddress = true;
			preferences.showCommandBarClear = false;
			preferences.showCommandBarFocusSwitch = false;
			preferences.showCommandBarEditor = false;
			preferences.showCommandBarSearch = false;
		});
		const response = await request.get('/api/v1/settings/preferences');
		expect(response.ok()).toBeTruthy();
		const current = readPreferencesResponse(await response.json());
		expect(current.preferences).toMatchObject({
			navBarVisible: false,
			showConnectionTags: false,
			showQuickCommandTags: false,
			showStatusMonitorIpAddress: true,
			showCommandBarClear: false,
			showCommandBarFocusSwitch: false,
			showCommandBarEditor: false,
			showCommandBarSearch: false,
		});
		for (const path of [
			'nav-bar-visibility',
			'show-connection-tags',
			'show-quick-command-tags',
			'show-status-monitor-ip-address',
		]) {
			expect((await request.get('/api/v1/settings/' + path)).status()).toBe(404);
		}
	});

	test('workspace layout and sidebar save atomically through one HTTP contract', async ({ request }) => {
		await loginAsInitialAdmin(request);
		const layoutResponse = await request.get('/api/v1/settings/layout');
		const sidebarResponse = await request.get('/api/v1/settings/sidebar');
		expect(layoutResponse.ok()).toBeTruthy();
		expect(sidebarResponse.ok()).toBeTruthy();
		const originalLayout = readLayoutResponse(await layoutResponse.json());
		const originalSidebar = readSidebarResponse(await sidebarResponse.json());
		expect(originalSidebar.version).toBe(originalLayout.version);
		const layout = { ...originalLayout.layout, id: 'e2e-atomic-' + crypto.randomUUID() };
		const rejected = await request.put('/api/v1/settings/workspace-layout', {
			headers,
			data: {
				expectedVersion: originalLayout.version,
				layout,
				sidebar: { left: ['connections', 'connections'], right: [] },
			},
		});
		expect(rejected.status()).toBe(400);
		const afterLayout = await request.get('/api/v1/settings/layout');
		const afterSidebar = await request.get('/api/v1/settings/sidebar');
		expect(readLayoutResponse(await afterLayout.json())).toEqual(originalLayout);
		expect(readSidebarResponse(await afterSidebar.json())).toEqual(originalSidebar);
		const saved = await request.put('/api/v1/settings/workspace-layout', {
			headers,
			data: { expectedVersion: originalLayout.version, layout, sidebar: originalSidebar.sidebar },
		});
		expect(saved.ok()).toBeTruthy();
		const result = readPresentationUpdateResponse(await saved.json());
		expect(result.version).toBe(originalLayout.version + 1);
		expect(result.value.layout).toEqual(layout);
		expect(result.value.sidebar).toEqual(originalSidebar.sidebar);
		const finalLayout = readLayoutResponse(await (await request.get('/api/v1/settings/layout')).json());
		const finalSidebar = readSidebarResponse(await (await request.get('/api/v1/settings/sidebar')).json());
		expect(finalLayout).toEqual({ version: result.version, layout });
		expect(finalSidebar).toEqual({ version: result.version, sidebar: originalSidebar.sidebar });
	});

	test('notification HTTP responses redact stored provider secrets', async ({ request }) => {
		await loginAsInitialAdmin(request);
		// Telegram tokens must carry a numeric bot ID; keep a valid secret so
		// this exercises redaction rather than input validation.
		const secret = '123456:test-value-not-for-use';
		const inputs: NotificationCreateRequest[] = [
			{
				name: 'E2E redacted email',
				enabled: false,
				events: ['LOGIN_SUCCESS'],
				config: {
					kind: 'email',
					to: 'recipient@example.test',
					from: 'nexus@example.test',
					host: '127.0.0.1',
					port: E2E_PORTS.smtp,
					secure: false,
					username: 'e2e-user',
					password: { action: 'replace', value: secret },
					bodyTemplate: null,
				},
			},
			{
				name: 'E2E redacted telegram',
				enabled: false,
				events: ['LOGIN_SUCCESS'],
				config: {
					kind: 'telegram',
					origin: 'https://example.test',
					chatId: 'e2e-chat',
					botToken: { action: 'replace', value: secret },
					bodyTemplate: null,
				},
			},
		];
		const ids: string[] = [];
		for (const input of inputs) {
			const created = await request.post('/api/v1/settings/notifications', { headers, data: input });
			expect(created.status()).toBe(200);
			expect(await created.text()).not.toContain(secret);
			const view = readNotificationResponse(await created.json()).setting;
			ids.push(view.id);
			if (view.config.kind === 'email') expect(view.config.hasPassword).toBe(true);
			else if (view.config.kind === 'telegram') expect(view.config.hasBotToken).toBe(true);
		}
		const response = await request.get('/api/v1/settings/notifications');
		expect(response.ok()).toBeTruthy();
		expect(await response.text()).not.toContain(secret);
		const list = readNotificationList(await response.json());
		for (const id of ids) expect(list.items.some((item) => item.id === id)).toBe(true);
	});
});
