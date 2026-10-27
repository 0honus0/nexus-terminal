import { readSuspendedSessionCatalog } from '../../../../packages/shared/src/remote/suspend/http-codec';
import { readSuspendedCatalogEvent } from '../../../../packages/shared/src/remote/suspend/events';
import { readLocalSystemStatus } from '../../../../packages/shared/src/system/status/http-codec';
import { readSshResourceStatusList } from '../../../../packages/shared/src/remote/monitoring/http-codec';
import { E2E_URLS } from '../../support/test-env';
import { readTagList, readTagView } from '../../../../packages/shared/src/targets/tags/http-codec';
import { readConnectionList } from '../../../../packages/shared/src/targets/connections/http-codec';
import { readTestConnectionImportId } from '../../support/targets';
import { readAppearanceView } from '../../../../packages/shared/src/preferences/appearance/http-codec';
import { updateTestAppearance } from '../../support/appearance';
import { readPreferencesResponse } from '../../../../packages/shared/src/preferences/presentation/http-codec';
import { expect, test, type APIRequestContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import { step } from '../../support/steps';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import {
	E2E_SSH,
	connectTestSshFromConnectionsPage,
	configureSshE2eSettings,
	ensureTestSshConnection,
	resetTestSshFilesystem,
} from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, requestWorkspace } from '../../support/ws';
import { selectUiOption } from '../../support/ui-select';

const ALPHA_NAME = 'E2E Dashboard Alpha';
const BETA_NAME = 'E2E Dashboard Beta';
const ALPHA_TAG = 'E2E Dashboard Alpha Tag';
const BETA_TAG = 'E2E Dashboard Beta Tag';
const EMPTY_TAG = 'E2E Dashboard Empty Tag';
const DASHBOARD_DARK_THEME = {
	'--app-bg-color': '#212529',
	'--text-color': '#e9ecef',
	'--text-color-secondary': '#adb5bd',
	'--border-color': '#495057',
	'--link-color': '#BB86FC',
	'--link-hover-color': '#D1A9FF',
	'--link-active-color': '#A06CD5',
	'--link-active-bg-color': 'rgba(160, 108, 213, 0.2)',
	'--nav-item-active-bg-color': 'var(--link-active-bg-color)',
	'--header-bg-color': '#343a40',
	'--footer-bg-color': '#343a40',
	'--button-bg-color': 'var(--link-active-color)',
	'--button-text-color': '#ffffff',
	'--button-hover-bg-color': '#8E44AD',
	'--icon-color': 'var(--text-color-secondary)',
	'--icon-hover-color': 'var(--link-hover-color)',
	'--split-line-color': 'var(--border-color)',
	'--split-line-hover-color': 'var(--border-color)',
	'--input-bg-color': '#2b3035',
	'--input-text-color': 'var(--text-color)',
	'--input-placeholder-color': 'var(--text-color-secondary)',
	'--input-disabled-bg-color': '#343a40',
	'--input-disabled-text-color': '#adb5bd',
	'--input-disabled-border-color': '#495057',
	'--input-focus-border-color': 'var(--link-active-color)',
	'--input-focus-glow': 'var(--link-active-color)',
	'--overlay-bg-color': 'rgba(0, 0, 0, 0.8)',
	'--color-success': '#5cb85c',
	'--color-error': '#d9534f',
	'--color-warning': '#f0ad4e',
	'--font-family-sans-serif': 'sans-serif',
	'--base-padding': '1rem',
	'--base-margin': '0.5rem',
};

async function cleanupDashboardFixtures(request: APIRequestContext): Promise<void> {
	const connectionsResponse = await request.get('/api/v1/targets/connections');
	expect(connectionsResponse.ok()).toBeTruthy();
	const connections = readConnectionList(await connectionsResponse.json());
	for (const connection of connections.filter((item) => item.name === ALPHA_NAME || item.name === BETA_NAME)) {
		expect(
			(
				await request.delete(`/api/v1/targets/connections/${connection.id}`, {
					headers: { Origin: E2E_URLS.frontendOrigin },
				})
			).ok(),
		).toBeTruthy();
	}

	const tagsResponse = await request.get('/api/v1/targets/tags');
	expect(tagsResponse.ok()).toBeTruthy();
	const tags = readTagList(await tagsResponse.json());
	for (const tag of tags.filter((item) => [ALPHA_TAG, BETA_TAG, EMPTY_TAG].includes(item.name))) {
		expect(
			(
				await request.delete(`/api/v1/targets/tags/${tag.id}`, { headers: { Origin: E2E_URLS.frontendOrigin } })
			).ok(),
		).toBeTruthy();
	}
}

async function switchInterfaceToChinese(page: Page): Promise<void> {
	await page.goto('/settings');
	await expect(page.getByRole('tab', { name: 'System' })).toBeVisible();
	await page.getByRole('tab', { name: 'System' }).click();
	const language = page.locator('#languageSelect');
	await expect(language).toBeVisible();
	await selectUiOption(language, 'zh-CN');
	const save = page.waitForResponse(
		(response) => response.url().includes('/api/v1/settings/preferences') && response.request().method() === 'PUT',
	);
	await page.locator('button[form="language-settings-form"]').click();
	expect((await save).ok()).toBeTruthy();
	await expect(page.getByRole('tab', { name: '系统' })).toBeVisible();
}

