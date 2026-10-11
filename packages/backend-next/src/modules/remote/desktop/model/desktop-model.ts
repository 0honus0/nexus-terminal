import type { TrustedDesktopTarget } from '../../../targets/public.js';
import {
	DesktopTransportFailure,
	type DesktopTransport,
	type DesktopTransportRequest,
} from '../../../../platform/desktop/desktop-port.js';
import type { DesktopConnection, DesktopDisplay, DesktopPeer } from './desktop-types.js';
import type { IncomingMessage } from 'node:http';
import type WebSocket from 'ws';
import { DesktopFailure } from '../desktop-errors.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';

/** Targets public → Remote application fact: do not spread a trusted secret DTO. */
export function toDesktopConnection(source: TrustedDesktopTarget): DesktopConnection {
	if (!source.password) {
		throw new DesktopFailure('invalid_input');
	}
	return {
		protocol: source.protocol,
		host: source.host,
		port: source.port,
		username: source.username || null,
		password: source.password,
		rdpRemoteApp: source.rdpRemoteApp,
		rdpRemoteAppDirectory: source.rdpRemoteAppDirectory,
		rdpRemoteAppArguments: source.rdpRemoteAppArguments,
	};
}

/** Protocol/technical handles are captured here, never handed to Service. */
export class DesktopModel {
	constructor(private readonly transport: DesktopTransport) {}

	createPeer(socket: WebSocket, request: IncomingMessage): DesktopPeer {
		return {
			get isOpen() {
				return socket.readyState === socket.OPEN;
			},

			get isClosed() {
				return socket.readyState === socket.CLOSED;
			},

			onClosed: (listener) => {
				socket.once('close', listener);
			},

			requestClose: (reason) => {
				if (socket.readyState === socket.OPEN) {
					const code = reason === 'limit_exceeded' ? 1013 : reason === 'invalid_input' ? 1008 : 1011;
					socket.close(code, reason);
				}
			},

			disconnect: () => {
				if (socket.readyState !== socket.CLOSED) {
					socket.terminate();
				}
			},

			waitClosed: (timeoutMs) => {
				if (socket.readyState === socket.CLOSED) {
					return Promise.resolve();
				}
				return new Promise<void>((resolve, reject) => {
					const closed = () => {
						clearTimeout(timer);
						socket.off('close', closed);
						resolve();
					};

					const timer = setTimeout(() => {
						socket.off('close', closed);
						reject(new DesktopFailure('operation_unknown'));
					}, timeoutMs);
					timer.unref();
					socket.once('close', closed);
					if (socket.readyState === socket.CLOSED) {
						closed();
					}
				});
			},

			open: async (connection, display, onTerminated) => {
				try {
					await this.transport.open(socket, request, toDesktopTransport(connection, display), onTerminated);
				} catch (cause) {
					if (cause instanceof DesktopTransportFailure && cause.reason === 'cleanup_failed') {
						throw new RemoteResourceCleanupFailure([cause]);
					}
					throw new DesktopFailure('remote_unavailable', { cause });
				}
			},
		};
	}

	async close(): Promise<void> {
		try {
			await this.transport.close();
		} catch (cause) {
			throw new RemoteResourceCleanupFailure([cause]);
		}
	}
}

/** Application → technical adapter, with explicitly named Guacamole defaults. */
function toDesktopTransport(connection: DesktopConnection, display: DesktopDisplay): DesktopTransportRequest {
	return {
		protocol: connection.protocol === 'RDP' ? 'rdp' : 'vnc',
		host: connection.host,
		port: connection.port,
		username: connection.username,
		password: connection.password,
		width: display.width ?? 1024,
		height: display.height ?? 768,
		dpi: display.dpi ?? 96,
		security: 'any',
		ignoreCertificate: true,
		resizeMethod: 'display-update',
		remoteApp: connection.protocol === 'RDP' ? connection.rdpRemoteApp : null,
		remoteAppDirectory: connection.protocol === 'RDP' ? connection.rdpRemoteAppDirectory : null,
		remoteAppArguments: connection.protocol === 'RDP' ? connection.rdpRemoteAppArguments : null,
	};
}
