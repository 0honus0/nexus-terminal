import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { NativeSnapshotRestoreFiles } from '../../../packages/backend/dist/platform/storage/sqlite/adapters/snapshot-restore-files.js';
import {
	SqliteSnapshotRestore,
	initializeSnapshotRestoreSchema,
} from '../../../packages/backend/dist/platform/storage/sqlite/adapters/snapshot-restore-sql.js';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { send, expectStatus, origin } from '../remote/openssh-fixture.mjs';

async function killedAt(directory, phase) {
	const child = fork(new URL('./snapshot-crash-worker.mjs', import.meta.url), [directory, phase], {
		stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
	});
	let errors = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk) => {
		errors = (errors + chunk).slice(-8192);
	});
	const exited = once(child, 'exit');
	let timer;
	try {
		const message = await Promise.race([
			once(child, 'message').then(([value]) => value),
			exited.then(([code, signal]) => {
				throw new Error(`Crash worker exited early: ${code}/${signal}: ${errors}`);
			}),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error('Crash checkpoint timed out: ' + errors)), 10000);
			}),
		]);
		assert.deepEqual(message, { phase });
		assert.equal(child.kill('SIGKILL'), true);
		assert.deepEqual(await exited, [null, 'SIGKILL']);
	} finally {
		clearTimeout(timer);
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL');
		}
		await exited;
	}
}

