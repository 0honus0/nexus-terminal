import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const THEME_NAME = 'E2E Custom Terminal Theme UI';
const EDITED_THEME_NAME = 'E2E Custom Terminal Theme UI Edited';

async function cleanupThemes(request: APIRequestContext): Promise<void> {
	const response = await request.get('/api/v1/terminal-themes');
	expect(response.ok()).toBeTruthy();
	const themes = (await response.json()) as Array<{ id?: string; name: string; preset?: boolean }>;
	for (const theme of themes.filter((item) => !item.preset && [THEME_NAME, EDITED_THEME_NAME].includes(item.name))) {
		if (theme.id) expect((await request.delete(`/api/v1/terminal-themes/${theme.id}`)).ok()).toBeTruthy();
	}
}

test('custom terminal theme UI creates, edits, applies, persists, and deletes a theme', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();
	await cleanupThemes(context.request);

	const originalAppearanceResponse = await context.request.get('/api/v1/appearance');
	expect(originalAppearanceResponse.ok()).toBeTruthy();
	const originalAppearance = (await originalAppearanceResponse.json()) as { activeTerminalThemeId?: number | null };
	let createdThemeId = 0;

	try {
		await page.goto('/');
		await page.getByTitle('Customize Style').click();
		const customizer = page.getByRole('heading', { name: 'Appearance Customizer', exact: true }).locator('../..');
		await expect(customizer).toBeVisible();
		for (const width of [1280, 640, 360]) {
			await page.setViewportSize({ width, height: 900 });
			for (const name of ['UI Styles', 'Terminal Styles', 'Background', 'Other Settings']) {
				await customizer.getByRole('button', { name, exact: true }).click();
				const main = customizer.locator('main');
				await expect
					.poll(() => main.evaluate((element) => element.scrollWidth - element.clientWidth))
					.toBeLessThanOrEqual(1);
				await expect(
					customizer.locator(
						'button:not([data-ui="button"]):not([data-ui="checkbox"]):not([data-ui="switch"]):not([role="combobox"])',
					),
				).toHaveCount(0);
				await expect(main.locator('input:not([type="file"]):not([data-no-highlight])')).toHaveCount(0);
			}
		}
		await page.setViewportSize({ width: 1280, height: 900 });
		await customizer.getByRole('button', { name: 'Terminal Styles', exact: true }).click();
		await expect(customizer.getByRole('button', { name: 'New Theme', exact: true })).toBeVisible();
		const themePanel = customizer.locator('[data-terminal-theme-panel]');
		await expect(themePanel.locator('[data-ui="select"]')).toHaveCount(1);
		await expect(
			themePanel.getByPlaceholder('Search theme name...', { exact: true }).locator('..'),
		).toHaveAttribute('data-ui-gen', '2');
		for (const width of [1280, 640, 360]) {
			await page.setViewportSize({ width, height: 900 });
			await expect
				.poll(() => customizer.evaluate((element) => element.scrollWidth - element.clientWidth))
				.toBeLessThanOrEqual(1);
			await expect
				.poll(() => themePanel.evaluate((element) => element.scrollWidth - element.clientWidth))
				.toBeLessThanOrEqual(1);
		}
		await page.setViewportSize({ width: 1280, height: 900 });

		await step('create a custom terminal theme from the visual editor', async () => {
			await customizer.getByRole('button', { name: 'New Theme', exact: true }).click();
			const editor = customizer
				.locator('section')
				.filter({ has: page.getByRole('heading', { name: 'New Terminal Theme', exact: true }) })
				.last();
			await expect(editor).toBeVisible();
			await editor.getByRole('textbox').first().fill(THEME_NAME);
			await editor.locator('textarea').fill(
				JSON.stringify(
					{
						background: '#101820',
						foreground: '#f2f2f2',
						cursor: '#ffcc00',
						selectionBackground: '#304050',
					},
					null,
					2,
				),
			);

			const createPromise = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/v1/terminal-themes') && response.request().method() === 'POST',
			);
			await editor.getByRole('button', { name: 'Save', exact: true }).click();
			const create = await createPromise;
			expect(create.status()).toBe(201);
			createdThemeId = Number(((await create.json()) as { id?: string }).id);
			expect(createdThemeId).toBeGreaterThan(0);
			await expect(editor).toBeHidden({ timeout: 15_000 });

			await customizer.getByPlaceholder('Search theme name...', { exact: true }).fill(THEME_NAME);
			await expect(
				customizer.getByRole('listitem').filter({ has: page.getByText(THEME_NAME, { exact: true }) }),
			).toBeVisible();
		});

		await step('edit updates both the theme name and colors through the same UI', async () => {
			const row = customizer.getByRole('listitem').filter({ has: page.getByText(THEME_NAME, { exact: true }) });
			await row.getByRole('button', { name: 'Edit', exact: true }).click();
			const editor = customizer
				.locator('section')
				.filter({ has: page.getByRole('heading', { name: 'Edit Terminal Theme', exact: true }) })
				.last();
			await expect(editor).toBeVisible();
			await editor.getByRole('textbox').first().fill(EDITED_THEME_NAME);
			await editor.locator('textarea').fill(
				JSON.stringify(
					{
						background: '#202830',
						foreground: '#fafafa',
						cursor: '#44dd88',
						selectionBackground: '#405060',
					},
					null,
					2,
				),
			);

			const updatePromise = page.waitForResponse(
				(response) =>
					response.url().endsWith(`/api/v1/terminal-themes/${createdThemeId}`) &&
					response.request().method() === 'PUT',
			);
			await editor.getByRole('button', { name: 'Save', exact: true }).click();
			expect((await updatePromise).ok()).toBeTruthy();
			await expect(editor).toBeHidden({ timeout: 15_000 });

			const theme = await context.request.get(`/api/v1/terminal-themes/${createdThemeId}`);
			expect(theme.ok()).toBeTruthy();
			await expect(theme.json()).resolves.toMatchObject({
				name: EDITED_THEME_NAME,
				themeData: { background: '#202830', foreground: '#fafafa', cursor: '#44dd88' },
			});
		});

		await step('apply persists the custom theme across a full reload', async () => {
			await customizer.getByPlaceholder('Search theme name...', { exact: true }).fill(EDITED_THEME_NAME);
			const row = customizer
				.getByRole('listitem')
				.filter({ has: page.getByText(EDITED_THEME_NAME, { exact: true }) });
			const appearanceSave = page.waitForResponse(
				(response) => response.url().endsWith('/api/v1/appearance') && response.request().method() === 'PUT',
			);
			await themePanel.getByRole('combobox').click();
			await page.getByRole('option', { name: EDITED_THEME_NAME, exact: true }).click();
			expect((await appearanceSave).ok()).toBeTruthy();
			await expect(row.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();

			await expect
				.poll(async () => {
					const response = await context.request.get('/api/v1/appearance');
					if (!response.ok()) return 0;
					return Number(
						((await response.json()) as { activeTerminalThemeId?: number }).activeTerminalThemeId ?? 0,
					);
				})
				.toBe(createdThemeId);

			await page.reload({ waitUntil: 'domcontentloaded' });
			await page.getByTitle('Customize Style').click();
			const reloadedCustomizer = page
				.getByRole('heading', { name: 'Appearance Customizer', exact: true })
				.locator('../..');
			await reloadedCustomizer.getByRole('button', { name: 'Terminal Styles', exact: true }).click();
			await reloadedCustomizer.getByPlaceholder('Search theme name...', { exact: true }).fill(EDITED_THEME_NAME);
			const reloadedRow = reloadedCustomizer
				.getByRole('listitem')
				.filter({ has: page.getByText(EDITED_THEME_NAME, { exact: true }) });
			await expect(reloadedRow).toBeVisible();
			await expect(reloadedRow.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
		});

		await step('deleting an active custom theme removes it and falls back to another theme', async () => {
			const row = customizer
				.getByRole('listitem')
				.filter({ has: page.getByText(EDITED_THEME_NAME, { exact: true }) });
			const deletePromise = page.waitForResponse(
				(response) =>
					response.url().endsWith(`/api/v1/terminal-themes/${createdThemeId}`) &&
					response.request().method() === 'DELETE',
			);
			await row.getByRole('button', { name: 'Delete', exact: true }).click();
			const confirm = page.getByRole('dialog', { name: 'Please confirm' });
			await expect(confirm).toBeVisible();
			await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
			expect((await deletePromise).ok()).toBeTruthy();
			await expect(row).toHaveCount(0, { timeout: 15_000 });
			expect((await context.request.get(`/api/v1/terminal-themes/${createdThemeId}`)).status()).toBe(404);

			await expect
				.poll(async () => {
					const response = await context.request.get('/api/v1/appearance');
					if (!response.ok()) return createdThemeId;
					return Number(
						((await response.json()) as { activeTerminalThemeId?: number }).activeTerminalThemeId ?? 0,
					);
				})
				.not.toBe(createdThemeId);
		});
	} finally {
		await cleanupThemes(context.request);
		const themes = await context.request.get('/api/v1/terminal-themes');
		const availableIds = themes.ok()
			? new Set(
					((await themes.json()) as Array<{ id?: string }>)
						.map((theme) => Number(theme.id))
						.filter(Number.isFinite),
				)
			: new Set<number>();
		let restoreId: number | null = originalAppearance.activeTerminalThemeId ?? null;
		if (restoreId !== null && !availableIds.has(restoreId)) restoreId = 1;
		await context.request.put('/api/v1/appearance', { data: { activeTerminalThemeId: restoreId } });
	}
});
