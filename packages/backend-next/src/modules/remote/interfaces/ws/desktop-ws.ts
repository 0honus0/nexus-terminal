import type { HttpWebSocketRoute } from '../../../../platform/http/http-types.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { readRemoteDesktopTicket, InvalidRemoteDesktopPayload } from '@nexus-terminal/shared/remote/desktop/http-codec';
import type { AccessPublicApi } from '../../../access/public.js';
import type { DesktopService } from '../../desktop/service/desktop-service.js';
import type { DesktopModel } from '../../desktop/model/desktop-model.js';

export function createDesktopWebSocketRoute(
	access: AccessPublicApi,
	service: DesktopService,
	model: DesktopModel,
): HttpWebSocketRoute {
	return {
		path: '/ws/remote-desktop',

		async authorize(request, url) {
			try {
				readRemoteDesktopTicket(url.searchParams);
			} catch (error) {
				if (error instanceof InvalidRemoteDesktopPayload) {
					return false;
				}
				throw error;
			}
			const token = readRequestCookie(request, 'nexus_session');
			const identity = token ? await access.authenticate(token) : null;
			return identity?.userId === 1;
		},

		connectedRaw(socket, request, url) {
			const ticket = readRemoteDesktopTicket(url.searchParams);
			return service.accept(
				readRequestCookie(request, 'nexus_session'),
				ticket,
				model.createPeer(socket, request),
			);
		},
	};
}
