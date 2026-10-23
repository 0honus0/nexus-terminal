import { dismissToasts } from '../../support/feedback';
import {
	readAgentProviderView,
	readAgentProviderListResponse,
	readAgentProviderDeleteResponse,
} from '../../../../packages/shared/src/agent/providers/http-codec';
import { readAgentExecutionSettingsResponse } from '../../../../packages/shared/src/agent/execution/http-codec';
import {
	readAgentAppListResponse,
	readAgentAppDefinitionListResponse,
	readAgentAppResponse,
} from '../../../../packages/shared/src/agent/scope/http-codec';
import { readAgentGrantView } from '../../../../packages/shared/src/agent/governance/http-codec';
import { readAgentErrorResponse } from '../../../../packages/shared/src/agent/http-codec';
import { readAgentPluginRecommended } from '../../../../packages/shared/src/agent/plugins/repository-http-codec';
import {
	readAgentWorkspaceRequest,
	readAgentWorkspaceResponse,
} from '../../../../packages/shared/src/agent/scope/workspace-http-codec';
import type { AgentWorkspaceRequest } from '../../../../packages/shared/src/agent/scope/workspace-http';
import {
	openAgentConversations,
	openAgentHub,
	selectAgentExtensionsSection,
	selectAgentSettingsGroup,
	createTestAgentApp,
	enableTestAgentExecution,
	requestAgentWorkspace,
	requestAgentJson,
	createAgentProvider,
	prepareAgentRun,
} from '../../support/agent';
import { randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { E2E_URLS } from '../../support/test-env';
import { expectUiSelectValue, selectUiOption } from '../../support/ui-select';
test.use({ actionTimeout: 10_000 });
test('Agent launcher stays passive until the user explicitly opens the Hub', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await createTestAgentApp(context.request);
	await enableTestAgentExecution(context.request);

	await page.goto('/connections');

	const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
	const hub = page.locator('section[aria-label="Agent"]');
	await expect(launcher).toBeVisible();
	await expect(hub).toHaveCount(0);

	await page.getByRole('button', { name: 'Add New Connection', exact: true }).click({ trial: true });

	await launcher.click();
	await expect(hub).toBeVisible();
});

test('Agent launcher moves immediately on drag and opens only on click', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await createTestAgentApp(context.request);
	await enableTestAgentExecution(context.request);
	await page.goto('/connections');

	const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });

	const launcherPosition = async () =>
		launcher.locator('..').evaluate((element) => {
			const style = getComputedStyle(element);
			return { right: Number.parseFloat(style.right), bottom: Number.parseFloat(style.bottom) };
		});

	const hub = page.locator('section[aria-label="Agent"]');
	await expect(launcher).toBeVisible();
	const initial = await launcher.boundingBox();
	const initialPosition = await launcherPosition();
	expect(initial).toBeTruthy();

	await page.mouse.move(initial!.x + initial!.width / 2, initial!.y + initial!.height / 2);
	await page.mouse.down();
	await page.mouse.move(initial!.x + initial!.width / 2 - 90, initial!.y + initial!.height / 2 - 80, {
		steps: 4,
	});
	await page.mouse.up();

	const moved = await launcher.boundingBox();
	expect(moved).toBeTruthy();
	expect(moved!.x).toBeLessThan(initial!.x - 60);
	expect(moved!.y).toBeLessThan(initial!.y - 50);
	const movedPosition = await launcherPosition();
	await expect(hub).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Reset position' })).toHaveCount(0);

	await page.reload();
	await expect(launcher).toBeVisible();
	expect(await launcherPosition()).toEqual(movedPosition);

	await launcher.click({ button: 'right' });
	expect(await launcherPosition()).toEqual(initialPosition);

	await launcher.click();
	await expect(hub).toBeVisible();
});

test('Agent launcher docks on either edge, restores its side and expands on focus', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await createTestAgentApp(context.request);
	await enableTestAgentExecution(context.request);
	await page.goto('/connections');
	const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
	const hub = page.locator('section[aria-label="Agent"]');
	await expect(launcher).toBeVisible();

	for (const side of ['left', 'right'] as const) {
		const initial = (await launcher.boundingBox())!;
		const width = await page.evaluate(() => document.documentElement.clientWidth);
		await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
		await page.mouse.down();
		await page.mouse.move(side === 'left' ? 22 : width - 22, initial.y + initial.height / 2 - 40, { steps: 5 });
		await page.mouse.up();
		await page.mouse.move(width / 2, 50);
		await expect(hub).toHaveCount(0);
		await page.reload();
		await expect(launcher).toBeVisible();
		const restoredWidth = await page.evaluate(() => innerWidth);
		const hiddenX = side === 'left' ? -22 : restoredWidth - 22;
		await expect.poll(async () => Math.round((await launcher.boundingBox())!.x)).toBe(hiddenX);
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await launcher.focus();
		await expect
			.poll(async () => Math.round((await launcher.boundingBox())!.x))
			.toBe(side === 'left' ? 0 : restoredWidth - 44);
		await launcher.evaluate((button) => (button as HTMLButtonElement).blur());
		await expect.poll(async () => Math.round((await launcher.boundingBox())!.x)).toBe(hiddenX);
		await launcher.click({ button: 'right' });
	}
	await launcher.press('Enter');
	await expect(hub).toBeVisible();
});