async function createTag(request: APIRequestContext, name: string): Promise<number> {
	const response = await request.post('/api/v1/targets/tags', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: { name },
	});
	expect(response.status()).toBe(201);
	return readTagView(await response.json()).id;
}

async function createConnection(
	request: APIRequestContext,
	name: string,
	username: string,
	host: string,
	tagId: number,
): Promise<number> {
	const create = await request.post('/api/v1/targets/connections/import', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: {
			items: [
				{
					connection: {
						name: name,
						type: 'SSH',
						host: host,
						port: 22,
						username: username,
						notes: `${name} notes`,
						route: 'direct',
						proxyId: null,
						tagIds: [],
						jumpIds: [],
					},
					credential: { kind: 'password', password: 'dashboard-e2e-not-used' },
				},
			],
		},
	});
	expect(create.status()).toBe(200);
	const id = readTestConnectionImportId(await create.json());

	const assignTag = await request.post('/api/v1/targets/connections/add-tag', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: { connectionIds: [id], tagId: tagId },
	});
	expect(assignTag.ok()).toBeTruthy();
	return id;
}

const dashboardRoot = (page: Page) => page.locator('.dashboard-page');

const connectionRow = (page: Page, name: string) =>
	page.locator('.dashboard-connection-item').filter({ has: page.getByTitle(name, { exact: true }) });

const remoteCard = (page: Page, address: string) =>
	page.locator('.dashboard-connection-card').filter({ hasText: address });

const connectionPanel = (page: Page) => page.locator('.dashboard-status-surface');

const connectionTypeSection = (page: Page, type: 'SSH' | 'RDP' | 'VNC') =>
	page
		.locator('.dashboard-connection-section')
		.filter({ has: page.getByRole('heading', { name: type, exact: true }) });

const tagFilter = (page: Page) => page.getByRole('combobox', { name: '按标签筛选', exact: true });

const sortFilter = (page: Page) => page.getByRole('combobox', { name: '排序方式', exact: true });

test('desktop dashboard exposes suspended sessions and connection types in one stable surface', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();
	const originalSettingsResponse = await context.request.get('/api/v1/settings/preferences');
	expect(originalSettingsResponse.ok()).toBeTruthy();
	const originalSettings = readPreferencesResponse(await originalSettingsResponse.json()).preferences;
	await updateUiPreferences(context.request, (preferences) => {
		preferences.dashboardShowRemoteResources = true;
	});
	const connectionId = await ensureTestSshConnection(context.request);
	const createdSuspendedIds: string[] = [];

	const createSuspended = async (label: string) => {
		const workspace = await openWorkspaceSession(
			context.request,
			connectionId,
			`dashboard-suspended-${label}-${crypto.randomUUID()}`,
		);
		await requestWorkspace(workspace.socket, 'suspend.mark');
		await closeWebSocket(workspace.socket);

		let suspendedId = '';
		await expect
			.poll(
				async () => {
					const response = await context.request.get('/api/v1/ssh-suspend/suspended-sessions');
					expect(response.ok()).toBeTruthy();
					const sessions = readSuspendedSessionCatalog(await response.json());
					const match = sessions.find(
						(session) =>
							session.originalWorkspaceId === workspace.workspaceId && session.status === 'active',
					);
					suspendedId = match?.id ?? '';
					return Boolean(match);
				},
				{ timeout: 10_000 },
			)
			.toBeTruthy();
		createdSuspendedIds.push(suspendedId);
		return suspendedId;
	};

	try {
		const firstSuspendedId = await createSuspended('first');
		let pushedIds: string[] = [];
		page.on('websocket', (socket) => {
			if (!socket.url().includes('/ws/suspended-sessions')) return;
			socket.on('framereceived', ({ payload }) => {
				const value: unknown = JSON.parse(String(payload));
				const event = readSuspendedCatalogEvent(value);
				if (event.type === 'snapshot') pushedIds = event.sessions.map((session) => session.id);
			});
		});
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/');

		const dashboard = dashboardRoot(page);
		const connections = connectionPanel(page);
		const sshSection = connectionTypeSection(page, 'SSH');
		const suspendedEntry = dashboard.getByRole('button', { name: /^Suspended sessions/ });
		await expect(suspendedEntry).toBeVisible();
		await expect(suspendedEntry).toContainText('Suspended sessions');
		await expect(connections).toBeVisible();
		await expect(sshSection).toBeVisible();
		await expect(sshSection.getByRole('heading', { name: 'SSH', exact: true })).toBeVisible();
		await expect(dashboard.locator('.dashboard-connection-sections')).toBeVisible();

		let catalogRequests = 0;

		const countCatalogRequest = (request: { url(): string }) => {
			if (request.url().includes('/api/v1/ssh-suspend/suspended-sessions')) catalogRequests += 1;
		};

		page.on('request', countCatalogRequest);
		await expect.poll(() => pushedIds).toContain(firstSuspendedId);
		const secondSuspendedId = await createSuspended('second');
		await expect.poll(() => pushedIds, { timeout: 2500 }).toContain(secondSuspendedId);
		const requestsBeforeOpen = catalogRequests;
		await suspendedEntry.click();
		await expect(page).toHaveURL(/\/workspace(?:\?|$)/);
		const dialog = page.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog.locator(`[data-suspend-id="${firstSuspendedId}"]`)).toBeVisible();
		await expect(dialog.locator(`[data-suspend-id="${secondSuspendedId}"]`)).toBeVisible();
		expect(catalogRequests).toBe(requestsBeforeOpen);
		const externalRename = await context.request.put(`/api/v1/ssh-suspend/name/${secondSuspendedId}`, {
			headers: { Origin: E2E_URLS.frontendOrigin },
			data: { customName: 'Cross-device WS rename' },
		});
		expect(externalRename.ok()).toBeTruthy();
		await expect(dialog.locator(`[data-suspend-id="${secondSuspendedId}"]`)).toContainText(
			'Cross-device WS rename',
			{ timeout: 2500 },
		);
		expect(catalogRequests).toBe(requestsBeforeOpen);
		page.off('request', countCatalogRequest);
	} finally {
		for (const suspendedId of createdSuspendedIds) {
			const response = await context.request.delete(
				`/api/v1/ssh-suspend/terminate/${encodeURIComponent(suspendedId)}`,
				{ headers: { Origin: E2E_URLS.frontendOrigin } },
			);
			expect([200, 404]).toContain(response.status());
		}
		await updateUiPreferences(context.request, (preferences) => {
			preferences.dashboardShowRemoteResources = originalSettings.dashboardShowRemoteResources ?? true;
		});
	}
});

