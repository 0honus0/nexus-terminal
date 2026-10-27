import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { NativeSnapshotRestoreFiles } from '../../../packages/backend/dist/platform/storage/sqlite/adapters/snapshot-restore-files.js';
import { SqliteSnapshotRestore } from '../../../packages/backend/dist/platform/storage/sqlite/adapters/snapshot-restore-sql.js';
import { SqliteTransactionAdapter } from '../../../packages/backend/dist/platform/storage/sqlite/adapters/transaction-sql.js';

const [directory, phase] = process.argv.slice(2);
const path = join(directory, 'state.db');
const roots = new Map(['appearance', 'artifacts', 'plugins'].map((name) => [name, path + '.' + name]));
const db = SqliteRuntime.open(path);
const files = new NativeSnapshotRestoreFiles(path, roots);
const sql = new SqliteSnapshotRestore(db);
const signal = new AbortController().signal;

async function checkpoint() {
	await new Promise((resolve, reject) => process.send({ phase }, (error) => (error ? reject(error) : resolve())));
	// The parent sends SIGKILL. No shutdown/rollback/finally is allowed to run.
	await new Promise(() => {});
}

// Stop at an actual filesystem boundary inside publish, without adding product hooks.
if (phase.startsWith('rename-')) {
	const rename = fs.rename;
	fs.rename = async (source, destination) => {
		const original = source === roots.get('appearance');
		const candidate = destination === roots.get('appearance') && source.endsWith('.staging/appearance');
		const selected = (phase.includes('original') && original) || (phase.includes('candidate') && candidate);
		if (selected && phase.endsWith('-before')) {
			await checkpoint();
		}
		await rename(source, destination);
		if (selected && phase.endsWith('-after')) {
			await checkpoint();
		}
	};
	syncBuiltinESMExports();
}

try {
	if (phase.startsWith('recover-')) {
		const rename = fs.rename;
		const remove = fs.rm;
		fs.rename = async (source, destination) => {
			const reverting = source.endsWith('.previous/plugins');
			await rename(source, destination);
			if (reverting && phase === 'recover-rollback-renamed') {
				await checkpoint();
			}
		};
		fs.rm = async (path, options) => {
			await remove(path, options);
			if (
				(phase === 'recover-rollback-removed' && path === roots.get('plugins')) ||
				(phase === 'recover-committed-cleaned' && path.endsWith('.previous'))
			) {
				await checkpoint();
			}
		};
		syncBuiltinESMExports();
		await files.recover((id) => sql.committed(id));
		throw new Error('Recovery did not reach the requested internal checkpoint');
	}
	const archive = [...roots.keys()].map((root) => {
		const content = Buffer.from('candidate:' + root + '\0恢复');
		return {
			reference: {
				root,
				key: randomUUID(),
				bytes: content.length,
				sha256: createHash('sha256').update(content).digest('hex'),
			},
			content,
		};
	});
	const journal = await files.stage(archive, signal);
	if (phase === 'staged') {
		await checkpoint();
	}
	await files.publish(journal);
	if (phase === 'published') {
		await checkpoint();
	}
	const tables = [{ name: 'regression', columns: ['id', 'value'] }];
	const rows = new Map([['regression', [{ id: 1, value: 'candidate' }]]]);
	if (phase === 'transaction') {
		await db.transaction(async (tx) => {
			await tx.run('UPDATE regression SET value=? WHERE id=1', ['uncommitted']);
			await tx.run('INSERT INTO snapshot_restore_state VALUES(1,?,0)', [journal.id]);
			await checkpoint();
		});
	}
	if (phase === 'commit-ack-lost') {
		const commit = SqliteTransactionAdapter.prototype.commit;
		SqliteTransactionAdapter.prototype.commit = async function () {
			await commit.call(this);
			// The actual SQLite COMMIT succeeded, but Runtime and its caller have not received completion.
			await checkpoint();
		};
	}
	await sql.commit(journal.id, tables, rows, signal);
	if (phase === 'committed') {
		await checkpoint();
	}
	if (await files.finalize(journal)) {
		throw new Error('Unexpected pending cleanup');
	}
	if (phase === 'finalized') {
		await checkpoint();
	}
	throw new Error('Unknown crash phase');
} catch (error) {
	console.error(error);
	process.exitCode = 1;
	await db.close();
	process.disconnect();
}
