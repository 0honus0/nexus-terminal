import type { MachineCommand, MachineCommandOutcome } from './ssh-port.js';
import { MachineDispatchFailure } from './ssh-port.js';

/** Byte I/O only; protocol framing and application authority remain with their respective owners. */
export class MachineCommandDuplex {
	readonly closed: Promise<void>;
	readonly outcome: Promise<MachineCommandOutcome>;
	private readonly reads = new Map<'stdout' | 'stderr', Promise<{ bytes: Uint8Array; eof: boolean }>>();
	private readonly remainder = new Map<'stdout' | 'stderr', Uint8Array>();
	private readonly tasks = new Set<Promise<unknown>>();
	private writeChain: Promise<void> = Promise.resolve();
	private closePromise: Promise<void> | null = null;
	private isClosed = false;
	private total = 0;
	private readonly abort: () => void;
	private readonly failures: unknown[] = [];

	constructor(
		private readonly command: MachineCommand,
		private readonly signal: AbortSignal,
		private readonly maxReadBytes: number,
	) {
		this.outcome = command.outcome;
		this.closed = new Promise((resolve) => {
			command.onClose(() => {
				this.isClosed = true;
				resolve();
			});
		});
		this.abort = () => {
			try {
				command.cancel();
			} catch (error) {
				this.failures.push(error);
			}
		};
		signal.addEventListener('abort', this.abort, { once: true });
		if (signal.aborted) {
			this.abort();
		}
	}

	read(stream: 'stdout' | 'stderr', maxBytes: number): Promise<{ bytes: Uint8Array; eof: boolean }> {
		if (this.closePromise || this.reads.has(stream) || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
			return Promise.reject(new MachineDispatchFailure('unknown'));
		}
		const source = stream === 'stdout' ? this.command.readable : this.command.stderrReadable;
		const pending = this.track(
			Promise.resolve().then(async () => {
				this.signal.throwIfAborted();
				const remaining = this.remainder.get(stream);
				if (remaining?.byteLength) {
					return this.chunk(stream, remaining, maxBytes);
				}
				return new Promise<{ bytes: Uint8Array; eof: boolean }>((resolve, reject) => {
					const clean = () => {
						source.off('readable', attempt);
						source.off('end', attempt);
						source.off('close', attempt);
						source.off('error', failed);
						this.signal.removeEventListener('abort', aborted);
					};

					const failed = (error: unknown) => {
						clean();
						reject(new MachineDispatchFailure('unknown', { cause: error }));
					};

					const aborted = () => failed(this.signal.reason);

					const attempt = () => {
						try {
							const value: unknown = source.read();
							if (value !== null) {
								if (!(value instanceof Uint8Array)) {
									throw new MachineDispatchFailure('unknown');
								}
								this.total += value.byteLength;
								if (this.total > this.maxReadBytes) {
									this.cancel();
									throw new MachineDispatchFailure('unknown');
								}
								clean();
								resolve(this.chunk(stream, value, maxBytes));
							} else if (this.isClosed || source.readableEnded || source.destroyed) {
								clean();
								resolve({ bytes: new Uint8Array(0), eof: true });
							}
						} catch (error) {
							failed(error);
						}
					};

					source.on('readable', attempt);
					source.on('end', attempt);
					source.on('close', attempt);
					source.on('error', failed);
					this.signal.addEventListener('abort', aborted, { once: true });
					if (this.signal.aborted) {
						aborted();
					} else {
						attempt();
					}
				});
			}),
		);
		this.reads.set(stream, pending);
		void pending.then(
			() => this.reads.delete(stream),
			() => this.reads.delete(stream),
		);
		return pending;
	}

	private chunk(
		stream: 'stdout' | 'stderr',
		bytes: Uint8Array,
		maxBytes: number,
	): { bytes: Uint8Array; eof: boolean } {
		const result = bytes.slice(0, maxBytes);
		this.remainder.set(stream, bytes.subarray(result.byteLength));
		return { bytes: result, eof: false };
	}

	write(bytes: Uint8Array): Promise<void> {
		if (this.closePromise || this.isClosed) {
			return Promise.reject(new MachineDispatchFailure('unknown'));
		}
		const pending = this.writeChain.then(() => {
			this.signal.throwIfAborted();
			return new Promise<void>((resolve, reject) => {
				const target = this.command.writable;
				let callbackDone = false;
				let needsDrain: boolean | null = null;
				let drained = false;

				const clean = () => {
					target.off('drain', drain);
					target.off('error', failed);
					target.off('close', closed);
				};

				const failed = (error: unknown) => {
					clean();
					reject(new MachineDispatchFailure('unknown', { cause: error }));
				};

				const closed = () => failed(new Error('Command closed before write acknowledgement'));

				const finish = () => {
					if (callbackDone && needsDrain !== null && (!needsDrain || drained)) {
						clean();
						resolve();
					}
				};

				const drain = () => {
					drained = true;
					finish();
				};

				target.on('drain', drain);
				target.on('error', failed);
				target.on('close', closed);
				try {
					needsDrain = !target.write(bytes, (error?: Error | null) => {
						if (error) {
							failed(error);
						} else {
							callbackDone = true;
							finish();
						}
					});
					finish();
				} catch (error) {
					failed(error);
				}
			});
		});
		this.writeChain = pending;
		return this.track(pending);
	}

	end(): Promise<void> {
		if (this.closePromise || this.isClosed) {
			return Promise.reject(new MachineDispatchFailure('unknown'));
		}
		const pending = this.writeChain.then(() => {
			this.signal.throwIfAborted();
			return new Promise<void>((resolve, reject) => {
				const target = this.command.writable;

				const clean = () => {
					target.off('error', failed);
					target.off('close', closed);
				};

				const failed = (error: unknown) => {
					clean();
					reject(new MachineDispatchFailure('unknown', { cause: error }));
				};

				const closed = () => failed(new Error('Command closed before stdin finished'));

				target.on('error', failed);
				target.on('close', closed);
				try {
					target.end(() => {
						clean();
						resolve();
					});
				} catch (error) {
					failed(error);
				}
			});
		});
		this.writeChain = pending;
		return this.track(pending);
	}

	cancel(): void {
		this.command.cancel();
	}

	private track<T>(task: Promise<T>): Promise<T> {
		this.tasks.add(task);
		void task.then(
			() => this.tasks.delete(task),
			() => this.tasks.delete(task),
		);
		return task;
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.closePromise = Promise.resolve().then(async () => {
				try {
					try {
						this.command.close();
					} catch (error) {
						// A failed close request does not settle the channel or its writes.
						this.failures.push(error);
					}
					// ssh2 emits channel close only after its readable side has drained.
					// Cancelling the outstanding reads removes their listeners, so a
					// paused tail must be consumed by the lifetime owner during shutdown.
					this.command.readable.resume();
					this.command.stderrReadable.resume();
					await this.closed;
					await Promise.allSettled([...this.tasks]);
					if (this.failures.length) {
						throw new AggregateError(this.failures, 'Command cancellation failed');
					}
				} finally {
					this.signal.removeEventListener('abort', this.abort);
				}
			});
		}
		return this.closePromise;
	}
}
