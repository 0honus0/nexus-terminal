import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	readWorkspaceFileListResponse,
	readWorkspaceFilePathRequest,
} from '../../../../packages/shared/src/remote/files/workspace-codec';
import {
	readWorkspaceMessage,
	readWorkspaceRequest,
} from '../../../../packages/shared/src/remote/workspace/workspace-codec';
import { expect, test, type BrowserContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
	E2E_SSH,
	activeFileManagerList,
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	fileManagerRow,
	openConnectedFileManager,
} from '../../support/ssh';

const manager = (page: Page) => page.getByRole('dialog', { name: 'File Manager', exact: true });

async function fixtures(): Promise<void> {
	for (const name of ['cache-one', 'cache-two']) {
		await mkdir(path.resolve('.tmp/ssh-root', name), { recursive: true });
		await writeFile(path.resolve('.tmp/ssh-root', name, `${name}.txt`), name);
	}
}

async function observeListings(page: Page, context: BrowserContext) {
	const cdp = await context.newCDPSession(page);
	await cdp.send('Network.enable');
	const requests = new Map<string, number>();
	const completed = new Map<string, number>();
	const pending = new Map<string, string>();
	const inFlight = new Set<string>();
	cdp.on('Network.webSocketFrameSent', ({ response }) => {
		if (response.opcode !== 1) return;
		const message = readWorkspaceRequest(JSON.parse(response.payloadData));
		if (message.requestId) inFlight.add(message.requestId);
		if (message.type !== 'filesystem.list' || !message.requestId) return;
		const { path } = readWorkspaceFilePathRequest(message.payload);
		requests.set(path, (requests.get(path) ?? 0) + 1);
		pending.set(message.requestId, path);
	});
	cdp.on('Network.webSocketFrameReceived', ({ response }) => {
		if (response.opcode !== 1) return;
		const message = readWorkspaceMessage(JSON.parse(response.payloadData));
		if (!('requestId' in message)) return;
		inFlight.delete(message.requestId);
		const path = pending.get(message.requestId);
		if (!path) return;
		pending.delete(message.requestId);
		if (!message.payload.ok) return;
		const listing = readWorkspaceFileListResponse(message.payload.data);
		expect(listing.path).toBe(path);
		completed.set(path, (completed.get(path) ?? 0) + 1);
	});
	return {
		requests,
		completed,
		pending,
		inFlight,

		dispose: () => cdp.detach(),
	};
}

async function navigate(page: Page, destination: string, filename: string): Promise<void> {
	const input = manager(page).locator('.file-manager-path-input input');
	await input.fill(destination);
	await input.press('Enter');
	await expect(fileManagerRow(page, filename)).toBeVisible();
	await expect(input).toHaveValue(destination);
	await expect(activeFileManagerList(page)).toHaveAttribute('aria-busy', 'false');
}

