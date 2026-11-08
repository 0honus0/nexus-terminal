import { test, expect, vi, afterEach } from 'vitest';
import {
	parseConnectionScript,
	expandConnectionHosts,
} from '../../../../packages/frontend/src/features/connections/model/connection-script.ts';
import { InvalidTargetPayload } from '../../../../packages/shared/src/targets/http.ts';

afterEach(() => vi.unstubAllGlobals());

test('script parsing preserves IPv6, quoted names, exact secrets and tags without dispatch', () => {
	const fetch = vi.fn(() => {
		throw new Error('Pure connection parsing must not dispatch');
	});
	vi.stubGlobal('fetch', fetch);
	const parsed = parseConnectionScript(
		'user@[::1]:22 -name "quoted name" -p " spaced password " -tags "new tag"',
		[],
		[],
	);
	expect(parsed).toHaveLength(1);
	expect(parsed[0].connection).toMatchObject({ host: '::1', port: 22, username: 'user', name: 'quoted name' });
	expect(parsed[0].credential).toEqual({ kind: 'password', password: ' spaced password ' });
	expect(parsed[0].tagNames).toEqual(['new tag']);
	expect(fetch).not.toHaveBeenCalled();
});

test('same-subnet range expands each address in order', () => {
	expect(expandConnectionHosts('192.168.1.1~192.168.1.3')).toEqual(['192.168.1.1', '192.168.1.2', '192.168.1.3']);
});

test.each(['u@host -k missing', 'u@host -p x -k y', 'u@host -name "unclosed'])(
	'invalid connection script is refused without any dispatch: %s',
	(source) => {
		const fetch = vi.fn(() => {
			throw new Error('Invalid connection script must not dispatch');
		});
		vi.stubGlobal('fetch', fetch);
		expect(() => parseConnectionScript(source, [], [])).toThrow(InvalidTargetPayload);
		expect(fetch).not.toHaveBeenCalled();
	},
);
