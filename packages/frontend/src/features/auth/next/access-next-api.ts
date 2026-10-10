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

const ACCESS_NEXT_RESPONSE_MAX_BYTES = 16 * 1024;

function requestFailure(): Error {
	return new Error('request_failed');
}

async function readBoundedJson(response: Response): Promise<unknown> {
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		if (!/^(0|[1-9][0-9]*)$/u.test(declared)) {
			throw requestFailure();
		}
		const bytes = Number(declared);
		if (!Number.isSafeInteger(bytes) || bytes > ACCESS_NEXT_RESPONSE_MAX_BYTES) {
			throw requestFailure();
		}
	}

	const reader = response.body?.getReader();
	if (!reader) {
		throw requestFailure();
	}
	const chunks: Uint8Array[] = [];
	let received = 0;
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			received += result.value.byteLength;
			if (received > ACCESS_NEXT_RESPONSE_MAX_BYTES) {
				try {
					await reader.cancel();
				} catch {
					// The response already exceeds the public budget.
				}
				throw requestFailure();
			}
			chunks.push(result.value);
		}
	} catch (error) {
		if (error instanceof Error && error.message === 'request_failed') {
			throw error;
		}
		throw requestFailure();
	} finally {
		reader.releaseLock();
	}
	const payload = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		payload.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) as unknown;
	} catch {
		throw requestFailure();
	}
}

/** backend-next authentication owner shared by isolated development consumers. */
export function createAccessNextApi(baseUrl: string) {
	const origin = new URL(baseUrl, window.location.href);
	if (origin.origin !== window.location.origin || origin.pathname !== '/__next/' || origin.search || origin.hash) {
		throw requestFailure();
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
			throw requestFailure();
		}
		const value = await readBoundedJson(response);
		if (!response.ok) {
			try {
				const failure = readAccessHttpError(value);
				throw new Error(failure.code);
			} catch (error) {
				if (error instanceof InvalidAccessPayload) {
					throw requestFailure();
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
				throw requestFailure();
			}
			throw error;
		}
	}

	return {
		needsSetup: async (signal?: AbortSignal): Promise<boolean> =>
			decoded(await request('GET', '/needs-setup', undefined, signal), readAccessNeedsSetup).needsSetup,

		setup: async (input: AccessSetupRequest, signal?: AbortSignal): Promise<void> => {
			decoded(await request('POST', '/setup', readAccessSetupRequest(input), signal), readAccessSetup);
		},

		login: async (input: AccessLoginRequest, signal?: AbortSignal): Promise<void> => {
			decoded(await request('POST', '/login', readAccessLoginRequest(input), signal), readAccessLogin);
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

		logout: async (signal?: AbortSignal): Promise<void> => {
			decoded(await request('POST', '/logout', {}, signal), readAccessLogout);
		},

		changePassword: async (input: AccessPasswordRequest, signal?: AbortSignal): Promise<void> => {
			decoded(await request('PUT', '/password', readAccessPasswordRequest(input), signal), readAccessPassword);
		},
	};
}

export type AccessNextApi = ReturnType<typeof createAccessNextApi>;
