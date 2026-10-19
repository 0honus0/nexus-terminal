import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { HeadlessSuspendedCheckpointFactory } from '../../../packages/backend/dist/platform/terminal/adapters/headless-suspended-checkpoint.js';
import { HeadlessTerminalLogRenderer } from '../../../packages/backend/dist/platform/terminal/adapters/headless-suspended-log-export.js';

await test('headless checkpoint serializes real VT state and restores mouse mode', async () => {
	const factory = new HeadlessSuspendedCheckpointFactory();
	const checkpoint = factory.create(undefined, { columns: 80, rows: 24 });
	let restored;
	try {
		await checkpoint.write('hello\rX\x1b[?1006h');
		const snapshot = await checkpoint.snapshot();
		assert.match(snapshot.data, /Xello/u);
		assert.ok(snapshot.data.endsWith('\x1b[?1006h'));
		restored = factory.create(snapshot.data, { columns: snapshot.columns, rows: snapshot.rows });
		const second = await restored.snapshot();
		assert.match(second.data, /Xello/u);
		assert.ok(second.data.endsWith('\x1b[?1006h'));
		await restored.resize({ columns: 100, rows: 30 });
		assert.equal((await restored.snapshot()).columns, 100);
	} finally {
		await restored?.dispose();
		const closing = checkpoint.dispose();
		assert.strictEqual(checkpoint.dispose(), closing);
		await closing;
	}
});

await test('log renderer applies VT editing and releases its input/output streams', async () => {
	const source = Readable.from([Buffer.from('hello\rX\r\n世界\r\n')]);
	const rendered = await new HeadlessTerminalLogRenderer().render(source, { columns: 80, rows: 24 });
	try {
		const chunks = [];
		for await (const bytes of rendered.bytes) {
			chunks.push(Buffer.from(bytes));
		}
		assert.equal(Buffer.concat(chunks).toString('utf8'), 'Xello\n世界\n');
		assert.equal(source.destroyed, true);
	} finally {
		await rendered.release();
	}
});
