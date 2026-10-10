import { REMOTE_FILE_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/remote/files/values';
import type { RemoteFileResourceView, RemoteFileInfo } from '@nexus-terminal/shared/remote/files/model';
import { readRemoteFileOpenRequest, readRemoteFilePathRequest, readRemoteFileOpenResponse,
	readRemoteFileListResponse, readRemoteFileStatResponse, readRemoteFileTextResponse,
	readRemoteFileCloseResponse, readRemoteFileErrorResponse } from '@nexus-terminal/shared/remote/files/http-codec';

const ROOT = '/__next/api/v1/remote/files';

async function call(method: 'POST' | 'DELETE', path: string, input?: unknown, signal?: AbortSignal): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(ROOT + path, { method, credentials: 'same-origin', cache: 'no-store', signal,
			...(input === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)}) });
	} catch { throw new Error('remote_unavailable'); }
	let content: string;
	try { content = await response.text(); }
	catch { throw new Error('remote_unavailable'); }
	if (new TextEncoder().encode(content).byteLength > REMOTE_FILE_MAX_RESPONSE_BYTES)
		throw new Error('limit_exceeded');
	let value: unknown;
	try { value = JSON.parse(content) as unknown; } catch { throw new Error('remote_unavailable'); }
	if (!response.ok) {
		try { throw new Error(readRemoteFileErrorResponse(value).code); }
		catch (error) {
			if (error instanceof Error && error.message === 'invalid_remote_file_payload')
				throw new Error('remote_unavailable');
			throw error;
		}
	}
	return value;
}

/** No PTY state, retry or cached file content is shared with this file API. */
export function createRemoteFilesApi() {
	return {
		open: async (targetId: number, signal?: AbortSignal): Promise<RemoteFileResourceView> =>
			readRemoteFileOpenResponse(await call('POST','/resources',readRemoteFileOpenRequest({targetId}),signal)),
		close: async (id: string): Promise<void> => {
			readRemoteFileCloseResponse(await call('DELETE','/resources/'+encodeURIComponent(id)));
		},
		list: async (id: string, path: string, signal?: AbortSignal) =>
			readRemoteFileListResponse(await call('POST','/resources/'+encodeURIComponent(id)+'/list',readRemoteFilePathRequest({path}),signal)),
		stat: async (id: string, path: string, signal?: AbortSignal): Promise<RemoteFileInfo> =>
			readRemoteFileStatResponse(await call('POST','/resources/'+encodeURIComponent(id)+'/stat',readRemoteFilePathRequest({path}),signal)).info,
		lstat: async (id: string, path: string, signal?: AbortSignal): Promise<RemoteFileInfo> =>
			readRemoteFileStatResponse(await call('POST','/resources/'+encodeURIComponent(id)+'/lstat',readRemoteFilePathRequest({path}),signal)).info,
		readText: async (id: string, path: string, signal?: AbortSignal) =>
			readRemoteFileTextResponse(await call('POST','/resources/'+encodeURIComponent(id)+'/read-text',readRemoteFilePathRequest({path}),signal)),
	};
}
