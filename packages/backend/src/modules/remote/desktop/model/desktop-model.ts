import type { TrustedDesktopTarget } from '../../../targets/public.js';
import {
	DesktopTransportFailure,
	type DesktopTransport,
	type DesktopTransportRequest,
	type DesktopTransportPeer,
} from '../../../../platform/desktop/desktop-port.js';
import type { DesktopConnection, DesktopDisplay, DesktopPeer } from './desktop-types.js';
import type WebSocket from 'ws';
import { DesktopFailure } from '../desktop-errors.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';

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
	};
}

/** Protocol/technical handles are captured here, never handed to Service. */
export class DesktopModel {
	constructor(
		private readonly transport: DesktopTransport,
		private readonly tokens: SessionTokens,
	) {}

	issueTicket(): string {
		try {
			return this.tokens.issue();
		} catch (cause) {
			throw new DesktopFailure('remote_unavailable', { cause });
		}
	}

	digestToken(token: string): string {
		try {
			return this.tokens.digest(token);
		} catch (cause) {
			throw new DesktopFailure('remote_unavailable', { cause });
		}
	}

	createPeer(socket: WebSocket): DesktopPeer {
		let transportPeer: DesktopTransportPeer;
		try {
			transportPeer = this.transport.bind(socket);
		} catch (cause) {
			throw new DesktopFailure('remote_unavailable', { cause });
		}
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

			open: async (connection, _display, onTerminated) => {
				try {
					await transportPeer.open(toDesktopTransport(connection), onTerminated);
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

function toDesktopTransport(connection: DesktopConnection): DesktopTransportRequest {
	return {
		protocol: connection.protocol === 'RDP' ? 'rdp' : 'vnc',
		host: connection.host,
		port: connection.port,
		ignoreCertificate: true,
	};
}
