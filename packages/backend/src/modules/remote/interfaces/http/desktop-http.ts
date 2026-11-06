import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { RemoteDesktopProtocol } from '@nexus-terminal/shared/remote/desktop/values';
import { REMOTE_DESKTOP_RESPONSE_MAX_BYTES } from '@nexus-terminal/shared/remote/desktop/values';
import type {
	RemoteDesktopSessionResponse,
	RemoteDesktopFailureResponse,
} from '@nexus-terminal/shared/remote/desktop/http';
import {
	readRemoteDesktopDisplay,
	readRemoteDesktopSessionPath,
	readRemoteDesktopSessionRequest,
	readRemoteDesktopFailureResponse,
	InvalidRemoteDesktopPayload,
} from '@nexus-terminal/shared/remote/desktop/http-codec';
import type { DesktopService } from '../../desktop/service/desktop-service.js';
import { DesktopCertificateRequired, DesktopFailure } from '../../desktop/desktop-errors.js';

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
		case 'certificate_required':
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
		bodyLimit: REMOTE_DESKTOP_RESPONSE_MAX_BYTES,
		url: `/api/v1/connections/:id/${protocol === 'RDP' ? 'rdp-session' : 'vnc-session'}`,

		async handler(request: HttpRequest, reply: HttpReply): Promise<void> {
			const controller = new AbortController();
			const socket = reply.raw.socket;
			let pendingTicket: string | null = null;

			const detachResponse = () => {
				reply.raw.off('close', onClose);
				reply.raw.off('finish', onFinish);
			};

			const onFinish = () => {
				if (
					pendingTicket !== null &&
					(reply.raw.statusCode !== 200 ||
						reply.raw.destroyed ||
						socket?.destroyed === true ||
						request.raw.aborted)
				) {
					service.discard(pendingTicket);
				}
				pendingTicket = null;
				detachResponse();
			};

			const abort = () => controller.abort();

			request.raw.once('aborted', abort);

			const onClose = () => {
				if (!reply.raw.writableFinished) {
					abort();
					if (pendingTicket !== null) {
						service.discard(pendingTicket);
						pendingTicket = null;
					}
				}
				detachResponse();
			};

			reply.raw.once('close', onClose);
			reply.raw.once('finish', onFinish);
			try {
				const hasBody =
					request.raw.headers['transfer-encoding'] ||
					(request.raw.headers['content-length'] && request.raw.headers['content-length'] !== '0');
				const input = hasBody ? readRemoteDesktopSessionRequest(request.body) : { certificate: null };
				const display = readRemoteDesktopDisplay(request.query);
				const { id: targetId } = readRemoteDesktopSessionPath(request.params);
				const result = await service.issue(
					readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
					targetId,
					protocol,
					{
						width: display.width ?? null,
						height: display.height ?? null,
						dpi: display.dpi ?? null,
					},
					controller.signal,
					input.certificate === null
						? null
						: {
								host: input.certificate.host,
								port: input.certificate.port,
								fingerprint: input.certificate.fingerprint,
								previousFingerprint: input.certificate.previousFingerprint,
								remember: input.certificate.remember,
							},
				);
				if (!controller.signal.aborted && !reply.raw.destroyed && !reply.raw.writableEnded) {
					const response: RemoteDesktopSessionResponse = {
						ticket: result.ticket,
						protocol: result.connection.protocol,
						host: result.connection.host,
						port: result.connection.port,
						username: result.connection.username ?? '',
						password: result.connection.password,
					};
					pendingTicket = result.ticket;
					try {
						reply.code(200).headers({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }).send(response);
					} catch (error) {
						service.discard(result.ticket);
						pendingTicket = null;
						throw error;
					}
				} else {
					service.discard(result.ticket);
				}
			} catch (error) {
				if (controller.signal.aborted || reply.raw.destroyed) {
					return;
				}
				if (error instanceof HttpInputFailure) {
					throw error;
				}
				if (error instanceof DesktopCertificateRequired) {
					const certificate = error.certificate;
					const body: RemoteDesktopFailureResponse = {
						code: 'certificate_required',
						certificate: {
							connectionId: certificate.targetId,
							host: certificate.host,
							port: certificate.port,
							fingerprint: certificate.fingerprint,
							previousFingerprint: certificate.previousFingerprint,
							subject: certificate.subject,
							issuer: certificate.issuer,
							validFrom: certificate.validFrom,
							validTo: certificate.validTo,
							reason: certificate.reason,
						},
					};
					// Includes the full encoded certificate projection in the existing response budget.
					try {
						readRemoteDesktopFailureResponse(body);
					} catch {
						reply.code(503).send({ code: 'remote_unavailable' } satisfies RemoteDesktopFailureResponse);
						return;
					}
					reply.code(409).headers({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }).send(body);
					return;
				}
				const code =
					error instanceof InvalidRemoteDesktopPayload
						? 'invalid_input'
						: error instanceof DesktopFailure && error.code !== 'certificate_required'
							? error.code
							: 'remote_unavailable';
				const body: RemoteDesktopFailureResponse = { code };
				reply.code(status(code)).send(body);
			} finally {
				request.raw.off('aborted', abort);
				// send() queues bytes; retain revocation until actual finish or close.
				if (reply.raw.writableFinished) {
					onFinish();
				} else if (reply.raw.destroyed) {
					onClose();
				} else if (pendingTicket === null) {
					detachResponse();
				}
			}
		},
	};
}

export function createDesktopHttpRoutes(service: DesktopService): HttpRoute[] {
	return [ticketRoute('RDP', service), ticketRoute('VNC', service)];
}
