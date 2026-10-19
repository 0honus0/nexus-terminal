import {
	readDownloadTicketRequest,
	readDownloadTicketResponse,
	readWorkspaceTransferHttpError,
} from '@nexus-terminal/shared/remote/transfers/http-codec';
import { WORKSPACE_DOWNLOAD_MAX_JSON_BYTES } from '@nexus-terminal/shared/remote/transfers/values';
import type { WorkspaceTransferHttpError } from '@nexus-terminal/shared/remote/transfers/http';
import { WORKSPACE_ERROR_CODES } from '@nexus-terminal/shared/remote/workspace/values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { FilesystemFailure, type FilesystemDownloadPort } from '@/features/filesystem/public';

interface WorkspaceDownloadPort extends FilesystemDownloadPort {
	disconnect(): void;
	dispose(): void;
}

function failureStatus(error: WorkspaceTransferHttpError): number {
	if ('code' in error) {
		switch (error.code) {
			case 'shutting_down':
				return 503;
			case 'internal_failure':
				return 500;
			case 'body_too_large':
				return 413;
			case 'unsupported_media_type':
				return 415;
			case 'csrf_rejected':
			case 'forbidden':
				return 403;
			case 'not_found':
				return 404;
			case 'invalid_json':
			case 'invalid_body':
			case 'invalid_host':
			case 'invalid_path':
				return 400;
			default:
				return 0;
		}
	}
	switch (error.message) {
		case 'invalid_input':
		case 'not_text':
			return 400;
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
			return 404;
		case 'limit_exceeded':
			return 429;
		case 'stale_target':
		case 'host_key_untrusted':
		case 'conflict':
		case 'operation_unknown':
		case 'remote_unavailable':
			return 503;
		case 'internal_failure':
			return 500;
		default:
			return 0;
	}
}

/** Owns ticket requests for one attachment; browser download delivery remains browser-owned. */
export function createFilesystemDownloadPort(
	workspaceId: string,
	connectionId: number,
	canUse: () => boolean,
): WorkspaceDownloadPort {
	let lifetime = new AbortController();
	let disposed = false;

	const disconnect = (): void => {
		lifetime.abort();
		lifetime = new AbortController();
	};

	return {
		async createDownload(path, kind, signal) {
			const original = lifetime;
			const cancelled = signal ? AbortSignal.any([signal, original.signal]) : original.signal;

			const checkCurrent = (): void => {
				if (disposed || cancelled.aborted || original !== lifetime || !canUse()) {
					throw new FilesystemFailure('not_connected', false);
				}
			};

			checkCurrent();
			let request;
			try {
				request = readDownloadTicketRequest({ connectionId, sessionId: workspaceId, remotePath: path });
			} catch (cause) {
				throw new FilesystemFailure('invalid_input', false, { cause });
			}
			if (kind === 'directory') {
				const query = new URLSearchParams({
					connectionId: String(request.connectionId),
					sessionId: workspaceId,
					remotePath: request.remotePath,
				});
				return { url: `/api/v1/sftp/download-directory?${query}` };
			}
			let response;
			try {
				response = await requestJson({
					method: 'POST',
					url: '/api/v1/sftp/download-ticket',
					body: request,
					maxRequestBytes: WORKSPACE_DOWNLOAD_MAX_JSON_BYTES,
					maxResponseBytes: WORKSPACE_DOWNLOAD_MAX_JSON_BYTES,
					signal: cancelled,
				});
			} catch (cause) {
				checkCurrent();
				const code =
					cause instanceof HttpRequestFailure && cause.code === 'protocol_failure'
						? 'protocol_error'
						: 'remote_unavailable';
				throw new FilesystemFailure(code, false, { cause });
			}
			checkCurrent();
			if (response.status === 201) {
				try {
					const ticket = readDownloadTicketResponse(response.body);
					// Explicit wire → application projection; never return the whole response.
					return { url: ticket.url };
				} catch (cause) {
					throw new FilesystemFailure('protocol_error', false, { cause });
				}
			}
			try {
				const error = readWorkspaceTransferHttpError(response.body);
				if (response.status !== failureStatus(error)) {
					throw new Error('Unexpected download status');
				}
				const message = 'message' in error ? error.message : error.code;
				for (const code of WORKSPACE_ERROR_CODES) {
					if (message === code) {
						throw new FilesystemFailure(code, false);
					}
				}
				throw new FilesystemFailure('remote_unavailable', false);
			} catch (cause) {
				if (cause instanceof FilesystemFailure) {
					throw cause;
				}
				throw new FilesystemFailure('protocol_error', false, { cause });
			}
		},

		disconnect,

		dispose() {
			disposed = true;
			disconnect();
		},
	};
}
