import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

import { getTestTheme, listTestThemes, removeTestTheme, themeHeaders } from '../../support/themes';
import {
	readTerminalThemeView,
	readTerminalThemeColors,
} from '../../../../packages/shared/src/preferences/themes/http-codec';
import type { TerminalThemeColors } from '../../../../packages/shared/src/preferences/themes/model';

const THEME_NAME = 'E2E Terminal Theme';
const UPDATED_NAME = 'E2E Terminal Theme Updated';
const IMPORTED_NAME = 'E2E Terminal Theme Imported';

const initialTheme = {
	foreground: '#d0d0d0',
	background: '#101010',
	cursor: '#f0f0f0',
	selectionBackground: '#303030',
};

const updatedTheme = {
	foreground: '#eeeeee',
	background: '#181818',
	cursor: '#ffcc00',
	selectionBackground: '#404040',
	blue: '#4488ff',
};

test('custom terminal theme supports create, conflict, update, export, import, and delete lifecycle', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);

	const cleanupByName = async (...names: string[]) => {
		const themes = await listTestThemes(request);
		const results = await Promise.allSettled(
			themes
				.filter((item) => !item.preset && names.includes(item.name))
				.map((theme) => removeTestTheme(request, theme)),
		);
		const failures = results.filter((item) => item.status === 'rejected').map((item) => item.reason);
		if (failures.length) throw new AggregateError(failures, 'Theme cleanup failed');
	};

	await cleanupByName(THEME_NAME, UPDATED_NAME, IMPORTED_NAME);
	let themeId = 0;
	let importedId = 0;

	try {
		await step('create a custom theme and fetch it by id', async () => {
			const create = await request.post('/api/v1/terminal-themes', {
				headers: themeHeaders,
				data: { name: THEME_NAME, themeData: initialTheme },
			});
			expect(create.status()).toBe(201);
			const created = readTerminalThemeView(await create.json());
			themeId = created.id;
			expect(created).toMatchObject({ name: THEME_NAME, preset: false, themeData: initialTheme });

			const read = await request.get(`/api/v1/terminal-themes/${themeId}`);
			expect(read.ok()).toBeTruthy();
			await expect(read.json()).resolves.toMatchObject({
				id: themeId,
				name: THEME_NAME,
				themeData: initialTheme,
			});
		});

		await step('duplicate names are rejected without overwriting the existing theme', async () => {
			const duplicate = await request.post('/api/v1/terminal-themes', {
				headers: themeHeaders,
				data: { name: THEME_NAME, themeData: updatedTheme },
			});
			expect(duplicate.status()).toBe(409);
			const original = await request.get(`/api/v1/terminal-themes/${themeId}`);
			await expect(original.json()).resolves.toMatchObject({ name: THEME_NAME, themeData: initialTheme });
		});

		await step('update changes both metadata and terminal colors', async () => {
			const update = await request.put(`/api/v1/terminal-themes/${themeId}`, {
				headers: themeHeaders,
				data: {
					expectedVersion: (await getTestTheme(request, themeId)).version,
					name: UPDATED_NAME,
					themeData: updatedTheme,
				},
			});
			expect(update.ok()).toBeTruthy();

			const read = await request.get(`/api/v1/terminal-themes/${themeId}`);
			expect(read.ok()).toBeTruthy();
			await expect(read.json()).resolves.toMatchObject({ name: UPDATED_NAME, themeData: updatedTheme });
		});

		let exportedTheme: TerminalThemeColors = initialTheme;
		await step('export returns the raw xterm theme JSON with a safe filename', async () => {
			const exported = await request.get(`/api/v1/terminal-themes/${themeId}/export`);
			expect(exported.ok()).toBeTruthy();
			expect(exported.headers()['content-type']).toContain('application/json');
			expect(exported.headers()['content-disposition']).toContain('e2e_terminal_theme_updated.json');
			exportedTheme = readTerminalThemeColors(await exported.json());
			expect(exportedTheme).toMatchObject(updatedTheme);
		});

		await step('an exported theme can be imported under a new name', async () => {
			const imported = await request.post('/api/v1/terminal-themes/import', {
				headers: themeHeaders,
				multipart: {
					name: IMPORTED_NAME,
					themeFile: {
						name: 'exported-theme.json',
						mimeType: 'application/json',
						buffer: Buffer.from(JSON.stringify(exportedTheme)),
					},
				},
			});
			expect(imported.status()).toBe(201);
			const body = readTerminalThemeView(await imported.json());
			importedId = body.id;
			expect(body).toMatchObject({ name: IMPORTED_NAME, preset: false, themeData: updatedTheme });
		});

		await step('custom themes delete cleanly and no longer resolve by id', async () => {
			await removeTestTheme(request, await getTestTheme(request, themeId));
			expect((await request.get(`/api/v1/terminal-themes/${themeId}`)).status()).toBe(404);
			themeId = 0;

			await removeTestTheme(request, await getTestTheme(request, importedId));
			expect((await request.get(`/api/v1/terminal-themes/${importedId}`)).status()).toBe(404);
			importedId = 0;
		});
	} finally {
		await cleanupByName(THEME_NAME, UPDATED_NAME, IMPORTED_NAME);
	}
});