test.describe('touch Agent launcher', () => {
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

	test('touch launcher docks half-hidden and opens from its exposed half', async ({ page, context }) => {
		await loginAsInitialAdmin(context.request);
		await setUiLanguage(context.request);
		await createTestAgentApp(context.request);
		await enableTestAgentExecution(context.request);
		await page.goto('/connections');
		const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
		const hub = page.locator('section[aria-label="Agent"]');
		await expect(launcher).toBeVisible();
		const initial = (await launcher.boundingBox())!;
		const y = initial.y + 22 - 60;
		await launcher.dispatchEvent('pointerdown', {
			pointerType: 'touch',
			pointerId: 1,
			isPrimary: true,
			clientX: initial.x + 22,
			clientY: initial.y + 22,
			button: 0,
			buttons: 1,
		});
		await launcher.dispatchEvent('pointermove', {
			pointerType: 'touch',
			pointerId: 1,
			isPrimary: true,
			clientX: 22,
			clientY: y,
			buttons: 1,
		});
		await launcher.dispatchEvent('pointerup', {
			pointerType: 'touch',
			pointerId: 1,
			isPrimary: true,
			clientX: 22,
			clientY: y,
			button: 0,
			buttons: 0,
		});
		await expect(hub).toHaveCount(0);
		await expect.poll(async () => Math.round((await launcher.boundingBox())!.x)).toBe(-22);
		await page.reload();
		await expect(launcher).toBeVisible();
		await expect.poll(async () => Math.round((await launcher.boundingBox())!.x)).toBe(-22);
		await page.touchscreen.tap(11, (await launcher.boundingBox())!.y + 22);
		await expect(hub).toBeVisible();
	});

	test('touch drag moves the launcher without opening the Hub', async ({ page, context }) => {
		await loginAsInitialAdmin(context.request);
		await setUiLanguage(context.request);
		await createTestAgentApp(context.request);
		await enableTestAgentExecution(context.request);
		await page.goto('/connections');

		const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
		const hub = page.locator('section[aria-label="Agent"]');
		await expect(launcher).toBeVisible();
		const initial = await launcher.boundingBox();
		expect(initial).toBeTruthy();
		const startX = initial!.x + initial!.width / 2;
		const startY = initial!.y + initial!.height / 2;
		await launcher.dispatchEvent('pointerdown', {
			pointerType: 'touch',
			pointerId: 1,
			isPrimary: true,
			clientX: startX,
			clientY: startY,
			button: 0,
			buttons: 1,
		});
		await launcher.dispatchEvent('pointermove', {
			pointerType: 'touch',
			pointerId: 1,
			isPrimary: true,
			clientX: startX - 45,
			clientY: startY - 40,
			buttons: 1,
		});
		await launcher.dispatchEvent('pointermove', {
			pointerType: 'touch',
			pointerId: 1,
			isPrimary: true,
			clientX: startX - 90,
			clientY: startY - 80,
			buttons: 1,
		});
		await launcher.dispatchEvent('pointerup', {
			pointerType: 'touch',
			pointerId: 1,
			isPrimary: true,
			clientX: startX - 90,
			clientY: startY - 80,
			button: 0,
			buttons: 0,
		});

		const moved = await launcher.boundingBox();
		expect(moved).toBeTruthy();
		expect(moved!.x).toBeLessThan(initial!.x - 60);
		expect(moved!.y).toBeLessThan(initial!.y - 50);
		await expect(hub).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Reset position' })).toHaveCount(0);

		await launcher.tap();
		await expect(hub).toBeVisible();
	});
});

test('Agent Hub native buttons keep a 24px physical pointer-target floor', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await createTestAgentApp(context.request);
	await enableTestAgentExecution(context.request);
	await page.goto('/connections');
	await openAgentHub(page);

	const hub = page.locator('section[aria-label="Agent"]');
	await expect(hub).toBeVisible();
	const undersized = await hub.locator('button').evaluateAll((buttons) =>
		buttons
			.filter((button) => {
				const style = getComputedStyle(button);
				return style.display !== 'none' && style.visibility !== 'hidden' && button.getClientRects().length > 0;
			})
			.map((button) => {
				const rect = button.getBoundingClientRect();
				return {
					width: rect.width,
					height: rect.height,
					label:
						button.getAttribute('aria-label') ??
						button.getAttribute('title') ??
						button.textContent?.trim() ??
						'',
				};
			})
			.filter(({ width, height }) => width < 24 || height < 24),
	);
	expect(undersized).toEqual([]);

	const resizeHandle = hub.locator('button[data-ui="resize-handle"]');
	const resizeBox = await resizeHandle.boundingBox();
	expect(resizeBox).toBeTruthy();
	expect(resizeBox!.width).toBeGreaterThanOrEqual(24);
	expect(resizeBox!.height).toBeGreaterThanOrEqual(24);
});

test('Agent Hub resizing keeps its current center and its bottom-right handle follows the pointer', async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await createTestAgentApp(context.request);
	await enableTestAgentExecution(context.request);
	await page.goto('/connections');
	await openAgentHub(page);
	const hub = page.locator('section[aria-label="Agent"]');
	await expect(hub).toBeVisible();
	const handle = hub.locator('button[data-ui="resize-handle"]');

	const bounds = async () => {
		const box = await hub.boundingBox();
		expect(box).toBeTruthy();
		return box!;
	};

	const resize = async (dx: number, dy: number) => {
		const box = await handle.boundingBox();
		expect(box).toBeTruthy();
		const x = box!.x + box!.width / 2;
		const y = box!.y + box!.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + dx, y + dy, { steps: 8 });
		await page.mouse.up();
	};

	const expectCenteredSize = async (before: Awaited<ReturnType<typeof bounds>>, dw: number, dh: number) => {
		await expect.poll(async () => (await bounds()).width).toBeCloseTo(before.width + dw, 0);
		await expect.poll(async () => (await bounds()).height).toBeCloseTo(before.height + dh, 0);
		const after = await bounds();
		expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2, 0);
		expect(after.y + after.height / 2).toBeCloseTo(before.y + before.height / 2, 0);
		return after;
	};

	const initial = await bounds();
	await resize(-80, -60);
	const shrunk = await expectCenteredSize(initial, -160, -120);
	expect(shrunk.x + shrunk.width).toBeCloseTo(initial.x + initial.width - 80, 0);
	expect(shrunk.y + shrunk.height).toBeCloseTo(initial.y + initial.height - 60, 0);

	// Moving the window establishes a new center; resizing must not snap back
	// to the viewport center or the position from the previous resize.
	const header = hub.locator('header').first();
	const headerBox = await header.boundingBox();
	expect(headerBox).toBeTruthy();
	const headerX = headerBox!.x + 24;
	const headerY = headerBox!.y + headerBox!.height / 2;
	await page.mouse.move(headerX, headerY);
	await page.mouse.down();
	await page.mouse.move(headerX + 40, headerY + 60, { steps: 8 });
	await page.mouse.up();
	await expect.poll(async () => (await bounds()).x).toBeCloseTo(shrunk.x + 40, 0);
	const moved = await bounds();
	await resize(30, 20);
	const grown = await expectCenteredSize(moved, 60, 40);

	await handle.focus();
	await page.keyboard.press('ArrowLeft');
	const keyboardResized = await expectCenteredSize(grown, -32, 0);
	await resize(500, 500);
	const maxWidth =
		2 *
		Math.min(keyboardResized.x + keyboardResized.width / 2, 1440 - keyboardResized.x - keyboardResized.width / 2);
	const maxHeight =
		2 *
		Math.min(keyboardResized.y + keyboardResized.height / 2, 1000 - keyboardResized.y - keyboardResized.height / 2);
	const limited = await expectCenteredSize(
		keyboardResized,
		maxWidth - keyboardResized.width,
		maxHeight - keyboardResized.height,
	);
	expect(limited.x).toBeGreaterThanOrEqual(0);
	expect(limited.y).toBeGreaterThanOrEqual(0);
	expect(limited.x + limited.width).toBeLessThanOrEqual(1440);
	expect(limited.y + limited.height).toBeLessThanOrEqual(1000);
});

