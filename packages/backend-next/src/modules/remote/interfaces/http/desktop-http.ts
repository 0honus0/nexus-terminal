import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { RemoteDesktopProtocol } from '@nexus-terminal/shared/remote/desktop/values';
import type {
	RemoteDesktopSessionResponse,
	RemoteDesktopFailureResponse,
} from '@nexus-terminal/shared/remote/desktop/http';
import {
	readRemoteDesktopDisplay,
	readRemoteDesktopSessionPath,
	InvalidRemoteDesktopPayload,
} from '@nexus-terminal/shared/remote/desktop/http-codec';
import type { DesktopService } from '../../desktop/service/desktop-service.js';
import { DesktopFailure } from '../../desktop/desktop-errors.js';

function status(code: DesktopFailure['code']): number {
	switch (code) {
		case 'invalid_input':
			return 400;
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
			return 404;
		case 'conflict':
			return 409;
		case 'limit_exceeded':
			return 429;
		case 'operation_unknown':
		case 'remote_unavailable':
			return 503;
	}
}

function ticketRoute(protocol: RemoteDesktopProtocol, service: DesktopService): HttpRoute {
	return {
		method: 'POST',
		path: `/api/v1/connections/:id/${protocol === 'RDP' ? 'rdp-session' : 'vnc-session'}`,

		async handle(ctx: HttpRouteContext): Promise<void> {
			const controller = new AbortController();

			const abort = () => controller.abort();

			ctx.request.once('aborted', abort);

			const onClose = () => {
				if (!ctx.response.writableEnded) {
					abort();
				}
			};

			ctx.response.once('close', onClose);
			try {
				if (
					ctx.request.headers['transfer-encoding'] ||
					(ctx.request.headers['content-length'] && ctx.request.headers['content-length'] !== '0')
				) {
					throw new InvalidRemoteDesktopPayload();
				}
				const display = readRemoteDesktopDisplay(ctx.query);
				const { id: targetId } = readRemoteDesktopSessionPath(ctx.params);
				const result = await service.issue(
					ctx.cookie('nexus_session'),
					targetId,
					protocol,
					{
						width: display.width ?? null,
						height: display.height ?? null,
						dpi: display.dpi ?? null,
					},
					controller.signal,
				);
				if (!controller.signal.aborted && !ctx.response.destroyed && !ctx.response.writableEnded) {
					const response: RemoteDesktopSessionResponse = {
						ticket: result.ticket,
						lastConnectedAt: result.lastConnectedAt,
					};
					try {
						ctx.send(200, response);
					} catch (error) {
						service.discard(result.ticket);
						throw error;
					}
				} else {
					service.discard(result.ticket);
				}
			} catch (error) {
				if (controller.signal.aborted || ctx.response.destroyed) {
					return;
				}
				if (error instanceof HttpInputFailure) {
					throw error;
				}
				const code =
					error instanceof InvalidRemoteDesktopPayload
						? 'invalid_input'
						: error instanceof DesktopFailure
							? error.code
							: 'remote_unavailable';
				const body: RemoteDesktopFailureResponse = { code };
				ctx.send(status(code), body);
			} finally {
				ctx.request.off('aborted', abort);
				ctx.response.off('close', onClose);
			}
		},
	};
}

export function createDesktopHttpRoutes(service: DesktopService): HttpRoute[] {
	return [ticketRoute('RDP', service), ticketRoute('VNC', service)];
}
