import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import type { AppearanceUpdateRequest } from '../../../../packages/shared/src/preferences/appearance/http';
import { getTestAppearance, updateTestAppearance } from '../../support/appearance';

test('unrelated appearance updates preserve the saved terminal animation until explicitly cleared', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const original = await getTestAppearance(request);
	const html =
		'<canvas id="animation"></canvas><script>requestAnimationFrame(function frame(){requestAnimationFrame(frame)})</script>';
	try {
		const applied = await updateTestAppearance(request, (input) => {
			input.terminalCustomHtml = html;
			input.terminalBackgroundEnabled = true;
		});
		expect(applied.terminalCustomHtml).toBe(html);
		for (const change of [
			(input: AppearanceUpdateRequest) => {
				input.terminalFontSize = 17;
			},
			(input: AppearanceUpdateRequest) => {
				input.terminalBackgroundEnabled = false;
			},
			(input: AppearanceUpdateRequest) => {
				input.terminalBackgroundEnabled = true;
			},
			(input: AppearanceUpdateRequest) => {
				input.terminalBackgroundOverlayOpacity = 0.25;
			},
		]) {
			const updated = await updateTestAppearance(request, change);
			expect(updated.terminalCustomHtml).toBe(html);
			expect((await getTestAppearance(request)).terminalCustomHtml).toBe(html);
		}
		const cleared = await updateTestAppearance(request, (input) => {
			input.terminalCustomHtml = '';
		});
		expect(cleared.terminalCustomHtml).toBe('');
		expect((await getTestAppearance(request)).terminalCustomHtml).toBe('');
	} finally {
		await updateTestAppearance(request, (input) => {
			input.terminalCustomHtml = original.terminalCustomHtml;
			input.terminalBackgroundEnabled = original.terminalBackgroundEnabled;
			input.terminalFontSize = original.terminalFontSize;
			input.terminalBackgroundOverlayOpacity = original.terminalBackgroundOverlayOpacity;
		});
	}
});
