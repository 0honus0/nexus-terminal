import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';
import { BACKUP_MAX_FILE_BYTES } from '../../packages/shared/dist/system/backups/values.js';

const { chromium } = createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-system-management-'));
const checks = [];
let app;
let vite;
let browser;
try {
	const net = createNetServer();
	await new Promise((resolve) => net.listen(0, '127.0.0.1', resolve));
	const port = net.address().port;
	await new Promise((resolve) => net.close(resolve));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'app.db'), { encryptionKey: randomBytes(32) });
	const address = await app.listenHttp({
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
			proxy: { '/api': { target: 'http://' + address, changeOrigin: false } },
		},
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage({ acceptDownloads: true });
	page.setDefaultTimeout(15000);
	await page.goto(origin + '/login');
	await page.evaluate(async () => {
		const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
		const api = createAccessApi();
		await api.setup({
			username: 'admin',
			password: 'System-fixture-2026!',
			confirmPassword: 'System-fixture-2026!',
		});
		await api.login({ username: 'admin', password: 'System-fixture-2026!', rememberMe: false });
	});
	await page.reload();
	await page.locator('.app-header a.nav-link[href="/"]').waitFor();
	const preflight = await page.evaluate(async (maxFileBytes) => {
		const { backupApi } = await import('/src/features/backup/api/backup-api.ts');
		const { BackupRequestFailure } = await import('/src/features/backup/model/backup-types.ts');
		const { requestBinary } = await import('/src/client/http/binary-client.ts');
		const { HttpRequestFailure } = await import('/src/client/http/request-failure.ts');

		async function rejects(work, type, code, outcome) {
			try {
				await work();
			} catch (cause) {
				if (cause instanceof type && cause.code === code && cause.outcome === outcome) {
					return;
				}
				throw cause;
			}
			throw Error('Expected rejection: ' + code);
		}

		await rejects(() => backupApi.exportFull(''), BackupRequestFailure, 'invalid_input', 'not_dispatched');
		const oversized = new File(['x'], 'oversized.nexus-backup');
		Object.defineProperty(oversized, 'size', { value: maxFileBytes + 1 });
		oversized.arrayBuffer = () => {
			throw Error('Oversized file must not be read');
		};
		await rejects(
			() => backupApi.importFull(oversized, null),
			BackupRequestFailure,
			'invalid_input',
			'not_dispatched',
		);
		const aborted = new AbortController();
		aborted.abort();
		await rejects(
			() => backupApi.importFull(new File(['x'], 'aborted.nexus-backup'), null, aborted.signal),
			BackupRequestFailure,
			'cancelled',
			'not_dispatched',
		);
		const budgets = { maxRequestBytes: 16, maxResponseBytes: 16, maxErrorBytes: 16 };
		await rejects(
			() => requestBinary({ method: 'POST', url: 'https://external.invalid', body: 'x', ...budgets }),
			HttpRequestFailure,
			'invalid_input',
			'not_dispatched',
		);
		await rejects(
			() => requestBinary({ method: 'POST', url: '/api/v1/status', body: 'x'.repeat(17), ...budgets }),
			HttpRequestFailure,
			'invalid_input',
			'not_dispatched',
		);
		return [
			'backup rejects empty password, oversized File and revoked intent before dispatch or file allocation',
			'binary transport rejects external origins and oversized request bodies before dispatch',
		];
	}, BACKUP_MAX_FILE_BYTES);
	checks.push(...preflight);
	await page.route(
		'**/api/v1/controlled-binary',
		(route) => route.fulfill({ contentType: 'application/octet-stream', body: 'x'.repeat(33) }),
		{ times: 1 },
	);
	const overflow = await page.evaluate(async () => {
		const { requestBinary } = await import('/src/client/http/binary-client.ts');
		const { HttpRequestFailure } = await import('/src/client/http/request-failure.ts');
		try {
			await requestBinary({
				method: 'GET',
				url: '/api/v1/controlled-binary',
				maxRequestBytes: 16,
				maxResponseBytes: 32,
				maxErrorBytes: 16,
			});
		} catch (cause) {
			return (
				cause instanceof HttpRequestFailure && cause.code === 'protocol_failure' && cause.outcome === 'unknown'
			);
		}
		return false;
	});
	assert.equal(overflow, true);
	checks.push('bounded binary response rejects declared/actual overflow and closes the response');

	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/settings?tab=data');
	});
	await page.locator('[data-host-diagnostics] dd').first().waitFor();
	const diagnostics = await page.evaluate(async () => {
		const { getHostDiagnostics } = await import('/src/features/system-overview/api/diagnostics-api.ts');
		const value = await getHostDiagnostics();
		return {
			schema: value.database.schemaVersion,
			available: value.database.available,
			runtime: value.process.runtimeVersion,
			safe: !('path' in value.database) && !('environment' in value.process),
		};
	});
	assert.equal(diagnostics.available, true);
	assert.ok(diagnostics.schema >= 1);
	assert.match(diagnostics.runtime, /^v[0-9]+/);
	assert.equal(diagnostics.safe, true);
	checks.push('formal data settings show real Shared host diagnostics without environment or database paths');

	await page.route(
		'**/api/v1/system/diagnostics',
		(route) => route.fulfill({ json: { diagnostics: { process: {} } } }),
		{ times: 1 },
	);
	const invalidDiagnostics = await page.evaluate(async () => {
		const { getHostDiagnostics } = await import('/src/features/system-overview/api/diagnostics-api.ts');
		const { HostDiagnosticFailure } = await import('/src/features/system-overview/model/diagnostic-types.ts');
		try {
			await getHostDiagnostics();
		} catch (cause) {
			return cause instanceof HostDiagnosticFailure && cause.code === 'protocol_failure';
		}
		return false;
	});
	assert.equal(invalidDiagnostics, true);
	checks.push('diagnostics reject incomplete wire objects rather than substituting default host facts');

	await page.locator('#backup-export-password').fill('temporary secret');
	await page.locator('#backup-import-password').fill('temporary import secret');
	await page.locator('#backup-import-file').setInputFiles({
		name: 'temporary.nexus-backup',
		mimeType: 'application/octet-stream',
		buffer: Buffer.from('fixture'),
	});
	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/settings?tab=system');
	});
	await page.locator('#timezoneSelect').waitFor();
	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/settings?tab=data');
	});
	assert.equal(await page.locator('#backup-export-password').inputValue(), '');
	assert.equal(await page.locator('#backup-import-password').inputValue(), '');
	assert.equal(await page.locator('#backup-import-file').inputValue(), '');
	checks.push(
		'hiding the data tab clears both passwords and the selected file without waiting for component unmount',
	);

	await page.locator('#backup-export-password').fill('Wrong-fixture-password!');
	await page.locator('[data-backup-export] button[type=submit]').click();
	await page.getByText('The password is incorrect.', { exact: true }).waitFor();
	assert.equal(await page.locator('#backup-export-password').inputValue(), '');
	checks.push('formal backup export reports safe invalid-password failure and immediately clears the password draft');

	await page.locator('#backup-export-password').fill('System-fixture-2026!');
	const downloadReady = page.waitForEvent('download');
	await page.locator('[data-backup-export] button[type=submit]').click();
	const download = await downloadReady;
	assert.equal(download.suggestedFilename(), 'nexus-terminal.nexus-backup');
	const backupPath = await download.path();
	const backupBytes = await readFile(backupPath);
	assert.ok(backupBytes.length > 32);
	checks.push('formal encrypted export delivers the complete real binary as the fixed safe filename');

	await page.evaluate(async () => {
		const { presentationApi } = await import('/src/features/preferences/api/presentation-api.ts');
		const snapshot = await presentationApi.load();
		snapshot.preferences.timezone = 'Europe/London';
		await presentationApi.update({
			action: 'preferences',
			expectedVersion: snapshot.version,
			preferences: snapshot.preferences,
		});
	});
	await page.locator('#backup-import-file').setInputFiles(backupPath);
	await page.locator('[data-backup-import] button[type=submit]').click();
	await page
		.getByRole('dialog')
		.filter({ hasText: 'Restore this backup and replace all backed-up business data?' })
		.getByRole('button', { name: 'Confirm', exact: true })
		.click();
	await page.getByRole('button', { name: 'Reload application', exact: true }).waitFor();
	assert.equal(await page.locator('#app > [inert]').count(), 1);
	const restored = await page.evaluate(async () => {
		const { useBackupStore } = await import('/src/features/backup/public.ts');
		const store = useBackupStore();
		const preferences = await (await fetch('/api/v1/settings/preferences')).json();
		return { status: store.state.status, timezone: preferences.preferences.timezone, blocked: store.blocked };
	});
	assert.deepEqual(restored, { status: 'restored', timezone: 'UTC', blocked: true });
	checks.push(
		'formal multipart restore replaces actual data and fences the old global application until explicit reload',
	);
	await Promise.all([
		page.waitForEvent('load'),
		page.getByRole('button', { name: 'Reload application', exact: true }).click(),
	]);
	await page.locator('[data-backup-settings]').waitFor();
	assert.equal(await page.locator('#app > [inert]').count(), 0);
	checks.push(
		'explicit reload starts fresh consumers with restored state while preserving the current account/session',
	);

	let imports = 0;
	await page.route('**/api/v1/settings/backup/import', async (route) => {
		imports++;
		await route.fetch();
		await route.abort().catch(() => undefined);
	});
	await page.locator('#backup-import-file').setInputFiles(backupPath);
	await page.locator('[data-backup-import] button[type=submit]').click();
	await page
		.getByRole('dialog')
		.filter({ hasText: 'Restore this backup and replace all backed-up business data?' })
		.getByRole('button', { name: 'Confirm', exact: true })
		.click();
	await page
		.getByRole('dialog', { name: 'Backup restoration', exact: true })
		.getByText('The restoration result is unknown. Do not submit the import again.', { exact: true })
		.waitFor();
	const unknown = await page.evaluate(async () => {
		const { useBackupStore } = await import('/src/features/backup/public.ts');
		const { BackupRequestFailure } = await import('/src/features/backup/model/backup-types.ts');
		const store = useBackupStore();
		let blocked = false;
		try {
			await store.importFull(new File(['x'], 'must-not-resend.nexus-backup'), null, new AbortController().signal);
		} catch (cause) {
			blocked = cause instanceof BackupRequestFailure && cause.outcome === 'not_dispatched';
		}
		store.reset();
		return { state: store.state.status, blocked: store.blocked, rejected: blocked };
	});
	assert.deepEqual(unknown, { state: 'unknown', blocked: true, rejected: true });
	assert.equal(imports, 1);
	assert.equal(await page.getByRole('button', { name: 'Reload application', exact: true }).count(), 0);
	assert.equal(await page.locator('[data-runtime-boundary]').count(), 0);
	checks.push(
		'real restore with lost response remains globally unknown, does not auto-reload/retry and survives auth reset',
	);
	console.log('System management: ' + checks.length + ' checks PASS\n' + checks.join('\n'));
} finally {
	const failures = [];
	for (const close of [
		() => browser?.close(),
		() => vite?.close(),
		() => app?.close(),
		() => rm(directory, { recursive: true, force: true }),
	]) {
		try {
			await close();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length) {
		throw new AggregateError(failures, 'System management fixture cleanup failed');
	}
}
