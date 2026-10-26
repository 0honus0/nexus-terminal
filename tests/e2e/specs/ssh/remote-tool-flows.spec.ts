import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { readConnectionView } from '../../../../packages/shared/src/targets/connections/http-codec';
import { readRemoteToolCheck, readRemoteToolError } from '../../../../packages/shared/src/remote/tools/http-codec';
import { readWorkspaceArchiveEvent } from '../../../../packages/shared/src/remote/transfers/task-codec';
import {
	closeWebSocket,
	openWorkspaceSession,
	requestWorkspace,
	waitForFilesystemReady,
	waitForJson,
} from '../../support/ws';
import { clickMenuItem, openFileManager, rightClickRow, row, refreshFileManager } from './progress-display.helpers';

async function controls(query: string): Promise<void> {
	expect((await fetch(`${E2E_SSH.controlUrl}/remote-tools?${query}`, { method: 'POST' })).ok).toBe(true);
}

async function state() {
	const response = await fetch(`${E2E_SSH.controlUrl}/remote-tools`);
	expect(response.ok).toBe(true);
	return response.json();
}

test('auto tool preparation offers the preferred missing rsync before selecting an available scp', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const id = await ensureTestSshConnection(request);
	const cloned = await request.post(`/api/v1/targets/connections/${id}/clone`, {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: { name: 'Tool preparation peer' },
	});
	expect(cloned.status()).toBe(201);
	const peer = readConnectionView(await cloned.json());
	await controls('missing=rsync');
	try {
		for (const side of ['source', 'target'] as const) {
			const response = await request.post('/api/v1/remote/tools/check', {
				headers: { Origin: E2E_URLS.frontendOrigin },
				data: { kind: 'transfer', targetId: id, peerId: peer.id, side, method: 'auto' },
			});
			expect(response.status()).toBe(200);
			const offer = readRemoteToolCheck(await response.json());
			expect(offer.tools).toContain('rsync');
			expect(offer.tools).not.toContain('scp');
			expect(offer.missing).toEqual(['rsync']);
			expect(offer.planId).not.toBeNull();
		}
		expect((await state()).installs).toBe(0);
	} finally {
		await controls('');
	}
});

for (const format of ['tar.gz', 'tar.bz2'] as const) {
	const missing = format === 'tar.gz' ? 'gzip' : 'bzip2';
	test(`archive protocol detects missing ${missing} before dispatching a writer and reports the exact tool`, async ({
		request,
	}) => {
		await loginAsInitialAdmin(request);
		const workspace = await openWorkspaceSession(request, await ensureTestSshConnection(request));
		try {
			await waitForFilesystemReady(workspace.socket);
			await controls(`missing=${missing}`);
			const id = crypto.randomUUID();
			const completed = waitForJson(
				workspace.socket,
				(message) =>
					message.type === 'transfer.archive' &&
					message.payload?.requestId === id &&
					message.payload?.type === 'failed',
			);
			expect(
				await requestWorkspace(
					workspace.socket,
					'transfer.compress',
					{ sources: ['/archive-source.txt'], destination: `/missing.${format}`, format },
					id,
				),
			).toEqual({ started: true });
			expect(readWorkspaceArchiveEvent((await completed).payload)).toMatchObject({
				type: 'failed',
				code: 'COMMAND_NOT_FOUND',
				commandNotFound: missing,
			});
			const processes = await (await fetch(`${E2E_SSH.controlUrl}/archive/processes`)).json();
			expect(processes).toEqual({ started: 0, exited: 0 });
			const health = await (await fetch(`${E2E_SSH.controlUrl}/health`)).json();
			expect(existsSync(path.join(String(health.rootDir), `missing.${format}`))).toBe(false);
		} finally {
			await controls('');
			await closeWebSocket(workspace.socket);
		}
	});
}

