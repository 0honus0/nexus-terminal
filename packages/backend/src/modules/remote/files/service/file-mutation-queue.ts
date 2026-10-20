import path from 'node:path';
import { FileCommandNotStarted, RemoteFileFailure } from '../model/file-types.js';
import type { FileCompressionFootprint } from '../model/file-task-types.js';

interface MutationMember {
	start(): Promise<void>;
	finish(failure: { cause: unknown } | null): void;
}

interface MutationBatch {
	kind: 'upload' | 'compression' | null;
	directory: string | null;
	paths: Set<string>;
	reads: Set<string>;
	members: MutationMember[];
	accepting: boolean;
	started: boolean;
	pending: number;
	failures: unknown[];
	drained: Promise<void>;
	drain(): void;
}

/** One Workspace keeps one durable endpoint claim until all admitted writes and their cleanup drain. */
export class FileMutationQueue {
	private tail = Promise.resolve();
	private preparation = Promise.resolve();
	private batch: MutationBatch | null = null;

	constructor(private readonly maxMembers: number) {}

	prepare<T>(work: () => Promise<T>): Promise<T> {
		const result = this.preparation.then(work);
		this.preparation = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	run<T>(
		work: () => Promise<T>,
		claim: (work: () => Promise<void>) => Promise<void>,
		signal: AbortSignal,
		uploadPath?: string,
		compression?: FileCompressionFootprint | null,
	): Promise<T> {
		const directory = compression?.directory ?? (uploadPath === undefined ? null : path.posix.dirname(uploadPath));
		const destination = compression?.destination ?? uploadPath;
		const kind = compression ? 'compression' : uploadPath === undefined ? null : 'upload';
		const current = this.batch;
		const canJoin =
			current !== null &&
			current.accepting &&
			current.kind === kind &&
			directory !== null &&
			current.directory === directory &&
			destination !== undefined &&
			!current.paths.has(destination) &&
			!current.reads.has(destination) &&
			!compression?.sources.some((source) => current.paths.has(source)) &&
			current.paths.size < this.maxMembers;
		let batch = current;
		if (!canJoin || batch === null) {
			if (batch) {
				batch.accepting = false;
			}
			let drain!: () => void;
			batch = {
				kind,
				directory,
				paths: new Set(),
				reads: new Set(),
				members: [],
				accepting: directory !== null,
				started: false,
				pending: 0,
				failures: [],
				drained: new Promise<void>((resolve) => {
					drain = resolve;
				}),
				drain,
			};
			this.batch = batch;
			const next = batch;
			this.tail = this.tail.then(() => this.execute(next, claim));
		}
		const owner = batch;
		if (destination !== undefined) {
			owner.paths.add(destination);
		}
		for (const source of compression?.sources ?? []) {
			owner.reads.add(source);
		}
		owner.pending++;
		return new Promise<T>((resolve, reject) => {
			let result!: T;
			let failed = false;
			let error: unknown;
			let started = false;
			let cancelled = false;

			const completed = () => {
				if (--owner.pending === 0) {
					owner.accepting = false;
					owner.drain();
				}
			};

			const cancelQueued = () => {
				if (started || cancelled) {
					return;
				}
				cancelled = true;
				signal.removeEventListener('abort', cancelQueued);
				completed();
				reject(new RemoteFileFailure('remote_unavailable'));
			};

			const member: MutationMember = {
				async start() {
					if (cancelled) {
						return;
					}
					started = true;
					signal.removeEventListener('abort', cancelQueued);
					try {
						result = await work();
					} catch (cause) {
						failed = true;
						error = cause;
						owner.failures.push(cause);
						owner.accepting = false;
					} finally {
						completed();
					}
					// No writer was launched and this member's resources have drained. Its
					// cancellation can retire while peers keep the durable endpoint claim.
					// Mutating results and unknown failures still await the whole settlement.
					if (
						owner.kind === 'compression' &&
						owner.pending > 0 &&
						signal.aborted &&
						error instanceof FileCommandNotStarted
					) {
						reject(error);
					}
				},

				finish(failure) {
					signal.removeEventListener('abort', cancelQueued);
					if (failure !== null) {
						reject(failure.cause);
					} else if (failed) {
						reject(error);
					} else {
						resolve(result);
					}
				},
			};
			owner.members.push(member);
			signal.addEventListener('abort', cancelQueued, { once: true });
			if (signal.aborted) {
				cancelQueued();
			}
			if (owner.started) {
				void member.start();
			}
		});
	}

	private async execute(batch: MutationBatch, claim: (work: () => Promise<void>) => Promise<void>): Promise<void> {
		let executionFailure: AggregateError | null = null;
		let settlementFailure: { cause: unknown } | null = null;
		try {
			if (batch.pending === 0) {
				return;
			}
			await claim(async () => {
				batch.started = true;
				for (const member of batch.members) {
					void member.start();
				}
				await batch.drained;
				if (batch.failures.length) {
					executionFailure = new AggregateError(batch.failures, 'Workspace mutation batch failed');
					throw executionFailure;
				}
			});
		} catch (cause) {
			// The claim owner has already classified and persisted the original member failures.
			// Acquisition or settlement failure affects every receipt, including otherwise successful members.
			if (executionFailure === null || cause !== executionFailure) {
				settlementFailure = { cause };
			}
		} finally {
			batch.accepting = false;
			if (this.batch === batch) {
				this.batch = null;
			}
			for (const member of batch.members) {
				member.finish(settlementFailure);
			}
		}
	}
}
