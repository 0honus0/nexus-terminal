import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { expectUiSelectValue, selectUiOption } from '../../support/ui-select';

test('direct settings entry mounts only the requested category and defers collapsed maintenance', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const reads: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'GET') reads.push(new URL(request.url()).pathname);
	});
	await page.goto('/settings?tab=about');
	await expect(page.locator('#settings-panel-about')).toBeVisible();
	await page.locator('#settings-tab-desktop-data').click();
	await expect(page.locator('#settings-panel-data')).toBeVisible();
	await expect(page.locator('#settings-panel-workspace')).toHaveCount(0);
	await expect(page.locator('.settings-maintenance__body')).toHaveCount(0);
	expect(reads).not.toContain('/api/v1/settings');
	expect(reads).not.toContain('/api/v1/system/diagnostics');
	expect(reads).not.toContain('/api/v1/remote/mutations');

	const maintenance = page.locator('.settings-maintenance');
	const diagnostics = page.waitForResponse(
		(response) => new URL(response.url()).pathname === '/api/v1/system/diagnostics',
	);
	const mutations = page.waitForResponse(
		(response) => new URL(response.url()).pathname === '/api/v1/remote/mutations',
	);
	await maintenance.locator(':scope > summary').click();
	expect((await diagnostics).ok()).toBe(true);
	expect((await mutations).ok()).toBe(true);
	await expect(maintenance.locator('.settings-maintenance__body')).toBeVisible();
	await expect(maintenance.locator('[aria-busy="true"]')).toHaveCount(0);
	expect(reads.filter((path) => path === '/api/v1/system/diagnostics')).toHaveLength(1);
	await maintenance.locator(':scope > summary').click();
	await expect(maintenance.locator('.settings-maintenance__body')).toBeHidden();
	const refreshed = page.waitForResponse(
		(response) => new URL(response.url()).pathname === '/api/v1/system/diagnostics',
	);
	await maintenance.locator(':scope > summary').click();
	expect((await refreshed).ok()).toBe(true);
	expect(reads.filter((path) => path === '/api/v1/system/diagnostics')).toHaveLength(2);
});

test('visited settings retain independent drafts across category switches without writing', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const writes: string[] = [];
	page.on('request', (request) => {
		if (['PUT', 'PATCH', 'POST', 'DELETE'].includes(request.method())) writes.push(new URL(request.url()).pathname);
	});
	await page.goto('/settings?tab=system');
	const timezone = page.locator('#timezoneSelect');
	await expect(timezone).toBeEnabled();
	await selectUiOption(timezone, 'Pacific/Honolulu');
	await page.locator('#settings-tab-desktop-workspace').click();
	const checkbox = page.locator('#showPopupFileManager');
	await expect(checkbox).toBeEnabled();
	const original = await checkbox.isChecked();
	await checkbox.setChecked(!original);
	await page.locator('#settings-tab-desktop-about').click();
	await expect(page.locator('#settings-panel-about')).toBeVisible();
	await page.locator('#settings-tab-desktop-system').click();
	await expectUiSelectValue(timezone, 'Pacific/Honolulu');
	await page.locator('#settings-tab-desktop-workspace').click();
	await expect(checkbox).toBeChecked({ checked: !original });
	expect(writes).toEqual([]);
});

test('settings group titles and actions stay readable at narrow widths', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	for (const tab of ['security', 'appearance']) {
		await page.goto('/settings?tab=' + tab);
		const panel = page.locator('#settings-panel-' + tab);
		await expect(panel.locator('.ui-settings-group__actions').first()).toBeVisible();
		for (const width of [320, 390, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			await expect
				.poll(() =>
					panel.evaluate((element) => {
						return Array.from(element.querySelectorAll<HTMLElement>('.ui-settings-group__head')).every(
							(head) => {
								const title = head.querySelector<HTMLElement>('.ui-settings-group__title');
								const actions = head.querySelector<HTMLElement>('.ui-settings-group__actions');
								if (!title || !actions || !actions.children.length) return true;
								const bounds = head.getBoundingClientRect();
								const text = title.getBoundingClientRect();
								const controls = actions.getBoundingClientRect();
								return (
									title.scrollWidth <= title.clientWidth + 1 &&
									text.height <= Number.parseFloat(getComputedStyle(title).lineHeight) * 2 + 1 &&
									controls.left >= bounds.left - 1 &&
									controls.right <= bounds.right + 1 &&
									(text.right <= controls.left + 1 || text.bottom <= controls.top + 1)
								);
							},
						);
					}),
				)
				.toBe(true);
		}
	}
});
