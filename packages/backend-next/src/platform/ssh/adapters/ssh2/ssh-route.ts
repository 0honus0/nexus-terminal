import { Client, type ConnectConfig, type ClientChannel } from 'ssh2';
import net from 'node:net';
import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { MachineEndpoint, MachineProxy, MachineConnectOptions } from '../../ssh-port.js';

export interface ConnectedRoute {
	readonly clients: Client[];
	readonly sockets: Duplex[];
	readonly primary: Client;
	assertOpen(): void;
	releaseMonitors(): void;
}

interface Deadline {
	readonly signal: AbortSignal;
	remaining(): number;
	finish(): void;
	fail(error: Error): void;
}

function abortCause(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new DOMException('SSH connection cancelled', 'AbortError');
}

function createConnectDeadline(options: MachineConnectOptions): Deadline {
	if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 300000) {
		throw new Error('SSH connection timeout out of range');
	}
	const controller = new AbortController();
	const limit = Date.now() + options.timeoutMs;

	const abort = () =>
		controller.abort(options.signal?.reason ?? new DOMException('SSH connection cancelled', 'AbortError'));

	if (options.signal?.aborted) {
		abort();
	}
	options.signal?.addEventListener('abort', abort, { once: true });
	const timer = setTimeout(() => controller.abort(new Error('SSH connect deadline exceeded')), options.timeoutMs);
	return {
		signal: controller.signal,

		fail(error) {
			controller.abort(error);
		},

		remaining() {
			if (controller.signal.aborted) {
				throw abortCause(controller.signal);
			}
			const ms = limit - Date.now();
			if (ms <= 0) {
				throw new Error('SSH connect deadline exceeded');
			}
			return ms;
		},

		finish() {
			clearTimeout(timer);
			options.signal?.removeEventListener('abort', abort);
		},
	};
}

function expandRoute(endpoint: MachineEndpoint): MachineEndpoint[] {
	const result: MachineEndpoint[] = [];

	const visit = (current: MachineEndpoint, depth: number) => {
		if (depth > 16 || result.length >= 256) {
			throw new Error('SSH route exceeds resource limits');
		}
		if (current.route.kind === 'jump') {
			if (!current.route.hops.length) {
				throw new Error('SSH jump route has no hops');
			}
			for (const hop of current.route.hops) {
				visit(hop, depth + 1);
			}
		}
		result.push(current);
	};

	visit(endpoint, 0);
	return result;
}

async function connectTcp(
	host: string,
	port: number,
	deadline: Deadline,
	ownSocket: (socket: Duplex) => void,
): Promise<Duplex> {
	deadline.remaining();
	const socket = net.connect({ host, port });
	ownSocket(socket);
	return new Promise((resolve, reject) => {
		let settled = false;

		const finish = (error?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			socket.off('connect', ready);
			socket.off('error', fail);
			socket.off('close', closed);
			deadline.signal.removeEventListener('abort', aborted);
			if (error) {
				socket.destroy();
				reject(error);
			} else {
				resolve(socket);
			}
		};

		const ready = () => finish();

		const fail = (error: Error) => finish(error);

		const closed = () => finish(new Error('TCP socket closed during SSH routing'));

		const aborted = () => finish(abortCause(deadline.signal));

		socket.once('connect', ready);
		socket.once('error', fail);
		socket.once('close', closed);
		deadline.signal.addEventListener('abort', aborted, { once: true });
		if (deadline.signal.aborted) {
			aborted();
		}
	});
}

async function openForwardChannel(
	client: Client,
	host: string,
	port: number,
	deadline: Deadline,
	ownSocket: (socket: Duplex) => void,
): Promise<ClientChannel> {
	deadline.remaining();
	return new Promise((resolve, reject) => {
		let settled = false;

		const finish = (error?: Error, channel?: ClientChannel) => {
			if (settled) {
				channel?.destroy();
				return;
			}
			settled = true;
			client.off('close', closed);
			client.off('error', failed);
			deadline.signal.removeEventListener('abort', aborted);
			if (error) {
				reject(error);
			} else {
				resolve(channel!);
			}
		};

		const closed = () => finish(new Error('SSH forwarding route disconnected'));

		const failed = (error: Error) => finish(error);

		const aborted = () => finish(abortCause(deadline.signal));

		client.once('close', closed);
		client.once('error', failed);
		deadline.signal.addEventListener('abort', aborted, { once: true });
		if (deadline.signal.aborted) {
			return aborted();
		}
		try {
			client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
				if (channel) {
					ownSocket(channel);
				}
				finish(error, channel);
			});
		} catch (error) {
			finish(error instanceof Error ? error : new Error('SSH forwarding rejected', { cause: error }));
		}
	});
}

