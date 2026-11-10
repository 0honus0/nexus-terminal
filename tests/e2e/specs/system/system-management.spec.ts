import { readFile } from 'node:fs/promises';
import { DIAGNOSTIC_MODULE_IDS } from '@nexus-terminal/shared/system/diagnostics/values';
import { test, expect } from '../../support/fixtures';
import {
	E2E_ADMIN,
	loginAsInitialAdmin,
	setUiLanguage,
	updateUiPreferences,
	getUiPreferences,
} from '../../support/auth';

test('data settings download and restore a complete backup, fencing old consumers until explicit reload', async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.goto('/settings?tab=data');
	await page.getByText('Diagnostics and recovery (advanced)', { exact: true }).click();
	await expect(page.locator('[data-host-diagnostics] dd').first()).toBeVisible();
	await page.locator('[data-host-resource-diagnostics] > summary').click();
	await expect(page.locator('[data-diagnostic-module]')).toHaveCount(DIAGNOSTIC_MODULE_IDS.length);
	for (const id of DIAGNOSTIC_MODULE_IDS) {
		await expect(page.locator(`[data-diagnostic-module="${id}"]`)).toHaveCount(1);
	}
	await page.locator('#backup-export-password').fill(E2E_ADMIN.password);
	const downloading = page.waitForEvent('download');
	await page.locator('[data-backup-export] button[type=submit]').click();
	const download = await downloading;
	expect(download.suggestedFilename()).toBe('nexus-terminal.nexus-backup');
	const path = await download.path();
	expect(path).not.toBeNull();
	if (!path) throw Error('Actual backup download path missing');
	const bytes = await readFile(path);
	expect(bytes.length).toBeGreaterThan(32);
	expect(bytes.subarray(0, 10).toString('ascii')).toBe('NXSEALED2\n');
	await updateUiPreferences(context.request, (preferences) => {
		preferences.timezone = 'Europe/London';
	});
	await page.locator('#backup-import-file').setInputFiles(path);
	await page.locator('[data-backup-import] button[type=submit]').click();
	await page
		.getByRole('dialog')
		.filter({ hasText: 'Restore this backup and replace all backed-up business data?' })
		.getByRole('button', { name: 'Confirm', exact: true })
		.click();
	const reload = page.getByRole('button', { name: 'Reload application', exact: true });
	await expect(reload).toBeVisible();
	await expect(page.locator('#app > [inert]')).toHaveCount(1);
	expect((await getUiPreferences(context.request)).preferences.timezone).toBe('UTC');
	await Promise.all([page.waitForEvent('load'), reload.click()]);
	await expect(page.locator('[data-backup-settings]')).toBeVisible();
	await expect(page.locator('#app > [inert]')).toHaveCount(0);
	await expect(page.locator('[data-runtime-boundary]')).toHaveCount(0);
	expect(errors).toEqual([]);
});
