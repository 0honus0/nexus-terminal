import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { test } from 'node:test';
import { SshCommandChannel } from '../../../packages/backend/dist/platform/ssh/adapters/ssh2/ssh-channels.js';
import { SftpFileResource } from '../../../packages/backend/dist/modules/remote/files/model/file-resource.js';

test('an archive SSH command keeps stdin available for TERM until remote exit', async () => {
	class Channel extends EventEmitter {
		constructor() {
			super();
			this.stderr = new EventEmitter();
			this.stderr.pause = () => undefined;
			this.stderr.resume = () => undefined;
			this.inputEnded = false;
			this.signals = [];
		}

		pause() {}

		resume() {}

		end() {
			this.inputEnded = true;
		}

		signal(value) {
			if (!this.inputEnded) this.signals.push(value);
		}
	}

	const raw = new Channel();
	const command = new SshCommandChannel(raw, () => undefined, true);
	assert.equal(raw.inputEnded, false, 'stdin must remain open during remote execution');
	command.terminate();
	assert.deepEqual(raw.signals, ['TERM'], 'SIGTERM must be dispatched before EOF');
	assert.equal(raw.inputEnded, false);
	raw.emit('exit', null, 'SIGTERM');
	assert.equal(raw.inputEnded, true, 'stdin EOF follows confirmed remote exit');
	raw.emit('close', null, 'SIGTERM');
	assert.deepEqual(await command.outcome, { status: 'unknown', reason: 'remote_signal', signal: 'TERM' });
});

test('the native archive command preserves writable stdin while ordinary commands send EOF', async () => {
	for (const beforeWriteMarker of [undefined, 'NEXUS_ARCHIVE_START_test']) {
		const writable = new PassThrough();
		let abortMode;
		const raw = {
			readable: Readable.from([]),
			writable,
			outcome: Promise.resolve({ status: 'completed', exitCode: 0, signal: null }),

			onStderr: () => () => undefined,

			close: () => undefined,
		};
		const machine = {
			isOpen: true,

			openRawCommand: async (_command, _signal, mode) => {
				abortMode = mode;
				return raw;
			},
		};
		const resource = new SftpFileResource(1, 'fixture-host-key', machine, {});
		assert.deepEqual(
			await resource.executeCommandLines(
				'echo fixture',
				new AbortController().signal,
				1000,
				() => undefined,
				beforeWriteMarker,
			),
			{ status: 'completed' },
		);
		assert.equal(abortMode, beforeWriteMarker === undefined ? 'close' : 'signal');
		assert.equal(writable.writableEnded, beforeWriteMarker === undefined);
	}
});
