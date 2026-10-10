import {
	InvalidAccessPayload,
	readAccessLogin,
	readAccessLogout,
	readAccessNeedsSetup,
	readAccessSetup,
	readAccessStatus,
	readAccessPassword,
	readAccessHttpError,
	readAccessSetupRequest,
	readAccessLoginRequest,
	readAccessPasswordRequest,
	type AccessLoginRequest,
	type AccessPasswordRequest,
	type AccessSetupRequest,
	type AccessStatusResponse,
} from '@nexus-terminal/shared/access/http';

/** Authentication is a separate client owner, not part of Targets CRUD. */
export function createAccessNextApi(baseUrl: string) {
	const origin = new URL(baseUrl, window.location.href);
	if (origin.origin !== window.location.origin || origin.pathname !== '/__next/' || origin.search || origin.hash) {
		throw new Error('request_failed');
	}
	const base = origin.origin + '/__next/api/v1/auth';

	async function request(
		method: 'GET' | 'POST' | 'PUT',
		path: string,
		body?: unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		let response: Response;
		try {
			response = await fetch(base + path, {
				method,
				credentials: 'same-origin',
				cache: 'no-store',
				signal,
				headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
		} catch (error) {
			if (signal?.aborted) {
				throw error;
			}
			throw new Error('request_failed');
		}
		let value: unknown;
		try {
			value = (await response.json()) as unknown;
		} catch {
			throw new Error('request_failed');
		}
		if (!response.ok) {
			try {
				const failure = readAccessHttpError(value);
				throw new Error(failure.code);
			} catch (error) {
				if (error instanceof InvalidAccessPayload) {
					throw new Error('request_failed');
				}
				throw error;
			}
		}
		return value;
	}

	function decoded<T>(value: unknown, decode: (input: unknown) => T): T {
		try {
			return decode(value);
		} catch (error) {
			if (error instanceof InvalidAccessPayload) {
				throw new Error('request_failed');
			}
			throw error;
		}
	}

	return {
		needsSetup: async (signal?: AbortSignal): Promise<boolean> =>
			decoded(await request('GET', '/needs-setup', undefined, signal), readAccessNeedsSetup).needsSetup,

		setup: async (input: AccessSetupRequest): Promise<void> => {
			decoded(await request('POST', '/setup', readAccessSetupRequest(input)), readAccessSetup);
		},

		login: async (input: AccessLoginRequest): Promise<void> => {
			decoded(await request('POST', '/login', readAccessLoginRequest(input)), readAccessLogin);
		},

		status: async (signal?: AbortSignal): Promise<AccessStatusResponse | null> => {
			try {
				return decoded(await request('GET', '/status', undefined, signal), readAccessStatus);
			} catch (error) {
				if (error instanceof Error && error.message === 'unauthenticated') {
					return null;
				}
				throw error;
			}
		},

		logout: async (): Promise<void> => {
			decoded(await request('POST', '/logout', {}), readAccessLogout);
		},

		changePassword: async (input: AccessPasswordRequest): Promise<void> => {
			decoded(await request('PUT', '/password', readAccessPasswordRequest(input)), readAccessPassword);
		},
	};
}
