import {
	readRemoteDesktopDisplay,
	readRemoteDesktopSessionPath,
	readRemoteDesktopSessionResponse,
	readRemoteDesktopFailureResponse,
} from '@nexus-terminal/shared/remote/desktop/http-codec';
import { REMOTE_DESKTOP_RESPONSE_MAX_BYTES } from '@nexus-terminal/shared/remote/desktop/values';
import type { RemoteDesktopErrorCode } from '@nexus-terminal/shared/remote/desktop/values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { toDisplayRequest, toSession } from '../model/remote-desktop-mapper';
import { RemoteDesktopFailure, type RemoteDesktopApi } from '../model/remote-desktop-types';

function matchesStatus(code: RemoteDesktopErrorCode, status: number): boolean {
	switch (code) {
		case 'invalid_input':
			return status === 400;
		case 'unauthenticated':
			return status === 401;
		case 'forbidden':
			return status === 403;
		case 'not_found':
			return status === 404;
		case 'conflict':
			return status === 409;
		case 'limit_exceeded':
			return status === 413 || status === 429;
		case 'remote_unavailable':
		case 'operation_unknown':
			return status === 503;
	}
}

export const remoteDesktopApi: RemoteDesktopApi = {
	async create(connectionId, protocol, display, signal) {
		let query: URLSearchParams;
		try {
			readRemoteDesktopSessionPath({ id: String(connectionId) });
			if (!Number.isSafeInteger(connectionId) || (protocol !== 'RDP' && protocol !== 'VNC')) {
				throw new RemoteDesktopFailure('invalid_input', 'not_dispatched');
			}
			const request = toDisplayRequest(display);
			query = new URLSearchParams({
				width: String(request.width),
				height: String(request.height),
				dpi: String(request.dpi),
			});
			readRemoteDesktopDisplay(query);
		} catch (cause) {
			throw new RemoteDesktopFailure('invalid_input', 'not_dispatched', { cause });
		}
		const path = protocol === 'RDP' ? 'rdp-session' : 'vnc-session';
		let response;
		try {
			response = await requestJson({
				method: 'POST',
				url: '/api/v1/connections/' + connectionId + '/' + path + '?' + query,
				maxRequestBytes: 1,
				maxResponseBytes: REMOTE_DESKTOP_RESPONSE_MAX_BYTES,
				signal,
			});
		} catch (cause) {
			if (cause instanceof HttpRequestFailure) {
				throw new RemoteDesktopFailure(cause.code, cause.outcome, { cause });
			}
			throw new RemoteDesktopFailure('request_failed', 'unknown', { cause });
		}
		try {
			if (response.status === 200) {
				return toSession(readRemoteDesktopSessionResponse(response.body));
			}
			const failure = readRemoteDesktopFailureResponse(response.body);
			if (!matchesStatus(failure.code, response.status)) {
				throw new RemoteDesktopFailure('protocol_failure', 'unknown');
			}
			throw new RemoteDesktopFailure(
				failure.code,
				failure.code === 'operation_unknown' ? 'unknown' : 'confirmed',
			);
		} catch (cause) {
			if (cause instanceof RemoteDesktopFailure) throw cause;
			throw new RemoteDesktopFailure('protocol_failure', 'unknown', { cause });
		}
	},
};
