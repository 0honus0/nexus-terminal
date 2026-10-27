import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000, stdio: 'pipe' }).trim();

export async function openDesktopServices() {
	const ids = [];
	try {
		docker('build', '-q', '-t', 'nexus-b10-desktop:local', fileURLToPath(new URL('./desktop/', import.meta.url)));
		const desktop = docker(
			'create',
			'-p',
			'127.0.0.1::5900',
			'-p',
			'127.0.0.1::3389',
			'--label',
			'nexus.b10=desktop',
			'nexus-b10-desktop:local',
		);
		ids.push(desktop);
		docker('start', desktop);
		await waitFor(
			() =>
				docker('exec', desktop, 'sh', '-c', 'DISPLAY=:0 xdotool search --name B10-Desktop 2>/dev/null || true'),
			(value) => value.length > 0,
			'real desktop window',
		);
		return {
			host: '127.0.0.1',
			vncPort: Number(docker('port', desktop, '5900/tcp').split(':').at(-1)),
			rdpPort: Number(docker('port', desktop, '3389/tcp').split(':').at(-1)),
			desktop,

			connections: () =>
				(docker('inspect', '-f', '{{.State.Running}}', desktop) === 'true'
					? docker('exec', desktop, 'sh', '-c', 'cat /proc/net/tcp /proc/net/tcp6')
					: ''
				)
					.split('\n')
					.filter((line) => {
						const fields = line.trim().split(/\s+/u);
						return fields[1]?.endsWith(':170C') && fields[3] === '01';
					}).length,

			x: (...args) => docker('exec', '-e', 'DISPLAY=:0', desktop, 'xdotool', ...args),

			read: (path) => docker('exec', desktop, 'cat', path),

			clipboard: () => docker('exec', '-e', 'DISPLAY=:0', desktop, 'xclip', '-selection', 'clipboard', '-o'),

			logs: () =>
				ids.map((id) => docker('logs', id)).join('\n') +
				docker('exec', desktop, 'sh', '-c', 'cat /tmp/xrdp.log /tmp/vnc.log'),

			stopDesktop: () => docker('stop', '--time', '1', desktop),

			async startDesktop() {
				docker('start', desktop);
				await waitFor(
					() =>
						docker(
							'exec',
							desktop,
							'sh',
							'-c',
							'DISPLAY=:0 xdotool search --name B10-Desktop 2>/dev/null || true',
						),
					(value) => value.length > 0,
					'desktop restarted',
				);
			},

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

export function desktopPeer(fixture, ticket, headers = {}) {
	const socket = fixture.socket('/ws/remote-desktop?ticket=' + ticket, headers);
	const events = [];
	const errors = [];
	let closeResult;
	let upgradeStatus;
	const closed = new Promise((resolve) =>
		socket.once('close', (code, reason) => {
			closeResult = { code, reason: reason.toString() };
			resolve(closeResult);
		}),
	);
	socket.on('error', (error) => errors.push(error));
	socket.on('message', () => events.push({ kind: 'data' }));
	socket.on('unexpected-response', (_request, response) => {
		upgradeStatus = response.statusCode;
		response.resume();
		socket.terminate();
	});
	return {
		socket,
		events,
		errors,
		closed,

		get closeResult() {
			return closeResult;
		},

		get upgradeStatus() {
			return upgradeStatus;
		},

		async close() {
			if (socket.readyState !== socket.CLOSED) socket.terminate();
			await closed;
		},
	};
}
