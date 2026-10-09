import { randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';

test('deleting an inactive terminal theme does not clear the selected theme', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const before = await request.get('/api/v1/appearance');
	expect(before.ok()).toBeTruthy();
	const original = await before.json();
	const ids: number[] = [];
	try {
		for (const label of ['selected', 'inactive']) {
			const created = await request.post('/api/v1/terminal-themes', {
				data: {
					name: `E2E ${label} isolation ${randomUUID()}`,
					themeData: { background: '#101010', foreground: '#eeeeee' },
				},
			});
			expect(created.status(), await created.text()).toBe(201);
			ids.push((await created.json()).id);
		}
		expect(
			(await request.put('/api/v1/appearance', { data: { activeTerminalThemeId: ids[0] } })).ok(),
		).toBeTruthy();
		expect((await request.delete(`/api/v1/terminal-themes/${ids[1]}`)).ok()).toBeTruthy();
		expect((await request.delete(`/api/v1/terminal-themes/${ids[1]}`)).status()).toBe(404);
		await expect((await request.get('/api/v1/appearance')).json()).resolves.toMatchObject({
			activeTerminalThemeId: ids[0],
		});
		expect((await request.get(`/api/v1/terminal-themes/${ids[0]}`)).ok()).toBeTruthy();
	} finally {
		expect(
			(
				await request.put('/api/v1/appearance', {
					data: { activeTerminalThemeId: original.activeTerminalThemeId },
				})
			).ok(),
		).toBeTruthy();
		for (const id of ids) {
			const removed = await request.delete(`/api/v1/terminal-themes/${id}`);
			expect([200, 404]).toContain(removed.status());
		}
	}
});