test('Agent window state resets every user-scoped layout field before an empty user restore', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await page.goto('/connections');

	const state = await page.evaluate(async () => {
		const modulePath = '/src/features/agent/host/window-manager.ts';
		const {
			createAgentWindowManager,
		}: typeof import('../../../../packages/frontend/src/features/agent/host/window-manager') = await import(
			modulePath
		);

		const agentWindowManager = createAgentWindowManager();

		const snapshot = () => JSON.parse(JSON.stringify(agentWindowManager.state)) as typeof agentWindowManager.state;

		const dirty = () => {
			agentWindowManager.openHub({ appId: '00000000-0000-4000-8000-000000000001' });
			agentWindowManager.switchApp({ appId: '00000000-0000-4000-8000-000000000002' });
			agentWindowManager.setHubView('files');
			agentWindowManager.setLauncherPosition({ right: 111, bottom: 222 });
			agentWindowManager.dockLauncher('left');
			agentWindowManager.setBounds({ x: 12, y: 18, width: 700, height: 600 });
			agentWindowManager.toggleMaximize();
		};

		dirty();
		agentWindowManager.reset();
		const afterReset = snapshot();

		dirty();
		const emptyUserId = 2_147_483_000;
		localStorage.removeItem(`nexus.agent.surface.user.${emptyUserId}.v2`);
		agentWindowManager.restoreForUser(emptyUserId);
		const afterEmptyUserRestore = snapshot();

		return { afterReset, afterEmptyUserRestore };
	});

	const expected = {
		status: 'closed',
		bounds: { x: 80, y: 16, width: 1180, height: 740 },
		maximized: false,
		activeAppId: null,
		recentAppIds: [],
		hubView: 'conversation',
		launcherPosition: { right: 22, bottom: 24 },
		launcherDock: null,
	};
	expect(state.afterReset).toEqual(expected);
	expect(state.afterEmptyUserRestore).toEqual(expected);
});

test('Agent layout preferences use the authenticated user namespace and reject obsolete or malformed data', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await page.goto('/connections');
	const result = await page.evaluate(async () => {
		const modulePath = '/src/features/agent/host/window-manager.ts';
		const {
			createAgentWindowManager,
		}: typeof import('../../../../packages/frontend/src/features/agent/host/window-manager') = await import(
			modulePath
		);
		const firstId = '00000000-0000-4000-8000-000000000001';
		const secondId = '00000000-0000-4000-8000-000000000002';
		const currentUser = 2_147_482_001;
		const otherUser = currentUser + 1;

		const key = (userId: number) => `nexus.agent.surface.user.${userId}.v2`;

		const current = createAgentWindowManager();
		current.openHub({ appId: firstId });
		current.setBounds({ x: 100, y: 50, width: 700, height: 500 });
		current.setHubView('files');
		current.setLauncherPosition({ right: 100, bottom: 150 });
		current.persistForUser(currentUser);
		const currentRaw = localStorage.getItem(key(currentUser));
		const other = createAgentWindowManager();
		other.openHub({ appId: secondId });
		other.persistForUser(otherUser);
		const otherRaw = localStorage.getItem(key(otherUser));
		current.restoreForUser(otherUser);
		const otherApp = current.state.activeAppId;
		current.restoreForUser(currentUser);
		const snapshot = JSON.parse(JSON.stringify(current.state));
		localStorage.setItem(
			key(currentUser),
			JSON.stringify({ schemaVersion: 2, bounds: { x: 0, y: 0, width: -1, height: 500 } }),
		);
		current.restoreForUser(currentUser);
		const malformed = {
			active: current.state.activeAppId,
			removed: localStorage.getItem(key(currentUser)) === null,
		};
		localStorage.setItem(`nexus.agent.surface.user.${currentUser}.v1`, currentRaw ?? '');
		current.restoreForUser(currentUser);
		const obsoleteIgnored = current.state.activeAppId === null;
		return {
			firstId,
			secondId,
			otherApp,
			snapshot,
			malformed,
			obsoleteIgnored,
			otherUnchanged: localStorage.getItem(key(otherUser)) === otherRaw,
		};
	});
	expect(result.otherApp).toBe(result.secondId);
	expect(result.snapshot).toMatchObject({
		activeAppId: result.firstId,
		recentAppIds: [result.firstId],
		hubView: 'files',
		bounds: { x: 100, y: 50, width: 700, height: 500 },
		launcherPosition: { right: 100, bottom: 150 },
	});
	expect(result.malformed).toEqual({ active: null, removed: true });
	expect(result.obsoleteIgnored).toBe(true);
	expect(result.otherUnchanged).toBe(true);
});

