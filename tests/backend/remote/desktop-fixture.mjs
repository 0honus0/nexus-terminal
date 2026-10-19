import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000, stdio: 'pipe' }).trim();

/** These are real Xvnc/xrdp/guacd processes, isolated from existing containers. */
export async function openDesktopServices() {
	const ids = [];
	let network;
	try {
		docker('build', '-q', '-t', 'nexus-b10-desktop:local', fileURLToPath(new URL('./desktop/', import.meta.url)));
		network = docker('network', 'create', '--label', 'nexus.b10=desktop', 'nexus-b10-' + randomUUID());
		const desktop = docker(
			'create',
			'--network',
			network,
			'--network-alias',
			'desktop',
			'--label',
			'nexus.b10=desktop',
			'nexus-b10-desktop:local',
		);
		ids.push(desktop);
		docker('start', desktop);
		const reservation = createServer();
		reservation.listen(0, '127.0.0.1');
		await once(reservation, 'listening');
		const port = reservation.address().port;
		await new Promise((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
		const guacd = docker(
			'create',
			'--network',
			network,
			'--label',
			'nexus.b10=desktop',
			'-p',
			'127.0.0.1:' + port + ':4822',
			'guacamole/guacd:latest',
		);
		ids.push(guacd);
		docker('start', guacd);
		await waitFor(
			() =>
				docker('exec', desktop, 'sh', '-c', 'DISPLAY=:0 xdotool search --name B10-Desktop 2>/dev/null || true'),
			(value) => value.length > 0,
			'real desktop window',
		);
		assert.equal(Number(docker('port', guacd, '4822/tcp').split(':').at(-1)), port);
		return {
			port,
			desktop,
			guacd,

			connections: () =>
				docker('exec', desktop, 'sh', '-c', 'cat /proc/net/tcp /proc/net/tcp6')
					.split('\n')
					.filter((line) => {
						const fields = line.trim().split(/\s+/u);
						return fields[1]?.endsWith(':170C') && fields[3] === '01';
					}).length,

			x: (...args) => docker('exec', '-e', 'DISPLAY=:0', desktop, 'xdotool', ...args),

			read: (path) => docker('exec', desktop, 'cat', path),

			logs: () =>
				ids.map((id) => docker('logs', id)).join('\n') +
				docker('exec', desktop, 'sh', '-c', 'cat /tmp/xrdp.log /tmp/vnc.log'),

			stopGuacd: () => docker('stop', '--time', '1', guacd),

			startGuacd: () => docker('start', guacd),

			close,
		};
	} catch (error) {
		try {
			close();
		} catch (cleanup) {
			throw new AggregateError([error, cleanup], 'Desktop setup and cleanup failed');
		}
		throw error;
	}

	function close() {
		const failures = [];
		for (const id of ids.reverse()) {
			try {
				docker('rm', '-f', id);
			} catch (error) {
				failures.push(error);
			}
		}
		if (network) {
			try {
				docker('network', 'rm', network);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length) {
			throw new AggregateError(failures, 'Desktop fixture cleanup failed');
		}
	}
}

export async function waitFor(read, accept, description, timeout = 10000) {
	const deadline = performance.now() + timeout;
	let value;
	do {
		value = await read();
		if (accept(value)) {
			return value;
		}
		await delay(40);
	} while (performance.now() < deadline);
	assert.fail(description + ': ' + JSON.stringify(value));
}

/** Guacamole framing is streamed; instructions can span WS messages. */
export function desktopPeer(fixture, ticket, headers = {}) {
	const socket = fixture.socket('/ws/remote-desktop?ticket=' + ticket, headers);
	const instructions = [];
	let buffer = '';
	let parts = [];
	let closeResult;
	let upgradeStatus;
	const closed = new Promise((resolve) =>
		socket.once('close', (code, reason) => {
			closeResult = { code, reason: reason.toString() };
			resolve(closeResult);
		}),
	);
	const errors = [];
	socket.on('error', (error) => errors.push(error));
	socket.on('unexpected-response', (_request, response) => {
		upgradeStatus = response.statusCode;
		response.resume();
		socket.terminate();
	});

	const encode = (values) => values.map((value) => String(value).length + '.' + value).join(',') + ';';

	const send = (...values) => socket.send(encode(values));

	socket.on('message', (bytes) => {
		buffer += bytes.toString();
		for (;;) {
			const dot = buffer.indexOf('.');
			if (dot < 0) {
				return;
			}
			const length = Number(buffer.slice(0, dot));
			assert.ok(Number.isSafeInteger(length) && length >= 0);
			const end = dot + 1 + length;
			if (buffer.length <= end) {
				return;
			}
			parts.push(buffer.slice(dot + 1, end));
			const separator = buffer[end];
			assert.ok(separator === ',' || separator === ';');
			buffer = buffer.slice(end + 1);
			if (separator === ';') {
				const instruction = parts;
				parts = [];
				instructions.push(instruction);
				if (instruction[0] === 'sync' && socket.readyState === socket.OPEN) {
					send(...instruction);
				}
			}
		}
	});
	return {
		socket,
		instructions,
		errors,
		closed,
		send,

		sendBinary: (...values) => socket.send(Buffer.from(encode(values))),

		get closeResult() {
			return closeResult;
		},

		get upgradeStatus() {
			return upgradeStatus;
		},

		ready: () =>
			waitFor(
				() => instructions.map((item) => item[0]),
				(items) => items.includes(''),
				'guacd real ready',
			),

		async close() {
			if (socket.readyState === socket.CLOSED) {
				return;
			}
			if (socket.readyState === socket.OPEN) {
				send('disconnect');
				socket.close();
			} else {
				socket.terminate();
			}
			const deadline = setTimeout(() => socket.terminate(), 5000);
			try {
				await closed;
			} finally {
				clearTimeout(deadline);
			}
		},
	};
}
