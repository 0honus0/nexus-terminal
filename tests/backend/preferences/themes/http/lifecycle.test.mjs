import { test, expect, loginAsAdmin } from '../../../../support/http/protocol-fixture.mjs';
import {
	readTerminalThemeView,
	readTerminalThemeColors,
	readTerminalThemeDeleted,
} from '../../../../../packages/shared/src/preferences/themes/http-codec.ts';

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
	await loginAsAdmin(request);
	const created = await request.post('/api/v1/terminal-themes', {
		data: { name: 'E2E Terminal Theme', themeData: initialTheme },
	});
	expect(created.status()).toBe(201);
	let theme = readTerminalThemeView(await created.json());
	expect(theme).toMatchObject({ name: 'E2E Terminal Theme', preset: false, themeData: initialTheme });
	const path = '/api/v1/terminal-themes/' + theme.id;
	const read = await request.get(path);
	expect(read.ok()).toBe(true);
	expect(await read.json()).toMatchObject({ id: theme.id, name: theme.name, themeData: initialTheme });
	const duplicate = await request.post('/api/v1/terminal-themes', {
		data: { name: theme.name, themeData: updatedTheme },
	});
	expect(duplicate.status()).toBe(409);
	expect(await (await request.get(path)).json()).toMatchObject({ name: theme.name, themeData: initialTheme });
	const updated = await request.put(path, {
		data: { expectedVersion: theme.version, name: 'E2E Terminal Theme Updated', themeData: updatedTheme },
	});
	expect(updated.ok()).toBe(true);
	const reread = await request.get(path);
	expect(reread.ok()).toBe(true);
	theme = readTerminalThemeView(await reread.json());
	expect(theme).toMatchObject({ name: 'E2E Terminal Theme Updated', themeData: updatedTheme });
	const exported = await request.get(path + '/export');
	expect(exported.ok()).toBe(true);
	expect(exported.headers()['content-type']).toContain('application/json');
	expect(exported.headers()['content-disposition']).toContain('e2e_terminal_theme_updated.json');
	const colors = readTerminalThemeColors(await exported.json());
	expect(colors).toMatchObject(updatedTheme);
	const imported = await request.post('/api/v1/terminal-themes/import', {
		multipart: {
			name: 'E2E Terminal Theme Imported',
			themeFile: {
				name: 'exported-theme.json',
				mimeType: 'application/json',
				buffer: Buffer.from(JSON.stringify(colors)),
			},
		},
	});
	expect(imported.status()).toBe(201);
	const copy = readTerminalThemeView(await imported.json());
	expect(copy).toMatchObject({ name: 'E2E Terminal Theme Imported', preset: false, themeData: updatedTheme });
	for (const item of [theme, copy]) {
		const removed = await request.delete('/api/v1/terminal-themes/' + item.id, {
			data: { expectedVersion: item.version },
		});
		expect(removed.ok()).toBe(true);
		readTerminalThemeDeleted(await removed.json());
		expect((await request.get('/api/v1/terminal-themes/' + item.id)).status()).toBe(404);
	}
});