test('Agent thread selection retains its identity while authoritative history is pending', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const app = await createTestAgentApp(context.request);
	await enableTestAgentExecution(context.request);

	const create = async (title: string) => {
		const result = await requestAgentWorkspace(context.request, app, {
			method: 'agent.threads.create',
			params: { operationId: randomUUID(), title },
		});
		if (result.method !== 'agent.threads.create') throw new Error('Unexpected thread confirmation');
		return result.value;
	};

	const first = await create('E2E Conversation A');
	const second = await create('E2E Conversation B');
	let held = 0;

	let release = () => {};

	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let hold = false;
	const workspacePath = `**/api/v1/agent/apps/${app.id}/workspace`;
	await page.route(workspacePath, async (route) => {
		const body = readAgentWorkspaceRequest(route.request().postDataJSON());
		if (
			hold &&
			(body.request.method === 'agent.threads.entries' || body.request.method === 'agent.runs.list') &&
			body.request.params.threadId === first.id
		) {
			held += 1;
			await gate;
		}
		await route.continue();
	});
	try {
		await page.goto('/connections');
		await openAgentHub(page);
		const hub = page.locator('section[aria-label="Agent"]');
		await openAgentConversations(page);
		const threads = hub.locator('#agent-thread-sidebar');
		const firstButton = threads.getByRole('button').filter({ has: page.getByText(first.title, { exact: true }) });
		const secondButton = threads.getByRole('button').filter({ has: page.getByText(second.title, { exact: true }) });
		await secondButton.click();
		await expect(
			hub.locator('.agent-conversation-pane > header').getByText(second.title, { exact: true }),
		).toBeVisible();
		await openAgentConversations(page);
		await expect(firstButton).toBeEnabled();
		hold = true;
		await openAgentConversations(page);
		await firstButton.click();
		await expect.poll(() => held).toBe(2);
		await expect(
			hub.locator('.agent-conversation-pane > header').getByText(first.title, { exact: true }),
		).toBeVisible();
		await openAgentConversations(page);
		await expect(secondButton).toBeDisabled();
		release();
		await openAgentConversations(page);
		await expect(secondButton).toBeEnabled();
		await secondButton.click();
		await expect(
			hub.locator('.agent-conversation-pane > header').getByText(second.title, { exact: true }),
		).toBeVisible();
	} finally {
		release();
		await page.unroute(workspacePath);
	}
});

test('Agent create-thread Retry retains the exact operation after an unknown outcome and requires inspection', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const app = await createTestAgentApp(context.request);
	await enableTestAgentExecution(context.request);

	const list = async () => {
		const result = await requestAgentWorkspace(context.request, app, {
			method: 'agent.threads.list',
			params: { after: null, limit: 50 },
		});
		if (result.method !== 'agent.threads.list') throw new Error('Unexpected thread list');
		return result.value.items;
	};

	const before = await list();
	const attempts: AgentWorkspaceRequest[] = [];
	const workspacePath = `**/api/v1/agent/apps/${app.id}/workspace`;
	await page.route(workspacePath, async (route) => {
		const body = readAgentWorkspaceRequest(route.request().postDataJSON());
		if (body.request.method !== 'agent.threads.create') {
			await route.continue();
			return;
		}
		attempts.push(body);
		if (attempts.length === 1) {
			const committed = await route.fetch();
			expect(committed.status()).toBe(200);
			readAgentWorkspaceResponse(await committed.json(), app.id, body);
			await route.abort('connectionreset');
		} else {
			await route.continue();
		}
	});
	await page.goto('/connections');
	await openAgentHub(page);
	const hub = page.locator('section[aria-label="Agent"]');
	await openAgentConversations(page);
	const threads = hub.locator('#agent-thread-sidebar');
	await threads.getByRole('button', { name: 'New', exact: true }).click();
	await expect.poll(() => attempts.length).toBe(1);
	const retry = threads.getByRole('button', { name: 'Retry after checking state', exact: true });
	await expect(retry).toBeDisabled();
	await threads.getByRole('button', { name: 'Inspect original intention', exact: true }).click();
	await expect(retry).toBeEnabled();
	expect(await list()).toHaveLength(before.length + 1);
	await retry.click();
	await expect.poll(() => attempts.length).toBe(2);
	expect(attempts[1]).toEqual(attempts[0]);
	expect(attempts[0].request.method).toBe('agent.threads.create');
	if (attempts[0].request.method !== 'agent.threads.create') throw new Error('Unexpected operation');
	expect(attempts[0].request.params.title).toBe('Untitled thread');
	expect(attempts[0].request.params.operationId).toMatch(/^[0-9a-f-]{36}$/u);
	await expect(retry).toHaveCount(0);
	expect(await list()).toHaveLength(before.length + 1);
	await page.unroute(workspacePath);
});

