import { Client, type ConnectConfig, type ClientChannel } from 'ssh2';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { MachineEndpoint, MachineProxy, MachineConnectOptions } from '../../ssh-port.js';

export interface ConnectedRoute {
	readonly clients: Client[];
	readonly sockets: Duplex[];
	readonly primary: Client;
}
interface Deadline {
	readonly signal: AbortSignal;
	remaining(): number;
	finish(): void;
}

function abortCause(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new DOMException('SSH connection cancelled', 'AbortError');
}

function makeDeadline(options: MachineConnectOptions): Deadline {
	if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 300000) {
		throw new Error('SSH connection timeout out of range');
	}
	const controller = new AbortController();
	const limit = Date.now() + options.timeoutMs;

	const abort = () =>
		controller.abort(options.signal?.reason ?? new DOMException('SSH connection cancelled', 'AbortError'));

	if (options.signal?.aborted) abort();
	options.signal?.addEventListener('abort', abort, { once: true });
	const timer = setTimeout(() => controller.abort(new Error('SSH connect deadline exceeded')), options.timeoutMs);
	return {
		signal: controller.signal,

		remaining() {
			if (controller.signal.aborted) throw abortCause(controller.signal);
			const ms = limit - Date.now();
			if (ms <= 0) throw new Error('SSH connect deadline exceeded');
			return ms;
		},

		finish() {
			clearTimeout(timer);
			options.signal?.removeEventListener('abort', abort);
		},
	};
}

function flatten(endpoint: MachineEndpoint): MachineEndpoint[] {
	const result: MachineEndpoint[] = [];

	const visit = (current: MachineEndpoint, depth: number) => {
		if (depth > 16 || result.length >= 256) throw new Error('SSH route exceeds resource limits');
		if (current.route.kind === 'jump') {
			if (!current.route.hops.length) throw new Error('SSH jump route has no hops');
			for (const hop of current.route.hops) visit(hop, depth + 1);
		}
		result.push(current);
	};

	visit(endpoint, 0);
	return result;
}

async function connectTcp(host: string, port: number, ctx: Deadline): Promise<Duplex> {
	ctx.remaining();
	const socket = net.connect({ host, port });
	return new Promise((resolve, reject) => {
		let settled = false;

		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			socket.off('connect', ready);
			socket.off('error', fail);
			socket.off('close', closed);
			ctx.signal.removeEventListener('abort', aborted);
			if (error) {
				socket.destroy();
				reject(error);
			} else resolve(socket);
		};

		const ready = () => finish();

		const fail = (error: Error) => finish(error);

		const closed = () => finish(new Error('TCP socket closed during SSH routing'));

		const aborted = () => finish(abortCause(ctx.signal));

		socket.once('connect', ready);
		socket.once('error', fail);
		socket.once('close', closed);
		ctx.signal.addEventListener('abort', aborted, { once: true });
		if (ctx.signal.aborted) aborted();
	});
}

async function forward(client: Client, host: string, port: number, ctx: Deadline): Promise<ClientChannel> {
	ctx.remaining();
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
			ctx.signal.removeEventListener('abort', aborted);
			if (error) reject(error);
			else resolve(channel!);
		};

		const closed = () => finish(new Error('SSH forwarding route disconnected'));

		const failed = (error: Error) => finish(error);

		const aborted = () => finish(abortCause(ctx.signal));

		client.once('close', closed);
		client.once('error', failed);
		ctx.signal.addEventListener('abort', aborted, { once: true });
		if (ctx.signal.aborted) return aborted();
		try {
			client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => finish(error, channel));
		} catch (error) {
			finish(error instanceof Error ? error : new Error('SSH forwarding rejected'));
		}
	});
}

