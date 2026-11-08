// @vitest-environment jsdom
import { File } from 'node:buffer';
import { test, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { themeApi } from '../../../../packages/frontend/src/features/appearance/api/theme-api.ts';
import { AppearanceRequestFailure } from '../../../../packages/frontend/src/features/appearance/model/appearance-failure.ts';
import { htmlThemeApi } from '../../../../packages/frontend/src/features/appearance/api/html-theme-api.ts';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('controlled remote HTML catalog uses actual query and strict UTF-8 text media contracts', async () => {
	const entry = {
		name: 'remote.html',
		downloadUrl: 'https://raw.githubusercontent.com/example/themes/main/remote.html',
	};
	server.use(
		http.get('http://localhost/api/v1/appearance/html-presets/remote/list', ({ request }) => {
			expect(new URL(request.url).searchParams.get('repoUrl')).toBe('https://github.com/example/themes');
			return HttpResponse.json([entry]);
		}),
		http.get('http://localhost/api/v1/appearance/html-presets/remote/content', ({ request }) => {
			expect(new URL(request.url).searchParams.get('fileUrl')).toBe(entry.downloadUrl);
			return new HttpResponse('<p>remote fixture</p>', {
				headers: { 'content-type': 'text/plain; charset=utf-8' },
			});
		}),
	);
	const entries = await htmlThemeApi.listRemote('https://github.com/example/themes');
	expect(entries).toEqual([entry]);
	expect(await htmlThemeApi.readRemote(entries[0].downloadUrl)).toBe('<p>remote fixture</p>');
});

test('malformed theme colors are rejected before any multipart dispatch', async () => {
	const dispatch = vi.spyOn(globalThis, 'fetch');
	try {
		const result = themeApi.importFile(new File(['{"foreground":2}'], 'bad.json', { type: 'application/json' }));
		await expect(result).rejects.toBeInstanceOf(AppearanceRequestFailure);
		await expect(result).rejects.toMatchObject({ code: 'invalid_input', outcome: 'not_dispatched' });
		expect(dispatch).not.toHaveBeenCalled();
	} finally {
		dispatch.mockRestore();
	}
});
