import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Same SSH/SFTP fault peer as browser tests; every invocation owns its ports and files. */
export async function openControlledSsh(directory) {
	await mkdir(directory, { recursive: true });
	// Unix-domain sockets in archive fixtures must fit sockaddr_un.sun_path.
	// Keep evidence at the requested location, and record the short runtime root.
	const runtimeRoot = await mkdtemp(join(tmpdir(), 'ssh-'));
	await writeFile(join(directory, 'runtime.json'), JSON.stringify({ runtimeRoot }));
	const failures = [];
	const log = createWriteStream(join(directory, 'ssh.log'));
	log.on('error', (error) => failures.push(error));
	const started = performance.now();
	const child = spawn(process.execPath, [fileURLToPath(new URL('./controlled-ssh-server.mjs', import.meta.url))], {
		env: {
			...process.env,
			NEXUS_E2E_SERVICE_ROOT: runtimeRoot,
			NEXUS_E2E_SSH_PORT: '0',
			NEXUS_E2E_SSH_TRANSFER_TARGET_PORT: '0',
			NEXUS_E2E_SSH_CONTROL_PORT: '0',
			NEXUS_E2E_SMTP_PORT: '0',
		},
		stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
	});
	child.stdout.pipe(log, { end: false });
	child.stderr.pipe(log, { end: false });
	child.on('error', (error) => failures.push(error));
	let rejectStartup;
	const startupFailed = new Promise((_, reject) => {
		rejectStartup = reject;
	});
	child.once('error', rejectStartup);
	const exited = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
	const timing = { readyMs: null, drainMs: null };
	let closing;

	function close() {
		closing ??= Promise.resolve().then(async () => {
			const draining = performance.now();
			if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
			let timer;
			try {
				const result = await Promise.race([
					exited,
					new Promise((_, reject) => {
						timer = setTimeout(
							() => reject(new Error('Controlled SSH did not drain; inspect ' + directory)),
							30_000,
						);
					}),
				]);
				assert.equal(result.code, 0, 'Controlled SSH exit: ' + JSON.stringify(result));
			} catch (error) {
				failures.push(error);
			} finally {
				clearTimeout(timer);
				log.end();
				try {
					await finished(log);
				} catch (error) {
					failures.push(error);
				}
				timing.drainMs = performance.now() - draining;
				try {
					await writeFile(join(directory, 'timings.json'), JSON.stringify(timing, null, 2));
				} catch (error) {
					failures.push(error);
				}
			}
			if (failures.length) throw new AggregateError(failures, 'Controlled SSH fixture failed');
		});
		return closing;
	}

	let timer;
	let onReady;
	try {
		const ready = await Promise.race([
			startupFailed,
			new Promise((resolve) => {
				onReady = resolve;
				child.once('message', onReady);
			}),
			exited.then((result) => {
				throw new Error('Controlled SSH exited before readiness: ' + JSON.stringify(result));
			}),
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error('Controlled SSH readiness failed; inspect ' + directory)),
					30_000,
				);
			}),
		]);
		assert.equal(ready?.type, 'ready');
		assert.equal(ready.host, '127.0.0.1');
		for (const key of ['port', 'controlPort', 'transferTargetPort', 'smtpPort']) {
			assert.ok(Number.isInteger(ready[key]) && ready[key] > 0 && ready[key] <= 65535, 'Invalid listener ' + key);
		}
		assert.equal(typeof ready.username, 'string');
		assert.equal(typeof ready.password, 'string');
		assert.match(ready.fingerprint, /^SHA256:/);
		timing.readyMs = performance.now() - started;
		return {
			directory,
			root: join(runtimeRoot, 'ssh-root'),
			host: ready.host,
			port: ready.port,
			transferTargetPort: ready.transferTargetPort,
			controlPort: ready.controlPort,
			controlUrl: 'http://' + ready.host + ':' + ready.controlPort,
			username: ready.username,
			password: ready.password,
			fingerprint: ready.fingerprint,
			close,
		};
	} catch (error) {
		try {
			await close();
		} catch (cleanup) {
			throw new AggregateError([error, cleanup], 'Controlled SSH startup and close failed');
		}
		throw error;
	} finally {
		clearTimeout(timer);
		child.off('message', onReady);
		child.off('error', rejectStartup);
	}
}
