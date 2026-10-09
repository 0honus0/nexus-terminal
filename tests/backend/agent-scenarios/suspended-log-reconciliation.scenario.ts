import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LocalSuspendedSessionLogAdapter } from '../../../packages/backend/src/infrastructure/ssh-suspend/local-suspended-session-log.adapter';
import { SshSuspendService } from '../../../packages/backend/src/modules/ssh-suspend/ssh-suspend.service';

export const suspendedLogReconciliationScenario = async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-suspended-log-reconcile-'));
	const logs = new LocalSuspendedSessionLogAdapter(directory);
	const service = new SshSuspendService(logs, { render: async (source) => source } as never, {
		ownerSweepMs: 60_000,
	});
	try {
		await logs.append('stale-before-restart', 'orphaned-history');
		assert.ok((await logs.position('stale-before-restart')) > 0);

		await service.initialize();
		assert.equal(
			await logs.position('stale-before-restart'),
			0,
			'startup must remove suspended SSH logs that have no recoverable in-memory owner',
		);

		const profiles = [];
		const chunk = Buffer.alloc(64 * 1024, 0x4c);
		const expected = createHash('sha256');
		for (let index = 0; index < 128; index++) expected.update(chunk);
		const expectedHash = expected.digest('hex');
		for (const batchSize of [1, 16]) {
			for (let sample = 0; sample < 3; sample++) {
				const id = `append-profile-${batchSize}-${sample}`;
				const started = performance.now();
				for (let offset = 0; offset < 128; offset += batchSize) {
					await Promise.all(Array.from({ length: batchSize }, () => logs.append(id, chunk)));
				}
				const appendedMs = performance.now() - started;
				const flushStarted = performance.now();
				await logs.flush(id);
				const flushMs = performance.now() - flushStarted;
				assert.equal(await logs.position(id), 8 * 1024 * 1024);
				const hash = createHash('sha256');
				let bytes = 0;
				for await (const data of await logs.openRead(id)) {
					bytes += data.length;
					hash.update(data);
				}
				assert.equal(bytes, 8 * 1024 * 1024);
				assert.equal(hash.digest('hex'), expectedHash);
				await logs.delete(id);
				assert.equal(await logs.position(id), 0);
				profiles.push({ batchSize, sample, appendedMs, flushMs, bytes });
			}
		}
		console.log('[suspended log append profile]', JSON.stringify(profiles));
		if (process.env.NEXUS_LOG_COMPACTION_PROFILE === '1') {
			const compactions = [];
			const block = Buffer.alloc(1024 * 1024, 0x4c);
			const retainedHash = createHash('sha256');
			for (let index = 0; index < 100; index++) retainedHash.update(block);
			const expectedRetainedHash = retainedHash.digest('hex');
			for (const initialMiB of [131, 132]) {
				for (let sample = 0; sample < 3; sample++) {
					const id = `compaction-profile-${initialMiB}-${sample}`;
					const file = path.join(directory, 'temp_suspended_ssh_logs', `${id}.log`);
					const descriptor = fs.openSync(file, 'w', 0o600);
					try {
						for (let index = 0; index < initialMiB; index++) fs.writeFileSync(descriptor, block);
					} finally {
						fs.closeSync(descriptor);
					}
					const started = performance.now();
					const append = logs.append(id, chunk);
					await logs.flush(id);
					await append;
					const drainMs = performance.now() - started;
					const physicalBytes = fs.statSync(file).size;
					assert.equal(
						physicalBytes,
						initialMiB === 132 ? 100 * 1024 * 1024 : initialMiB * 1024 * 1024 + chunk.length,
					);
					assert.equal(await logs.position(id), 100 * 1024 * 1024);
					const hash = createHash('sha256');
					let bytes = 0;
					for await (const data of await logs.openRead(id)) {
						bytes += data.length;
						hash.update(data);
					}
					assert.equal(bytes, 100 * 1024 * 1024);
					assert.equal(hash.digest('hex'), expectedRetainedHash);
					await logs.delete(id);
					assert.equal(await logs.position(id), 0);
					compactions.push({ initialMiB, sample, drainMs, physicalBytes, exportedBytes: bytes });
				}
			}
			console.log('[suspended log compaction profile]', JSON.stringify(compactions));
		}

		return [{ name: 'suspended_ssh_log_startup_reconciliation', value: 1, unit: 'files' }];
	} finally {
		await service.dispose().catch(() => undefined);
		fs.rmSync(directory, { recursive: true, force: true });
	}
};
