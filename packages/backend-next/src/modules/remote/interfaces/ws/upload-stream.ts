import type { IncomingMessage } from 'node:http';
import type { AccessPublicApi } from '../../../access/public.js';
import type { HttpWebSocketRoute, HttpWebSocketChannel } from '../../../../platform/http/http-types.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { RemoteFileService } from '../../files/service/file-service.js';
import type { WorkspaceUploadStream } from '@nexus-terminal/shared/remote/transfers/workspace';
import { WORKSPACE_UPLOAD_MAX_CHUNK_BYTES } from '@nexus-terminal/shared/remote/transfers/values';
import { readWorkspaceUploadStream } from '@nexus-terminal/shared/remote/transfers/workspace-codec';

function streamParams(url: URL): WorkspaceUploadStream | null {
	try {
		return readWorkspaceUploadStream(url.searchParams);
	} catch {
		return null;
	}
}

/** Dedicated upload binary channel: no other Workspace or PTY route accepts binary input. */
export function createUploadStreamRoute(access: AccessPublicApi, files: RemoteFileService): HttpWebSocketRoute {
	return {
		path: '/ws/uploads',
		maxBinaryMessageBytes: WORKSPACE_UPLOAD_MAX_CHUNK_BYTES,

		async authorize(request: IncomingMessage, url: URL) {
			if (!streamParams(url)) {
				return false;
			}
			const token = readRequestCookie(request, 'nexus_session');
			const identity = token ? await access.authenticate(token) : null;
			return identity?.userId === 1;
		},

		connected(channel: HttpWebSocketChannel, request: IncomingMessage, url: URL) {
			const params = streamParams(url);
			const token = readRequestCookie(request, 'nexus_session');
			const attachment = params
				? files.claimUploadStream(token, params.workspaceId, params.uploadId, params.size)
				: null;
			if (!params || !attachment) {
				channel.close(1008, 'Invalid upload request');
				return;
			}
			let lastReceived = false;

			const abortUpload = () => {
				if (!lastReceived) {
					// Closing the byte transport is not evidence that remote writes
					// were rolled back. Service owns the staged-file cleanup and
					// classifies an unconfirmed mutation as unknown.
					attachment.abort();
				}
			};

			channel.onClose(async () => {
				abortUpload();
			});
			channel.onMessage(async () => {
				channel.close(1003, 'Upload stream only accepts binary');
			});
			channel.onBinary(async (bytes) => {
				if (lastReceived || (bytes.byteLength === 0 && params.size > 0)) {
					channel.close(1003, 'Invalid upload chunk');
					return;
				}
				try {
					const finished = await attachment.append(bytes);
					if (finished) {
						lastReceived = true;
						channel.close(1000, 'Upload complete');
					}
				} catch {
					channel.close(1011, 'Upload append failed');
				}
			});
		},
	};
}