test('dashboard quick connect completion refreshes recent connection without navigating back to Workspace', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(context.request);

	// Workspace SSH sessions use WorkspaceService, not the legacy HTTP
	// SessionOwner. Only the latter emits SSH_CONNECT_SUCCESS audit records;
	// asserting that event here incorrectly couples two different producers.
	// The actual contract is the active Workspace binding and Dashboard's
	// recent-connection timestamp, which are both checked below.

	let releaseConnect: (() => void) | undefined;
	const connectGate = new Promise<void>((resolve) => {
		releaseConnect = resolve;
	});
	let markConnectStarted: (() => void) | undefined;
	const connectStarted = new Promise<void>((resolve) => {
		markConnectStarted = resolve;
	});
	let holdConnect = false;
	// Hold work already owned by the runtime, not the page's preflight detail
	// read. Install before navigation: Playwright instruments WebSocket through
	// an init script, so registering it in an already mounted SPA is too late.
	await page.routeWebSocket('**/ws/workspace', (socket) => {
		const server = socket.connectToServer();
		socket.onMessage(async (message) => {
			if (holdConnect && typeof message === 'string' && JSON.parse(message).type === 'workspace.connect') {
				markConnectStarted?.();
				await connectGate;
			}
			server.send(message);
		});
	});

	try {
		// Recent connections are owned by the mounted frontend store, so prime through the UI.
		await connectTestSshFromConnectionsPage(page, connectionId);
		await page.getByRole('button', { name: 'Close Tab', exact: true }).click();
		await page.locator('.app-nav-links').getByRole('link', { name: 'Dashboard', exact: true }).click();
		await expect(page).toHaveURL(/\/$/);

		const row = connectionRow(page, 'E2E SSH');
		await expect(row).toBeVisible();
		const dashboardSummary = dashboardRoot(page).locator('section').first();
		await expect(dashboardSummary.getByText(/^(Latest connection|最近连接|最近の接続)$/)).toHaveCount(0);
		await expect(dashboardSummary.getByRole('button', { name: /^(Reconnect|重新连接|再接続)$/ })).toHaveCount(0);
		const quickConnect = row.locator('.dashboard-connection-card');
		await expect(quickConnect).toBeVisible();
		const previousLastConnectedAt = Number(await row.getAttribute('data-last-connected-at'));
		expect(previousLastConnectedAt).toBeGreaterThan(0);
		// The recent-connection wire timestamp is whole Unix seconds. Two
		// successful SSH connects within the same second legitimately produce
		// equal milliseconds, even after a correct Dashboard store refresh.
		// Start the second connect in the next representable tick instead of
		// weakening the strict greater-than assertion on the refreshed row.
		await expect.poll(() => Date.now()).toBeGreaterThan(previousLastConnectedAt + 1_000);

		holdConnect = true;
		await quickConnect.click();
		await connectStarted;

		// The one-shot connectionId query is consumed immediately, before SSH finishes connecting.
		await expect(page).toHaveURL(/\/workspace$/);
		await page.locator('.app-nav-links').getByRole('link', { name: 'Dashboard', exact: true }).click();
		await expect(page).toHaveURL(/\/$/);

		releaseConnect?.();
		// Successful background completion must update the already-mounted Dashboard store without a page reload.
		await expect
			.poll(async () => Number(await row.getAttribute('data-last-connected-at')), { timeout: 10_000 })
			.toBeGreaterThan(previousLastConnectedAt);
		await expect(page).toHaveURL(/\/$/);

		// The connected session is still available when the user later opens Workspace explicitly.
		await page.getByRole('link', { name: 'Terminal', exact: true }).click();
		await expect(page).toHaveURL(/\/workspace$/);
		await expect(page.getByRole('tablist').getByRole('tab', { selected: true })).toHaveAttribute(
			'data-session-state',
			'connected',
		);
	} finally {
		releaseConnect?.();
		await page.unrouteAll({ behavior: 'wait' });
	}
});

