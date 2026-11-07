import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import {
	processIdentity,
	recoverModuleDirectories,
	writeProcessJournal,
	syncModuleDirectory,
	removeModuleDirectory,
} from './module-recovery.js';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
	IsolatedModuleInstance,
	ModuleRuntime,
	IsolatedModuleHostScope,
	IsolatedModuleSourceInvocation,
} from '../module-runtime.js';
import { ModuleRuntimeFailure, ModuleInvocationFailure } from '../module-runtime.js';
import { FailureSummary } from '../../lifecycle/failure-summary.js';

const MAX_MESSAGE_BYTES = 512 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new ModuleRuntimeFailure('protocol_invalid');
	}
	return value;
}

function executionFailure(cause: unknown, firstFailure: ModuleRuntimeFailure | null): ModuleRuntimeFailure {
	if (firstFailure !== null && cause === firstFailure) {
		return firstFailure;
	}
	return cause instanceof ModuleRuntimeFailure && cause.kind === 'execution_unknown'
		? cause
		: new ModuleRuntimeFailure('execution_unknown', { cause });
}

class NodeModuleInstance implements IsolatedModuleInstance {
	private readonly pending = new Map<
		number,
		{
			method: string;
			resolve(value: unknown): void;
			reject(error: unknown): void;
			timer: NodeJS.Timeout;
			source?: IsolatedModuleSourceInvocation;
			host?: (request: unknown) => Promise<unknown>;
		}
	>();
	private readonly hosts = new Set<Promise<void>>();
	private ordinaryHosts = 0;
	private writes = Promise.resolve();
	private activeSourceWrite = false;
	private activeFiniteWrite = false;
	private readonly finiteWriteErrors = new WeakSet<Error>();
	private readonly sourceWriteErrors = new WeakSet<Error>();
	private buffer = Buffer.alloc(0);
	private sequence = 0;
	private hostSequence = 0;
	private closing = false;
	private failure: ModuleRuntimeFailure | null = null;
	private hasNonSourceFailure = false;
	private readonly laterFailures = new FailureSummary();
	private readonly recordedLaterFailures = new WeakSet<ModuleRuntimeFailure>();
	private closePromise: Promise<void> | null = null;
	private readySettled = false;
	private readonly ready: Promise<void>;

	private resolveReady: () => void = () => undefined;

	private rejectReady: (error: unknown) => void = () => undefined;

	private readonly readyTimer: NodeJS.Timeout;
	private readonly processExit: Promise<void>;
	readonly exited: Promise<void>;

	constructor(
		private readonly child: ChildProcessWithoutNullStreams,
		private readonly root: string,
		private readonly host: (input: unknown, scope: IsolatedModuleHostScope) => Promise<unknown>,
	) {
		this.ready = new Promise((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});
		void this.ready.catch(() => undefined);
		this.readyTimer = setTimeout(() => this.fail(new ModuleRuntimeFailure('unavailable')), 15000);
		this.processExit = new Promise((resolve) => {
			child.once('close', () => {
				if (!this.closing && this.failure === null) {
					this.fail(new ModuleRuntimeFailure('execution_unknown'));
				}
				resolve();
			});
		});
		this.exited = this.processExit.then(() => {
			if (this.failure) {
				throw this.failure;
			}
		});
		// Construction can fail before the application has received the instance.
		void this.exited.catch(() => undefined);
		child.once('error', (cause) => this.fail(new ModuleRuntimeFailure('unavailable', { cause })));
		child.stdin.on('error', (cause: Error) => {
			const finite = this.activeFiniteWrite || this.finiteWriteErrors.has(cause);
			if (finite && (this.closing || this.failure)) {
				return;
			}
			if (this.activeSourceWrite || this.sourceWriteErrors.has(cause)) {
				this.failSource(new ModuleRuntimeFailure('protocol_invalid', { cause }));
				return;
			}
			this.fail(new ModuleRuntimeFailure('execution_unknown', { cause }));
		});
		child.stdout.on('error', (cause) => this.fail(new ModuleRuntimeFailure('execution_unknown', { cause })));
		// Do not retain or expose arbitrary plugin stderr; drain it to prevent a blocked pipe.
		child.stderr.on('data', () => undefined);
		child.stderr.on('error', (cause) => this.fail(new ModuleRuntimeFailure('execution_unknown', { cause })));
		child.stdout.on('data', (chunk: Buffer) => {
			if (this.failure) {
				return;
			}
			try {
				this.read(chunk);
			} catch (cause) {
				const failure =
					cause instanceof ModuleRuntimeFailure
						? cause
						: new ModuleRuntimeFailure('protocol_invalid', { cause });
				if ([...this.pending.values()].some((item) => item.method === 'invoke' && item.source)) {
					this.failSource(failure);
				} else {
					this.fail(failure);
				}
			}
		});
	}

