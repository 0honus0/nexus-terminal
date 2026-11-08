import { expect, type APIRequestContext } from './fixtures';
import { E2E_URLS } from '../../support/protocols/test-environment';

/** Facts from the actual X11/VNC peer; no browser or application state is substituted. */
export function desktopService(request: APIRequestContext) {
	async function read(path: string): Promise<Record<string, unknown>> {
		const response = await request.get(E2E_URLS.desktopControlOrigin + '/e2e/desktop/' + path);
		expect(response.status()).toBe(200);
		const value: unknown = await response.json();
		if (typeof value !== 'object' || value === null || Array.isArray(value))
			throw Error('Invalid desktop peer facts');
		return Object.fromEntries(Object.entries(value));
	}

	async function text(path: string, field: string): Promise<string> {
		const value = (await read(path))[field];
		if (typeof value !== 'string') throw Error('Invalid desktop peer text');
		return value;
	}

	return {
		async connections(): Promise<number> {
			const value = (await read('connections')).connections;
			if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
				throw Error('Invalid desktop peer connection count');
			return value;
		},

		input: (): Promise<string> => text('input', 'text'),

		clipboard: (): Promise<string> => text('clipboard', 'text'),

		pointer: (): Promise<string> => text('pointer', 'position'),

		async focus(): Promise<void> {
			const response = await request.post(E2E_URLS.desktopControlOrigin + '/e2e/desktop/focus');
			expect(response.status()).toBe(200);
			expect(await response.json()).toEqual({ focused: true });
		},
	};
}
