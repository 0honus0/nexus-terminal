import { test, expect, loginAsAdmin } from '../../../../support/http/protocol-fixture.mjs';
import { readAppearanceView } from '../../../../../packages/shared/src/preferences/appearance/http-codec.ts';
import { readTerminalThemeView } from '../../../../../packages/shared/src/preferences/themes/http-codec.ts';

test('deleting the selected terminal theme clears only its persisted appearance reference', async ({ request }) => {
	await loginAsAdmin(request);
	const before = readAppearanceView(await (await request.get('/api/v1/appearance')).json());
	const created = await request.post('/api/v1/terminal-themes', {
		data: { name: 'Selected theme', themeData: { background: '#101010', foreground: '#eeeeee' } },
	});
	expect(created.status()).toBe(201);
	const theme = readTerminalThemeView(await created.json());
	const saved = await request.put('/api/v1/appearance', {
		data: { expectedVersion: before.version, activeTerminalThemeId: theme.id },
	});
	expect(saved.status()).toBe(200);
	expect(readAppearanceView(await saved.json()).activeTerminalThemeId).toBe(theme.id);
	const selected = readAppearanceView(await (await request.get('/api/v1/appearance')).json());
	expect(selected.activeTerminalThemeId).toBe(theme.id);
	const deleted = await request.delete('/api/v1/terminal-themes/' + theme.id, {
		data: { expectedVersion: theme.version },
	});
	expect(deleted.status()).toBe(200);
	expect((await request.get('/api/v1/terminal-themes/' + theme.id)).status()).toBe(404);
	const after = readAppearanceView(await (await request.get('/api/v1/appearance')).json());
	expect(after.activeTerminalThemeId).toBeNull();
	const { version: selectedVersion, activeTerminalThemeId: selectedId, ...independent } = selected;
	const { version: afterVersion, activeTerminalThemeId: afterId, ...remaining } = after;
	expect(selectedId).toBe(theme.id);
	expect(afterId).toBeNull();
	expect(remaining).toEqual(independent);
	expect(afterVersion).toBe(selectedVersion + 1);
});
