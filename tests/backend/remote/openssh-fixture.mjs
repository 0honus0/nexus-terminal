import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from '../../../packages/backend/node_modules/ws/index.js';
import { decodeWorkspaceBinaryFrame } from '../../../packages/shared/dist/remote/workspace/workspace-binary.js';

const origin = 'http://127.0.0.1:0';

async function until(read, accept, description) {
	const deadline = performance.now() + 10000;
	let value;
	do {
		value = await read();
		if (accept(value)) {
			return value;
		}
		await delay(20);
	} while (performance.now() < deadline);
	assert.fail(description + ': ' + JSON.stringify(value));
}

function send(address, cookie, method, path, input, headers = {}) {
	const bytes = Buffer.isBuffer(input) ? input : input === undefined ? undefined : Buffer.from(JSON.stringify(input));
	return new Promise((resolve, reject) => {
		const req = request(
			'http://' + address + path,
			{
				method,
				headers: {
					Host: new URL(origin).host,
					Origin: origin,
					Cookie: cookie,
					...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}),
					...headers,
				},
			},
			(response) => {
				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('error', reject);
				response.on('end', () => {
					try {
						const data = Buffer.concat(chunks);
						resolve({
							status: response.statusCode,
							headers: response.headers,
							bytes: data,
							body: response.headers['content-type']?.includes('application/json')
								? JSON.parse(data.toString('utf8'))
								: null,
						});
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		req.on('error', reject);
		req.setTimeout(15000, () => req.destroy(new Error('OpenSSH HTTP request deadline')));
		req.end(bytes);
	});
}

function expectStatus(response, status) {
	assert.equal(response.status, status, JSON.stringify(response.body));
	return response.body;
}

/** A loopback-only OpenSSH daemon trusts only this run's ephemeral public key. */
async function openSshd(directory) {
	const portServer = createServer();
	portServer.listen(0, '127.0.0.1');
	await once(portServer, 'listening');
	const port = portServer.address().port;
	await new Promise((resolve, reject) => portServer.close((error) => (error ? reject(error) : resolve())));
	const host = join(directory, 'host');
	const client = join(directory, 'client');
	for (const filename of [host, client]) {
		execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', filename]);
	}
	const user = userInfo().username;
	const config = join(directory, 'sshd_config');
	await writeFile(
		config,
		[
			'ListenAddress 127.0.0.1',
			'Port ' + port,
			'HostKey ' + host,
			'PidFile ' + join(directory, 'sshd.pid'),
			'AuthorizedKeysFile ' + client + '.pub',
			'StrictModes no',
			'PermitRootLogin prohibit-password',
			'PasswordAuthentication no',
			'KbdInteractiveAuthentication no',
			'UsePAM yes',
			'AllowUsers ' + user,
			'AllowTcpForwarding no',
			'X11Forwarding no',
			'LogLevel VERBOSE',
			'Subsystem sftp internal-sftp',
		].join('\n') + '\n',
	);
	if (process.getuid() === 0) {
		await mkdir('/run/sshd', { recursive: true });
	}
	const daemon = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', config], { stdio: ['ignore', 'ignore', 'pipe'] });
	let diagnostics = '';
	daemon.stderr.on('data', (chunk) => {
		diagnostics = (diagnostics + chunk.toString()).slice(-16384);
	});
	const exited = once(daemon, 'exit');
	try {
		await until(
			() => {
				assert.equal(daemon.exitCode, null, diagnostics);
				return diagnostics;
			},
			(value) => value.includes('Server listening on'),
			'OpenSSH startup',
		);
	} catch (error) {
		daemon.kill('SIGTERM');
		await exited;
		throw error;
	}
	const publicKey = (await readFile(host + '.pub', 'utf8')).split(' ')[1];
	const fingerprint =
		'SHA256:' + createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('base64').replace(/=+$/u, '');
	return {
		port,
		user,
		fingerprint,
		privateKey: await readFile(client, 'utf8'),

		close: async () => {
			daemon.kill('SIGTERM');
			await exited;
		},
	};
}

async function openWorkspace(address, cookie, { terminalAutoAck = true } = {}) {
	const socket = new WebSocket('ws://' + address + '/ws/workspace', {
		origin,
		headers: { Host: new URL(origin).host, Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' },
	});
	const closed = new Promise((resolve) => socket.once('close', (...args) => resolve(args)));
	const responses = new Map();
	const events = [];
	const binary = new Map();
	const terminal = [];
	let consumed = 0;
	let consumptionTimer;

	// Match the real Workspace client's coalesced ACKs instead of sending a
	// control request per SSH chunk and overflowing the socket input queue.
	const scheduleConsumptionAck = () => {
		if (consumptionTimer || !terminalAutoAck) {
			return;
		}
		consumptionTimer = setTimeout(() => {
			consumptionTimer = undefined;
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ type: 'terminal.flow', payload: { consumedBytes: consumed } }));
			}
		}, 20);
	};

	socket.once('close', () => clearTimeout(consumptionTimer));
	socket.on('message', (data, isBinary) => {
		if (!isBinary) {
			const message = JSON.parse(data.toString());
			if (message.type === 'response') {
				responses.set(message.requestId, message.payload);
			} else {
				events.push(message);
			}
			return;
		}
		const frame = decodeWorkspaceBinaryFrame(data);
		const payload = Buffer.from(frame.data);
		if (frame.kind === 'terminal') {
			terminal.push(payload);
			consumed += payload.length;
			scheduleConsumptionAck();
		} else {
			const entry = binary.get(frame.requestId) ?? { chunks: [], final: false };
			entry.chunks.push(payload);
			entry.final = frame.final;
			binary.set(frame.requestId, entry);
		}
	});
	await once(socket, 'open');
	return {
		socket,
		closed,
		events,
		terminal,

		acknowledgeTerminal() {
			terminalAutoAck = true;
			scheduleConsumptionAck();
		},

		async call(type, payload, id = randomUUID()) {
			socket.send(JSON.stringify({ type, requestId: id, payload }));
			return until(() => responses.get(id), Boolean, 'Workspace response ' + type);
		},

		async read(path, maxBytes) {
			const id = randomUUID();
			const response = await this.call('filesystem.readBinary', { path, maxBytes }, id);
			assert.equal(response.ok, true, JSON.stringify(response));
			const result = binary.get(id);
			assert.equal(result?.final, true);
			return Buffer.concat(result.chunks);
		},

		async archive(type, payload) {
			const id = randomUUID();
			const response = await this.call(type, payload, id);
			assert.equal(response.ok, true, JSON.stringify(response));
			assert.equal(response.data.started, true);
			return until(
				() =>
					events.find(
						(event) =>
							event.type === 'transfer.archive' &&
							event.payload.requestId === id &&
							event.payload.type !== 'progress',
					),
				Boolean,
				'Archive terminal event',
			);
		},

		async copyMove(payload) {
			const id = randomUUID();
			const started = await this.call('transfer.copyMove', payload, id);
			assert.equal(started.ok, true, JSON.stringify(started));
			const event = await until(
				() =>
					events.find(
						(event) =>
							event.type === 'transfer.copyMove' &&
							event.payload.requestId === id &&
							['completed', 'failed', 'cancelled'].includes(event.payload.type),
					),
				Boolean,
				'Copy/move terminal event',
			);
			assert.equal(event.payload.type, 'completed', JSON.stringify(event));
			return event.payload;
		},

		async close() {
			if (socket.readyState === WebSocket.CLOSED) {
				return;
			}
			socket.close();
			await closed;
		},
	};
}

export { origin, until, send, expectStatus, openSshd, openWorkspace };
