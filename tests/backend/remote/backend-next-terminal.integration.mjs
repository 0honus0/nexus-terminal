import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import headless from '../../../packages/backend/node_modules/@xterm/headless/lib-headless/xterm-headless.js';
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

async function visibleCells(snapshot) {
	const terminal = new headless.Terminal({ cols: snapshot.columns, rows: snapshot.rows, allowProposedApi: true });
	try {
		await new Promise((resolve) => terminal.write(snapshot.data, resolve));
		return Array.from({ length: terminal.rows }, (_, row) => {
			const line = terminal.buffer.active.getLine(terminal.buffer.active.baseY + row);
			return Array.from({ length: terminal.cols }, (_, column) => {
				const cell = line.getCell(column);
				return [cell.getChars(), cell.getWidth(), cell.getFgColor(), cell.getBgColor(), cell.isInverse()];
			});
		});
	} finally {
		terminal.dispose();
	}
}

for (const scenario of [
	{ name: 'normal buffer', setup: '' },
	{ name: 'alternate buffer', setup: '\x1b[?1049h' },
	{ name: 'origin mode', setup: '', afterRegion: '\x1b[?6h\x1b[3;5H' },
	{ name: 'invalid margin ignored', setup: '', afterRegion: '\x1b[11;3r' },
	{ name: 'soft reset', setup: '', afterRegion: '\x1b[!p' },
	{ name: 'hard reset', setup: '', afterRegion: '\x1bc' },
	{ name: 'resize resets margins', setup: '', resize: { columns: 42, rows: 14 } },
]) {
	await test(`checkpoint mid-redraw preserves subsequent scrolling: ${scenario.name}`, async () => {
		const factory = new HeadlessSuspendedCheckpointFactory();
		const control = factory.create(undefined, { columns: 40, rows: 12 });
		let restored;
		try {
			await control.write(
				scenario.setup +
					'\x1b[2J\x1b[10;1H\x1b[44mqueued message' +
					'\x1b[11;1Hcompose input' +
					'\x1b[12;1Hfooter\x1b[0m\x1b[2;9r' +
					(scenario.afterRegion ?? ''),
			);
			if (scenario.resize) await control.resize(scenario.resize);
			const snapshot = await control.snapshot();
			restored = factory.create(snapshot.data, { columns: snapshot.columns, rows: snapshot.rows });
			// Resume in the middle of a redraw, after the margins but before scrolling and resetting them.
			const continuation = 'continued\x1b[9;1H' + 'output\r\n'.repeat(16) + '\x1b[r';
			await control.write(continuation);
			await restored.write(continuation);
			const expected = await visibleCells(await control.snapshot());
			assert.deepEqual(await visibleCells(await restored.snapshot()), expected);
			if (!scenario.resize && !scenario.name.includes('reset')) {
				assert.equal(
					expected[10]
						.slice(0, 13)
						.map((cell) => cell[0])
						.join(''),
					'compose input',
				);
				assert.equal(expected[10][0][3], 4);
			}
		} finally {
			await restored?.dispose();
			await control.dispose();
		}
	});
}