test('SSH resource cards appear while their status requests are pending', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await ensureTestSshConnection(context.request);

	const originalSettingsResponse = await context.request.get('/api/v1/settings/preferences');
	expect(originalSettingsResponse.ok()).toBeTruthy();
	const originalSettings = readPreferencesResponse(await originalSettingsResponse.json()).preferences;

	await updateUiPreferences(context.request, (preferences) => {
		preferences.dashboardShowRemoteResources = true;
	});

	let releaseRemoteResources: (() => void) | undefined;
	const remoteResourcesReleased = new Promise<void>((resolve) => {
		releaseRemoteResources = resolve;
	});
	let markRemoteRequestStarted: (() => void) | undefined;
	const remoteRequestStarted = new Promise<void>((resolve) => {
		markRemoteRequestStarted = resolve;
	});

	await page.route('**/api/v1/system/ssh-resources/*', async (route) => {
		markRemoteRequestStarted?.();
		const backendResponse = await route.fetch();
		await remoteResourcesReleased;
		await route.fulfill({ response: backendResponse });
	});

	try {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await remoteRequestStarted;

		const section = connectionTypeSection(page, 'SSH');
		const card = remoteCard(page, `${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port}`);
		await expect(section).toBeVisible();
		await expect(card).toBeVisible();
		await expect(card).toContainText('Waiting for data');
		await expect(card.locator('.ui-spinner')).toBeVisible();
		expect(await card.evaluate((element) => element.getBoundingClientRect().height)).toBe(188);
	} finally {
		releaseRemoteResources?.();
		await page.unrouteAll({ behavior: 'wait' });
		await updateUiPreferences(context.request, (preferences) => {
			preferences.dashboardShowRemoteResources = originalSettings.dashboardShowRemoteResources ?? true;
		});
	}
});

test('a slow SSH resource does not hold back another host on the dashboard', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	const goodConnectionId = await ensureTestSshConnection(context.request);
	const originalSettingsResponse = await context.request.get('/api/v1/settings/preferences');
	expect(originalSettingsResponse.ok()).toBeTruthy();
	const originalSettings = readPreferencesResponse(await originalSettingsResponse.json()).preferences;
	await updateUiPreferences(context.request, (preferences) => {
		preferences.dashboardShowRemoteResources = true;
	});
	const badHost = '198.51.100.88';
	const badPort = 2222;
	const create = await context.request.post('/api/v1/targets/connections/import', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: {
			items: [
				{
					connection: {
						name: 'E2E Slow SSH Resource',
						type: 'SSH',
						host: badHost,
						port: badPort,
						username: 'slow',
						notes: null,
						route: 'direct',
						proxyId: null,
						tagIds: [],
						jumpIds: [],
					},
					credential: { kind: 'password', password: 'unused' },
				},
			],
		},
	});
	expect(create.status()).toBe(200);
	const badConnectionId = readTestConnectionImportId(await create.json());
	let releaseSlow: (() => void) | undefined;
	const slowReleased = new Promise<void>((resolve) => {
		releaseSlow = resolve;
	});

	await page.route('**/api/v1/system/ssh-resources/*', async (route) => {
		const id = Number(route.request().url().split('/').at(-1));
		if (id === badConnectionId) {
			await slowReleased;
			await route.abort('failed');
		} else if (id === goodConnectionId) {
			await route.fulfill({
				json: {
					key: `${E2E_SSH.host.toLowerCase()}:${E2E_SSH.port}`,
					connectionId: goodConnectionId,
					name: 'E2E SSH',
					username: E2E_SSH.username,
					host: E2E_SSH.host,
					port: E2E_SSH.port,
					status: { cpuPercent: 7, memPercent: 8, timestamp: Date.now() },
					checkedAt: Date.now(),
				},
			});
		} else await route.abort('failed');
	});

	try {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		const goodCard = remoteCard(page, `${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port}`);
		const badCard = remoteCard(page, `slow@${badHost}:${badPort}`);
		await expect(goodCard).toContainText('7%');
		await expect(goodCard.locator('.dashboard-gauge')).toHaveCount(3);
		await expect(goodCard.locator('.dashboard-connection-card__last-connected')).toBeVisible();
		await expect(goodCard.locator('.dashboard-connection-card__updated-at')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
		await expect(badCard).toBeVisible();
		await expect(badCard).not.toContainText('The network request failed. Retry the read.');
		expect(await badCard.evaluate((element) => element.getBoundingClientRect().height)).toBe(188);
		releaseSlow?.();
		await expect(badCard).toContainText('The network request failed. Retry the read.');
		await expect(goodCard).toContainText('7%');
		expect(await badCard.evaluate((element) => element.getBoundingClientRect().height)).toBe(188);
	} finally {
		releaseSlow?.();
		await page.unrouteAll({ behavior: 'wait' });
		expect(
			(
				await context.request.delete(`/api/v1/targets/connections/${badConnectionId}`, {
					headers: { Origin: E2E_URLS.frontendOrigin },
				})
			).ok(),
		).toBeTruthy();
		await updateUiPreferences(context.request, (preferences) => {
			preferences.dashboardShowRemoteResources = originalSettings.dashboardShowRemoteResources ?? true;
		});
	}
});