	async waitReady(): Promise<void> {
		await this.ready;
	}

	private failSource(cause: ModuleRuntimeFailure): void {
		const hasOrdinaryInvocation = [...this.pending.values()].some(
			(item) => item.method === 'invoke' && !item.source,
		);
		// Only an explicit source failure with no ordinary Host work may be finite.
		// Process crashes and generic stream errors never enter this branch.
		if (
			(!this.failure || this.failure.kind === 'source_failed') &&
			!this.hasNonSourceFailure &&
			this.ordinaryHosts === 0 &&
			!hasOrdinaryInvocation
		) {
			if (this.failure?.cause === cause) {
				return;
			}
			this.fail(new ModuleRuntimeFailure('source_failed', { cause }));
		} else {
			this.fail(cause);
		}
	}

	private fail(error: ModuleRuntimeFailure): void {
		if (error.kind !== 'source_failed') {
			this.hasNonSourceFailure = true;
		}
		if (this.failure === null) {
			this.failure = error;
		} else if (error !== this.failure && !this.recordedLaterFailures.has(error)) {
			this.recordedLaterFailures.add(error);
			this.laterFailures.record(error);
		}
		clearTimeout(this.readyTimer);
		this.rejectReady(this.failure);
		for (const item of this.pending.values()) {
			clearTimeout(item.timer);
			item.reject(this.failure);
		}
		this.pending.clear();
		if (this.child.exitCode === null && this.child.signalCode === null) {
			this.child.kill('SIGKILL');
		}
	}

