import { randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { getTestAppearance, updateTestAppearance } from '../../support/appearance';
import { listTestThemes, removeTestTheme, themeHeaders } from '../../support/themes';
import {
	readTerminalThemeView,
	readTerminalThemeError,
} from '../../../../packages/shared/src/preferences/themes/http-codec';

test('deleting an inactive terminal theme does not clear the selected theme', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const original = await getTestAppearance(request);
	const prefix = `E2E isolation ${randomUUID()}`;
	const ids: number[] = [];
	try {
		for (const label of ['selected', 'inactive']) {
			const created = await request.post('/api/v1/terminal-themes', {
				headers: themeHeaders,
				data: { name: `${prefix} ${label}`, themeData: { background: '#101010', foreground: '#eeeeee' } },
			});
			expect(created.status()).toBe(201);
			ids.push(readTerminalThemeView(await created.json()).id);
		}
		await updateTestAppearance(request, (input) => {
			input.activeTerminalThemeId = ids[0];
		});
		const inactive = (await listTestThemes(request)).find((theme) => theme.id === ids[1]);
		if (!inactive) throw new Error('Inactive theme missing');
		await removeTestTheme(request, inactive);
		const deletedAgain = await request.delete('/api/v1/terminal-themes/' + inactive.id, {
			headers: themeHeaders,
			data: { expectedVersion: inactive.version },
		});
		expect(deletedAgain.status()).toBe(404);
		expect(readTerminalThemeError(await deletedAgain.json()).code).toBe('not_found');
		expect((await getTestAppearance(request)).activeTerminalThemeId).toBe(ids[0]);
		const selected = await request.get('/api/v1/terminal-themes/' + ids[0]);
		expect(selected.ok()).toBe(true);
		expect(readTerminalThemeView(await selected.json()).id).toBe(ids[0]);
	} finally {
		const failures: unknown[] = [];
		try {
			await updateTestAppearance(request, (input) => {
				input.activeTerminalThemeId = original.activeTerminalThemeId;
			});
		} catch (cause) {
			failures.push(cause);
		}
		try {
			const results = await Promise.allSettled(
				(await listTestThemes(request))
					.filter((theme) => theme.name.startsWith(prefix))
					.map((theme) => removeTestTheme(request, theme)),
			);
			for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
		} catch (cause) {
			failures.push(cause);
		}
		if (failures.length) throw new AggregateError(failures, 'Theme isolation cleanup failed');
	}
});