/** Exact protocol read; never leave handshake listeners attached to an SSH socket. */
async function readBytes(socket: Duplex, bytes: number, deadline: Deadline): Promise<Buffer> {
	deadline.remaining();
	return new Promise((resolve, reject) => {
		const collected: Buffer[] = [];
		let received = 0;

		const cleanup = () => {
			socket.pause();
			socket.off('data', data);
			socket.off('error', fail);
			socket.off('end', ended);
			socket.off('close', ended);
			deadline.signal.removeEventListener('abort', aborted);
		};

		const data = (chunk: Buffer) => {
			const wanted = bytes - received;
			if (chunk.length > wanted) {
				socket.unshift(chunk.subarray(wanted));
			}
			collected.push(chunk.subarray(0, wanted));
			received += Math.min(chunk.length, wanted);
			if (received === bytes) {
				cleanup();
				resolve(Buffer.concat(collected));
			}
		};

		const fail = (error: Error) => {
			cleanup();
			reject(error);
		};

		const ended = () => fail(new Error('Proxy closed during handshake'));

		const aborted = () => fail(abortCause(deadline.signal));

		socket.on('data', data);
		socket.once('error', fail);
		socket.once('end', ended);
		socket.once('close', ended);
		deadline.signal.addEventListener('abort', aborted, { once: true });
		if (deadline.signal.aborted) {
			aborted();
		} else {
			socket.resume();
		}
	});
}

async function openSocks5Tunnel(
	socket: Duplex,
	target: MachineEndpoint,
	proxy: MachineProxy,
	deadline: Deadline,
): Promise<void> {
	const username = proxy.username === null ? null : Buffer.from(proxy.username);
	const password = Buffer.from(proxy.password ?? '');
	if (username && (username.length > 255 || password.length > 255)) {
		throw new Error('Proxy credentials too long');
	}
	socket.write(Buffer.from([5, 1, username ? 2 : 0]));
	const greeting = await readBytes(socket, 2, deadline);
	if (greeting[0] !== 5 || greeting[1] === 255) {
		throw new Error('SOCKS5 proxy authentication rejected');
	}
	if (greeting[1] === 2) {
		if (!username) {
			throw new Error('SOCKS5 requires credentials');
		}
		socket.write(
			Buffer.concat([Buffer.from([1, username.length]), username, Buffer.from([password.length]), password]),
		);
		const response = await readBytes(socket, 2, deadline);
		if (response[1] !== 0) {
			throw new Error('SOCKS5 credential rejected');
		}
	} else if (greeting[1] !== 0) {
		throw new Error('Unsupported SOCKS5 authentication method');
	}

	const host = Buffer.from(target.host);
	if (host.length < 1 || host.length > 255) {
		throw new Error('Invalid proxy destination');
	}
	socket.write(
		Buffer.concat([
			Buffer.from([5, 1, 0, 3, host.length]),
			host,
			Buffer.from([target.port >> 8, target.port & 255]),
		]),
	);
	const reply = await readBytes(socket, 4, deadline);
	if (reply[0] !== 5 || reply[1] !== 0) {
		throw new Error('SOCKS5 proxy route rejected');
	}
	let addressBytes: number;
	switch (reply[3]) {
		case 1:
			addressBytes = 4;
			break;
		case 4:
			addressBytes = 16;
			break;
		case 3:
			addressBytes = (await readBytes(socket, 1, deadline))[0];
			break;
		default:
			throw new Error('Invalid SOCKS5 reply');
	}
	await readBytes(socket, addressBytes + 2, deadline);
}

async function openHttpTunnel(
	socket: Duplex,
	target: MachineEndpoint,
	proxy: MachineProxy,
	deadline: Deadline,
): Promise<void> {
	const authority = target.host.includes(':')
		? '[' + target.host + ']:' + target.port
		: target.host + ':' + target.port;
	const headers = ['CONNECT ' + authority + ' HTTP/1.1', 'Host: ' + authority];
	if (proxy.username !== null) {
		const credentials = Buffer.from(proxy.username + ':' + (proxy.password ?? '')).toString('base64');
		headers.push('Proxy-Authorization: Basic ' + credentials);
	}
	socket.write(headers.join('\r\n') + '\r\n\r\n');
	let text = '';
	while (!text.endsWith('\r\n\r\n') && text.length < 8192) {
		text += (await readBytes(socket, 1, deadline)).toString('latin1');
	}
	if (!text.endsWith('\r\n\r\n') || !/^HTTP\/1\.[01] 200(?: |\r)/.test(text)) {
		throw new Error('HTTP CONNECT route rejected');
	}
}