	private write(value: unknown, origin?: 'source' | 'expired'): Promise<void> {
		const finiteReply = origin !== undefined;
		const sourceReply = origin === 'source';
		const encoded = JSON.stringify(value) + '\n';
		if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) {
			return Promise.reject(new ModuleRuntimeFailure('protocol_invalid'));
		}
		const next = this.writes
			.then(() => {
				if (
					this.failure ||
					!this.child.stdin.writable ||
					this.child.exitCode !== null ||
					this.child.signalCode !== null
				) {
					if (finiteReply) {
						return;
					}
					throw this.failure ?? new ModuleRuntimeFailure('unavailable');
				}
				return new Promise<void>((resolve, reject) => {
					this.activeSourceWrite = sourceReply;
					this.activeFiniteWrite = finiteReply;
					this.child.stdin.write(encoded, (error) => {
						this.activeSourceWrite = false;
						this.activeFiniteWrite = false;
						if (error) {
							if (finiteReply) {
								this.finiteWriteErrors.add(error);
							}
							if (sourceReply) {
								this.sourceWriteErrors.add(error);
							}
							reject(error);
						} else {
							resolve();
						}
					});
				});
			})
			.catch((cause) => {
				if (finiteReply) {
					if (
						this.closing ||
						this.failure ||
						!this.child.stdin.writable ||
						this.child.exitCode !== null ||
						this.child.signalCode !== null
					) {
						return;
					}
				}
				if (sourceReply) {
					throw new ModuleRuntimeFailure('protocol_invalid', { cause });
				}
				throw executionFailure(cause, this.failure);
			});
		this.writes = next;
		void next.catch((cause) => (sourceReply ? this.failSource(cause) : this.fail(cause)));
		return next;
	}

	private read(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		let end: number;
		while ((end = this.buffer.indexOf(10)) !== -1) {
			if (end > MAX_MESSAGE_BYTES) {
				throw new ModuleRuntimeFailure('protocol_invalid');
			}
			const value: unknown = JSON.parse(
				new TextDecoder('utf-8', { fatal: true }).decode(this.buffer.subarray(0, end)),
			);
			this.buffer = this.buffer.subarray(end + 1);
			this.message(record(value));
		}
		if (this.buffer.byteLength > MAX_MESSAGE_BYTES) {
			throw new ModuleRuntimeFailure('protocol_invalid');
		}
	}

	private message(message: Record<string, unknown>): void {
		if (message.kind === 'ready') {
			if (this.readySettled || message.protocol !== 1 || Object.keys(message).length !== 2) {
				throw new ModuleRuntimeFailure('protocol_invalid');
			}
			this.readySettled = true;
			clearTimeout(this.readyTimer);
			this.resolveReady();
			return;
		}
		if (
			!this.readySettled ||
			typeof message.id !== 'number' ||
			!Number.isSafeInteger(message.id) ||
			message.id < 1
		) {
			throw new ModuleRuntimeFailure('protocol_invalid');
		}
		if (message.kind === 'result') {
			const item = this.pending.get(message.id);
			if (!item || typeof message.ok !== 'boolean' || Object.keys(message).length !== (message.ok ? 4 : 3)) {
				throw new ModuleRuntimeFailure('protocol_invalid');
			}
			if (
				message.ok &&
				item.method !== 'invoke' &&
				item.method !== 'activate' &&
				(item.method === 'health' ? typeof message.value !== 'boolean' : message.value !== null)
			) {
				throw new ModuleRuntimeFailure('protocol_invalid');
			}
			clearTimeout(item.timer);
			this.pending.delete(message.id);
			if (message.ok) {
				item.resolve(message.value);
			} else if (item.method === 'invoke' && !item.source) {
				item.reject(new ModuleInvocationFailure(message.id));
			} else {
				item.reject(new ModuleRuntimeFailure(item.source ? 'protocol_invalid' : 'execution_unknown'));
			}
			return;
		}
		if (
			(message.kind !== 'host' && message.kind !== 'source') ||
			Object.keys(message).length !== 4 ||
			(message.kind === 'source' && message.controlId === null) ||
			(message.controlId !== null &&
				(typeof message.controlId !== 'number' ||
					!Number.isSafeInteger(message.controlId) ||
					message.controlId < 1)) ||
			message.id <= this.hostSequence
		) {
			throw new ModuleRuntimeFailure('protocol_invalid');
		}
		this.hostSequence = message.id;
		const id = message.id;
		const controlId = message.controlId;
		const sourceRequest = message.kind === 'source';
		const scope: IsolatedModuleHostScope =
			controlId === null
				? { kind: 'lifecycle' }
				: typeof controlId === 'number' && this.pending.get(controlId)?.method === 'invoke'
					? { kind: 'invoke', controlId }
					: { kind: 'expired' };
		const invocation = scope.kind === 'invoke' ? this.pending.get(scope.controlId) : undefined;
		const source = invocation?.source;
		const ordinaryHost = !source && !sourceRequest;
		if (ordinaryHost) {
			this.ordinaryHosts++;
		}
		const task = Promise.resolve().then(async () => {
			if (sourceRequest && !source) {
				// A retired source closure never enters the global Host, even while
				// an ordinary invocation is live. Ordinary expired calls retain their
				// explicit scope so the application adapter can project its refusal.
				await this.write({ kind: 'host.result', id, error: true }, 'expired');
				return;
			}
			if (source) {
				let value: unknown;
				try {
					value = await source.read(message.input);
				} catch {
					// The source owner retains the actual failure. This finite refusal
					// dispatched no Host effect and cannot borrow the global Host bridge.
					await this.write({ kind: 'host.result', id, error: true }, 'source');
					return;
				}
				await this.write({ kind: 'host.result', id, value }, 'source');
				return;
			}
			const value = invocation?.host
				? await invocation.host(message.input)
				: await this.host(message.input, scope);
			await this.write({ kind: 'host.result', id, value }, scope.kind === 'expired' ? 'expired' : undefined);
		});
		this.hosts.add(task);
		void task.then(
			() => {
				this.hosts.delete(task);
				if (ordinaryHost) {
					this.ordinaryHosts--;
				}
			},
			(cause) => {
				this.hosts.delete(task);
				if (ordinaryHost) {
					this.ordinaryHosts--;
				}
				if (source) {
					this.failSource(
						cause instanceof ModuleRuntimeFailure
							? cause
							: new ModuleRuntimeFailure('protocol_invalid', { cause }),
					);
				} else {
					this.fail(executionFailure(cause, this.failure));
				}
			},
		);
	}

	private control(
		method: string,
		deadline?: number,
		inputJson?: string,
		timeoutMs = 15000,
		signal?: AbortSignal,
		source?: IsolatedModuleSourceInvocation,
		host?: (request: unknown) => Promise<unknown>,
	): Promise<unknown> {
		if (this.failure || this.sequence >= Number.MAX_SAFE_INTEGER) {
			return Promise.reject(this.failure ?? new ModuleRuntimeFailure('unavailable'));
		}
		const id = ++this.sequence;
		const result = new Promise<unknown>((resolve, reject) => {
			const deadlineAt = Date.now() + timeoutMs;

			const expire = () => {
				const current = this.pending.get(id);
				if (!current) {
					return;
				}
				const remaining = deadlineAt - Date.now();
				if (remaining > 0) {
					current.timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
				} else {
					if (source) {
						this.failSource(new ModuleRuntimeFailure('unavailable'));
					} else {
						this.fail(new ModuleRuntimeFailure('execution_unknown'));
					}
				}
			};

			const timer = setTimeout(expire, Math.min(timeoutMs, 2_147_483_647));
			this.pending.set(id, { method, resolve, reject, timer, source, host });
		});
		void result.catch(() => undefined);

		const abort = () => {
			void this.write({ kind: 'cancel', id }).catch(() => undefined);
		};

		void this.write(
			inputJson !== undefined
				? source
					? {
							kind: 'control',
							id,
							method,
							input: JSON.parse(inputJson),
							exportName: source.exportName,
							sourceMethods: source.methods,
						}
					: { kind: 'control', id, method, input: JSON.parse(inputJson) }
				: deadline === undefined
					? { kind: 'control', id, method }
					: { kind: 'control', id, method, deadline },
		);
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) {
			abort();
		}
		return result.finally(() => signal?.removeEventListener('abort', abort));
	}

	invoke(
		inputJson: string,
		signal: AbortSignal,
		timeoutMs: number,
		source?: IsolatedModuleSourceInvocation,
		host?: (request: unknown) => Promise<unknown>,
	): Promise<unknown> {
		if (this.closing || signal.aborted) {
			return Promise.reject(new ModuleRuntimeFailure('unavailable'));
		}
		try {
			const input: unknown = JSON.parse(inputJson);
			if (
				Buffer.byteLength(
					JSON.stringify({
						kind: 'control',
						id: Number.MAX_SAFE_INTEGER,
						method: 'invoke',
						input,
						...(source ? { exportName: source.exportName, sourceMethods: source.methods } : {}),
					}) + '\n',
				) > MAX_MESSAGE_BYTES
			) {
				throw new ModuleRuntimeFailure('protocol_invalid');
			}
		} catch (cause) {
			return Promise.reject(new ModuleRuntimeFailure('protocol_invalid', { cause }));
		}
		return this.control('invoke', undefined, inputJson, timeoutMs, signal, source, host);
	}

	async activate(): Promise<unknown> {
		if (this.closing) {
			throw new ModuleRuntimeFailure('unavailable');
		}
		return this.control('activate');
	}

	async health(): Promise<boolean> {
		if (this.closing) {
			throw new ModuleRuntimeFailure('unavailable');
		}
		const result = await this.control('health');
		if (typeof result !== 'boolean') {
			throw new ModuleRuntimeFailure('protocol_invalid');
		}
		return result;
	}

	async quiesce(deadline: number): Promise<void> {
		this.closing = true;
		await this.control('quiesce', deadline);
	}

	close(): Promise<void> {
		this.closePromise ??= Promise.resolve().then(() => this.closeInstance());
		this.closing = true;
		return this.closePromise;
	}

	private async waitExit(timeoutMs: number): Promise<boolean> {
		let timer: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				this.processExit.then(() => true),
				new Promise<boolean>((resolve) => {
					timer = setTimeout(() => resolve(false), timeoutMs);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	}

	private async closeInstance(): Promise<void> {
		const failures: unknown[] = [];
		if (!this.failure && this.child.exitCode === null && this.child.signalCode === null) {
			try {
				await this.control('dispose');
			} catch (error) {
				if (error !== this.failure) {
					failures.push(error);
				}
			}
		}
		if (!(await this.waitExit(2000))) {
			this.child.kill('SIGTERM');
			if (!(await this.waitExit(2000))) {
				this.child.kill('SIGKILL');
				if (!(await this.waitExit(5000))) {
					throw new ModuleRuntimeFailure('cleanup_failed', {
						cause: new AggregateError(failures, 'Module exit unconfirmed'),
					});
				}
			}
		}
		clearTimeout(this.readyTimer);
		// The original task observers record failures before these waits settle.
		await Promise.allSettled([...this.hosts, this.writes]);
		const cleanupFailed = failures.some(
			(failure) => !(failure instanceof ModuleRuntimeFailure && failure.kind === 'source_failed'),
		);
		if (this.failure) {
			failures.push(this.failure);
		}
		failures.push(...this.laterFailures.errors());
		try {
			await removeModuleDirectory(this.root);
		} catch (cause) {
			throw new ModuleRuntimeFailure('cleanup_failed', {
				cause: new AggregateError([...failures, cause], 'Module files cleanup failed'),
			});
		}
		if (cleanupFailed || this.hasNonSourceFailure) {
			throw new ModuleRuntimeFailure('execution_unknown', {
				cause: new AggregateError(failures, 'Module shutdown failed'),
			});
		}
	}
}

export class NodeModuleRuntime implements ModuleRuntime {
	constructor(private readonly directory: string) {}

	async recover(): Promise<void> {
		try {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			await recoverModuleDirectories(this.directory);
		} catch (cause) {
			throw cause instanceof ModuleRuntimeFailure ? cause : new ModuleRuntimeFailure('cleanup_failed', { cause });
		}
	}

	async open(input: Parameters<ModuleRuntime['open']>[0]): Promise<IsolatedModuleInstance> {
		let root: string | null = null;
		let instance: NodeModuleInstance | null = null;
		try {
			const paths = new Set<string>();
			let size = 0;
			if (input.files.length > 10000 || Buffer.byteLength(input.contextJson) > 16384) {
				throw new ModuleRuntimeFailure('invalid_module');
			}
			record(JSON.parse(input.contextJson));
			for (const file of input.files) {
				size += file.bytes.byteLength;
				if (
					paths.has(file.path) ||
					file.path.split('/').some((part) => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/u.test(part)) ||
					size > 200 * 1024 * 1024 ||
					createHash('sha256').update(file.bytes).digest('hex') !== file.sha256
				) {
					throw new ModuleRuntimeFailure('invalid_module');
				}
				paths.add(file.path);
			}
			if (!paths.has(input.entry) || !/\.(?:m?js|cjs)$/u.test(input.entry)) {
				throw new ModuleRuntimeFailure('invalid_module');
			}
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			root = await mkdtemp(join(this.directory, 'instance-'));
			const parentIdentity = await processIdentity(process.pid);
			if (!parentIdentity) {
				throw new ModuleRuntimeFailure('unavailable');
			}
			await writeProcessJournal(join(root, '.nexus-owner.json'), JSON.stringify(parentIdentity));
			await syncModuleDirectory(this.directory);
			for (const file of input.files) {
				const destination = resolve(root, file.path);
				await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
				await writeFile(destination, file.bytes, { flag: 'wx', mode: 0o400 });
			}
			const worker = join(root, '.nexus-runtime.mjs');
			await writeFile(worker, await readFile(fileURLToPath(new URL('./module-worker.js', import.meta.url))), {
				flag: 'wx',
				mode: 0o400,
			});
			await writeProcessJournal(join(root, '.nexus-spawning'), '1');
			const child = spawn(
				process.execPath,
				[
					'--permission',
					'--no-addons',
					'--disable-proto=throw',
					`--allow-fs-read=${root}`,
					`--allow-fs-read=${worker}`,
					worker,
				],
				{
					stdio: ['pipe', 'pipe', 'pipe'],
					cwd: root,
					env: { NEXUS_MODULE_ENTRY: resolve(root, input.entry), NEXUS_MODULE_CONTEXT: input.contextJson },
				},
			);
			instance = new NodeModuleInstance(child, root, input.host);
			if (!child.pid) {
				throw new ModuleRuntimeFailure('unavailable');
			}
			const childIdentity = await processIdentity(child.pid);
			if (!childIdentity) {
				throw new ModuleRuntimeFailure('unavailable');
			}
			await writeProcessJournal(
				join(root, '.nexus-process.json'),
				JSON.stringify({ parent: parentIdentity, child: childIdentity }),
			);
			await instance.waitReady();
			return instance;
		} catch (cause) {
			try {
				if (instance) {
					await instance.close();
				} else if (root) {
					await removeModuleDirectory(root);
				}
			} catch (cleanupError) {
				throw new ModuleRuntimeFailure('cleanup_failed', {
					cause: new AggregateError([cause, cleanupError], 'Module construction and cleanup failed'),
				});
			}
			throw cause instanceof ModuleRuntimeFailure ? cause : new ModuleRuntimeFailure('unavailable', { cause });
		}
	}
}