test('resource failures stay inside their panels and do not block quick connect', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await page.clock.install();
	const originalSettingsResponse = await context.request.get('/api/v1/settings/preferences');
	expect(originalSettingsResponse.ok()).toBeTruthy();
	const originalSettings = readPreferencesResponse(await originalSettingsResponse.json()).preferences;
	await updateUiPreferences(context.request, (preferences) => {
		preferences.dashboardShowLocalResources = true;
		preferences.dashboardShowRemoteResources = true;
	});

	const connectionId = await ensureTestSshConnection(context.request);

	let localRequests = 0;
	let remoteRequests = 0;
	await page.route('**/api/v1/system/status', async (route) => {
		localRequests += 1;
		await route.abort('failed');
	});
	await page.route('**/api/v1/system/ssh-resources/*', async (route) => {
		remoteRequests += 1;
		await route.abort('failed');
	});

	try {
		await page.goto('/');
		const dashboard = dashboardRoot(page);
		const local = dashboard.locator('.dashboard-overview-local');
		const remoteError = remoteCard(page, `${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port}`);
		const connectionList = connectionPanel(page).locator('.dashboard-connection-grid');
		const row = connectionRow(page, 'E2E SSH');

		await expect(local).toContainText('The network request failed. Retry the read.');
		await expect(remoteError).toContainText('The network request failed. Retry the read.');
		await page.locator('.app-nav-links a[href="/connections"]').click();
		await expect(page).toHaveURL(/\/connections$/);
		const pausedLocalRequests = localRequests;
		const pausedRemoteRequests = remoteRequests;
		await page.clock.fastForward(120_000);
		expect(localRequests).toBe(pausedLocalRequests);
		expect(remoteRequests).toBe(pausedRemoteRequests);
		await page.locator('.app-nav-links a[href="/"]').click();
		await expect.poll(() => localRequests).toBeGreaterThan(pausedLocalRequests);
		await expect.poll(() => remoteRequests).toBeGreaterThan(pausedRemoteRequests);
		await expect(connectionList).toBeVisible();
		await expect(row).toBeVisible();
		await expect(row.getByRole('button', { name: 'Connect E2E SSH', exact: true })).toBeEnabled();

		const card = row.getByRole('button', { name: 'Connect E2E SSH', exact: true });
		await expect(card.getByText('Connect', { exact: true })).toHaveCount(0);
		expect(await card.evaluate((element) => element.getBoundingClientRect().height)).toBe(188);
		await card.focus();
		await card.press('Enter');
		await expect(page).toHaveURL(/\/workspace(?:\?|$)/);
		await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-session-state', 'connected', {
			timeout: 35_000,
		});
	} finally {
		await page.unrouteAll({ behavior: 'wait' });
		await updateUiPreferences(context.request, (preferences) => {
			preferences.dashboardShowLocalResources = originalSettings.dashboardShowLocalResources ?? true;
			preferences.dashboardShowRemoteResources = originalSettings.dashboardShowRemoteResources ?? true;
		});
	}
});

