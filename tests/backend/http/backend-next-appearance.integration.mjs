import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openManagement } from './management-fixture.mjs';
import { expectStatus } from '../remote/openssh-fixture.mjs';
import {
	readAppearanceView,
	readBackgroundMutation,
} from '../../../packages/shared/dist/preferences/appearance/http-codec.js';

function multipart(parts) {
	const boundary = 'b10-' + randomUUID();
	return {
		bytes: Buffer.concat([
			...parts.flatMap(({ name, filename, type, bytes }) => [
				Buffer.from(
					'--' +
						boundary +
						'\r\nContent-Disposition: form-data; name="' +
						name +
						'"' +
						(filename ? '; filename="' + filename + '"' : '') +
						'\r\n' +
						(type ? 'Content-Type: ' + type + '\r\n' : '') +
						'\r\n',
				),
				bytes,
				Buffer.from('\r\n'),
			]),
			Buffer.from('--' + boundary + '--\r\n'),
		]),
		headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
	};
}

await test(
	'B10 installed appearance, background bytes and local HTML library lifecycle',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-appearance-'));
		let f;
		let current;
		let terminal;
		let html;
		let theme;
		let presets;
		const path = '/api/v1/appearance';
		const local = path + '/html-presets/local';
		const name = '中文 主题.html';
		const htmlPath = local + '/' + encodeURIComponent(name);
		const png = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=',
			'base64',
		);
		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>');

		const appearance = async () => readAppearanceView(expectStatus(await f.api('GET', path), 200));

		const change = async (patch) =>
			readAppearanceView(
				expectStatus(await f.api('PUT', path, { expectedVersion: current.version, ...patch }), 200),
			);

		const upload = (kind, bytes, type, version = current.version, extras = []) => {
			const body = multipart([
				{ name: kind + 'BackgroundFile', filename: 'input', type, bytes },
				{ name: 'expectedVersion', bytes: Buffer.from(String(version)) },
				...extras,
			]);
			return f.api('POST', path + '/background/' + kind, body.bytes, body.headers);
		};

		try {
			f = await openManagement(directory);
			await t.test('anonymous read/write and binary resource access are refused', async () => {
				expectStatus(await f.anonymous('GET', path), 401);
				expectStatus(await f.anonymous('PUT', path, { expectedVersion: 1, terminalFontSize: 20 }), 401);
				expectStatus(await f.anonymous('GET', path + '/background/file/' + randomUUID()), 401);
			});
			await t.test('update before initial read conflicts; first read creates one stable default', async () => {
				expectStatus(await f.api('PUT', path, { expectedVersion: 1, terminalFontSize: 20 }), 409);
				current = await appearance();
				assert.equal(current.version, 1);
				assert.deepEqual(await appearance(), current);
			});
			await t.test('font, CSS JSON, nullable choice and HTML copy round trip independently', async () => {
				current = await change({
					customUiTheme: JSON.stringify({ '--text-color': '#abc' }),
					terminalFontSize: 17,
					terminalFontSizeMobile: 19,
					editorFontFamily: null,
					terminalCustomHtml: '<section>独立副本</section>',
					activeTerminalThemeId: null,
					windowThemeColor: '#123456',
				});
				assert.equal(current.version, 2);
				assert.deepEqual(JSON.parse(current.customUiTheme), { '--text-color': '#abc' });
				assert.equal(current.editorFontFamily, null);
				assert.deepEqual(await appearance(), current);
			});
			await t.test('concurrent same-version edits commit exactly one result', async () => {
				const version = current.version;
				const results = await Promise.all(
					[21, 22].map((size) => f.api('PUT', path, { expectedVersion: version, terminalFontSize: size })),
				);
				assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
				current = await appearance();
				assert.equal(current.version, version + 1);
				assert.deepEqual(current, results.find((response) => response.status === 200).body);
			});
			await t.test(
				'malformed input, prohibited reference and out-of-range values leave state intact',
				async () => {
					for (const patch of [
						{ terminalFontSize: 0 },
						{ terminalBackgroundOverlayOpacity: 1.1 },
						{ windowThemeColor: 'red' },
						{ customUiTheme: '{bad' },
						{ pageBackgroundImage: '/etc/passwd' },
						{ customUiTheme: JSON.stringify({ color: 'red' }) },
					]) {
						expectStatus(await f.api('PUT', path, { expectedVersion: current.version, ...patch }), 400);
					}
					expectStatus(
						await f.api('PUT', path, Buffer.from('{'), { 'Content-Type': 'application/json' }),
						400,
					);
					expectStatus(
						await f.api('PUT', path, { expectedVersion: current.version, activeTerminalThemeId: 99999999 }),
						404,
					);
					assert.deepEqual(await appearance(), current);
				},
			);
			await t.test(
				'PNG upload commits reference and returns exact authenticated bytes with restrictive headers',
				async () => {
					const result = readBackgroundMutation(expectStatus(await upload('page', png, 'image/png'), 200));
					assert.equal(result.cleanupPending, false);
					current = result.appearance;
					const read = await f.api('GET', current.pageBackgroundImage);
					expectStatus(read, 200);
					assert.deepEqual(read.bytes, png);
					assert.equal(read.headers['content-type'], 'image/png');
					assert.equal(read.headers['content-length'], String(png.length));
					assert.equal(read.headers['x-content-type-options'], 'nosniff');
					assert.equal(read.headers['cross-origin-resource-policy'], 'same-origin');
					assert.match(read.headers['content-security-policy'], /^sandbox;/u);
					expectStatus(await f.anonymous('GET', current.pageBackgroundImage), 401);
				},
			);
			await t.test(
				'signature mismatch, unsupported format and unknown multipart fields refuse before publish',
				async () => {
					expectStatus(await upload('page', png, 'image/jpeg'), 400);
					expectStatus(await upload('page', png, 'text/plain'), 415);
					expectStatus(await upload('page', Buffer.from('not an image'), 'image/png'), 400);
					expectStatus(
						await upload('page', png, 'image/png', current.version, [
							{ name: 'unexpected', bytes: Buffer.from('x') },
						]),
						400,
					);
					assert.deepEqual(await appearance(), current);
				},
			);
			await t.test('stale image CAS preserves original reference and original bytes', async () => {
				expectStatus(await upload('page', svg, 'image/svg+xml', current.version - 1), 409);
				assert.deepEqual(await appearance(), current);
				assert.deepEqual((await f.api('GET', current.pageBackgroundImage)).bytes, png);
			});
			await t.test(
				'SVG replacement retires old public resource and exposes exact sandboxed SVG bytes',
				async () => {
					const previous = current.pageBackgroundImage;
					current = readBackgroundMutation(
						expectStatus(await upload('page', svg, 'image/svg+xml'), 200),
					).appearance;
					assert.notEqual(current.pageBackgroundImage, previous);
					expectStatus(await f.api('GET', previous), 404);
					const read = await f.api('GET', current.pageBackgroundImage);
					expectStatus(read, 200);
					assert.deepEqual(read.bytes, svg);
					assert.equal(read.headers['content-type'], 'image/svg+xml');
				},
			);
			await t.test('terminal background is independent from page selection', async () => {
				const page = current.pageBackgroundImage;
				current = readBackgroundMutation(
					expectStatus(await upload('terminal', png, 'image/png'), 200),
				).appearance;
				terminal = current.terminalBackgroundImage;
				assert.notEqual(terminal, page);
				assert.equal(current.pageBackgroundImage, page);
			});
			await t.test('restart preserves chosen settings, explicit null and both actual image files', async () => {
				await f.restart();
				assert.deepEqual(await appearance(), current);
				assert.deepEqual((await f.api('GET', current.pageBackgroundImage)).bytes, svg);
				assert.deepEqual((await f.api('GET', terminal)).bytes, png);
				assert.equal(current.activeTerminalThemeId, null);
			});
			await t.test('background deletion requires current version and retires only selected kind', async () => {
				expectStatus(
					await f.api('DELETE', path + '/background/page', { expectedVersion: current.version - 1 }),
					409,
				);
				const old = current.pageBackgroundImage;
				current = readBackgroundMutation(
					expectStatus(
						await f.api('DELETE', path + '/background/page', { expectedVersion: current.version }),
						200,
					),
				).appearance;
				assert.equal(current.pageBackgroundImage, null);
				assert.equal(current.terminalBackgroundImage, terminal);
				expectStatus(await f.api('GET', old), 404);
			});
			await t.test('HTML library accepts encoded Unicode names and delivers inert exact text', async () => {
				html = expectStatus(
					await f.api('POST', local, { name, content: '<script>window.test="中文"</script>' }),
					201,
				);
				assert.equal(html.name, name);
				const read = await f.api('GET', htmlPath);
				expectStatus(read, 200);
				assert.equal(read.bytes.toString('utf8'), '<script>window.test="中文"</script>');
				assert.match(read.headers['content-type'], /^text\/plain/u);
				assert.match(read.headers['content-security-policy'], /sandbox/u);
			});
			await t.test('duplicate names, stale writes and invalid paths cannot alter library content', async () => {
				expectStatus(await f.api('POST', local, { name, content: 'duplicate' }), 409);
				expectStatus(
					await f.api('PUT', htmlPath, { expectedVersion: html.version + 1, content: 'stale' }),
					409,
				);
				for (const bad of ['../bad.html', 'bad/child.html', 'bad..html', 'bad.txt']) {
					expectStatus(await f.api('POST', local, { name: bad, content: '' }), 400);
				}
				assert.equal(
					(await f.api('GET', htmlPath)).bytes.toString('utf8'),
					'<script>window.test="中文"</script>',
				);
			});
			await t.test(
				'updating and deleting library do not mutate active HTML copy; recreated name cannot reuse old CAS',
				async () => {
					html = expectStatus(
						await f.api('PUT', htmlPath, { expectedVersion: html.version, content: '' }),
						200,
					);
					assert.equal((await f.api('GET', htmlPath)).bytes.length, 0);
					const version = html.version;
					expectStatus(await f.api('DELETE', htmlPath, { expectedVersion: version }), 200);
					expectStatus(await f.api('GET', htmlPath), 404);
					html = expectStatus(await f.api('POST', local, { name, content: 'recreated' }), 201);
					assert.ok(html.version > version);
					expectStatus(
						await f.api('PUT', htmlPath, { expectedVersion: version, content: 'old intent' }),
						409,
					);
					assert.deepEqual(await appearance(), current);
				},
			);
			await t.test('custom override of builtin HTML falls back to builtin after delete', async () => {
				presets = expectStatus(await f.api('GET', local), 200).filter((item) => item.type === 'preset');
				assert.equal(presets.length, 17);
				const target = local + '/' + encodeURIComponent(presets[0].name);
				const original = (await f.api('GET', target)).bytes;
				const override = expectStatus(
					await f.api('POST', local, { name: presets[0].name, content: 'isolated override' }),
					201,
				);
				assert.equal((await f.api('GET', target)).bytes.toString('utf8'), 'isolated override');
				expectStatus(await f.api('DELETE', target, { expectedVersion: override.version }), 200);
				assert.deepEqual((await f.api('GET', target)).bytes, original);
			});
			await t.test('terminal builtin theme refuses mutation, custom theme is selectable', async () => {
				const themes = expectStatus(await f.api('GET', '/api/v1/terminal-themes'), 200);
				const preset = themes.find((item) => item.preset);
				assert.ok(preset);
				expectStatus(
					await f.api('DELETE', '/api/v1/terminal-themes/' + preset.id, { expectedVersion: preset.version }),
					409,
				);
				theme = expectStatus(
					await f.api('POST', '/api/v1/terminal-themes', {
						name: 'isolated B10 theme',
						themeData: preset.themeData,
					}),
					201,
				);
				current = await change({ activeTerminalThemeId: theme.id });
				assert.equal(current.activeTerminalThemeId, theme.id);
			});
			await t.test(
				'deleting selected terminal theme clears reference and increments appearance in same commit',
				async () => {
					const version = current.version;
					expectStatus(
						await f.api('DELETE', '/api/v1/terminal-themes/' + theme.id, {
							expectedVersion: theme.version,
						}),
						200,
					);
					current = await appearance();
					assert.equal(current.activeTerminalThemeId, null);
					assert.equal(current.version, version + 1);
				},
			);
			await t.test(
				'HTML library and appearance choices remain after second restart; normal input rejects did not poison owners',
				async () => {
					await f.restart();
					assert.equal((await f.api('GET', htmlPath)).bytes.toString('utf8'), 'recreated');
					assert.deepEqual(await appearance(), current);
					assert.deepEqual((await f.api('GET', terminal)).bytes, png);
				},
			);
		} finally {
			await f?.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