async function fixture(t, originals = true) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-snapshot-crash-'));
	const path = join(directory, 'state.db');
	const roots = new Map(['appearance', 'artifacts', 'plugins'].map((name) => [name, path + '.' + name]));
	let db;
	t.after(async () => {
		try {
			await db?.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	db = SqliteRuntime.open(path);
	await initializeSnapshotRestoreSchema(db);
	await db.exec('CREATE TABLE regression(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
	await db.run('INSERT INTO regression VALUES(1,?)', ['original']);
	await db.close();
	db = undefined;
	if (originals) {
		for (const [root, location] of roots) {
			await mkdir(location);
			await writeFile(join(location, 'original.txt'), 'original:' + root);
		}
	}
	return {
		directory,
		path,
		roots,
		files: new NativeSnapshotRestoreFiles(path, roots),

		open() {
			db = SqliteRuntime.open(path);
			return db;
		},
	};
}

for (const originals of [true, false]) {
	const publishWindows = originals
		? ['rename-original-before', 'rename-original-after', 'rename-candidate-before', 'rename-candidate-after']
		: ['rename-candidate-before', 'rename-candidate-after'];
	for (const phase of [
		'staged',
		...publishWindows,
		'published',
		'transaction',
		'commit-ack-lost',
		'committed',
		'finalized',
	]) {
		await test(`Snapshot SIGKILL at ${phase}, previous roots ${originals}: real marker controls all roots`, async (t) => {
			const f = await fixture(t, originals);
			await killedAt(f.directory, phase);
			const db = f.open();
			const sql = new SqliteSnapshotRestore(db);
			const committed = phase === 'commit-ack-lost' || phase === 'committed' || phase === 'finalized';
			await f.files.recover((id) => sql.committed(id));
			assert.equal(
				(await db.one('SELECT value FROM regression WHERE id=1')).value,
				committed ? 'candidate' : 'original',
			);
			assert.equal(await sql.needsInitialization(), committed);
			for (const [root, location] of f.roots) {
				if (committed) {
					const names = await readdir(location);
					assert.equal(names.length, 1);
					assert.match(names[0], /^[a-f0-9-]{36}\.blob$/u);
					assert.equal((await readFile(join(location, names[0]))).toString(), 'candidate:' + root + '\0恢复');
				} else if (originals) {
					assert.deepEqual(await readdir(location), ['original.txt']);
					assert.equal(await readFile(join(location, 'original.txt'), 'utf8'), 'original:' + root);
				} else {
					await assert.rejects(readdir(location), { code: 'ENOENT' });
				}
			}
			assert.deepEqual(
				(await readdir(f.directory)).filter((name) => name.includes('.restore-')),
				[],
			);
			await f.files.recover((id) => sql.committed(id));
			if (committed) {
				await sql.initialized();
				assert.equal(await sql.needsInitialization(), false);
			}
		});
	}
}

for (const phase of ['recover-rollback-removed', 'recover-rollback-renamed', 'recover-committed-cleaned']) {
	await test('Snapshot recovery survives another actual SIGKILL at ' + phase, async (t) => {
		const f = await fixture(t);
		const committed = phase === 'recover-committed-cleaned';
		await killedAt(f.directory, committed ? 'commit-ack-lost' : 'published');
		const id = JSON.parse(await readFile(f.path + '.restore-journal', 'utf8')).id;
		await killedAt(f.directory, phase);
		assert.equal(JSON.parse(await readFile(f.path + '.restore-journal', 'utf8')).id, id);
		const db = f.open();
		const sql = new SqliteSnapshotRestore(db);
		assert.equal(await sql.committed(id), committed);
		await f.files.recover((restoreId) => sql.committed(restoreId));
		await f.files.recover((restoreId) => sql.committed(restoreId));
		assert.equal((await db.one('SELECT value FROM regression')).value, committed ? 'candidate' : 'original');
		for (const [root, location] of f.roots) {
			const names = await readdir(location);
			assert.equal(names.length, 1);
			assert.equal(
				await readFile(join(location, names[0]), 'utf8'),
				committed ? 'candidate:' + root + '\0恢复' : 'original:' + root,
			);
		}
		assert.deepEqual(
			(await readdir(f.directory)).filter((name) => name.includes('.restore-')),
			[],
		);
	});
}

for (const phase of ['published', 'committed']) {
	await test(`Snapshot recovery at ${phase} survives a second filesystem failure without guessing commit`, async (t) => {
		const f = await fixture(t);
		await killedAt(f.directory, phase);
		const journalPath = f.path + '.restore-journal';
		const journal = JSON.parse(await readFile(journalPath, 'utf8'));
		const db = f.open();
		const sql = new SqliteSnapshotRestore(db);
		const failure = new Error('controlled recovery filesystem refusal');
		const rename = fs.rename;
		const remove = fs.rm;
		let intercepted = 0;
		t.mock.method(fs, 'rename', async (source, destination) => {
			if (source.endsWith('.previous/plugins')) {
				intercepted += 1;
				throw failure;
			}
			return rename(source, destination);
		});
		t.mock.method(fs, 'rm', async (path, options) => {
			if (phase === 'committed' && path === f.path + '.restore-' + journal.id + '.previous') {
				intercepted += 1;
				throw failure;
			}
			return remove(path, options);
		});
		syncBuiltinESMExports();
		try {
			await assert.rejects(
				f.files.recover((id) => sql.committed(id)),
				(error) => error === failure,
			);
			assert.equal(intercepted, 1);
			assert.equal(JSON.parse(await readFile(journalPath, 'utf8')).id, journal.id);
			assert.equal(
				(await db.one('SELECT value FROM regression')).value,
				phase === 'committed' ? 'candidate' : 'original',
			);
			if (phase === 'published') {
				assert.equal(
					await readFile(
						join(f.path + '.restore-' + journal.id + '.previous', 'plugins', 'original.txt'),
						'utf8',
					),
					'original:plugins',
				);
			}
		} finally {
			t.mock.restoreAll();
			syncBuiltinESMExports();
		}
		await f.files.recover((id) => sql.committed(id));
		await f.files.recover((id) => sql.committed(id));
		for (const [root, location] of f.roots) {
			const names = await readdir(location);
			assert.equal(names.length, 1);
			assert.equal(
				await readFile(join(location, names[0]), 'utf8'),
				phase === 'committed' ? 'candidate:' + root + '\0恢复' : 'original:' + root,
			);
		}
		assert.deepEqual(
			(await readdir(f.directory)).filter((name) => name.includes('.restore-')),
			[],
		);
	});
}

for (const phase of ['staged', 'published']) {
	await test(`Actual application startup reconciles ${phase} SIGKILL before opening HTTP`, async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-snapshot-startup-'));
		const path = join(directory, 'state.db');
		let app;
		t.after(async () => {
			try {
				await app?.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		});
		app = await createApp(path);
		await app.close();
		app = undefined;
		for (const root of ['appearance', 'artifacts', 'plugins']) {
			await mkdir(path + '.' + root, { recursive: true });
			await writeFile(join(path + '.' + root, 'original.txt'), 'original:' + root);
		}
		await killedAt(directory, phase);
		app = await createApp(path);
		const address = await app.listenHttp({
			publicOrigin: origin,
			bindHost: '127.0.0.1',
			port: 0,
			trustedProxies: [],
		});
		expectStatus(await send(address, '', 'GET', '/api/v1/status'), 200);
		for (const root of ['appearance', 'artifacts', 'plugins']) {
			assert.deepEqual(await readdir(path + '.' + root), ['original.txt']);
			assert.equal(await readFile(join(path + '.' + root, 'original.txt'), 'utf8'), 'original:' + root);
		}
		assert.deepEqual(
			(await readdir(directory)).filter((name) => name.includes('.restore-')),
			[],
		);
	});
}

for (const phase of ['published', 'committed']) {
	await test(`Snapshot marker query failure at ${phase} preserves both versions until evidence is restored`, async (t) => {
		const f = await fixture(t);
		await killedAt(f.directory, phase);
		const journal = await readFile(f.path + '.restore-journal');
		const db = f.open();
		const sql = new SqliteSnapshotRestore(db);
		await db.exec('ALTER TABLE snapshot_restore_state RENAME TO unavailable_marker');
		await assert.rejects(f.files.recover((id) => sql.committed(id)));
		assert.deepEqual(await readFile(f.path + '.restore-journal'), journal);
		const id = JSON.parse(journal).id;
		for (const [root, location] of f.roots) {
			assert.equal((await readdir(location)).length, 1);
			assert.equal(
				await readFile(join(f.path + '.restore-' + id + '.previous', root, 'original.txt'), 'utf8'),
				'original:' + root,
			);
		}
		await db.exec('ALTER TABLE unavailable_marker RENAME TO snapshot_restore_state');
		await f.files.recover((restoreId) => sql.committed(restoreId));
		for (const [root, location] of f.roots) {
			const names = await readdir(location);
			assert.equal(names.length, 1);
			assert.equal(
				await readFile(join(location, names[0]), 'utf8'),
				phase === 'committed' ? 'candidate:' + root + '\0恢复' : 'original:' + root,
			);
		}
		assert.equal(
			(await db.one('SELECT value FROM regression')).value,
			phase === 'committed' ? 'candidate' : 'original',
		);
		assert.deepEqual(
			(await readdir(f.directory)).filter((name) => name.includes('.restore-')),
			[],
		);
	});
}

for (const damage of ['json', 'oversized', 'unknown-root', 'duplicate-root', 'symlink']) {
	await test(`Snapshot ${damage} journal refuses recovery and preserves unrelated files`, async (t) => {
		const f = await fixture(t);
		await killedAt(f.directory, 'published');
		const journalPath = f.path + '.restore-journal';
		const original = await readFile(journalPath);
		const journal = JSON.parse(original);
		const sentinel = join(f.directory, 'unrelated.txt');
		await writeFile(sentinel, 'do not touch');
		if (damage === 'json') {
			await writeFile(journalPath, '{');
		}
		if (damage === 'oversized') {
			await writeFile(journalPath, Buffer.alloc(16385, 32));
		}
		if (damage === 'unknown-root') {
			journal.swaps[0].root = '../unrelated.txt';
			await writeFile(journalPath, JSON.stringify(journal));
		}
		if (damage === 'duplicate-root') {
			journal.swaps[1].root = journal.swaps[0].root;
			await writeFile(journalPath, JSON.stringify(journal));
		}
		if (damage === 'symlink') {
			await rm(journalPath);
			await symlink(sentinel, journalPath);
		}
		const db = f.open();
		const sql = new SqliteSnapshotRestore(db);
		await assert.rejects(f.files.recover((id) => sql.committed(id)));
		assert.equal(await readFile(sentinel, 'utf8'), 'do not touch');
		assert.equal((await db.one('SELECT value FROM regression')).value, 'original');
		for (const location of f.roots.values()) {
			assert.equal((await readdir(location)).length, 1);
		}
		await rm(journalPath);
		await writeFile(journalPath, original);
		await f.files.recover((id) => sql.committed(id));
		for (const [root, location] of f.roots) {
			assert.equal(await readFile(join(location, 'original.txt'), 'utf8'), 'original:' + root);
		}
	});
}
