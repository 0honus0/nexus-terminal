import {
	REMOTE_FILE_MAX_REQUEST_BYTES,
	REMOTE_FILE_MAX_RESPONSE_BYTES,
	type RemoteFileErrorCode,
} from '@nexus-terminal/shared/remote/files/values';
import type { RemoteFileInfo, RemoteFileResourceView } from '@nexus-terminal/shared/remote/files/model';
import {
	InvalidRemoteFilePayload,
	readRemoteFileCloseResponse,
	readRemoteFileErrorResponse,
	readRemoteFileListResponse,
	readRemoteFileOpenRequest,
	readRemoteFileOpenResponse,
	readRemoteFilePathRequest,
	readRemoteFileStatResponse,
	readRemoteFileTextResponse,
} from '@nexus-terminal/shared/remote/files/http-codec';

const ROOT = '/__next/api/v1/remote/files';

export class RemoteFilesRequestFailure extends Error {
	constructor(
		readonly code: RemoteFileErrorCode,
		options?: ErrorOptions,
	) {
		super(code, options);
	}
}

/** Enforce the wire limit while reading, before retaining an unbounded response body. */
async function receive(response: Response): Promise<unknown> {
	if (!response.body) {
		throw new RemoteFilesRequestFailure('remote_unavailable');
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) {
				break;
			}
			bytes += part.value.byteLength;
			if (bytes > REMOTE_FILE_MAX_RESPONSE_BYTES) {
				await reader.cancel().catch(() => undefined);
				throw new RemoteFilesRequestFailure('limit_exceeded');
			}
			chunks.push(part.value);
		}
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
		return decoded;
	} catch {
		throw new RemoteFilesRequestFailure('remote_unavailable');
	}
}

async function call(method: 'POST' | 'DELETE', path: string, input?: unknown, signal?: AbortSignal): Promise<unknown> {
	const body = input === undefined ? undefined : JSON.stringify(input);
	if (body !== undefined && new TextEncoder().encode(body).byteLength > REMOTE_FILE_MAX_REQUEST_BYTES) {
		throw new RemoteFilesRequestFailure('limit_exceeded');
	}
	let response: Response;
	try {
		response = await fetch(ROOT + path, {
			method,
			credentials: 'same-origin',
			cache: 'no-store',
			signal,
			...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body }),
		});
	} catch {
		throw new RemoteFilesRequestFailure('remote_unavailable');
	}
	let value: unknown;
	try {
		value = await receive(response);
	} catch (error) {
		if (error instanceof RemoteFilesRequestFailure) {
			throw error;
		}
		throw new RemoteFilesRequestFailure('remote_unavailable', { cause: error });
	}
	if (!response.ok) {
		try {
			const decoded = readRemoteFileErrorResponse(value);
			throw new RemoteFilesRequestFailure(decoded.code);
		} catch (error) {
			if (error instanceof InvalidRemoteFilePayload) {
				throw new RemoteFilesRequestFailure('remote_unavailable', { cause: error });
			}
			throw error;
		}
	}
	return value;
}

/** Ordinary Remote Files do not share mutable state or cached content with PTY. */
export function createRemoteFilesApi() {
	return {
		open: async (targetId: number, signal?: AbortSignal): Promise<RemoteFileResourceView> =>
			readRemoteFileOpenResponse(
				await call('POST', '/resources', readRemoteFileOpenRequest({ targetId }), signal),
			),

		close: async (id: string): Promise<void> => {
			readRemoteFileCloseResponse(await call('DELETE', '/resources/' + encodeURIComponent(id)));
		},

		list: async (id: string, path: string, signal?: AbortSignal) =>
			readRemoteFileListResponse(
				await call(
					'POST',
					'/resources/' + encodeURIComponent(id) + '/list',
					readRemoteFilePathRequest({ path }),
					signal,
				),
			),

		stat: async (id: string, path: string, signal?: AbortSignal): Promise<RemoteFileInfo> =>
			readRemoteFileStatResponse(
				await call(
					'POST',
					'/resources/' + encodeURIComponent(id) + '/stat',
					readRemoteFilePathRequest({ path }),
					signal,
				),
			).info,

		lstat: async (id: string, path: string, signal?: AbortSignal): Promise<RemoteFileInfo> =>
			readRemoteFileStatResponse(
				await call(
					'POST',
					'/resources/' + encodeURIComponent(id) + '/lstat',
					readRemoteFilePathRequest({ path }),
					signal,
				),
			).info,

		readText: async (id: string, path: string, signal?: AbortSignal) =>
			readRemoteFileTextResponse(
				await call(
					'POST',
					'/resources/' + encodeURIComponent(id) + '/read-text',
					readRemoteFilePathRequest({ path }),
					signal,
				),
			),
	};
}