test('Agent execution setting gates the launcher and its global window', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const app = await createTestAgentApp(context.request);
	const original = await requestAgentJson(
		context.request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	if (original.settings.enabled) {
		await requestAgentJson(
			context.request,
			{
				method: 'PUT',
				path: '/execution-settings',
				data: {
					expectedVersion: original.settings.version,
					enabled: false,
					limits: original.settings.limits,
				},
			},
			readAgentExecutionSettingsResponse,
		);
	}
	await page.goto('/settings?tab=agent');
	await selectAgentSettingsGroup(page, 'runtime');
	const enable = page.getByRole('switch', { name: 'Agent feature', exact: true });
	await expect(enable).toBeEnabled();
	await expect(enable).not.toBeChecked();
	const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
	const hub = page.locator('section[aria-label="Agent"]');
	await expect(launcher).toHaveCount(0);
	await expect(hub).toHaveCount(0);
	const save = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/v1/agent/execution-settings' &&
			response.request().method() === 'PUT',
	);
	await enable.click();
	expect((await save).status()).toBe(200);
	await expect(enable).toBeChecked();
	await expect(launcher).toBeVisible();
	await launcher.click();
	await expect(hub).toBeVisible();
	await expect(hub).toContainText(app.name);
	await expect(hub).not.toContainText('Execution is disabled');
	await captureFunctionalScreenshot(page, 'agent-native-enabled.png', { viewport: { width: 1440, height: 900 } });
	const bounds = await hub.boundingBox();
	expect(bounds).not.toBeNull();
	await expect
		.poll(() =>
			page.evaluate(() => ({
				root: document.documentElement.style.overflow,
				body: document.body.style.overflow,
			})),
		)
		.toEqual({ root: 'hidden', body: 'hidden' });
	for (const [name, pathname] of [
		['Connections', '/connections'],
		['Dashboard', '/'],
		['Settings', '/settings'],
	]) {
		const settingsRead =
			pathname === '/settings'
				? page.waitForResponse(
						(response) =>
							new URL(response.url()).pathname === '/api/v1/agent/execution-settings' &&
							response.request().method() === 'GET',
					)
				: null;
		await page
			.locator('.app-nav-links')
			.getByRole('link', { name, exact: true })
			.evaluate((element) => (element as HTMLAnchorElement).click());
		if (settingsRead) expect((await settingsRead).status()).toBe(200);
		await expect.poll(() => new URL(page.url()).pathname).toBe(pathname);
		await expect(hub).toBeVisible();
		await expect(launcher).toHaveCount(0);
		expect(await hub.boundingBox()).toEqual(bounds);
	}
	await hub.getByRole('button', { name: 'Minimize Agent', exact: true }).click();
	await expect(hub).toBeHidden();
	await page.locator('[role="tab"][aria-controls="settings-panel-agent"]:visible').click();
	await selectAgentSettingsGroup(page, 'runtime');
	await expect(enable).toBeEnabled();
	await expect(enable).toBeChecked();
	await dismissToasts(page);
	const disabledSave = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/v1/agent/execution-settings' &&
			response.request().method() === 'PUT',
	);
	await enable.click();
	expect((await disabledSave).status()).toBe(200);
	await expect(enable).not.toBeChecked();
	await expect(launcher).toHaveCount(0);
	await expect(hub).toHaveCount(0);
});

test('Agent settings load independently of retired Runner endpoints and expose current Browser and ACP owners', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const obsoleteRequests: string[] = [];
	await page.route('**/api/v1/agent/workspace-runtime/**', (route) => {
		obsoleteRequests.push(route.request().url());
		return route.abort();
	});
	await page.goto('/settings?tab=agent');
	const panel = page.locator('#settings-panel-agent');
	for (const [group, name] of [
		['models', 'Model providers'],
		['runtime', 'Execution and performance'],
	] as const) {
		await selectAgentSettingsGroup(page, group);
		await expect(panel.getByRole('region', { name, exact: true })).toBeVisible();
	}
	await selectAgentExtensionsSection(page, 'integrations');
	await expect(panel.getByRole('region', { name: 'MCP / ACP integrations', exact: true })).toBeVisible();
	await selectAgentSettingsGroup(page, 'runtime');
	await expect(panel.getByRole('region', { name: 'CDP', exact: true })).toBeVisible();
	await expect(panel.getByRole('heading', { name: 'Workspace dev environment', exact: true })).toHaveCount(0);
	expect(obsoleteRequests).toEqual([]);
});

