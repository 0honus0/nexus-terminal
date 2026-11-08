import { expect, test, loginAsAdmin, HTTP_TEST_ORIGIN } from '../../../../support/http/protocol-fixture.mjs';
import {
	readPreferencesResponse,
	readPreferencesUpdate,
	readLayoutResponse,
	readSidebarResponse,
	readPresentationUpdateResponse,
} from '../../../../../packages/shared/src/preferences/presentation/http-codec.ts';
import { readSettingsResponse } from '../../../../../packages/shared/src/preferences/configuration/http-codec.ts';
const headers = { Origin: HTTP_TEST_ORIGIN };

async function updateUiPreferences(request, change) {
	const response = await request.get('/api/v1/settings/preferences');
	expect(response.ok()).toBe(true);
	const current = readPreferencesResponse(await response.json());
	const input = readPreferencesUpdate({ expectedVersion: current.version, preferences: current.preferences });
	change(input.preferences);
	const saved = await request.put('/api/v1/settings/preferences', { data: input });
	expect(saved.ok()).toBe(true);
	expect(readPresentationUpdateResponse(await saved.json()).version).toBe(current.version + 1);
}

test('rejects invalid bounded settings instead of persisting them', async ({ request }) => {
	await loginAsAdmin(request);
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
	await loginAsAdmin(request);
	await updateUiPreferences(request, (preferences) => {
		preferences.navBarVisible = false;
		preferences.showConnectionTags = false;
		preferences.showQuickCommandTags = false;
		preferences.showStatusMonitorIpAddress = true;
		preferences.showWorkspaceSuspendedSessions = false;
		preferences.showWorkspaceHeaderToggle = false;
		preferences.showWorkspaceProgress = false;
		preferences.showWorkspaceLayoutConfigurator = false;
	});
	const response = await request.get('/api/v1/settings/preferences');
	expect(response.ok()).toBeTruthy();
	const current = readPreferencesResponse(await response.json());
	expect(current.preferences).toMatchObject({
		navBarVisible: false,
		showConnectionTags: false,
		showQuickCommandTags: false,
		showStatusMonitorIpAddress: true,
		showWorkspaceSuspendedSessions: false,
		showWorkspaceHeaderToggle: false,
		showWorkspaceProgress: false,
		showWorkspaceLayoutConfigurator: false,
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
	await loginAsAdmin(request);
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
