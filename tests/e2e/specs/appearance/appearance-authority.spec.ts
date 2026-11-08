import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { readAppearanceView } from '../../../../packages/shared/src/preferences/appearance/http-codec';
import { readTerminalThemeList } from '../../../../packages/shared/src/preferences/themes/http-codec';

test('native appearance clients preserve multipart images, imported theme activation and complete downloads', async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.goto('/settings');
	const result = await page.evaluate(async () => {
		const path = '/__e2e__/browser-clients.js';
		const { appearanceApi, themeApi }: typeof import('../../support/browser-clients') = await import(path);
		let appearance = await appearanceApi.load();
		const colors = { foreground: '#ffffff', background: '#000000', selectionForeground: '#123456' };
		const imported = await themeApi.importFile(
			new File([JSON.stringify(colors)], 'Imported fixture.json', { type: 'application/json' }),
		);
		if (imported.name !== 'Imported fixture' || imported.themeData.selectionForeground !== '#123456')
			throw Error('Real multipart theme import changed colors or filename');
		await appearanceApi.update({ activeTerminalThemeId: imported.id }, appearance.version);
		await themeApi.remove(imported);
		appearance = await appearanceApi.load();
		if (appearance.activeTerminalThemeId !== null) throw Error('Deleting theme did not clear its active reference');
		const png = Uint8Array.from(
			atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF3sAAAAASUVORK5CYII='),
			(value) => value.charCodeAt(0),
		);
		const images = [];
		for (const kind of ['page', 'terminal'] as const) {
			const image = await appearanceApi.uploadBackground(
				kind,
				new File([png], kind + '.png', { type: 'image/png' }),
				appearance.version,
			);
			const url =
				kind === 'page' ? image.appearance.pageBackgroundImage : image.appearance.terminalBackgroundImage;
			if (!url) throw Error('Background upload did not publish its reference');
			const response = await fetch(url);
			if (response.status !== 200) throw Error('Background download rejected');
			const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
			appearance = (await appearanceApi.removeBackground(kind, image.appearance.version)).appearance;
			if ((kind === 'page' ? appearance.pageBackgroundImage : appearance.terminalBackgroundImage) !== null)
				throw Error('Deleted background still active');
			images.push({ kind, bytes });
		}
		const exported = await themeApi.create('Native fixture export', {
			foreground: '#ffffff',
			background: '#000000',
		});
		return { images, png: Array.from(png), exported };
	});
	expect(result.images).toEqual(['page', 'terminal'].map((kind) => ({ kind, bytes: result.png })));
	const downloading = page.waitForEvent('download');
	await page.evaluate(async (theme) => {
		const path = '/__e2e__/browser-clients.js';
		const { themeApi }: typeof import('../../support/browser-clients') = await import(path);
		await themeApi.exportFile(theme);
	}, result.exported);
	const download = await downloading;
	expect(download.suggestedFilename()).toBe('terminal-theme.json');
	const stream = await download.createReadStream();
	const chunks = [];
	for await (const chunk of stream) chunks.push(chunk);
	expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual({
		foreground: '#ffffff',
		background: '#000000',
	});
	expect(errors).toEqual([]);
});

test('appearance settings save through the actual form and the customizer creates a terminal theme', async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.goto('/settings');
	await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
	await page.locator('#windowThemeColorInput').fill('#ABCDEF');
	const formal = page.locator('#settings-panel-appearance');
	await formal.getByRole('button', { name: 'Save', exact: true }).click();
	await expect
		.poll(
			async () =>
				readAppearanceView(await (await context.request.get('/api/v1/appearance')).json()).windowThemeColor,
		)
		.toBe('#ABCDEF');
	await formal.getByRole('button', { name: 'Customize Appearance', exact: true }).click();
	await page.locator('[data-ui=overlay]').getByRole('tab', { name: 'Terminal Styles', exact: true }).click();
	const themes = page.locator('[data-terminal-theme-panel]');
	await themes.getByRole('button', { name: 'New Theme', exact: true }).click();
	await themes.getByLabel('Theme Name', { exact: true }).fill('Formal fixture theme');
	await themes.getByRole('button', { name: 'Save', exact: true }).click();
	await expect
		.poll(async () =>
			readTerminalThemeList(await (await context.request.get('/api/v1/terminal-themes')).json()).some(
				(item) => item.name === 'Formal fixture theme',
			),
		)
		.toBe(true);
	await expect(page.locator('[data-runtime-boundary]')).toHaveCount(0);
	expect(errors).toEqual([]);
});
