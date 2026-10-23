import net from 'node:net';
import tls from 'node:tls';
import type WebSocket from 'ws';
import type { RawData } from 'ws';
import { REMOTE_DESKTOP_FRAME_MAX_BYTES } from '@nexus-terminal/shared/remote/desktop/values';
import {
	DesktopTransportFailure,
	type DesktopTransport,
	type DesktopTransportPeer,
	type DesktopTransportRequest,
} from '../desktop-port.js';
import { encodeCleanPathResponse, readCleanPathRequest } from './rdcleanpath.js';

const MAX_QUEUED_BYTES = 4 * 1024 * 1024;
const SEND_HIGH_WATER_BYTES = 64 * 1024;
const SEND_LOW_WATER_BYTES = 16 * 1024;
const HANDSHAKE_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 10_000;

function toBuffer(data: RawData): Buffer {
	if (Buffer.isBuffer(data)) {
		return data;
	}
	return Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
}

class BrowserDesktopPeer implements DesktopTransportPeer {
	private readonly sockets = new Set<net.Socket>();
	private readonly queue: Buffer[] = [];
	private queuedBytes = 0;
	private destination: net.Socket | null = null;
	private options: DesktopTransportRequest | null = null;
	private opening: Promise<void> | null = null;
	private pumping: Promise<void> | null = null;
	private closing = false;
	private finished = false;
	private initialized = false;
	private sending = 0;
	private onTerminated: (() => void) | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;

	private resolveReady: () => void = () => undefined;

	private rejectReady: (failure: unknown) => void = () => undefined;

	private readonly ready = new Promise<void>((resolve, reject) => {
		this.resolveReady = resolve;
		this.rejectReady = reject;
	});

	private resolveClosed: () => void = () => undefined;

	readonly closed = new Promise<void>((resolve) => {
		this.resolveClosed = resolve;
	});

	constructor(
		private readonly ws: WebSocket,
		private readonly retire: () => void,
	) {
		void this.ready.catch(() => undefined);
		ws.on('message', this.receive);
		ws.once('close', this.stop);
		ws.once('error', this.stop);
	}

	private readonly receive = (raw: RawData, binary: boolean): void => {
		if (this.closing) {
			return;
		}
		const bytes = toBuffer(raw);
		if (
			!binary ||
			bytes.length > REMOTE_DESKTOP_FRAME_MAX_BYTES ||
			this.queuedBytes + bytes.length > MAX_QUEUED_BYTES
		) {
			this.stop();
			return;
		}
		this.queue.push(bytes);
		this.queuedBytes += bytes.length;
		this.pump();
	};

	readonly stop = (): void => {
		if (!this.closing) {
			this.closing = true;
			if (this.timer) {
				clearTimeout(this.timer);
			}
			this.timer = null;
			this.queue.length = 0;
			this.queuedBytes = 0;
			this.rejectReady(new DesktopTransportFailure('unavailable'));
			for (const socket of this.sockets) {
				socket.destroy();
			}
			if (this.ws.readyState !== this.ws.CLOSED) {
				this.ws.terminate();
			}
		}
		this.finish();
	};

	private finish(): void {
		if (
			!this.closing ||
			this.finished ||
			this.sockets.size > 0 ||
			this.opening ||
			this.pumping ||
			this.sending > 0 ||
			this.ws.readyState !== this.ws.CLOSED
		) {
			return;
		}
		this.finished = true;
		this.ws.off('message', this.receive);
		this.ws.off('close', this.stop);
		this.ws.off('error', this.stop);
		this.retire();
		this.resolveClosed();
		const notify = this.onTerminated;
		this.onTerminated = null;
		notify?.();
	}

	private own<T extends net.Socket>(socket: T): T {
		this.sockets.add(socket);
		socket.once('error', this.stop);
		socket.once('close', () => {
			this.sockets.delete(socket);
			this.stop();
		});
		if (this.closing) {
			socket.destroy();
		}
		return socket;
	}

