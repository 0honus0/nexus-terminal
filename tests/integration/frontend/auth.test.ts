import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../../../src/auth/browser/auth-api.js';
import type { AuthState } from '../../../src/auth/auth-http-types.js';

const account = { id: 'owner', username: 'fixture' } as const;
const signedIn: AuthState = { initialized: true, account, methods: [] };
const signedOut: AuthState = { ...signedIn, account: null };

function fixture() {
	const signal = new AbortController();
	const log = { report: vi.fn() };
	const auth = new AuthApi(signal.signal, log);
	return { auth, signal, log };
}

afterEach(() => vi.unstubAllGlobals());

describe('浏览器认证会话', () => {
	it('服务端撤销会话后丢弃迟到的已登录状态', async () => {
		const late = Promise.withResolvers<Response>();
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(Response.json(signedIn))
			.mockReturnValueOnce(late.promise);
		vi.stubGlobal('fetch', fetch);
		const { auth, signal } = fixture();
		try {
			await auth.refresh();
			const pending = auth.refresh();
			expect(auth.checking.value).toBe(true);
			auth.expire();
			late.resolve(Response.json(signedIn));
			await pending;
			expect(auth.state.value).toEqual(signedOut);
			expect(auth.checking.value).toBe(false);
		} finally {
			signal.abort();
		}
	});

	it('登录响应中断时核对服务端会话，不重放认证请求', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(Response.json(signedOut))
			.mockRejectedValueOnce(new TypeError('connection interrupted'))
			.mockResolvedValueOnce(Response.json(signedIn));
		vi.stubGlobal('fetch', fetch);
		const { auth, signal } = fixture();
		try {
			await auth.refresh();
			await expect(
				auth.signIn({ username: account.username, password: 'fixture password' }, signal.signal),
			).rejects.toThrow('connection interrupted');
			expect(auth.state.value).toEqual(signedIn);
			expect(fetch.mock.calls.map(([, options]) => options?.method ?? 'GET')).toEqual(['GET', 'POST', 'GET']);
		} finally {
			signal.abort();
		}
	});

	it('取消旧视图读取后不交付迟到的账户状态', async () => {
		const late = Promise.withResolvers<Response>();
		vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockReturnValue(late.promise));
		const { auth, signal } = fixture();
		const view = new AbortController();
		try {
			const pending = auth.refresh(view.signal);
			view.abort();
			late.resolve(Response.json(signedIn));
			await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
			expect(auth.state.value).toBeUndefined();
			expect(auth.checking.value).toBe(false);
		} finally {
			signal.abort();
		}
	});
});