test('dashboard filters connections and persists tag and sort preferences across reloads', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await cleanupDashboardFixtures(context.request);
	await resetTestSshFilesystem();

	const originalSettingsResponse = await context.request.get('/api/v1/settings/preferences');
	expect(originalSettingsResponse.ok()).toBeTruthy();
	const originalSettings = readPreferencesResponse(await originalSettingsResponse.json()).preferences;
	const originalAppearanceResponse = await context.request.get('/api/v1/appearance');
	expect(originalAppearanceResponse.ok()).toBeTruthy();
	const originalAppearance = readAppearanceView(await originalAppearanceResponse.json());

	await updateUiPreferences(context.request, (preferences) => {
		preferences.language = 'en-US';
		preferences.dashboardShowLocalResources = true;
		preferences.dashboardShowRemoteResources = true;
	});

	await updateTestAppearance(context.request, (preferences) => {
		preferences.customUiTheme = JSON.stringify(DASHBOARD_DARK_THEME);
		preferences.windowThemeColor = '#343a40';
	});

	const systemStatusResponse = await context.request.get('/api/v1/system/status');
	expect(systemStatusResponse.ok()).toBeTruthy();
	const systemStatus = readLocalSystemStatus(await systemStatusResponse.json());
	expect(systemStatus.cpuPercent).toBeGreaterThanOrEqual(0);
	expect(systemStatus.cpuPercent).toBeLessThanOrEqual(100);
	expect(systemStatus.memPercent).toBeGreaterThanOrEqual(0);
	expect(systemStatus.memPercent).toBeLessThanOrEqual(100);
	expect(systemStatus.memUsed).toBeGreaterThanOrEqual(0);
	expect(systemStatus.memTotal).toBeGreaterThan(0);
	if (systemStatus.diskPercent !== undefined) {
		expect(systemStatus.diskPercent).toBeGreaterThanOrEqual(0);
		expect(systemStatus.diskPercent).toBeLessThanOrEqual(100);
	}

	const primedSshResourcesResponse = await context.request.get('/api/v1/system/ssh-resources');
	expect(primedSshResourcesResponse.ok()).toBeTruthy();
	readSshResourceStatusList(await primedSshResourcesResponse.json());

	const alphaTagId = await createTag(context.request, ALPHA_TAG);
	const betaTagId = await createTag(context.request, BETA_TAG);
	const emptyTagId = await createTag(context.request, EMPTY_TAG);
	const alphaId = await createConnection(context.request, ALPHA_NAME, 'dashboard-alpha', '192.0.2.10', alphaTagId);
	const betaId = await createConnection(context.request, BETA_NAME, 'dashboard-beta', '192.0.2.20', betaTagId);
	const sshConnectionId = await ensureTestSshConnection(context.request);

	try {
		await switchInterfaceToChinese(page);
		await page.goto('/');
		const dashboard = dashboardRoot(page);
		await expect(dashboard).toBeVisible();
		await expect(connectionPanel(page)).toBeVisible();
		await expect(dashboard.locator('.dashboard-overview-local')).toBeVisible();
		await expect(connectionTypeSection(page, 'SSH')).toBeVisible({ timeout: 20_000 });
		await expect(dashboard.locator('.dashboard-overview-local')).toContainText('CPU');
		await expect(dashboard.locator('.dashboard-overview-local__updated')).toHaveText(/更新于 \d{2}:\d{2}:\d{2}/);
		const alphaRow = connectionRow(page, ALPHA_NAME);
		const betaRow = connectionRow(page, BETA_NAME);
		await expect(alphaRow).toContainText(ALPHA_NAME);
		await expect(betaRow).toContainText(BETA_NAME);
		await expect(alphaRow.locator('.dashboard-connection-card__tag')).toHaveText(ALPHA_TAG);
		await expect(alphaRow.locator('.dashboard-connection-card__footer')).toHaveCount(0);
		const protocolBox = await alphaRow.locator('.dashboard-connection-card__protocol').boundingBox();
		const tagBox = await alphaRow.locator('.dashboard-connection-card__tag').boundingBox();
		if (!protocolBox || !tagBox) throw new Error('connection protocol and tag must be visible');
		expect(Math.abs(tagBox.y - protocolBox.y)).toBeLessThanOrEqual(2);

		await step('search matches username and host fields', async () => {
			const search = dashboard.locator('input[type="search"]');
			await search.fill('dashboard-alpha');
			await expect(alphaRow).toBeVisible();
			await expect(betaRow).toBeHidden();

			await search.fill('192.0.2.20');
			await expect(betaRow).toBeVisible();
			await expect(alphaRow).toBeHidden();
			await search.fill('');
		});

		await step('an empty selected tag uses the restored tag-specific empty state', async () => {
			await selectUiOption(tagFilter(page), String(emptyTagId));
			await expect(dashboard.getByText('该标签下没有连接记录', { exact: true })).toBeVisible();
			await selectUiOption(tagFilter(page), String(alphaTagId));
		});

		await step('tag filtering persists across a full page reload', async () => {
			await selectUiOption(tagFilter(page), String(alphaTagId));
			await expect(alphaRow).toBeVisible();
			await expect(betaRow).toBeHidden();

			expect(
				(
					await context.request.delete(`/api/v1/targets/tags/${emptyTagId}`, {
						headers: { Origin: E2E_URLS.frontendOrigin },
					})
				).ok(),
			).toBeTruthy();
			await page.reload();
			await expect(tagFilter(page)).toHaveAttribute('data-value', String(alphaTagId));
			await expect(alphaRow).toBeVisible();
			await expect(betaRow).toBeHidden();
		});

		await step('sort field and order persist independently from the connection data', async () => {
			await selectUiOption(tagFilter(page), '');
			await selectUiOption(sortFilter(page), 'name');
			await dashboard.locator('.dashboard-status-toolbar button').last().click();

			await page.reload();
			const finalDashboard = dashboardRoot(page);
			await expect(sortFilter(page)).toHaveAttribute('data-value', 'name');
			const visibleFixtureRows = finalDashboard
				.locator('.dashboard-connection-item')
				.filter({ hasText: /E2E Dashboard (Alpha|Beta)/ });
			await expect(visibleFixtureRows).toHaveCount(2);
			const texts = await visibleFixtureRows.allTextContents();
			expect(texts.map((text) => (text.includes(ALPHA_NAME) ? ALPHA_NAME : BETA_NAME))).toEqual([
				ALPHA_NAME,
				BETA_NAME,
			]);

			await expect(finalDashboard.locator('.dashboard-overview-metrics')).toBeVisible();
			await expect(finalDashboard.locator('a[href="/connections"]')).toBeVisible();
			await expect(alphaRow.locator('.dashboard-connection-card')).toBeVisible();
			await expect(betaRow.locator('.dashboard-connection-card')).toBeVisible();
		});

		await step(
			'dashboard renders configured SSH resources and keeps the current desktop layout stable',
			async () => {
				const remoteCards = page.locator('.dashboard-connection-card');
				const e2eHostCard = remoteCards.filter({
					hasText: `${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port}`,
				});

				await expect(connectionTypeSection(page, 'SSH')).toBeVisible({ timeout: 20_000 });
				await expect(e2eHostCard).toHaveCount(1);
				await expect(e2eHostCard).toContainText('CPU', { timeout: 20_000 });
				await expect(e2eHostCard.locator('.dashboard-gauge')).toHaveCount(3);
				await expect(e2eHostCard.locator('.dashboard-connection-card__updated-at')).toHaveAttribute(
					'title',
					/更新于 \d{2}:\d{2}:\d{2}/,
				);
				await expect(e2eHostCard.locator('.dashboard-gauge__detail').nth(1)).toHaveText(
					/^\d+(?:\.\d+)? (?:GB|MB|TB)\s*\/\s*\d+(?:\.\d+)? (?:GB|MB|TB)$/,
				);
				const gauges = await e2eHostCard.locator('.dashboard-gauge').evaluateAll((items) =>
					items.map((gauge) => {
						const value = Number(
							gauge.querySelector('.dashboard-gauge__value')?.textContent?.replace('%', ''),
						);
						const offset = Number.parseFloat(
							getComputedStyle(gauge.querySelector('.dashboard-gauge__progress')!).strokeDashoffset,
						);
						return { value, offset };
					}),
				);
				for (const gauge of gauges) {
					expect(Number.isFinite(gauge.value)).toBeTruthy();
					expect(Math.abs(gauge.offset - (100 - gauge.value))).toBeLessThanOrEqual(1);
				}
				await expect(page.getByText('活动 SSH 会话', { exact: true })).toHaveCount(0);

				await page.setViewportSize({ width: 1440, height: 900 });
				const dashboard = dashboardRoot(page);
				const statusPanel = connectionPanel(page);
				const connectionList = statusPanel.locator('.ui-scroll-area__viewport');
				const localResource = dashboard.locator('.dashboard-overview-local');

				await expect(statusPanel).toBeVisible();
				await expect(connectionList).toBeVisible();
				await expect(localResource).toBeVisible();
				await expect(localResource).toContainText('CPU');
				await expect(dashboard.getByRole('complementary')).toHaveCount(0);
				await expect(alphaRow).toBeVisible();
				await expect(betaRow).toBeVisible();

				const tagControl = tagFilter(page);
				const sortControl = sortFilter(page);
				for (const control of [tagControl, sortControl]) {
					const geometry = await control.evaluate((element) => {
						const box = element.getBoundingClientRect();
						const label = element.querySelector(':scope > span')?.getBoundingClientRect();
						const chevron = element.querySelector('svg')?.getBoundingClientRect();
						return {
							height: box.height,
							centerY: box.top + box.height / 2,
							labelCenterY: label ? label.top + label.height / 2 : Number.NaN,
							chevronCenterY: chevron ? chevron.top + chevron.height / 2 : Number.NaN,
						};
					});
					expect(Math.abs(geometry.height - 40)).toBeLessThanOrEqual(2);
					expect(Math.abs(geometry.labelCenterY - geometry.centerY)).toBeLessThanOrEqual(1);
					expect(Math.abs(geometry.chevronCenterY - geometry.centerY)).toBeLessThanOrEqual(1);
				}

				await tagControl.click();
				const tagMenu = page.getByRole('listbox');
				await expect(tagMenu).toBeVisible();
				const optionCenters = await tagMenu.getByRole('option').evaluateAll((options) =>
					options.map((option) => {
						const box = option.getBoundingClientRect();
						const label = option.querySelector('span')?.getBoundingClientRect();
						return label
							? {
									leftInset: label.left - box.left,
									rightInset: box.right - label.right,
									verticalOffset: Math.abs(label.top + label.height / 2 - (box.top + box.height / 2)),
								}
							: {
									leftInset: Number.NEGATIVE_INFINITY,
									rightInset: Number.NEGATIVE_INFINITY,
									verticalOffset: Number.POSITIVE_INFINITY,
								};
					}),
				);
				expect(optionCenters.length).toBeGreaterThan(1);
				for (const geometry of optionCenters) {
					expect(geometry.leftInset).toBeGreaterThanOrEqual(0);
					expect(geometry.rightInset).toBeGreaterThanOrEqual(0);
					expect(geometry.verticalOffset).toBeLessThanOrEqual(1);
				}
				await page.keyboard.press('Escape');
				await expect(tagMenu).toBeHidden();

				const overflow = await dashboard.evaluate((element) => ({
					scrollWidth: element.scrollWidth,
					clientWidth: element.clientWidth,
				}));
				expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
				const documentScroll = await page.evaluate(() => ({
					scrollHeight: document.documentElement.scrollHeight,
					clientHeight: document.documentElement.clientHeight,
				}));
				expect(documentScroll.scrollHeight).toBeLessThanOrEqual(documentScroll.clientHeight + 1);

				const sections = await dashboard.locator('.dashboard-connection-section').evaluateAll((items) =>
					items.map((section) => ({
						type: section.getAttribute('aria-labelledby')?.replace('dashboard-connection-section-', ''),
						cards: [...section.querySelectorAll<HTMLElement>('.dashboard-connection-card')].map((card) => {
							const rect = card.getBoundingClientRect();
							return { width: rect.width, height: rect.height };
						}),
					})),
				);
				expect(sections.length).toBeGreaterThan(0);
				for (const section of sections) {
					expect(['SSH', 'RDP', 'VNC']).toContain(section.type);
					expect(section.cards.length).toBeGreaterThan(0);
					const widths = section.cards.map((card) => card.width);
					const heights = section.cards.map((card) => card.height);
					expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
					expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
					expect(Math.abs(heights[0]! - (section.type === 'SSH' ? 188 : 76))).toBeLessThanOrEqual(1);
					if (section.type !== 'SSH') {
						await expect(
							dashboard.locator(`.dashboard-connection-section--${section.type!.toLowerCase()} small`),
						).toHaveCount(0);
					}
				}

				const cardGeometry = await page.locator('.dashboard-connection-card').evaluateAll((cards) =>
					cards.map((card) => {
						const rect = card.getBoundingClientRect();
						return { width: rect.width, height: rect.height };
					}),
				);
				const widths = cardGeometry.map((card) => card.width);
				expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);

				for (const type of ['SSH', 'RDP'] as const) {
					const section = connectionTypeSection(page, type);
					if ((await section.count()) === 0) continue;
					const toggle = section.locator('.dashboard-connection-section__toggle');
					const list = section.locator('.dashboard-connection-grid');
					await expect(toggle).toHaveAttribute('aria-expanded', 'true');
					await toggle.click();
					await expect(toggle).toHaveAttribute('aria-expanded', 'false');
					await expect(list).toBeHidden();
					await toggle.click();
					await expect(toggle).toHaveAttribute('aria-expanded', 'true');
					await expect(list).toBeVisible();
				}

				const connectionScroll = await connectionList.evaluate((element) => ({
					clientHeight: element.clientHeight,
					scrollHeight: element.scrollHeight,
					overflowY: getComputedStyle(element).overflowY,
				}));
				expect(['auto', 'scroll']).toContain(connectionScroll.overflowY);

				await captureFunctionalScreenshot(page, 'dashboard-home.png', {
					viewport: { width: 1440, height: 900 },
				});
			},
		);

		await step('local and remote dashboard resource sections honor their independent settings', async () => {
			await updateUiPreferences(context.request, (preferences) => {
				preferences.dashboardShowLocalResources = false;
				preferences.dashboardShowRemoteResources = true;
			});

			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(connectionPanel(page)).toBeVisible();
			await expect(page.locator('.dashboard-overview-local')).toHaveCount(0);
			await expect(connectionTypeSection(page, 'SSH')).toBeVisible({ timeout: 20_000 });
			await expect(page.locator('.dashboard-gauge').first()).toBeVisible({ timeout: 20_000 });

			await updateUiPreferences(context.request, (preferences) => {
				preferences.dashboardShowLocalResources = true;
				preferences.dashboardShowRemoteResources = false;
			});

			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(page.locator('.dashboard-overview-local')).toBeVisible();
			await expect(connectionPanel(page)).toBeVisible();
			await expect(connectionTypeSection(page, 'SSH')).toBeVisible({ timeout: 20_000 });
			await expect(page.locator('.dashboard-gauge')).toHaveCount(0);
			await expect(page.locator('.dashboard-connection-card[data-resource-state="none"]').first()).toBeVisible();

			await updateUiPreferences(context.request, (preferences) => {
				preferences.dashboardShowLocalResources = true;
				preferences.dashboardShowRemoteResources = true;
			});

			await page.reload({ waitUntil: 'domcontentloaded' });
		});

		await step('dashboard does not render the removed recent-activity panel', async () => {
			await expect(dashboard.locator('a[href="/audit-logs"]')).toHaveCount(0);
			await expect(dashboard.getByRole('complementary')).toHaveCount(0);
		});
	} finally {
		await cleanupDashboardFixtures(context.request);
		await updateUiPreferences(context.request, (preferences) => {
			preferences.language = originalSettings.language ?? 'en-US';
			preferences.dashboardShowLocalResources = originalSettings.dashboardShowLocalResources ?? true;
			preferences.dashboardShowRemoteResources = originalSettings.dashboardShowRemoteResources ?? true;
		});

		await updateTestAppearance(context.request, (preferences) => {
			preferences.customUiTheme = originalAppearance.customUiTheme;
			preferences.windowThemeColor = originalAppearance.windowThemeColor;
		});
	}
});