async function setDirectoryDelay(ms: number): Promise<void> {
	const response = await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=${ms}`, { method: 'POST' });
	expect(response.ok).toBe(true);
}

test('five-minute directory snapshots switch without a list request or spinner; refresh and TTL still read external changes', async ({
	page,
	context,
}) => {
	test.setTimeout(90_000);
	await page.clock.install();
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await fixtures();
	const observation = await observeListings(page, context);
	try {
		await connectTestSshFromConnectionsPage(page, await ensureTestSshConnection(context.request));
		await openConnectedFileManager(page);
		await setDirectoryDelay(500);
		await navigate(page, '/cache-one', 'cache-one.txt');
		await navigate(page, '/cache-two', 'cache-two.txt');
		const baseline = observation.requests.get('/cache-one');
		expect(baseline).toBe(1);
		await navigate(page, '/cache-one', 'cache-one.txt');
		expect(observation.requests.get('/cache-one')).toBe(baseline);
		await expect(manager(page).locator('.file-manager-loading-state')).toHaveCount(0);
		await writeFile(path.resolve('.tmp/ssh-root/cache-one/after-refresh.txt'), 'external refresh');
		await manager(page).getByTitle('Refresh', { exact: true }).click();
		await expect(fileManagerRow(page, 'after-refresh.txt')).toBeVisible();
		expect(observation.requests.get('/cache-one')).toBe(2);
		expect(observation.completed.get('/cache-one')).toBe(2);
		await navigate(page, '/cache-two', 'cache-two.txt');
		await expect.poll(() => observation.inFlight.size).toBe(0);
		await page.clock.fastForward(121_000);
		await navigate(page, '/cache-one', 'cache-one.txt');
		expect(observation.requests.get('/cache-one')).toBe(2);
		await navigate(page, '/cache-two', 'cache-two.txt');
		await writeFile(path.resolve('.tmp/ssh-root/cache-one/after-expiry.txt'), 'external expiry');
		await expect.poll(() => observation.inFlight.size).toBe(0);
		await page.clock.fastForward(181_000);
		await navigate(page, '/cache-one', 'after-expiry.txt');
		expect(observation.requests.get('/cache-one')).toBe(3);
		expect(observation.completed.get('/cache-one')).toBe(3);
	} finally {
		try {
			await setDirectoryDelay(0);
		} finally {
			await observation.dispose();
		}
	}
});

test('hover preloads only the intended directory and clicking shares its already dispatched list request', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await fixtures();
	const observation = await observeListings(page, context);
	try {
		await connectTestSshFromConnectionsPage(page, await ensureTestSshConnection(context.request));
		await openConnectedFileManager(page);
		await setDirectoryDelay(2500);
		await fileManagerRow(page, 'cache-one').hover();
		await expect.poll(() => observation.requests.get('/cache-one')).toBe(1);
		await expect
			.poll(async () => {
				const response = await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay`);
				expect(response.ok).toBe(true);
				return (await response.json()).sftpDelayedDirectoryOpens;
			})
			.toBe(1);
		expect([...observation.pending.values()]).toContain('/cache-one');
		await expect(manager(page).locator('.file-manager-path-input input')).toHaveValue('/');
		await expect(fileManagerRow(page, 'seed.txt')).toBeVisible();
		await expect(manager(page).locator('.file-manager-loading-state')).toHaveCount(0);
		expect(observation.requests.get('/cache-two') ?? 0).toBe(0);
		await fileManagerRow(page, 'cache-one').click();
		await expect(fileManagerRow(page, 'cache-one.txt')).toBeVisible();
		await expect(activeFileManagerList(page)).toHaveAttribute('aria-busy', 'false');
		expect(observation.requests.get('/cache-one')).toBe(1);
		expect(observation.completed.get('/cache-one')).toBe(1);
		await navigate(page, '/', 'seed.txt');
		await navigate(page, '/cache-one', 'cache-one.txt');
		expect(observation.requests.get('/cache-one')).toBe(1);
	} finally {
		try {
			await setDirectoryDelay(0);
		} finally {
			await observation.dispose();
		}
	}
});

test('a real file mutation invalidates cached directories and a late prefetch cannot repopulate them', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await fixtures();
	const observation = await observeListings(page, context);
	try {
		await connectTestSshFromConnectionsPage(page, await ensureTestSshConnection(context.request));
		await openConnectedFileManager(page);
		await navigate(page, '/cache-two', 'cache-two.txt');
		await navigate(page, '/', 'seed.txt');
		await setDirectoryDelay(1500);
		await fileManagerRow(page, 'cache-one').hover();
		await expect.poll(() => observation.requests.get('/cache-one')).toBe(1);
		expect([...observation.pending.values()]).toContain('/cache-one');
		await manager(page).getByTitle('New File', { exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Create New File', exact: true });
		await dialog.getByLabel('File name:', { exact: true }).fill('cache-mutation.txt');
		await dialog.getByRole('button', { name: 'Create', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(fileManagerRow(page, 'cache-mutation.txt')).toBeVisible();
		expect(await readFile(path.resolve('.tmp/ssh-root/cache-mutation.txt'))).toEqual(Buffer.alloc(0));
		await expect.poll(() => observation.pending.size).toBe(0);
		expect(observation.completed.get('/cache-one')).toBe(1);
		await expect(manager(page).locator('.file-manager-path-input input')).toHaveValue('/');
		await navigate(page, '/cache-one', 'cache-one.txt');
		expect(observation.requests.get('/cache-one')).toBe(2);
		expect(observation.completed.get('/cache-one')).toBe(2);
		await navigate(page, '/cache-two', 'cache-two.txt');
		expect(observation.requests.get('/cache-two')).toBe(2);
		expect(observation.completed.get('/cache-two')).toBe(2);
	} finally {
		try {
			await setDirectoryDelay(0);
		} finally {
			await observation.dispose();
		}
	}
});
