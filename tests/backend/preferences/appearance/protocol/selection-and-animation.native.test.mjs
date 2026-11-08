import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';
import { readAppearanceView } from '../../../../../packages/shared/dist/preferences/appearance/http-codec.js';
import {
	readTerminalThemeView,
	readTerminalThemeError,
} from '../../../../../packages/shared/dist/preferences/themes/http-codec.js';

await test('Appearance writes preserve independent terminal choices through real HTTP and SQLite', async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'appearance-independent-'));
	const started = performance.now();
	const f = await openManagement(root);
	const timing = { setupMs: performance.now() - started, executeMs: null, drainMs: null };
	const executing = performance.now();
	t.after(async () => {
		timing.executeMs = performance.now() - executing;
		const drain = performance.now();
		try {
			await f.close();
		} finally {
			timing.drainMs = performance.now() - drain;
			await writeFile(join(root, 'timings.json'), JSON.stringify(timing, null, 2));
			t.diagnostic(JSON.stringify(timing));
		}
	});

	const read = async () => readAppearanceView(expectStatus(await f.api('GET', '/api/v1/appearance'), 200));

	const change = async (fields) => {
		const before = await read();
		const saved = readAppearanceView(
			expectStatus(await f.api('PUT', '/api/v1/appearance', { expectedVersion: before.version, ...fields }), 200),
		);
		assert.equal(saved.version, before.version + 1);
		return saved;
	};

	await t.test('deleting an inactive theme never clears the selected theme', async () => {
		const themes = [];
		for (const name of ['selected', 'inactive']) {
			themes.push(
				readTerminalThemeView(
					expectStatus(
						await f.api('POST', '/api/v1/terminal-themes', {
							name,
							themeData: { background: '#101010', foreground: '#eeeeee' },
						}),
						201,
					),
				),
			);
		}
		await change({ activeTerminalThemeId: themes[0].id });
		expectStatus(
			await f.api('DELETE', '/api/v1/terminal-themes/' + themes[1].id, { expectedVersion: themes[1].version }),
			200,
		);
		const repeated = await f.api('DELETE', '/api/v1/terminal-themes/' + themes[1].id, {
			expectedVersion: themes[1].version,
		});
		assert.equal(repeated.status, 404);
		assert.equal(readTerminalThemeError(repeated.body).code, 'not_found');
		assert.equal((await read()).activeTerminalThemeId, themes[0].id);
		assert.equal(
			readTerminalThemeView(expectStatus(await f.api('GET', '/api/v1/terminal-themes/' + themes[0].id), 200)).id,
			themes[0].id,
		);
	});
	await t.test('unrelated edits preserve the saved terminal animation until explicit clear', async () => {
		const html =
			'<canvas id="animation"></canvas><script>requestAnimationFrame(function frame(){requestAnimationFrame(frame)})</script>';
		assert.equal(
			(await change({ terminalCustomHtml: html, terminalBackgroundEnabled: true })).terminalCustomHtml,
			html,
		);
		for (const fields of [
			{ terminalFontSize: 17 },
			{ terminalBackgroundEnabled: false },
			{ terminalBackgroundEnabled: true },
			{ terminalBackgroundOverlayOpacity: 0.25 },
		]) {
			assert.equal((await change(fields)).terminalCustomHtml, html);
			assert.equal((await read()).terminalCustomHtml, html);
		}
		await f.restart();
		assert.equal((await read()).terminalCustomHtml, html);
		assert.equal((await change({ terminalCustomHtml: '' })).terminalCustomHtml, '');
		assert.equal((await read()).terminalCustomHtml, '');
	});
});