test('Agent settings surface exposes the current control plane and saves explicit Provider capabilities', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await createTestAgentApp(context.request);
	await page.goto('/settings?tab=agent');
	const panel = page.locator('#settings-panel-agent');
	for (const [group, name] of [
		['models', 'Model providers'],
		['runtime', 'Execution and performance'],
		['runtime', 'CDP'],
	] as const) {
		await selectAgentSettingsGroup(page, group);
		await expect(panel.getByRole('region', { name, exact: true })).toBeVisible();
	}
	await selectAgentExtensionsSection(page, 'apps');
	await expect(panel.getByRole('region', { name: 'Agent apps', exact: true })).toBeVisible();
	await selectAgentExtensionsSection(page, 'integrations');
	await expect(panel.getByRole('region', { name: 'MCP / ACP integrations', exact: true })).toBeVisible();
	await selectAgentSettingsGroup(page, 'safety');
	await expect(panel.getByRole('region', { name: 'Agent global target denylist', exact: true })).toBeVisible();
	await expect(panel.getByRole('region', { name: 'Memory management', exact: true })).toHaveCount(0);
	await selectAgentSettingsGroup(page, 'models');
	const providers = panel.getByRole('region', { name: 'Model providers', exact: true });

	const readSavedProvider = async () => {
		// Save closes/re-renders the browser editor, so the intercepted POST/PATCH
		// response body is not a durable CDP read target. Read the one persisted
		// provider instead of replaying a credential-bearing mutation.
		const items = await requestAgentJson(
			context.request,
			{ method: 'GET', path: '/ai/providers' },
			readAgentProviderListResponse,
		);
		const matches = items.filter((item) => item.displayName === 'Settings UI Provider');
		expect(matches).toHaveLength(1);
		return matches[0]!;
	};

	await providers.getByRole('button', { name: 'Add provider', exact: true }).click();
	const editor = page.getByRole('dialog').filter({ has: page.locator('#provider-editor') });
	const form = editor.locator('form');
	await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Settings UI Provider');
	await form.getByRole('textbox', { name: 'API endpoint', exact: true }).fill(E2E_URLS.openAiProviderOrigin + '/v1');
	await expect(form.getByRole('combobox', { name: 'Credential action', exact: true })).toHaveCount(0);
	await form.locator('input[type="password"]').fill('e2e-provider-secret');
	const enabled = form.getByRole('switch', { name: 'Enabled', exact: true });
	if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click();
	await form.getByRole('button', { name: 'Add model manually', exact: true }).click();
	await form.getByRole('textbox', { name: 'Model ID', exact: true }).fill('e2e-model');
	await form.getByRole('spinbutton', { name: 'Context window', exact: true }).fill('131072');
	await form.getByRole('spinbutton', { name: 'Maximum output tokens', exact: true }).fill('128');
	await form.getByRole('checkbox', { name: 'Supports tools', exact: true }).check();
	await form.getByRole('checkbox', { name: 'Low', exact: true }).check();
	await form.getByRole('checkbox', { name: 'High', exact: true }).check();
	await selectUiOption(form.getByRole('combobox', { name: 'Default effort', exact: true }), 'high');
	const creation = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/v1/agent/ai/providers' && response.request().method() === 'POST',
	);
	await editor.getByRole('button', { name: 'Save', exact: true }).click();
	const receipt = await creation;
	expect(receipt.status()).toBe(201);
	let provider = await readSavedProvider();
	expect(provider.models[0]).toMatchObject({
		id: 'e2e-model',
		contextWindow: 131072,
		maxOutputTokens: 128,
		supportsTools: true,
		reasoningEfforts: ['low', 'high'],
		defaultReasoningEffort: 'high',
	});
	expect(JSON.stringify(provider)).not.toContain('e2e-provider-secret');
	await expect(form).toHaveCount(0);
	const card = providers
		.locator('article')
		.filter({ has: page.getByRole('heading', { name: 'Settings UI Provider', exact: true }) });
	await card.getByRole('button', { name: 'Models & test (1)', exact: true }).click();
	const testDialog = page.getByRole('dialog', { name: 'Configured models & test', exact: true });
	await testDialog.getByRole('button', { name: 'Send real connection test', exact: true }).click();
	await expect(
		page.locator('.ui-notification[data-kind="success"]').filter({ hasText: /Test succeeded in/ }),
	).toBeVisible();
	await dismissToasts(page);
	await testDialog.getByRole('button', { name: 'Close', exact: true }).click();
	await card.getByRole('button', { name: 'Discover and record models', exact: true }).click();
	await expect(editor.getByRole('textbox', { name: 'Filter discovered models', exact: true })).toBeVisible();
	const protocol = form.locator('#provider-protocol');
	await selectUiOption(protocol, 'responses');
	const update = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === `/api/v1/agent/ai/providers/${provider.id}` &&
			response.request().method() === 'PATCH',
	);
	await editor.getByRole('button', { name: 'Save', exact: true }).click();
	const updated = await update;
	expect(updated.status()).toBe(200);
	const previousVersion = provider.version;
	provider = await readSavedProvider();
	expect(provider.version).toBe(previousVersion + 1);
	expect(provider.protocol).toBe('responses');
	await expect(form).toHaveCount(0);
	await card.getByRole('button', { name: 'Edit', exact: true }).click();
	await selectUiOption(protocol, 'chat-completions');
	const providerPath = `**/api/v1/agent/ai/providers/${provider.id}`;
	await page.route(providerPath, async (route) => {
		if (route.request().method() === 'PATCH')
			await route.fulfill({ status: 500, json: { code: 'internal_failure' } });
		else await route.continue();
	});
	await editor.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(
		page.locator('.ui-notification[data-kind="error"]').filter({
			hasText: 'Outcome unknown. Read current state; do not repeat creation, discovery or paid tests.',
		}),
	).toBeVisible();
	await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
	await dismissToasts(page);
	await page.unroute(providerPath);
	await editor.getByRole('button', { name: 'Read again (discard draft)', exact: true }).click();
	await card.getByRole('button', { name: 'Edit', exact: true }).click();
	await expectUiSelectValue(protocol, 'responses');
	await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
	await captureFunctionalScreenshot(page, 'agent-settings-models.png', { viewport: { width: 1440, height: 900 } });
	await selectAgentSettingsGroup(page, 'runtime');
	await panel.getByRole('region', { name: 'Execution and performance', exact: true }).scrollIntoViewIfNeeded();
	await captureFunctionalScreenshot(page, 'agent-settings-runtime.png', { viewport: { width: 1440, height: 900 } });
});

test('Subagents inherit main Agent limits without independent model settings', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	let provider = await createAgentProvider(context.request);
	const original = await requestAgentJson(
		context.request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	provider = await requestAgentJson(
		context.request,
		{
			method: 'PATCH',
			path: `/ai/providers/${provider.id}`,
			data: { expectedVersion: provider.version, displayName: 'Changed provider' },
		},
		readAgentProviderView,
	);
	await page.goto('/settings?tab=agent');
	await selectAgentSettingsGroup(page, 'safety');
	const execution = page.getByRole('region', { name: 'Subagents', exact: true });
	await requestAgentJson(
		context.request,
		{ method: 'DELETE', path: `/ai/providers/${provider.id}?expectedVersion=${provider.version}` },
		readAgentProviderDeleteResponse,
	);
	// Normal reads load on entry; the recovery button is reserved for failed/unknown state.
	await page.reload();
	await selectAgentSettingsGroup(page, 'safety');
	await expect(
		execution.getByText(
			'Subagents inherit the main Agent model, tools and execution limits, sharing family budgets and the main task deadline.',
			{ exact: true },
		),
	).toBeVisible();
	await expect(execution.getByRole('combobox')).toHaveCount(0);
	const current = await requestAgentJson(
		context.request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	expect(current.settings).toEqual(original.settings);
	expect(current.settings).not.toHaveProperty('profiles');
});

test('Agent Host preserves an open surface when a directory refresh fails and recovers through explicit read', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const app = await createTestAgentApp(context.request);
	await enableTestAgentExecution(context.request);
	await page.goto('/connections');
	await openAgentHub(page);
	const hub = page.locator('section[aria-label="Agent"]');
	await openAgentConversations(page);
	await hub.locator('#agent-thread-sidebar').getByRole('button', { name: 'New', exact: true }).click();
	const prompt = hub.getByRole('textbox', { name: 'Task input', exact: true });
	await prompt.fill('Unsaved local prompt');
	const appsPath = '**/api/v1/agent/apps';
	await page.route(appsPath, (route) => route.fulfill({ status: 503, json: { code: 'storage_unavailable' } }));
	await hub.getByRole('button', { name: 'Minimize Agent', exact: true }).click();
	await openAgentHub(page);
	const failure = page.getByRole('alert').filter({
		hasText: 'Conversations and App information are temporarily unavailable. Check your connection and try again.',
	});
	await expect(failure).toBeVisible();
	await expect(hub).toBeVisible();
	await expect(prompt).toHaveValue('Unsaved local prompt');
	await page.unroute(appsPath);
	await dismissToasts(page);
	await hub.getByRole('button', { name: 'Minimize Agent', exact: true }).click();
	const recovered = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/v1/agent/apps' && response.request().method() === 'GET',
	);
	await openAgentHub(page);
	expect((await recovered).ok()).toBe(true);
	await expect(failure).toHaveCount(0);
	await expect(hub).toContainText(app.name);
	await expect(prompt).toHaveValue('Unsaved local prompt');
});

