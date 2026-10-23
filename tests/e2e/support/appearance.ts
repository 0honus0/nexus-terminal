import { expect, type APIRequestContext, type Locator } from '@playwright/test';
import {
	readAppearanceUpdate,
	readAppearanceView,
} from '../../../packages/shared/src/preferences/appearance/http-codec';
import type { AppearanceUpdateRequest } from '../../../packages/shared/src/preferences/appearance/http';
import type { AppearanceView } from '../../../packages/shared/src/preferences/appearance/model';
import { E2E_URLS } from './test-env';

export async function selectAppearanceSection(surface: Locator, name: string): Promise<void> {
	// The current mobile navigation is a category picker; desktop tabs are hidden.
	const desktop = await surface.page().evaluate(() => matchMedia('(min-width: 768px)').matches);
	if (desktop) {
		const tab = surface.getByRole('tab', { name, exact: true });
		await tab.click();
		await expect(tab).toHaveAttribute('aria-selected', 'true');
		return;
	}
	const trigger = surface.locator('button[aria-haspopup="listbox"]:not([role="combobox"])');
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await trigger.click();
	const menu = surface.page().getByRole('listbox', { name: 'Appearance Settings', exact: true });
	await expect(menu).toBeVisible();
	await menu.getByRole('option', { name, exact: true }).click();
	await expect(menu).toBeHidden();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect(trigger).toHaveText(name);
}

export async function getTestAppearance(request: APIRequestContext): Promise<AppearanceView> {
	const response = await request.get('/api/v1/appearance');
	expect(response.status()).toBe(200);
	return readAppearanceView(await response.json());
}

/** Each test operation uses the observed version once; conflicts are never automatically retried. */
export async function updateTestAppearance(
	request: APIRequestContext,
	change: (input: AppearanceUpdateRequest) => void,
): Promise<AppearanceView> {
	const current = await getTestAppearance(request);
	const input: AppearanceUpdateRequest = { expectedVersion: current.version };
	change(input);
	const response = await request.put('/api/v1/appearance', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: readAppearanceUpdate(input),
	});
	expect(response.status()).toBe(200);
	const saved = readAppearanceView(await response.json());
	expect(saved.version).toBe(current.version + 1);
	return saved;
}
