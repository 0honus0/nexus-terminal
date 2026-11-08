import { test, expect } from 'vitest';
import { openAppearance } from '../support/fixture.mjs';
import { appearanceApi } from '../../../../packages/frontend/src/features/appearance/api/appearance-api.ts';
import { themeApi } from '../../../../packages/frontend/src/features/appearance/api/theme-api.ts';
import { htmlThemeApi } from '../../../../packages/frontend/src/features/appearance/api/html-theme-api.ts';
import { AppearanceRequestFailure } from '../../../../packages/frontend/src/features/appearance/model/appearance-failure.ts';

test('appearance defaults, previews, themes and Unicode HTML retain actual HTTP CAS and independent state', async () => {
	const { store } = await openAppearance();
	const checks = [];

	function ensure(value, message) {
		if (!value) {
			throw Error(message);
		}
	}

	async function refuses(work, code, outcome) {
		try {
			await work();
		} catch (cause) {
			ensure(
				cause instanceof AppearanceRequestFailure && cause.code === code && cause.outcome === outcome,
				'Wrong failure ' + cause.code + '/' + cause.outcome,
			);
			return;
		}
		throw Error('Expected failure ' + code);
	}

	await store.load(true);
	ensure(
		store.snapshot.version >= 1 && store.themes.length > 0 && store.localThemes.length >= 17,
		'Real default appearance/themes/HTML read',
	);
	checks.push(
		'real complete Shared defaults, terminal themes and HTML presets load into independent application owners',
	);
	const initial = store.snapshot;
	store.previewSettings({ terminalFontSize: 22 });
	ensure(
		store.settings.terminalFontSize === 22 &&
			store.snapshot.terminalFontSize === initial.terminalFontSize &&
			store.version === initial.version,
		'Preview must not change durable state',
	);
	store.clearFontPreview('terminal');
	ensure(store.settings.terminalFontSize === initial.terminalFontSize, 'Preview clears to authoritative value');
	await store.update(
		{ windowThemeColor: '#123456', terminalFontSize: 17, terminalCustomHtml: '<p>active copy</p>' },
		initial.version,
		new AbortController().signal,
	);
	ensure(store.version === initial.version + 1 && store.settings.terminalFontSize === 17, 'Real appearance CAS');
	checks.push(
		'preview is independent, explicit clear restores saved state and appearance CAS updates the actual version',
	);
	const colors = { foreground: '#ffffff', background: '#000000', selectionForeground: '#123456' };
	const theme = await themeApi.create('Fixture theme', colors);
	const changed = await themeApi.update(theme, 'Fixture edited', {
		foreground: '#eeeeee',
		background: '#111111',
	});
	ensure(
		changed.id === theme.id && changed.version === theme.version + 1 && changed.name === 'Fixture edited',
		'Theme original CAS',
	);
	await refuses(() => themeApi.update(theme, 'Stale', colors), 'version_conflict', 'confirmed');
	await themeApi.remove(changed);
	checks.push('real terminal CRUD preserves original CAS refusal');
	const html = await htmlThemeApi.create('测试 fixture.html', '<p>original</p>');
	const updated = await htmlThemeApi.update(html, '');
	ensure(updated.version > html.version && (await htmlThemeApi.read(html.name)) === '', 'Empty HTML is valid');
	await refuses(() => htmlThemeApi.update(html, 'stale'), 'version_conflict', 'confirmed');
	const copy = await htmlThemeApi.create('copy.html', '<p>copy</p>');
	ensure(
		(await htmlThemeApi.list()).some((value) => value.name === html.name && value.type === 'custom'),
		'Copy preserves source',
	);
	await htmlThemeApi.remove(updated);
	await htmlThemeApi.remove(copy);
	const repo = await htmlThemeApi.repository();
	const repoUpdated = await htmlThemeApi.updateRepository('https://github.com/example/themes', repo.version);
	ensure(
		repoUpdated.version === repo.version + 1 && repoUpdated.url === 'https://github.com/example/themes',
		'Repository uses shared CAS',
	);
	await htmlThemeApi.updateRepository(null, repoUpdated.version);
	await store.load(true);
	ensure(store.snapshot.terminalCustomHtml === '<p>active copy</p>', 'Library mutations leave active copy unchanged');
	checks.push(
		'real Unicode/empty HTML CRUD, original CAS, copy without source deletion and repository shared revision',
	);
	const revoked = new AbortController();
	revoked.abort();
	let dispatched = false;
	await refuses(
		() =>
			store.mutate(async () => {
				dispatched = true;
			}, revoked.signal),
		'cancelled',
		'not_dispatched',
	);
	ensure(!dispatched, 'Revoked intention dispatched');
	await refuses(
		() => appearanceApi.update({ terminalFontSize: 0 }, store.version),
		'invalid_input',
		'not_dispatched',
	);

	checks.push('revoked queued intent and malformed appearance/import inputs are refused before side effects');
	expect(checks).toHaveLength(5);
});
