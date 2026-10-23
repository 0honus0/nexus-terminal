import {
	readRemoteFileOpenRequest,
	readRemoteFileOpenResponse,
	readRemoteFileCloseResponse,
	readRemoteFilePathRequest,
	readRemoteFileListResponse,
	readRemoteFileStatResponse,
	readRemoteFileErrorResponse,
} from '@nexus-terminal/shared/remote/files/http-codec';
import {
	REMOTE_FILE_MAX_REQUEST_BYTES,
	REMOTE_FILE_MAX_METADATA_BYTES,
} from '@nexus-terminal/shared/remote/files/values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { DirectoryBrowserFailure, type DirectoryEntry, type DirectoryResource } from '../model/directory-browser-types';

async function request<T>(
	method: 'POST' | 'DELETE',
	path: string,
	expectedStatus: number,
	decode: (value: unknown) => T,
	body?: unknown,
	signal?: AbortSignal,
): Promise<T> {
	let response;
	try {
		response = await requestJson({
			method,
			url: '/api/v1/remote/files/resources' + path,
			body,
			signal,
			maxRequestBytes: REMOTE_FILE_MAX_REQUEST_BYTES,
			maxResponseBytes: REMOTE_FILE_MAX_METADATA_BYTES + 1024,
		});
	} catch (cause) {
		throw new DirectoryBrowserFailure(cause instanceof HttpRequestFailure ? cause.code : 'request_failed', {
			cause,
		});
	}
	if (response.status >= 400) {
		let code;
		try {
			code = readRemoteFileErrorResponse(response.body).code;
		} catch (cause) {
			throw new DirectoryBrowserFailure('protocol_failure', { cause });
		}
		throw new DirectoryBrowserFailure(code);
	}
	try {
		if (response.status !== expectedStatus) {
			throw new Error('Unexpected directory response');
		}
		return decode(response.body);
	} catch (cause) {
		throw new DirectoryBrowserFailure('protocol_failure', { cause });
	}
}

export const directoryBrowserApi = {
	async open(targetId: number, signal: AbortSignal): Promise<DirectoryResource> {
		const result = await request(
			'POST',
			'',
			201,
			readRemoteFileOpenResponse,
			readRemoteFileOpenRequest({ targetId }),
			signal,
		);
		if (result.targetId !== targetId) {
			throw new DirectoryBrowserFailure('protocol_failure');
		}
		return { id: result.id, targetId: result.targetId };
	},

	async close(resource: DirectoryResource): Promise<void> {
		try {
			await request('DELETE', '/' + encodeURIComponent(resource.id), 200, readRemoteFileCloseResponse);
		} catch (cause) {
			if (!(cause instanceof DirectoryBrowserFailure && cause.code === 'not_found')) throw cause;
		}
	},

	async list(resource: DirectoryResource, path: string, signal: AbortSignal): Promise<DirectoryEntry[]> {
		const result = await request(
			'POST',
			'/' + encodeURIComponent(resource.id) + '/list',
			200,
			readRemoteFileListResponse,
			readRemoteFilePathRequest({ path }),
			signal,
		);
		const entries: DirectoryEntry[] = [];
		for (const entry of result.entries) {
			if (entry.info.kind === 'directory' || entry.info.kind === 'symlink') {
				entries.push({
					name: entry.name,
					path: (path === '/' ? '/' : path + '/') + entry.name,
					kind: entry.info.kind,
				});
			}
		}
		return entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
	},

	async checkDirectory(resource: DirectoryResource, path: string, signal: AbortSignal): Promise<void> {
		const result = await request(
			'POST',
			'/' + encodeURIComponent(resource.id) + '/stat',
			200,
			readRemoteFileStatResponse,
			readRemoteFilePathRequest({ path }),
			signal,
		);
		if (result.info.kind !== 'directory') {
			throw new DirectoryBrowserFailure('not_directory');
		}
	},
};