for (const scenario of [
	'zip',
	'tar.gz',
	'tar.bz2',
	'cancel',
	'failed',
	'incomplete',
	'password',
	'bad-password',
	'sudo',
	'no-manager',
	'incompatible-tar',
	'unavailable',
] as const) {
	test(`archive UI: ${scenario} dependency preparation preserves installation and dispatch semantics`, async ({
		page,
		context,
	}) => {
		const format =
			scenario === 'incompatible-tar'
				? 'tar.gz'
				: scenario === 'tar.gz' || scenario === 'tar.bz2'
					? scenario
					: 'zip';
		const missing =
			scenario === 'incompatible-tar'
				? 'tar'
				: format === 'tar.gz'
					? 'gzip'
					: format === 'tar.bz2'
						? 'bzip2'
						: 'zip,unzip';
		const privilege =
			scenario === 'password' || scenario === 'bad-password'
				? 'password'
				: scenario === 'unavailable'
					? 'unavailable'
					: scenario === 'sudo'
						? 'sudo'
						: 'root';
		const result = scenario === 'failed' || scenario === 'incomplete' ? scenario : 'success';
		const installationErrors: string[] = [];
		await page.route('**/api/v1/remote/tools/install', async (route) => {
			const response = await route.fetch();
			if (!response.ok()) {
				installationErrors.push(readRemoteToolError(await response.json()).code);
			}
			await route.fulfill({ response });
		});
		const archiveRequests: string[] = [];
		page.on('websocket', (socket) => {
			if (new URL(socket.url()).pathname !== '/ws/workspace') {
				return;
			}
			socket.on('framesent', ({ payload }) => {
				if (typeof payload !== 'string') {
					return;
				}
				const message = JSON.parse(payload);
				if (message.type === 'transfer.compress') {
					archiveRequests.push(message.requestId);
				}
			});
		});
		await openFileManager(page, context);
		await controls(
			`missing=${scenario === 'incompatible-tar' ? '' : missing}&privilege=${privilege}&install=${result}&manager=${scenario === 'no-manager' ? 'none' : ''}&incompatible=${scenario === 'incompatible-tar' ? 'tar' : ''}`,
		);
		try {
			await rightClickRow(page, 'archive-source.txt');
			await page.getByRole('menu').getByRole('menuitem', { name: 'Compress', exact: true }).hover();
			await page
				.getByRole('menu')
				.getByRole('menuitem', { name: `Compress to ${format}`, exact: true })
				.click();
			const install = page.getByRole('dialog', { name: 'Install required tools', exact: true });
			if (scenario === 'unavailable' || scenario === 'no-manager') {
				// No install plan can be issued without a usable privilege method.
				await expect(
					page.getByText(
						'Required tools are missing and no supported package manager or privilege method is available. Install them manually.',
						{ exact: true },
					),
				).toBeVisible();
			} else {
				await expect(install).toBeVisible();
				for (const tool of missing.split(',')) {
					await expect(install).toContainText(tool);
				}
				expect(archiveRequests).toEqual([]);
				expect((await state()).installs).toBe(0);
				if (scenario === 'cancel') {
					await install.getByRole('button', { name: 'Cancel', exact: true }).click();
				} else {
					if (privilege === 'password') {
						await install
							.getByLabel('sudo authentication password', { exact: true })
							.fill(scenario === 'password' ? 'e2e-sudo-password' : 'wrong-password');
					}
					const installation = page.waitForResponse(
						(response) =>
							new URL(response.url()).pathname === '/api/v1/remote/tools/install' &&
							response.request().method() === 'POST',
					);
					await install.getByRole('button', { name: 'Install and continue', exact: true }).click();
					const response = await installation;
					if (scenario === 'failed' || scenario === 'incomplete' || scenario === 'bad-password') {
						expect(response.ok()).toBe(false);
						expect(installationErrors).toEqual([
							scenario === 'bad-password' ? 'authentication_failed' : 'installation_failed',
						]);
						await expect(
							page.getByText(
								scenario === 'bad-password'
									? 'sudo authentication or permission was denied. Check the password and sudo configuration.'
									: "Installation failed or tools are still unavailable. Check the server's repositories and package manager.",
								{ exact: true },
							),
						).toBeVisible();
					} else {
						expect(response.status()).toBe(200);
					}
				}
				await expect(install).toBeHidden();
			}
			const succeeds = ['zip', 'tar.gz', 'tar.bz2', 'password', 'sudo', 'incompatible-tar'].includes(scenario);
			const health = await (await fetch(`${E2E_SSH.controlUrl}/health`)).json();
			const output = path.join(String(health.rootDir), `archive-source.${format}`);
			if (succeeds) {
				await expect(row(page, `archive-source.${format}`)).toBeVisible({ timeout: 30000 });
				const extracted = await promisify(execFile)(
					format === 'zip' ? 'unzip' : 'tar',
					format === 'zip'
						? ['-p', output, 'archive-source.txt']
						: [format === 'tar.gz' ? '-xOzf' : '-xOjf', output, './archive-source.txt'],
				);
				expect(extracted.stdout).toBe(
					await readFile(path.join(String(health.rootDir), 'archive-source.txt'), 'utf8'),
				);
				expect(archiveRequests).toHaveLength(1);
			} else {
				await refreshFileManager(page);
				expect(archiveRequests).toEqual([]);
				expect(existsSync(output)).toBe(false);
				expect(await (await fetch(`${E2E_SSH.controlUrl}/archive/processes`)).json()).toEqual({
					started: 0,
					exited: 0,
				});
			}
			const current = await state();
			expect(current.installs).toBe(
				scenario === 'cancel' || scenario === 'unavailable' || scenario === 'no-manager' ? 0 : 1,
			);
			expect(current.passwordReceived).toBe(privilege === 'password');
		} finally {
			await controls('');
		}
	});
}