test('durable Run events catch up over authenticated workspace reads without a Host subscription', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const { app, thread, input } = await prepareAgentRun(request);
	const created = await requestAgentWorkspace(request, app, {
		method: 'agent.runs.create',
		params: { threadId: thread.id, operationId: randomUUID(), input },
	});
	if (created.method !== 'agent.runs.create') throw new Error('Unexpected Run receipt');
	const runId = created.value.run.id;
	const first = await requestAgentWorkspace(request, app, {
		method: 'agent.runs.events',
		params: { runId, after: 0, limit: 1 },
	});
	if (first.method !== 'agent.runs.events') throw new Error('Unexpected event page');
	expect(first.value.items.map((event) => event.type)).toEqual(['run.created']);
	await expect
		.poll(async () => {
			const read = await requestAgentWorkspace(request, app, { method: 'agent.runs.get', params: { runId } });
			return read.method === 'agent.runs.get' ? read.value?.status : null;
		})
		.toBe('completed');
	const next = await requestAgentWorkspace(request, app, {
		method: 'agent.runs.events',
		params: { runId, after: first.value.nextCursor, limit: 100 },
	});
	if (next.method !== 'agent.runs.events') throw new Error('Unexpected catch-up page');
	expect(next.value.items.map((event) => event.type)).toEqual(['run.started', 'run.completed']);
	expect(next.value.items.every((event) => event.sequence > first.value.nextCursor)).toBe(true);
	const caughtUp = await requestAgentWorkspace(request, app, {
		method: 'agent.runs.events',
		params: { runId, after: next.value.nextCursor, limit: 100 },
	});
	if (caughtUp.method !== 'agent.runs.events') throw new Error('Unexpected final page');
	expect(caughtUp.value).toEqual({ items: [], nextCursor: next.value.nextCursor });
});

test('Agent tabs own independent local drafts and observe external threads through explicit reads', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const app = await createTestAgentApp(context.request);
	await enableTestAgentExecution(context.request);
	const initialThread = await requestAgentWorkspace(context.request, app, {
		method: 'agent.threads.create',
		params: { operationId: randomUUID(), title: 'Shared initial conversation' },
	});
	if (initialThread.method !== 'agent.threads.create') throw new Error('Unexpected initial thread');
	let sockets = 0;
	context.on('page', (opened) =>
		opened.on('websocket', (socket) => {
			if (new URL(socket.url()).pathname === '/ws/agent') sockets += 1;
		}),
	);
	page.on('websocket', (socket) => {
		if (new URL(socket.url()).pathname === '/ws/agent') sockets += 1;
	});
	await page.goto('/connections');
	await openAgentHub(page);
	const follower = await context.newPage();
	try {
		await follower.goto('/connections');
		await openAgentHub(follower);
		await openAgentConversations(page);
		await openAgentConversations(follower);
		const firstHub = page.locator('section[aria-label="Agent"]');
		const secondHub = follower.locator('section[aria-label="Agent"]');
		const secondThreads = secondHub.locator('#agent-thread-sidebar');
		await firstHub
			.locator('#agent-thread-sidebar')
			.getByRole('button')
			.filter({ has: page.getByText(initialThread.value.title, { exact: true }) })
			.click();
		await secondThreads
			.getByRole('button')
			.filter({ has: follower.getByText(initialThread.value.title, { exact: true }) })
			.click();
		const firstDraft = firstHub.getByRole('textbox', { name: 'Task input', exact: true });
		const secondDraft = secondHub.getByRole('textbox', { name: 'Task input', exact: true });
		await secondDraft.fill('Follower draft');
		await firstDraft.fill('Leader draft');
		const result = await requestAgentWorkspace(context.request, app, {
			method: 'agent.threads.create',
			params: { operationId: randomUUID(), title: 'External thread' },
		});
		if (result.method !== 'agent.threads.create') throw new Error('Unexpected thread');
		await secondHub.getByRole('button', { name: 'Minimize Agent', exact: true }).click();
		await openAgentHub(follower);
		await openAgentConversations(follower);
		await expect(
			secondThreads.getByRole('button').filter({ has: follower.getByText('External thread', { exact: true }) }),
		).toBeVisible();
		await expect(secondDraft).toHaveValue('Follower draft');
		await expect(firstDraft).toHaveValue('Leader draft');
		expect(sockets).toBe(0);
	} finally {
		await follower.close();
	}
});