	open(options: DesktopTransportRequest, onTerminated: () => void): Promise<void> {
		if (this.options) {
			throw new DesktopTransportFailure('unavailable');
		}
		this.options = options;
		this.onTerminated = onTerminated;
		if (this.finished) {
			this.onTerminated = null;
			onTerminated();
			return Promise.reject(new DesktopTransportFailure('unavailable'));
		}
		this.timer = setTimeout(this.stop, HANDSHAKE_TIMEOUT_MS);
		const task = this.initialize(options);
		this.opening = task;
		void task
			.catch(() => this.stop())
			.finally(() => {
				this.opening = null;
				this.finish();
				this.pump();
			});
		return this.ready;
	}

	private async initialize(options: DesktopTransportRequest): Promise<void> {
		if (this.closing) {
			throw new DesktopTransportFailure('unavailable');
		}
		const socket = this.own(net.createConnection({ host: options.host, port: options.port }));
		await this.waitFor(socket, 'connect');
		if (this.closing) {
			return;
		}
		socket.setNoDelay(true);
		this.destination = socket;
		if (options.protocol === 'vnc') {
			this.forward(socket);
			this.markReady();
		}
	}

	private waitFor(socket: net.Socket, event: 'connect' | 'secureConnect' | 'drain'): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const clean = () => {
				socket.off(event, success);
				socket.off('close', failure);
				socket.off('error', failure);
			};

			const success = () => {
				clean();
				resolve();
			};

			const failure = () => {
				clean();
				reject(new DesktopTransportFailure('unavailable'));
			};