async function openProxyTunnel(
	target: MachineEndpoint,
	proxy: MachineProxy,
	previous: Client | null,
	deadline: Deadline,
	ownSocket: (socket: Duplex) => void,
): Promise<Duplex> {
	const socket = previous
		? await openForwardChannel(previous, proxy.host, proxy.port, deadline, ownSocket)
		: await connectTcp(proxy.host, proxy.port, deadline, ownSocket);
	try {
		if (proxy.type === 'HTTP') {
			await openHttpTunnel(socket, target, proxy, deadline);
		} else if (proxy.type === 'SOCKS5') {
			await openSocks5Tunnel(socket, target, proxy, deadline);
		} else {
			throw new Error('Unsupported proxy kind');
		}
		return socket;
	} catch (error) {
		socket.destroy();
		throw error;
	}
}

function createConnectConfig(
	endpoint: MachineEndpoint,
	socket: Duplex | null,
	deadline: Deadline,
	verifyHostKey: MachineConnectOptions['verifyHostKey'],
): ConnectConfig {
	const authentication = endpoint.authentication;
	const config: ConnectConfig = {
		host: endpoint.host,
		port: endpoint.port,
		username: endpoint.username,
		readyTimeout: deadline.remaining(),
		keepaliveInterval: 10000,

		hostVerifier: (key: Buffer) =>
			verifyHostKey(endpoint.host, endpoint.port, Buffer.isBuffer(key) ? key : Buffer.from(key)),
	};
	if (authentication.kind === 'password') {
		config.password = authentication.password;
	} else {
		config.privateKey = authentication.privateKey;
		if (authentication.passphrase !== null) {
			config.passphrase = authentication.passphrase;
		}
	}
	if (socket !== null) {
		config.sock = socket;
	}
	return config;
}

async function connectClient(
	endpoint: MachineEndpoint,
	socket: Duplex | null,
	deadline: Deadline,
	verifyHostKey: MachineConnectOptions['verifyHostKey'],
	ownClient: (client: Client) => void,
): Promise<Client> {
	deadline.remaining();
	const config = createConnectConfig(endpoint, socket, deadline, verifyHostKey);
	const client = new Client();
	ownClient(client);
	try {
		await new Promise<void>((resolve, reject) => {
			let settled = false;

			const cleanup = () => {
				client.off('ready', ready);
				client.off('error', failed);
				client.off('close', closed);
				deadline.signal.removeEventListener('abort', aborted);
			};

			const finish = (error?: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};

			const ready = () => finish();

			const failed = (error: Error) => finish(error);

			const closed = () => finish(new Error('SSH client closed before ready'));

			const aborted = () => finish(abortCause(deadline.signal));

			client.once('ready', ready);
			client.once('error', failed);
			client.once('close', closed);
			deadline.signal.addEventListener('abort', aborted, { once: true });
			if (deadline.signal.aborted) {
				return aborted();
			}
			try {
				client.connect(config);
			} catch (error) {
				finish(error instanceof Error ? error : new Error('SSH connection refused', { cause: error }));
			}
		});
		return client;
	} catch (error) {
		client.destroy();
		throw error;
	}
}

export async function openSshRoute(endpoint: MachineEndpoint, options: MachineConnectOptions): Promise<ConnectedRoute> {
	const stages = expandRoute(endpoint);
	const deadline = createConnectDeadline(options);
	const clients: Client[] = [];
	const sockets: Duplex[] = [];
	const monitors = new Set<() => void>();

	const monitor = (resource: EventEmitter) => {
		const failed = (error: Error) => deadline.fail(error);

		const closed = () => {
			deadline.fail(new Error('SSH route resource closed'));
			release();
		};

		const release = () => {
			resource.off('error', failed);
			resource.off('close', closed);
			monitors.delete(release);
		};

		resource.on('error', failed);
		resource.once('close', closed);
		monitors.add(release);
	};

	const ownSocket = (socket: Duplex) => {
		sockets.push(socket);
		monitor(socket);
	};

	const ownClient = (client: Client) => {
		clients.push(client);
		monitor(client);
	};

	try {
		for (const stage of stages) {
			const previous = clients.length ? clients[clients.length - 1] : null;
			let socket: Duplex | null = null;
			if (stage.route.kind === 'proxy') {
				socket = await openProxyTunnel(stage, stage.route.proxy, previous, deadline, ownSocket);
			} else if (previous) {
				socket = await openForwardChannel(previous, stage.host, stage.port, deadline, ownSocket);
			}
			await connectClient(stage, socket, deadline, options.verifyHostKey, ownClient);
			deadline.remaining();
		}
		if (deadline.signal.aborted) {
			throw abortCause(deadline.signal);
		}
		return {
			clients,
			sockets,
			primary: clients[clients.length - 1],

			assertOpen() {
				if (deadline.signal.aborted) {
					throw abortCause(deadline.signal);
				}
			},

			releaseMonitors() {
				for (const release of [...monitors]) {
					release();
				}
			},
		};
	} catch (error) {
		for (const client of [...clients].reverse()) {
			client.destroy();
		}
		for (const socket of [...sockets].reverse()) {
			socket.destroy();
		}
		throw error;
	} finally {
		deadline.finish();
	}
}
