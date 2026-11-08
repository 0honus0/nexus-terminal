import { readBackupImportResponse } from '../../../../packages/shared/src/system/backups/http-codec';
import { readAccessStatus } from '../../../../packages/shared/src/access/http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { slowStep, step } from '../../support/steps';

const BACKUP_MAGIC = 'NXSEALED2\n';

async function captureEvidence(
	page: import('@playwright/test').Page,
	testInfo: import('@playwright/test').TestInfo,
	name: string,
): Promise<void> {
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
	);
	const metrics = await page.evaluate(() => {
		const panel = document.querySelector('[role="tabpanel"][aria-label="Data Management"]');
		const panelRect = panel?.getBoundingClientRect();
		const overflowing = [...document.querySelectorAll('*')]
			.map((element) => {
				const htmlElement = element as HTMLElement;
				const rect = htmlElement.getBoundingClientRect();
				return {
					tag: htmlElement.tagName,
					className: htmlElement.className,
					text: (htmlElement.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
					x: rect.x,
					width: rect.width,
					right: rect.right,
					clientWidth: htmlElement.clientWidth,
					scrollWidth: htmlElement.scrollWidth,
				};
			})
			.filter((item) => item.right > window.innerWidth + 1 || item.scrollWidth > item.clientWidth + 1)
			.sort((left, right) => Math.max(right.right, right.scrollWidth) - Math.max(left.right, left.scrollWidth))
			.slice(0, 12);
		return {
			viewport: { width: window.innerWidth, height: window.innerHeight },
			page: {
				clientWidth: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
				clientHeight: document.documentElement.clientHeight,
				scrollHeight: document.documentElement.scrollHeight,
			},
			panel: panelRect
				? {
						x: panelRect.x,
						y: panelRect.y,
						width: panelRect.width,
						height: panelRect.height,
						right: panelRect.right,
						bottom: panelRect.bottom,
						clientWidth: panel?.clientWidth ?? 0,
						scrollWidth: panel?.scrollWidth ?? 0,
					}
				: null,
			overflowing,
		};
	});
	await writeFile(testInfo.outputPath(`backup-${name}.metrics.json`), JSON.stringify(metrics, null, 2));
	expect(metrics.panel).not.toBeNull();
	expect(metrics.page.scrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
	expect(metrics.panel?.right ?? 0).toBeLessThanOrEqual(metrics.viewport.width);
	expect(metrics.panel?.scrollWidth ?? 0).toBeLessThanOrEqual(metrics.panel?.clientWidth ?? 0);
	if (metrics.viewport.width <= 375)
		expect(metrics.page.scrollHeight).toBeGreaterThanOrEqual(metrics.viewport.height);
}

test('data management UI exports a real backup file and imports it through the file picker', async ({
	page,
	context,
}, testInfo) => {
	await loginAsInitialAdmin(context.request);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto('/settings');
	await page.getByRole('tab', { name: 'Data Management', exact: true }).click();
	const section = page.getByRole('tabpanel', { name: 'Data Management', exact: true });
	await expect(section).toBeVisible();
	await section.scrollIntoViewIfNeeded();

	await step(
		'connection-only export is removed and the backup file control keeps rounded themed chrome',
		async () => {
			await expect(section.getByText('Export Connection Data', { exact: true })).toHaveCount(0);
			const settingsExport = await context.request.get('/api/v1/settings/export-connections');
			expect(settingsExport.ok()).toBeFalsy();
			expect(settingsExport.headers()['content-type'] ?? '').not.toContain('application/zip');
			const connectionsExport = await context.request.get('/api/v1/connections/export');
			expect(connectionsExport.ok()).toBeFalsy();
			expect(connectionsExport.headers()['content-type'] ?? '').not.toContain('application/zip');

			const fileButton = section.getByRole('button', { name: 'Choose file', exact: true });
			await expect(fileButton).toBeVisible();
			const fileChrome = await fileButton.evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					topLeft: Number.parseFloat(style.borderTopLeftRadius),
					topRight: Number.parseFloat(style.borderTopRightRadius),
					bottomLeft: Number.parseFloat(style.borderBottomLeftRadius),
					bottomRight: Number.parseFloat(style.borderBottomRightRadius),
					overflow: element.scrollWidth - element.clientWidth,
				};
			});
			expect(fileChrome.topLeft).toBeGreaterThan(0);
			expect(fileChrome.topRight).toBeGreaterThan(0);
			expect(fileChrome.bottomLeft).toBeGreaterThan(0);
			expect(fileChrome.bottomRight).toBeGreaterThan(0);
			expect(fileChrome.overflow).toBeLessThanOrEqual(1);
		},
	);

	await captureEvidence(page, testInfo, 'before');
	await captureFunctionalScreenshot(page, 'data-backup-settings.png', { viewport: { width: 1280, height: 800 } });

	await page.setViewportSize({ width: 320, height: 667 });
	await section.scrollIntoViewIfNeeded();
	await captureEvidence(page, testInfo, 'narrow-320');
	await captureFunctionalScreenshot(page, 'data-backup-settings-narrow-320.png');

	await page.setViewportSize({ width: 375, height: 812 });
	await section.scrollIntoViewIfNeeded();
	await captureEvidence(page, testInfo, 'narrow-375');
	await captureFunctionalScreenshot(page, 'data-backup-settings-narrow-375.png');

	await page.setViewportSize({ width: 1280, height: 800 });
	await section.scrollIntoViewIfNeeded();

	let backupPath = '';
	await slowStep('export downloads a non-empty encrypted .nexus-backup file', async () => {
		await section.locator('form').first().locator('input[type="password"]').fill(E2E_ADMIN.password);
		const downloadPromise = page.waitForEvent('download');
		const responsePromise = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/v1/settings/backup/export') && response.request().method() === 'POST',
		);
		await section.getByRole('button', { name: 'Export backup', exact: true }).click();
		const download = await downloadPromise;
		expect((await responsePromise).ok()).toBeTruthy();
		expect(download.suggestedFilename()).toMatch(/\.nexus-backup$/);
		backupPath = (await download.path()) ?? '';
		expect(backupPath).not.toBe('');
		expect((await stat(backupPath)).size).toBeGreaterThan(100);
		const backup = await readFile(backupPath);
		expect(backup.subarray(0, BACKUP_MAGIC.length).toString('utf8')).toBe(BACKUP_MAGIC);
		expect(backup.toString('utf8')).not.toContain(E2E_ADMIN.password);
	});

	await slowStep('import submits the downloaded backup through the real UI file picker', async () => {
		await section.locator('input[type="file"]').setInputFiles(backupPath);
		// A successful import replaces persisted state and re-renders the UI;
		// its browser-owned response body can be retired before Playwright reads
		// it. Capture the *same* original POST via the routing owner, without
		// repeating this destructive mutation or weakening its value assertions.
		let verifiedBody: ReturnType<typeof readBackupImportResponse> | undefined;
		const importRoute = '**/api/v1/settings/backup/import';
		await page.route(importRoute, async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue();
				return;
			}
			const upstream = await route.fetch({ maxRetries: 0 });
			if (upstream.ok()) verifiedBody = readBackupImportResponse(await upstream.json());
			await route.fulfill({ response: upstream });
		});
		try {
			const importPromise = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/v1/settings/backup/import') && response.request().method() === 'POST',
			);
			await section.getByRole('button', { name: 'Import backup', exact: true }).click();
			// Restoring replaces business data and closes active resources. The UI
			// must obtain the separate destructive confirmation before dispatching
			// the import; merely clicking the form's submit never sends the POST.
			const confirm = page.getByRole('dialog', { name: 'Please confirm' });
			await expect(confirm).toContainText('Restore this backup and replace all backed-up business data?');
			await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
			const response = await importPromise;
			expect(response.ok()).toBeTruthy();
			expect(verifiedBody, 'Backup import must return its persisted receipt').toBeDefined();
			const body = verifiedBody!;
			expect(body.restoredTables).toBeGreaterThan(0);
			expect(body.cleanupPending).toBe(false);
			const recovery = page.locator('[data-backup-recovery]');
			await expect(recovery).toContainText(
				`Backup restored: ${body.restoredRows} rows and ${body.restoredFiles} files.`,
			);
		} finally {
			await page.unroute(importRoute);
		}
		// Finish interception teardown before reload starts fetching its module
		// graph; changing patterns mid-navigation can retire a paused script.
		await Promise.all([
			page.waitForEvent('domcontentloaded'),
			page
				.locator('[data-backup-recovery]')
				.getByRole('button', { name: 'Reload application', exact: true })
				.click(),
		]);
	});

	await step('the browser remains authenticated after the import-triggered reload', async () => {
		await page.waitForLoadState('domcontentloaded');
		const status = await context.request.get('/api/v1/auth/status');
		expect(status.ok()).toBeTruthy();
		expect(readAccessStatus(await status.json()).user.username).toBe(E2E_ADMIN.username);
		await page.getByRole('tab', { name: 'Data Management', exact: true }).click();
		const reloadedSection = page.getByRole('tabpanel', { name: 'Data Management', exact: true });
		await expect(reloadedSection).toBeVisible();
		await reloadedSection.scrollIntoViewIfNeeded();
		await captureEvidence(page, testInfo, 'after');
		await captureFunctionalScreenshot(page, 'data-backup-restored.png', {
			viewport: { width: 1280, height: 800 },
		});
	});
});