			socket.once(event, success);
			socket.once('close', failure);
			socket.once('error', failure);
			if (socket.destroyed || this.closing) {
				failure();
			}
		});
	}

	private markReady(): void {
		if (this.closing) {
			return;
		}
		this.initialized = true;
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = null;
		this.resolveReady();
	}

	private pump(): void {
		if (
			this.closing ||
			this.opening ||
			this.pumping ||
			!this.destination ||
			!this.options ||
			this.queue.length === 0
		) {
			return;
		}
		const task = this.consume();
		this.pumping = task;
		void task
			.catch(() => this.stop())
			.finally(() => {
				this.pumping = null;
				this.finish();
				this.pump();
			});
	}

	private async consume(): Promise<void> {
		while (!this.closing && this.destination && this.options && this.queue.length > 0) {
			const bytes = this.queue.shift();
			if (!bytes) {
				return;
			}
			this.queuedBytes -= bytes.length;
			if (!this.initialized && this.options.protocol === 'rdp') {
				await this.negotiate(bytes, this.destination, this.options);
			} else if (!this.destination.write(bytes)) {
				this.ws.pause();
				await this.waitFor(this.destination, 'drain');
				if (!this.closing) {
					this.ws.resume();
				}
			}
		}
	}

	private readNegotiation(socket: net.Socket): Promise<Buffer> {
		return new Promise<Buffer>((resolve, reject) => {
			let buffer = Buffer.alloc(0);

			const clean = () => {
				socket.off('data', receive);
				socket.off('close', fail);
				socket.off('error', fail);
			};

			const fail = () => {
				clean();
				reject(new DesktopTransportFailure('unavailable'));
			};

			const receive = (chunk: Buffer) => {
				if (buffer.length + chunk.length > 65535) {
					return fail();
				}
				buffer = Buffer.concat([buffer, chunk]);
				if (buffer.length < 4) {
					return;
				}
				const length = buffer.readUInt16BE(2);
				if (buffer[0] !== 3 || buffer[1] !== 0 || length < 19 || buffer.length > length) {
					return fail();
				}
				if (buffer.length < length) {
					return;
				}
				const offset = buffer.length - 8;
				const protocol = buffer.readUInt32LE(offset + 4);
				if (
					buffer[5] !== 0xd0 ||
					buffer[offset] !== 2 ||
					buffer.readUInt16LE(offset + 2) !== 8 ||
					(protocol !== 1 && protocol !== 2 && protocol !== 8)
				) {
					return fail();
				}
				clean();
				resolve(buffer);
			};

			socket.on('data', receive);
			socket.once('close', fail);
			socket.once('error', fail);
			if (socket.destroyed || this.closing) {
				fail();
			}
		});
	}

	private async negotiate(bytes: Buffer, socket: net.Socket, options: DesktopTransportRequest): Promise<void> {
		const request = readCleanPathRequest(bytes);
		const responseTask = this.readNegotiation(socket);
		socket.write(request);
		const response = await responseTask;
		if (this.closing) {
			return;
		}
		const secure = this.own(
			tls.connect({
				socket,
				rejectUnauthorized: !options.ignoreCertificate,
				servername: net.isIP(options.host) ? undefined : options.host,
				minVersion: 'TLSv1.2',
			}),
		);
		await this.waitFor(secure, 'secureConnect');
		if (this.closing) {
			return;
		}
		this.destination = secure;
		const certificates: Buffer[] = [];
		const fingerprints = new Set<string>();
		let certificate = secure.getPeerCertificate(true);
		while (certificate?.raw && !fingerprints.has(certificate.fingerprint256)) {
			if (certificates.length >= 8) {
				throw new DesktopTransportFailure('unavailable');
			}
			fingerprints.add(certificate.fingerprint256);
			certificates.push(certificate.raw);
			certificate = certificate.issuerCertificate;
		}
		if (certificates.length === 0) {
			throw new DesktopTransportFailure('unavailable');
		}
		await this.send(encodeCleanPathResponse(response, certificates, secure.remoteAddress ?? options.host));
		if (this.closing) {
			return;
		}
		this.forward(secure);
		this.markReady();
	}

	private send(bytes: Buffer): Promise<void> {
		this.sending += 1;
		return new Promise<void>((resolve, reject) => {
			if (this.closing || this.ws.readyState !== this.ws.OPEN || this.ws.bufferedAmount > MAX_QUEUED_BYTES) {
				reject(new DesktopTransportFailure('unavailable'));
				return;
			}
			this.ws.send(bytes, { binary: true }, (error) => {
				if (error) {
					reject(new DesktopTransportFailure('unavailable', { cause: error }));
				} else {
					resolve();
				}
			});
		}).finally(() => {
			this.sending -= 1;
			this.finish();
		});
	}

	private forward(socket: net.Socket): void {
		let paused = false;
		socket.on('data', (bytes: Buffer) => {
			if (this.closing) {
				return;
			}
			// Keep the byte stream moving until the real outbound buffer needs backpressure.
			const task = this.send(bytes);
			if (this.ws.bufferedAmount >= SEND_HIGH_WATER_BYTES) {
				paused = true;
				socket.pause();
			}
			void task.then(() => {
				if (paused && !this.closing && this.ws.bufferedAmount <= SEND_LOW_WATER_BYTES) {
					paused = false;
					socket.resume();
				}
			}, this.stop);
		});
	}
}

export class BrowserDesktopAdapter implements DesktopTransport {
	private readonly peers = new Set<BrowserDesktopPeer>();
	private closing = false;
	private closePromise: Promise<void> | null = null;

	bind(socket: WebSocket): DesktopTransportPeer {
		if (this.closing) {
			throw new DesktopTransportFailure('unavailable');
		}
		const peer = new BrowserDesktopPeer(socket, () => this.peers.delete(peer));
		this.peers.add(peer);
		if (socket.readyState !== socket.OPEN) {
			peer.stop();
		}
		return peer;
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closing = true;
		this.closePromise = Promise.resolve().then(async () => {
			const peers = [...this.peers];
			for (const peer of peers) {
				peer.stop();
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					Promise.all(peers.map((peer) => peer.closed)),
					new Promise<never>((_, reject) => {
						timer = setTimeout(
							() => reject(new DesktopTransportFailure('cleanup_failed')),
							CLOSE_TIMEOUT_MS,
						);
					}),
				]);
			} finally {
				if (timer) {
					clearTimeout(timer);
				}
			}
		});
		return this.closePromise;
	}
}
