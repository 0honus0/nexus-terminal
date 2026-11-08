import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

export async function countDesktopConnections(port) {
	const tables = await Promise.all(['/proc/net/tcp', '/proc/net/tcp6'].map((file) => readFile(file, 'utf8')));
	const suffix = ':' + port.toString(16).toUpperCase().padStart(4, '0');
	return tables
		.join('\n')
		.split('\n')
		.filter((line) => {
			const fields = line.trim().split(/\s+/u);
			return fields[1]?.endsWith(suffix) && fields[3] === '01';
		}).length;
}

async function allocatePort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	await new Promise((resolve, reject) => server.close((cause) => (cause ? reject(cause) : resolve())));
	return address.port;
}

/** Use the runner's installed TigerVNC/xrdp, with isolated ports, X display and retained evidence. */
export async function openDesktopServices(root = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir()) {
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, 'desktop-service-'));
	const [rdpPort, vncPort, controlPort] = await Promise.all([allocatePort(), allocatePort(), allocatePort()]);
	const origin = 'http://127.0.0.1:' + controlPort;
	let current = null;
	let closed = false;
	let closing = null;
	let sequence = 0;

	const facts = async (path, method = 'GET') => {
		const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(3000) });
		assert.equal(response.status, 200, 'Controlled desktop fact response');
		const value = await response.json();
		assert.ok(value && typeof value === 'object' && !Array.isArray(value));
		return value;
	};

	const stopDesktop = () => {
		const original = current;
		if (!original) return Promise.resolve();
		original.stopping ??= Promise.resolve().then(async () => {
			original.child.kill('SIGTERM');
			const result = await original.completion;
			original.log.end();
			await finished(original.log);
			if (result.cause) throw result.cause;
			assert.equal(result.code, 0, 'Controlled desktop must exit normally');
			if (current === original) current = null;
		});
		return original.stopping;
	};

	const startDesktop = async () => {
		assert.equal(closed, false, 'Retired desktop service cannot restart');
		assert.equal(current, null, 'Only one desktop process owns these ports');
		const log = createWriteStream(join(directory, 'driver-' + sequence++ + '.log'));
		const child = spawn(process.execPath, [fileURLToPath(new URL('./desktop-server.mjs', import.meta.url))], {
			env: {
				...process.env,
				NEXUS_E2E_RDP_PORT: String(rdpPort),
				NEXUS_E2E_VNC_PORT: String(vncPort),
				NEXUS_E2E_DESKTOP_CONTROL_PORT: String(controlPort),
				NEXUS_E2E_DESKTOP_ROOT: directory,
				NEXUS_E2E_DESKTOP_GEOMETRY: '800x600',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		child.stdout.pipe(log, { end: false });
		child.stderr.pipe(log, { end: false });
		let cause;
		const completion = new Promise((resolve) => {
			child.once('error', (error) => {
				cause = error;
			});
			child.once('close', (code, signal) => resolve({ code, signal, cause }));
		});
		current = { child, log, completion, stopping: null };
		const deadline = performance.now() + 30000;
		let lastFailure;
		while (performance.now() < deadline) {
			if (cause) throw cause;
			assert.equal(child.exitCode, null, 'Desktop service exited during startup; inspect ' + directory);
			try {
				const health = await facts('/health');
				assert.deepEqual(health, { ok: true, rdpPort, vncPort });
				return;
			} catch (failure) {
				lastFailure = failure;
			}
			await delay(20);
		}
		throw new Error('Controlled desktop startup failed; inspect ' + directory, { cause: lastFailure });
	};

	const close = () => {
		if (closing) return closing;
		closed = true;
		closing = Promise.resolve().then(stopDesktop);
		return closing;
	};

	try {
		await startDesktop();
	} catch (cause) {
		try {
			await close();
		} catch (cleanup) {
			throw new AggregateError([cause, cleanup], 'Desktop setup and cleanup failed');
		}
		throw cause;
	}
	return {
		host: '127.0.0.1',
		rdpPort,
		vncPort,
		directory,

		connections: () => countDesktopConnections(vncPort),

		async authenticatedSessions() {
			const value = (await facts('/e2e/desktop/rdp-authentication')).authenticatedSessions;
			assert.ok(Number.isSafeInteger(value) && value >= 0);
			return value;
		},

		async pointer() {
			const value = (await facts('/e2e/desktop/pointer')).position;
			assert.equal(typeof value, 'string');
			return value;
		},

		async input() {
			const value = (await facts('/e2e/desktop/input')).text;
			assert.equal(typeof value, 'string');
			return value;
		},

		async focus() {
			assert.deepEqual(await facts('/e2e/desktop/focus', 'POST'), { focused: true });
		},

		async logs() {
			const paths = (await readdir(directory, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory() && entry.name.startsWith('nexus-e2e-desktop-'))
				.flatMap((entry) => ['xrdp.log', 'process.log'].map((file) => join(directory, entry.name, file)))
				.filter((file) => existsSync(file));
			return (await Promise.all(paths.map((file) => readFile(file, 'utf8')))).join('\n');
		},

		stopDesktop,
		startDesktop,
		close,
	};
}
