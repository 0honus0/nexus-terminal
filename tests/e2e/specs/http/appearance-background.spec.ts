import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';

test('unrelated appearance updates preserve the saved terminal animation until explicitly cleared', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const originalResponse = await request.get('/api/v1/appearance');
	expect(originalResponse.ok()).toBeTruthy();
	const original = await originalResponse.json();
	const html =
		'<canvas id="animation"></canvas><script>requestAnimationFrame(function frame(){requestAnimationFrame(frame)})</script>';
	try {
		const applied = await request.put('/api/v1/appearance', {
			data: { terminalCustomHtml: html, terminalBackgroundEnabled: true },
		});
		expect(applied.ok()).toBeTruthy();
		expect((await applied.json()).terminalCustomHtml).toBe(html);
		for (const patch of [
			{ terminalFontSize: 17 },
			{ terminalBackgroundEnabled: false },
			{ terminalBackgroundEnabled: true },
			{ terminalBackgroundOverlayOpacity: 0.25 },
		]) {
			const updated = await request.put('/api/v1/appearance', { data: patch });
			expect(updated.ok()).toBeTruthy();
			expect((await updated.json()).terminalCustomHtml).toBe(html);
			const persisted = await request.get('/api/v1/appearance');
			expect(persisted.ok()).toBeTruthy();
			expect((await persisted.json()).terminalCustomHtml).toBe(html);
		}
		const cleared = await request.put('/api/v1/appearance', { data: { terminalCustomHtml: null } });
		expect(cleared.ok()).toBeTruthy();
		expect((await cleared.json()).terminalCustomHtml).toBe('');
		expect((await (await request.get('/api/v1/appearance')).json()).terminalCustomHtml).toBe('');
	} finally {
		expect(
			(
				await request.put('/api/v1/appearance', {
					data: {
						terminalCustomHtml: original.terminalCustomHtml,
						terminalBackgroundEnabled: original.terminalBackgroundEnabled,
						terminalFontSize: original.terminalFontSize,
						terminalBackgroundOverlayOpacity: original.terminalBackgroundOverlayOpacity,
					},
				})
			).ok(),
		).toBeTruthy();
	}
});