test('concurrent Agent settings preserve dirty drafts and reject their original stale version', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.goto('/settings?tab=agent');
	const follower = await context.newPage();
	try {
		await follower.goto('/settings?tab=agent');
		await selectAgentSettingsGroup(page, 'runtime');
		await selectAgentSettingsGroup(follower, 'runtime');
		const leader = page.getByRole('region', { name: 'Execution and performance', exact: true });
		const other = follower.getByRole('region', { name: 'Execution and performance', exact: true });
		// Lowering Concurrent Runs alone violates the execution contract if
		// model-call capacity still equals the current maximum run capacity.
		// Use the independently editable (and bounded by Runs) model-call limit
		// to exercise the same concurrent CAS conflict without invalid input.
		const leaderInput = leader.getByRole('textbox', { name: 'Concurrent model calls', exact: true });
		const otherInput = other.getByRole('textbox', { name: 'Concurrent model calls', exact: true });
		const original = Number(await leaderInput.inputValue());
		const current = await requestAgentJson(
			context.request,
			{ method: 'GET', path: '/execution-settings' },
			readAgentExecutionSettingsResponse,
		);
		const maximum = current.settings.hardLimits.maxConcurrentModelCalls;
		const runs = Number(await leader.getByRole('textbox', { name: 'Concurrent Runs', exact: true }).inputValue());
		const alternatives = Array.from({ length: Math.min(maximum, runs) }, (_, index) => index + 1).filter(
			(value) => value !== original,
		);
		expect(alternatives.length).toBeGreaterThanOrEqual(2);
		await otherInput.fill(String(alternatives[1]));
		await leaderInput.fill(String(alternatives[0]));
		const leaderSave = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/v1/agent/execution-settings' &&
				response.request().method() === 'PUT',
		);
		await leader.getByRole('button', { name: 'Save', exact: true }).click();
		expect((await leaderSave).status()).toBe(200);
		await expect(
			page.locator('.ui-notification[data-kind="success"]').filter({ hasText: 'Settings saved.' }),
		).toBeVisible();
		await expect(otherInput).toHaveValue(String(alternatives[1]));
		const conflict = follower.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/v1/agent/execution-settings' &&
				response.request().method() === 'PUT',
		);
		await other.getByRole('button', { name: 'Save', exact: true }).click();
		expect((await conflict).status()).toBe(409);
		await expect(
			follower
				.locator('.ui-notification')
				.filter({ hasText: 'The version changed. Read saved settings and review a new draft.' }),
		).toBeVisible();
		await expect(otherInput).toHaveValue(String(alternatives[1]));
		await expect(other.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
		await follower.getByRole('button', { name: 'Reload settings', exact: true }).click();
		await expect(otherInput).toHaveValue(String(alternatives[0]));
	} finally {
		await follower.close();
	}
});

test('retired Agent Host subscriptions reject every connection without blocking native authenticated reads', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	const created = await createTestAgentApp(context.request);
	await page.goto('/connections');
	const outcomes = await page.evaluate(async () =>
		Promise.all(
			Array.from(
				{ length: 4 },
				() =>
					new Promise<string>((resolve, reject) => {
						const socket = new WebSocket(location.origin.replace(/^http/u, 'ws') + '/ws/agent');
						const timer = setTimeout(() => {
							socket.close();
							reject(new Error('Retired Agent subscription did not reject'));
						}, 5000);
						socket.addEventListener(
							'open',
							() => {
								clearTimeout(timer);
								socket.close();
								resolve('opened');
							},
							{ once: true },
						);
						socket.addEventListener(
							'close',
							() => {
								clearTimeout(timer);
								resolve('rejected');
							},
							{ once: true },
						);
					}),
			),
		),
	);
	expect(outcomes).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
	const apps = await requestAgentJson(context.request, { method: 'GET', path: '/apps' }, readAgentAppListResponse);
	// The native app and the built-in product app can coexist. The removed
	// WebSocket subscriptions must not mutate or conceal this authenticated
	// app directory; verify the exact app created for this scenario.
	expect(apps.filter((app) => app.id === created.id)).toEqual([created]);
});

test('Agent App lifecycle uses safe contracts, explicit grants and original state versions', async ({ request }) => {
	const anonymous = await request.get('/api/v1/agent/apps');
	expect(anonymous.status()).toBe(401);
	expect(readAgentErrorResponse(await anonymous.json())).toEqual({ code: 'unauthenticated' });
	await loginAsInitialAdmin(request);
	const definitions = await requestAgentJson(
		request,
		{ method: 'GET', path: '/app-definitions' },
		readAgentAppDefinitionListResponse,
	);
	const native = definitions.find((item) => item.id === 'nexus.terminal');
	expect(native).toMatchObject({ version: '1.8.0', defaultEnabled: true });
	const app = await createTestAgentApp(request);
	const grants = await requestAgentJson(
		request,
		{ method: 'GET', path: `/apps/${app.id}/grants` },
		readAgentGrantView,
	);
	expect(grants.grants).toEqual([]);
	expect(grants.definitions.map((definition) => definition.id)).toContain('integration.acp.invoke');
	const disabled = await requestAgentJson(
		request,
		{ method: 'PATCH', path: `/apps/${app.id}`, data: { enabled: false, expectedVersion: app.version } },
		readAgentAppResponse,
	);
	expect(disabled).toMatchObject({ id: app.id, enabled: false, version: app.version + 1 });
	const stale = await request.patch(`/api/v1/agent/apps/${app.id}`, {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: { enabled: true, expectedVersion: app.version },
	});
	expect(stale.status()).toBe(409);
	expect(readAgentErrorResponse(await stale.json())).toEqual({ code: 'version_conflict' });
	const enabled = await requestAgentJson(
		request,
		{ method: 'PATCH', path: `/apps/${app.id}`, data: { enabled: true, expectedVersion: disabled.version } },
		readAgentAppResponse,
	);
	expect(enabled.version).toBe(disabled.version + 1);
	const currentGrants = await requestAgentJson(
		request,
		{ method: 'GET', path: `/apps/${app.id}/grants` },
		readAgentGrantView,
	);
	expect(currentGrants.grants).toEqual(grants.grants);
	expect(currentGrants.policyRevision).toBe(grants.policyRevision + 2);
	for (const path of ['/security/csrf', '/settings', '/summary']) {
		const retired = await request.get('/api/v1/agent' + path);
		expect(retired.status(), path).toBe(404);
	}
	// Recommended onboarding is a live first-version Plugin endpoint, not a
	// retired Agent Host compatibility route. An offline external catalog has
	// an explicit provider-unavailable failure, not an invented 404 contract.
	const recommended = await request.get('/api/v1/agent/onboarding/recommended-plugin');
	if (recommended.status() === 200) {
		readAgentPluginRecommended(await recommended.json());
	} else {
		expect(recommended.status()).toBe(503);
		expect(readAgentErrorResponse(await recommended.json())).toEqual({ code: 'provider_unavailable' });
	}
});
