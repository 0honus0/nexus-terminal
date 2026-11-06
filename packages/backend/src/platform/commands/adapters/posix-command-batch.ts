import type { NativeCommandBatchOptions } from '../command-port.js';
import { NativeCommandCleanupFailure } from '../command-port.js';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
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

/** Stream all output to the owner; the result budget limits only the inline preview. */
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
	let executionFailure: unknown = null;

	const readers: Promise<void>[] = [];
	const readingStopped = new AbortController();
	const readingSignal = AbortSignal.any([signal, readingStopped.signal]);

	const stdoutParser = (stream: 'stdout' | 'stderr') => {
		const decoder = new StringDecoder('utf8');
		let pending = '';
		let current: number | null = null;
		let next = 0;

		const output = async (text: string) => {
			if (!text) {
				return;
			}
			const index = current;
			const item = index === null ? undefined : captured[index];
			if (!item || index === null) {
				throw new MachineDispatchFailure('unknown');
			}
			await options.onOutput?.(index, stream, text, readingSignal);
			const bytes = Buffer.byteLength(text);
			if (bytes <= remaining) {
				item[stream] += text;
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
				item.truncated = true;
				remaining = 0;
			}
		};

		const consume = async (text: string, final: boolean) => {
			pending += text;
			while (pending) {
				const start = pending.indexOf(prefix);
				if (start < 0) {
					let keep = final ? 0 : Math.min(prefix.length - 1, pending.length);
					while (keep > 0 && !prefix.startsWith(pending.slice(-keep))) {
						keep--;
					}
					await output(pending.slice(0, pending.length - keep));
					pending = pending.slice(pending.length - keep);
					break;
				}
				await output(pending.slice(0, start));
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

	const stdout = stdoutParser('stdout');
	const stderr = stdoutParser('stderr');
	try {
		signal.throwIfAborted();
		channel = await open(script, signal);
		const command = channel;
		// Each stream pauses after one chunk; both serialize through the append owner.
		// At most one delivered chunk per stream waits outside the SSH buffers.
		let writing = Promise.resolve();

		const consume = (readable: Readable, parser: ReturnType<typeof stdoutParser>) =>
			new Promise<void>((resolve, reject) => {
				let done = false;
				let pending = Promise.resolve();

				const cleanup = () => {
					readable.off('data', data);
					readable.off('end', end);
					readable.off('error', fail);
					readingSignal.removeEventListener('abort', abort);
					readable.pause();
				};

				const finish = (error?: unknown) => {
					if (done) {
						return;
					}
					done = true;
					cleanup();
					void pending.then(() => (error === undefined ? resolve() : reject(error)), reject);
				};

				const fail = (error: unknown) => finish(error);

				const abort = () => finish(new MachineDispatchFailure('unknown'));

				const data = (chunk: unknown) => {
					readable.pause();
					if (!Buffer.isBuffer(chunk)) {
						fail(new MachineDispatchFailure('unknown'));
						return;
					}
					pending = writing.then(() => parser.write(chunk));
					writing = pending;
					void pending.then(() => {
						if (!done && !readingSignal.aborted) {
							readable.resume();
						}
					}, fail);
				};

				const end = () => {
					pending = writing.then(() => parser.end());
					writing = pending;
					finish();
				};

				readable.on('data', data);
				readable.once('end', end);
				readable.once('error', fail);
				readingSignal.addEventListener('abort', abort, { once: true });
				if (readingSignal.aborted) {
					abort();
				} else if (readable.readableEnded) {
					end();
				} else {
					readable.resume();
				}
			});

		// Direct stderr consumption survives SSH channel-close while buffered data drains.
		readers.push(consume(command.readable, stdout), consume(command.stderrReadable, stderr));
		const outcome = command.outcome.then((value) => {
			if (value.status === 'unknown') {
				readingStopped.abort();
				throw new MachineDispatchFailure('unknown');
			}
			return value;
		});
		const [, result] = await Promise.all([Promise.all(readers), outcome]);

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
		if ((result.status === 'nonzero') !== anyFailed) {
			throw new MachineDispatchFailure('unknown');
		}
		return { results };
	} catch (cause) {
		controller.abort();
		executionFailure =
			cause instanceof MachineDispatchFailure
				? cause
				: new MachineDispatchFailure(channel === null ? 'not_started' : 'unknown', { cause });
		throw executionFailure;
	} finally {
		clearTimeout(timer);
		readingStopped.abort();
		await Promise.allSettled(readers);
		try {
			channel?.close();
		} catch (cleanup) {
			throw new NativeCommandCleanupFailure({
				cause: executionFailure === null ? cleanup : new AggregateError([executionFailure, cleanup]),
			});
		}
	}
}
