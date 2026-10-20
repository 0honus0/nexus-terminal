import path from 'node:path';
import { RemoteFileFailure } from '../model/file-types.js';

interface MutationMember {
	start(): Promise<void>;
	finish(failure: { cause: unknown } | null): void;
}

interface UploadBatch {
	directory: string | null;
	paths: Set<string>;
	members: MutationMember[];
	accepting: boolean;
	started: boolean;
	pending: number;
	failures: unknown[];
	drained: Promise<void>;
	drain(): void;
}

/** One Workspace keeps one durable endpoint claim until all admitted uploads and their cleanup drain. */
export class FileMutationQueue {
	private tail = Promise.resolve();
	private preparation = Promise.resolve();
	private batch: UploadBatch | null = null;

	constructor(private readonly maxUploads: number) {}

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
	): Promise<T> {
		const directory = uploadPath === undefined ? null : path.posix.dirname(uploadPath);
		let batch = this.batch;
		const canJoin =
			batch !== null &&
			batch.accepting &&
			directory !== null &&
			batch.directory === directory &&
			uploadPath !== undefined &&
			!batch.paths.has(uploadPath) &&
			batch.paths.size < this.maxUploads;
		if (!canJoin || batch === null) {
			if (batch) {
				batch.accepting = false;
			}
			let drain!: () => void;
			batch = {
				directory,
				paths: new Set(),
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
		if (uploadPath !== undefined) {
			owner.paths.add(uploadPath);
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

	private async execute(batch: UploadBatch, claim: (work: () => Promise<void>) => Promise<void>): Promise<void> {
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
