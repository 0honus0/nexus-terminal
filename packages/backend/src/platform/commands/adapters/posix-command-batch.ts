import type { NativeCommandBatchOptions } from '../command-port.js';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { MachineDispatchFailure } from '../../ssh/ssh-port.js';
import type { MachineCommand } from '../../ssh/ssh-port.js';
import type { NativeCommandBatchResult } from '../command-port.js';

interface CapturedCommand {
	stdout: string;
	stderr: string;
	truncated: boolean;
	started: Set<'stdout' | 'stderr'>;
	ended: Map<'stdout' | 'stderr', number>;
}

/** Parse control records before applying the shared output budget, including after truncation. */
export async function executePosixBatch(
	open: (command: string, signal: AbortSignal) => Promise<MachineCommand>,
	invocations: string[],
	onError: 'stop' | 'continue',
	options: NativeCommandBatchOptions,
): Promise<NativeCommandBatchResult> {
	const prefix = '\u001eNEXUS_' + randomUUID().replaceAll('-', '') + ':';
	const suffix = '\u001f';
	const quotedPrefix = "'" + prefix + "'";
	const script = [
		'nexus_batch_failed=0',
		...invocations.flatMap((invocation, index) => [
			`printf '%s${index}:start%s' ${quotedPrefix} '${suffix}'`,
			`printf '%s${index}:start%s' ${quotedPrefix} '${suffix}' >&2`,
			`( ${invocation} ) </dev/null`,
			'nexus_batch_code=$?',
			`printf '%s${index}:%s%s' ${quotedPrefix} "$nexus_batch_code" '${suffix}'`,
			`printf '%s${index}:%s%s' ${quotedPrefix} "$nexus_batch_code" '${suffix}' >&2`,
			'[ "$nexus_batch_code" -eq 0 ] || nexus_batch_failed=1',
			...(onError === 'stop' ? ['[ "$nexus_batch_code" -eq 0 ] || exit "$nexus_batch_code"'] : []),
		]),
		'exit "$nexus_batch_failed"',
	].join('\n');
	const controller = new AbortController();
	const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
	const timer = setTimeout(() => controller.abort(), options.timeoutMs);
	const captured: CapturedCommand[] = invocations.map(() => ({
		stdout: '',
		stderr: '',
		truncated: false,
		started: new Set(),
		ended: new Map(),
	}));
	let remaining = options.maxOutputBytes;
	let channel: MachineCommand | null = null;

	let offStderr = () => {};

	let offStdout = () => {};

	let failure: unknown = null;

	const parser = (stream: 'stdout' | 'stderr') => {
		const decoder = new StringDecoder('utf8');
		let pending = '';
		let current: number | null = null;
		let next = 0;

		const output = (text: string) => {
			if (!text) {
				return;
			}
			const index = current;
			const item = index === null ? undefined : captured[index];
			if (!item || index === null) {
				throw new MachineDispatchFailure('unknown');
			}
			const bytes = Buffer.byteLength(text);
			if (bytes <= remaining) {
				item[stream] += text;
				options.onOutput?.(index, stream, text);
				remaining -= bytes;
			} else {
				// Never split a UTF-8 code point at the capture boundary.
				let accepted = '';
				for (const point of text) {
					const size = Buffer.byteLength(point);
					if (size > remaining) {
						break;
					}
					accepted += point;
					remaining -= size;
				}
				item[stream] += accepted;
				if (accepted) {
					options.onOutput?.(index, stream, accepted);
				}
				item.truncated = true;
				remaining = 0;
			}
		};

		const consume = (text: string, final: boolean) => {
			pending += text;
			while (pending) {
				const start = pending.indexOf(prefix);
				if (start < 0) {
					let keep = final ? 0 : Math.min(prefix.length - 1, pending.length);
					while (keep > 0 && !prefix.startsWith(pending.slice(-keep))) {
						keep--;
					}
					output(pending.slice(0, pending.length - keep));
					pending = pending.slice(pending.length - keep);
					break;
				}
				output(pending.slice(0, start));
				pending = pending.slice(start);
				const end = pending.indexOf(suffix, prefix.length);
				if (end < 0) {
					// Index and POSIX exit status are safe integers, so a control record is bounded.
					if (final || pending.length > prefix.length + 40) {
						throw new MachineDispatchFailure('unknown');
					}
					break;
				}
				const record = pending.slice(prefix.length, end);
				const match = /^(0|[1-9][0-9]*):(start|0|[1-9][0-9]{0,2})$/u.exec(record);
				if (!match) {
					throw new MachineDispatchFailure('unknown');
				}
				const index = Number(match[1]);
				const item = captured[index];
				if (!item || index !== next) {
					throw new MachineDispatchFailure('unknown');
				}
				if (match[2] === 'start') {
					if (current !== null || item.started.has(stream)) {
						throw new MachineDispatchFailure('unknown');
					}
					current = index;
					item.started.add(stream);
				} else {
					const code = Number(match[2]);
					if (current !== index || code > 255) {
						throw new MachineDispatchFailure('unknown');
					}
					item.ended.set(stream, code);
					current = null;
					next += 1;
				}
				pending = pending.slice(end + suffix.length);
			}
			if (final && current !== null) {
				throw new MachineDispatchFailure('unknown');
			}
		};

		return {
			write: (bytes: Uint8Array) => consume(decoder.write(Buffer.from(bytes)), false),

			end: () => consume(decoder.end(), true),
		};
	};

	const stdout = parser('stdout');
	const stderr = parser('stderr');
	try {
		signal.throwIfAborted();
		channel = await open(script, signal);
		const command = channel;
		offStderr = command.onStderr((bytes) => {
			try {
				stderr.write(bytes);
			} catch (error) {
				failure ??= error;
				controller.abort();
			}
		});
		// ssh2.destroy() only sends EOF/CLOSE. A remote process ignoring TERM may
		// keep its readable open after the local outcome has become unknown. Stop
		// consuming on that outcome so the machine owner can retire the transport;
		// awaiting the stream first would prevent that owner from ever releasing it.
		await new Promise<void>((resolve, reject) => {
			const data = (chunk: unknown) => {
				try {
					if (!Buffer.isBuffer(chunk)) {
						throw new MachineDispatchFailure('unknown');
					}
					stdout.write(chunk);
				} catch (error) {
					reject(error);
				}
			};

			const end = () => resolve();

			const error = (cause: unknown) => reject(cause);

			offStdout = () => {
				command.readable.off('data', data);
				command.readable.off('end', end);
				command.readable.off('error', error);
				command.readable.pause();
				resolve();
			};
			command.readable.on('data', data);
			command.readable.once('end', end);
			command.readable.once('error', error);
			void command.outcome.then((outcome) => {
				if (outcome.status === 'unknown') {
					reject(new MachineDispatchFailure('unknown'));
				}
			}, reject);
			if (command.readable.readableEnded) {
				resolve();
			}
		});
		const outcome = await command.outcome;
		if (failure !== null) {
			throw failure;
		}
		if (outcome.status === 'unknown') {
			throw new MachineDispatchFailure('unknown');
		}
		stdout.end();
		stderr.end();
		let stopped = false;
		let anyFailed = false;
		const results: NativeCommandBatchResult['results'] = captured.map((item, index) => {
			if (stopped) {
				if (item.started.size || item.ended.size) {
					throw new MachineDispatchFailure('unknown');
				}
				return { index, status: 'not_started' };
			}
			const code = item.ended.get('stdout');
			if (code === undefined || item.ended.get('stderr') !== code) {
				throw new MachineDispatchFailure('unknown');
			}
			if (code !== 0) {
				anyFailed = true;
				stopped = onError === 'stop';
			}
			return {
				index,
				status: code === 0 ? 'completed' : 'nonzero',
				exitCode: code,
				stdout: item.stdout,
				stderr: item.stderr,
				truncated: item.truncated,
			};
		});
		if ((outcome.status === 'nonzero') !== anyFailed) {
			throw new MachineDispatchFailure('unknown');
		}
		return { results };
	} finally {
		clearTimeout(timer);
		try {
			try {
				offStdout();
			} finally {
				offStderr();
			}
		} finally {
			channel?.close();
		}
	}
}
