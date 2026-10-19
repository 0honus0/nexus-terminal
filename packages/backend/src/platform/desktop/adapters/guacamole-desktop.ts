import { createCipheriv, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import WebSocket from 'ws';
import GuacamoleLite from 'guacamole-lite';
import { DesktopTransportFailure, type DesktopTransport, type DesktopTransportRequest } from '../desktop-port.js';

interface GuacamoleSettings {
	connection?: Record<string, unknown>;
	[key: string]: unknown;
}

interface PendingSettings {
	socket: WebSocket;
	settings: Record<string, string | string[] | null>;
}

interface VendorConnection {
	webSocket: WebSocket;
	guacdClient?: { guacdConnection?: Socket };
}

interface ConnectionObserver {
	opened: (() => void) | null;
	closed(client: VendorConnection): void;
}

function isVendorConnection(value: unknown): value is VendorConnection {
	return typeof value === 'object' && value !== null && 'webSocket' in value && value.webSocket instanceof WebSocket;
}

/** A vendor 'close' event means destroy was requested, not necessarily that
 * guacd's TCP socket emitted close. The original Adapter retains this owner. */
function afterGuacdSocketClosed(socket: Socket | undefined, done: () => void): void {
	if (!socket || socket.closed) {
		done();
		return;
	}

	const ended = () => {
		socket.off('close', ended);
		done();
	};

	socket.once('close', ended);
	if (socket.closed) {
		ended();
	}
}

/** Third-party token syntax, settings and guacd handling live only here. */
export class GuacamoleDesktopAdapter implements DesktopTransport {
	private readonly server: GuacamoleLite;
	private readonly key = randomBytes(32);
	private readonly pending = new Map<string, PendingSettings>();
	private readonly observers = new Map<WebSocket, ConnectionObserver>();
	private closing: Promise<void> | null = null;
	private dispatch: Promise<void> = Promise.resolve();

	constructor(host: string, port: number) {
		if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
			throw new Error('Invalid guacd configuration');
		}
		this.server = new GuacamoleLite(
			{ server: undefined, noServer: true },
			{ host, port },
			{
				crypt: { key: this.key, cypher: 'aes-256-cbc' },
				connectionDefaultSettings: {},
				// Guacamole's default log callbacks can print technical errors
				// containing user-controlled settings. Never log those secrets.
				log: {
					level: 0,

					stdLog: () => undefined,

					errorLog: () => undefined,
				},
			},
			{ processConnectionSettings: (settings, callback) => this.resolveSettings(settings, callback) },
		);
		// guacamole-lite registers process signal handlers unconditionally.
		// Leave process shutdown exclusively with the application bootstrap,
		// so Remote Service can quiesce admission before technology teardown.
		process.removeListener('SIGTERM', this.server.sigTermHandler);
		process.removeListener('SIGINT', this.server.sigIntHandler);
		// A client error has a safe technical boundary; do not log Guacamole
		// settings or credentials contained in third-party exception bodies.
		this.server.on('error', () => undefined);
		// One listener per vendor event; connection observers remain bound to
		// their original socket until its actual termination is confirmed.
		this.server.on('open', (client: unknown) => {
			if (isVendorConnection(client)) {
				const observer = this.observers.get(client.webSocket);
				const opened = observer?.opened;
				if (observer) {
					observer.opened = null;
				}
				opened?.();
			}
		});
		this.server.on('close', (client: unknown) => {
			if (isVendorConnection(client)) {
				this.observers.get(client.webSocket)?.closed(client);
			}
		});
	}

	async open(
		socket: WebSocket,
		request: IncomingMessage,
		options: DesktopTransportRequest,
		onTerminated: () => void,
	): Promise<void> {
		if (this.closing || socket.readyState !== socket.OPEN) {
			// No Guacamole client was ever admitted.
			onTerminated();
			throw new DesktopTransportFailure('unavailable');
		}
		const bridgeId = randomBytes(18).toString('base64url');
		this.pending.set(bridgeId, { socket, settings: this.toSettings(options) });

		const dispose = () => this.pending.delete(bridgeId);

		socket.once('close', dispose);
		const internalToken = this.internalToken(options.protocol, bridgeId);
		const internalRequest = Object.create(request) as IncomingMessage;
		internalRequest.url = '/?token=' + encodeURIComponent(internalToken);

		// guacamole-lite 1.2.0's newConnection Promise settles immediately after
		// calling ClientConnection.connect(), BEFORE guacd handshakes. Its Server
		// emits 'open' on guacd ready, and 'close' when the ClientConnection owner
		// closes. Keep the close listener after opening to report the real end.
		await new Promise<void>((resolve, reject) => {
			let ready = false;
			let expired = false;
			let vendorTerminated = false;

			const cleanup = () => {
				clearTimeout(deadline);
				socket.off('close', dispose);
				dispose();
				this.observers.delete(socket);
			};

			const opened = () => {
				if (expired || this.closing || socket.readyState !== socket.OPEN) {
					socket.terminate();
					return;
				}
				ready = true;
				clearTimeout(deadline);
				resolve();
			};

			const closed = (client: VendorConnection) => {
				vendorTerminated = true;
				cleanup();
				afterGuacdSocketClosed(client.guacdClient?.guacdConnection, onTerminated);
				if (!ready) {
					reject(new Error('Guacamole connection closed before ready'));
				}
			};

			let closeLateClient: (() => void) | null = null;
			const deadline = setTimeout(() => {
				if (ready) {
					return;
				}
				expired = true;
				socket.terminate();
				// A client may have been registered after the dispatcher returned,
				// and ClientConnection.close() may already have become a no-op.
				try {
					closeLateClient?.();
				} catch (cleanupError) {
					reject(new AggregateError([cleanupError], 'Guacamole late close failed'));
					return;
				}
				reject(new Error('Guacamole handshake confirmation expired'));
				// The close listener stays installed: the original Guacamole owner
				// must still deliver its late terminal event.
			}, 20_000);
			deadline.unref();
			this.observers.set(socket, { opened, closed });
			// Server.newConnection awaits routing before creating its client.
			// Shutdown can win that await: once dispatch actually completes,
			// the original adapter owner must close even a late-created client.
			// The vendor reads a mutable connectionsCount after an await. Serialize
			// only construction/dispatch so concurrent handshakes retain unique IDs.
			const dispatched = this.dispatch.then(() => {
				if (this.closing || expired || socket.readyState !== socket.OPEN) {
					vendorTerminated = true;
					cleanup();
					onTerminated();
					throw new DesktopTransportFailure('unavailable');
				}
				return this.server.newConnection(socket, internalRequest);
			});
			this.dispatch = dispatched.catch(() => undefined);
			closeLateClient = () => {
				const entry = [...this.server.activeConnections].find(([, client]) => client.webSocket === socket);
				const client = entry?.[1];
				if (!client) {
					return;
				}
				if (client.state === client.STATE_CLOSED) {
					// The vendor constructor can close before installing its
					// Server close listener, then connect a new guacd socket.
					// Another client.close() is a no-op in this state.
					client.guacdClient?.close();
					if (entry) {
						this.server.activeConnections.delete(entry[0]);
					}
					if (!vendorTerminated) {
						vendorTerminated = true;
						cleanup();
						afterGuacdSocketClosed(client.guacdClient?.guacdConnection, onTerminated);
						if (!ready) {
							reject(new Error('Guacamole client ended before registration'));
						}
					}
				} else if (this.closing || expired || socket.readyState !== socket.OPEN) {
					client.close();
				}
			};
			void dispatched.then(
				() => {
					try {
						closeLateClient?.();
					} catch (cleanupError) {
						socket.terminate();
						reject(new AggregateError([cleanupError], 'Guacamole late close failed'));
					}
				},
				(error: unknown) => {
					try {
						closeLateClient?.();
					} catch (cleanupError) {
						reject(new AggregateError([error, cleanupError], 'Guacamole dispatch and close failed'));
						socket.terminate();
						return;
					}
					if (!ready) {
						reject(error);
					}
					socket.terminate();
				},
			);
		}).catch((cause: unknown) => {
			if (cause instanceof DesktopTransportFailure) {
				throw cause;
			}
			throw new DesktopTransportFailure(cause instanceof AggregateError ? 'cleanup_failed' : 'unavailable', {
				cause,
			});
		});
	}

	close(): Promise<void> {
		if (this.closing) {
			return this.closing;
		}
		this.closing = Promise.resolve()
			.then(async () => {
				this.pending.clear();
				this.server.close();
				await this.dispatch;
			})
			.catch((cause: unknown) => {
				throw new DesktopTransportFailure('cleanup_failed', { cause });
			});
		return this.closing;
	}

	private resolveSettings(
		settings: GuacamoleSettings,
		callback: (error?: Error, resolved?: GuacamoleSettings) => void,
	): void {
		const id = settings.connection?.['nexus-bridge-id'];
		if (typeof id !== 'string' || this.closing) {
			callback(new Error('Desktop bridge is unavailable'));
			return;
		}
		const current = this.pending.get(id);
		this.pending.delete(id);
		if (!current || current.socket.readyState !== current.socket.OPEN) {
			callback(new Error('Desktop bridge is unavailable'));
			return;
		}
		// The adapter owns this third-party output projection. Never pass
		// through decrypted token fields or Guacamole's mutable settings.
		callback(undefined, { connection: { ...current.settings } });
	}

	private internalToken(protocol: 'rdp' | 'vnc', id: string): string {
		const payload = JSON.stringify({ connection: { type: protocol, settings: { 'nexus-bridge-id': id } } });
		const iv = randomBytes(16);
		const cipher = createCipheriv('aes-256-cbc', this.key, iv);
		const value = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]).toString('base64');
		return Buffer.from(JSON.stringify({ iv: iv.toString('base64'), value })).toString('base64');
	}

	private toSettings(input: DesktopTransportRequest): Record<string, string | string[] | null> {
		const settings: Record<string, string | string[] | null> = {
			hostname: input.host,
			port: String(input.port),
			password: input.password,
			width: String(input.width),
			height: String(input.height),
			dpi: String(input.dpi),
			// The settings callback replaces the vendor's merged defaults.
			// Keep its negotiated media capabilities explicitly for both protocols.
			audio: ['audio/L16'],
			video: null,
			image: ['image/png', 'image/jpeg'],
			timezone: null,
		};
		if (input.username !== null) {
			settings.username = input.username;
		}
		if (input.protocol === 'rdp') {
			settings.security = input.security;
			settings['ignore-cert'] = String(input.ignoreCertificate);
			settings['resize-method'] = input.resizeMethod;
			if (input.remoteApp) {
				settings['remote-app'] = '||' + input.remoteApp.replace(/^\|\|/u, '');
			}
			if (input.remoteAppDirectory) {
				settings['remote-app-dir'] = input.remoteAppDirectory;
			}
			if (input.remoteAppArguments) {
				settings['remote-app-args'] = input.remoteAppArguments;
			}
		}
		return settings;
	}
}
