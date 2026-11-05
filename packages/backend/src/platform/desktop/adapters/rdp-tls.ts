import net from 'node:net';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { DesktopTransportFailure, type DesktopTransportCertificate } from '../desktop-port.js';

export function readRdpNegotiation(socket: net.Socket): Promise<Buffer> {
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
		if (socket.destroyed) {
			fail();
		}
	});
}

function waitFor(socket: net.Socket, event: 'connect' | 'secureConnect'): Promise<void> {
	return new Promise((resolve, reject) => {
		const clean = () => {
			socket.off(event, ready);
			socket.off('error', failed);
			socket.off('close', failed);
		};

		const ready = () => {
			clean();
			resolve();
		};

		const failed = (cause?: unknown) => {
			clean();
			reject(new DesktopTransportFailure('unavailable', { cause }));
		};

		socket.once(event, ready);
		socket.once('error', failed);
		socket.once('close', failed);
		if (socket.destroyed) {
			failed();
		}
	});
}

/** Only X224 negotiation and TLS. Never sends a username or CredSSP credentials. */
export async function probeRdpCertificate(
	host: string,
	port: number,
	signal: AbortSignal,
): Promise<DesktopTransportCertificate> {
	if (signal.aborted) {
		throw new DesktopTransportFailure('unavailable');
	}
	const sockets = new Set<net.Socket>();
	const closures: Promise<void>[] = [];

	const own = <T extends net.Socket>(socket: T): T => {
		sockets.add(socket);
		closures.push(
			new Promise((resolve) =>
				socket.once('close', () => {
					sockets.delete(socket);
					resolve();
				}),
			),
		);
		// Late errors during destroy are owned here; active waits preserve their causes.
		socket.on('error', () => undefined);
		return socket;
	};

	const abort = () => {
		for (const socket of sockets) {
			socket.destroy();
		}
	};

	signal.addEventListener('abort', abort, { once: true });
	try {
		const socket = own(net.createConnection({ host, port }));
		if (signal.aborted) {
			abort();
		}
		await waitFor(socket, 'connect');
		const response = readRdpNegotiation(socket);
		// RDP_NEG_REQ advertises TLS, HYBRID and HYBRID_EX (MS-RDPBCGR).
		socket.write(Buffer.from([3, 0, 0, 19, 14, 0xe0, 0, 0, 0, 0, 0, 1, 0, 8, 0, 11, 0, 0, 0]));
		await response;
		if (signal.aborted) {
			throw new DesktopTransportFailure('unavailable');
		}
		const secure = own(
			tls.connect({
				socket,
				rejectUnauthorized: false,
				servername: net.isIP(host) ? undefined : host,

				// Without SNI, Node otherwise checks "localhost" for a wrapped socket.
				checkServerIdentity: (_hostname, certificate) => tls.checkServerIdentity(host, certificate),

				minVersion: 'TLSv1.2',
			}),
		);
		await waitFor(secure, 'secureConnect');
		if (signal.aborted) {
			throw new DesktopTransportFailure('unavailable');
		}
		const peer = secure.getPeerCertificate();
		if (!peer.raw) {
			throw new DesktopTransportFailure('unavailable');
		}
		const certificate = new X509Certificate(peer.raw);
		const validFrom = certificate.validFromDate.getTime();
		const validTo = certificate.validToDate.getTime();
		if (!Number.isSafeInteger(validFrom) || !Number.isSafeInteger(validTo)) {
			throw new DesktopTransportFailure('unavailable');
		}
		return {
			fingerprint: certificate.fingerprint256,
			subject: certificate.subject,
			issuer: certificate.issuer,
			validFrom,
			validTo,
			systemTrusted: secure.authorized,
			hostMatches: tls.checkServerIdentity(host, peer) === undefined,
		};
	} catch (cause) {
		if (cause instanceof DesktopTransportFailure) {
			throw cause;
		}
		throw new DesktopTransportFailure('unavailable', { cause });
	} finally {
		signal.removeEventListener('abort', abort);
		abort();
		// Retain the admission slot until both TCP and its TLS wrapper actually close.
		await Promise.all(closures);
	}
}