/** Exact protocol read; never leave handshake listeners attached to an SSH socket. */
async function readBytes(socket: Duplex, bytes: number, ctx: Deadline): Promise<Buffer> {
	ctx.remaining();
	return new Promise((resolve, reject) => {
		const collected: Buffer[] = [];
		let received = 0;

		const cleanup = () => {
			socket.pause();
			socket.off('data', data);
			socket.off('error', fail);
			socket.off('end', ended);
			socket.off('close', ended);
			ctx.signal.removeEventListener('abort', aborted);
		};

		const data = (chunk: Buffer) => {
			const wanted = bytes - received;
			if (chunk.length > wanted) socket.unshift(chunk.subarray(wanted));
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

		const aborted = () => fail(abortCause(ctx.signal));

		socket.on('data', data);
		socket.once('error', fail);
		socket.once('end', ended);
		socket.once('close', ended);
		ctx.signal.addEventListener('abort', aborted, { once: true });
		if (ctx.signal.aborted) aborted();
		else socket.resume();
	});
}

async function socks5(socket: Duplex, target: MachineEndpoint, proxy: MachineProxy, ctx: Deadline): Promise<void> {
	const username = proxy.username === null ? null : Buffer.from(proxy.username);
	const password = Buffer.from(proxy.password ?? '');
	if (username && (username.length > 255 || password.length > 255)) throw new Error('Proxy credentials too long');
	socket.write(Buffer.from([5, 1, username ? 2 : 0]));
	const greeting = await readBytes(socket, 2, ctx);
	if (greeting[0] !== 5 || greeting[1] === 255) throw new Error('SOCKS5 proxy authentication rejected');
	if (greeting[1] === 2) {
		if (!username) throw new Error('SOCKS5 requires credentials');
		socket.write(
			Buffer.concat([Buffer.from([1, username.length]), username, Buffer.from([password.length]), password]),
		);
		const response = await readBytes(socket, 2, ctx);
		if (response[1] !== 0) throw new Error('SOCKS5 credential rejected');
	} else if (greeting[1] !== 0) throw new Error('Unsupported SOCKS5 authentication method');

	const host = Buffer.from(target.host);
	if (host.length < 1 || host.length > 255) throw new Error('Invalid proxy destination');
	socket.write(
		Buffer.concat([
			Buffer.from([5, 1, 0, 3, host.length]),
			host,
			Buffer.from([target.port >> 8, target.port & 255]),
		]),
	);
	const reply = await readBytes(socket, 4, ctx);
	if (reply[0] !== 5 || reply[1] !== 0) throw new Error('SOCKS5 proxy route rejected');
	let remaining = reply[3] === 1 ? 4 : reply[3] === 4 ? 16 : -1;
	if (reply[3] === 3) remaining = (await readBytes(socket, 1, ctx))[0];
	if (remaining < 0) throw new Error('Invalid SOCKS5 reply');
	await readBytes(socket, remaining + 2, ctx);
}

async function httpConnect(socket: Duplex, target: MachineEndpoint, proxy: MachineProxy, ctx: Deadline): Promise<void> {
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
		text += (await readBytes(socket, 1, ctx)).toString('latin1');
	}
	if (!text.endsWith('\r\n\r\n') || !/^HTTP\/1\.[01] 200(?: |\r)/.test(text)) {
		throw new Error('HTTP CONNECT route rejected');
	}
}

async function proxyTunnel(
	target: MachineEndpoint,
	proxy: MachineProxy,
	previous: Client | null,
	ctx: Deadline,
): Promise<Duplex> {
	const socket = previous
		? await forward(previous, proxy.host, proxy.port, ctx)
		: await connectTcp(proxy.host, proxy.port, ctx);
	try {
		if (proxy.type === 'HTTP') await httpConnect(socket, target, proxy, ctx);
		else if (proxy.type === 'SOCKS5') await socks5(socket, target, proxy, ctx);
		else throw new Error('Unsupported proxy kind');
		return socket;
	} catch (error) {
		socket.destroy();
		throw error;
	}
}

async function connectClient(
	endpoint: MachineEndpoint,
	sock: Duplex | null,
	ctx: Deadline,
	verify: MachineConnectOptions['verifyHostKey'],
): Promise<Client> {
	ctx.remaining();
	const auth = endpoint.authentication;
	const config: ConnectConfig = {
		host: endpoint.host,
		port: endpoint.port,
		username: endpoint.username,
		readyTimeout: ctx.remaining(),
		keepaliveInterval: 10000,

		hostVerifier: (key: Buffer) =>
			verify(endpoint.host, endpoint.port, Buffer.isBuffer(key) ? key : Buffer.from(key)),

		...(auth.kind === 'password'
			? { password: auth.password }
			: { privateKey: auth.privateKey, ...(auth.passphrase === null ? {} : { passphrase: auth.passphrase }) }),
		...(sock ? { sock } : {}),
	};
	const client = new Client();
	try {
		await new Promise<void>((resolve, reject) => {
			let settled = false;

			const cleanup = () => {
				client.off('ready', ready);
				client.off('error', failed);
				client.off('close', closed);
				ctx.signal.removeEventListener('abort', aborted);
			};

			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (error) reject(error);
				else resolve();
			};

			const ready = () => finish();

			const failed = (error: Error) => finish(error);

			const closed = () => finish(new Error('SSH client closed before ready'));

			const aborted = () => finish(abortCause(ctx.signal));

			client.once('ready', ready);
			client.once('error', failed);
			client.once('close', closed);
			ctx.signal.addEventListener('abort', aborted, { once: true });
			if (ctx.signal.aborted) return aborted();
			try {
				client.connect(config);
			} catch (error) {
				finish(error instanceof Error ? error : new Error('SSH connection refused'));
			}
		});
		return client;
	} catch (error) {
		client.destroy();
		throw error;
	}
}

export async function openSshRoute(endpoint: MachineEndpoint, options: MachineConnectOptions): Promise<ConnectedRoute> {
	const stages = flatten(endpoint);
	const ctx = makeDeadline(options);
	const clients: Client[] = [];
	const sockets: Duplex[] = [];
	try {
		for (const stage of stages) {
			const previous = clients.length ? clients[clients.length - 1] : null;
			let socket: Duplex | null = null;
			if (stage.route.kind === 'proxy') socket = await proxyTunnel(stage, stage.route.proxy, previous, ctx);
			else if (previous) socket = await forward(previous, stage.host, stage.port, ctx);
			if (socket) sockets.push(socket);
			const client = await connectClient(stage, socket, ctx, options.verifyHostKey);
			clients.push(client);
			ctx.remaining();
		}
		if (ctx.signal.aborted) throw abortCause(ctx.signal);
		return { clients, sockets, primary: clients[clients.length - 1] };
	} catch (error) {
		for (const client of [...clients].reverse()) client.destroy();
		for (const socket of [...sockets].reverse()) socket.destroy();
		throw error;
	} finally {
		ctx.finish();
	}
}