test('ZIP extraction prompts for missing auxiliary tools and installs before the original extraction', async ({
	page,
	context,
}) => {
	const archiveRequests: string[] = [];
	page.on('websocket', (socket) => {
		socket.on('framesent', ({ payload }) => {
			if (typeof payload !== 'string') {
				return;
			}
			const message = JSON.parse(payload);
			if (message.type === 'transfer.decompress') {
				archiveRequests.push(message.requestId);
			}
		});
	});
	await openFileManager(page, context);
	await controls('missing=zipinfo,od,grep,cp,ln');
	try {
		await rightClickRow(page, '中文解压测试.zip');
		await clickMenuItem(page, 'Decompress');
		const install = page.getByRole('dialog', { name: 'Install required tools', exact: true });
		await expect(install).toBeVisible();
		for (const tool of ['zipinfo', 'od', 'grep', 'cp', 'ln']) {
			await expect(install).toContainText(tool);
		}
		expect(archiveRequests).toEqual([]);
		await install.getByRole('button', { name: 'Install and continue', exact: true }).click();
		await expect(install).toBeHidden();
		await expect(row(page, '中文解压测试')).toBeVisible({ timeout: 30000 });
		expect(archiveRequests).toHaveLength(1);
		const health = await (await fetch(`${E2E_SSH.controlUrl}/health`)).json();
		const output = await readFile(path.join(String(health.rootDir), '中文解压测试'), 'utf8');
		expect(output).toBe('unicode-path-e2e\n');
		expect((await state()).installs).toBe(1);
	} finally {
		await controls('');
	}
});

test('ZIP extraction protocol reports each missing auxiliary tool before snapshot or writer dispatch', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const workspace = await openWorkspaceSession(request, await ensureTestSshConnection(request));
	try {
		await waitForFilesystemReady(workspace.socket);
		for (const tool of ['zipinfo', 'od', 'grep', 'cp', 'ln']) {
			await controls(`missing=${tool}`);
			const id = crypto.randomUUID();
			const failed = waitForJson(
				workspace.socket,
				(message) =>
					message.type === 'transfer.archive' &&
					message.payload?.requestId === id &&
					message.payload?.type === 'failed',
			);
			expect(
				await requestWorkspace(workspace.socket, 'transfer.decompress', { source: '/中文解压测试.zip' }, id),
			).toEqual({ started: true });
			expect(readWorkspaceArchiveEvent((await failed).payload)).toMatchObject({
				type: 'failed',
				code: 'COMMAND_NOT_FOUND',
				commandNotFound: tool,
			});
			expect(await (await fetch(`${E2E_SSH.controlUrl}/archive/processes`)).json()).toEqual({
				started: 0,
				exited: 0,
			});
		}
	} finally {
		await controls('');
		await closeWebSocket(workspace.socket);
	}
});
