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
import type { IsolatedModuleInstance, ModuleRuntime } from '../module-runtime.js';
import { ModuleRuntimeFailure } from '../module-runtime.js';

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

class NodeModuleInstance implements IsolatedModuleInstance {
	private readonly pending = new Map<
		number,
		{ method: string; resolve(value: unknown): void; reject(error: unknown): void; timer: NodeJS.Timeout }
	>();
	private readonly hosts = new Set<Promise<void>>();
	private writes = Promise.resolve();
	private buffer = Buffer.alloc(0);
	private sequence = 0;
	private hostSequence = 0;
	private closing = false;
	private failure: ModuleRuntimeFailure | null = null;
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
		private readonly host: (input: unknown) => Promise<unknown>,
	) {
		this.ready = new Promise((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});
		void this.ready.catch(() => undefined);
		this.readyTimer = setTimeout(() => this.fail(new ModuleRuntimeFailure('unavailable')), 15000);
		this.processExit = new Promise((resolve) => {
			child.once('close', () => {
				if (!this.closing) {
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
		child.stdin.on('error', (cause) => this.fail(new ModuleRuntimeFailure('execution_unknown', { cause })));
		child.stdout.on('error', (cause) => this.fail(new ModuleRuntimeFailure('execution_unknown', { cause })));
		// Do not retain or expose arbitrary plugin stderr; drain it to prevent a blocked pipe.
		child.stderr.on('data', () => undefined);
		child.stderr.on('error', (cause) => this.fail(new ModuleRuntimeFailure('execution_unknown', { cause })));
		child.stdout.on('data', (chunk: Buffer) => {
			try {
				this.read(chunk);
			} catch (cause) {
				this.fail(
					cause instanceof ModuleRuntimeFailure
						? cause
						: new ModuleRuntimeFailure('protocol_invalid', { cause }),
				);
			}
		});
	}

	async waitReady(): Promise<void> {
		await this.ready;
	}

	private fail(error: ModuleRuntimeFailure): void {
		this.failure ??= error;
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

	private write(value: unknown): Promise<void> {
		const encoded = JSON.stringify(value) + '\n';
		if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) {
			return Promise.reject(new ModuleRuntimeFailure('protocol_invalid'));
		}
		const next = this.writes.then(() => {
			if (this.failure || !this.child.stdin.writable) {
				throw this.failure ?? new ModuleRuntimeFailure('unavailable');
			}
			return new Promise<void>((resolve, reject) =>
				this.child.stdin.write(encoded, (error) => (error ? reject(error) : resolve())),
			);
		});
		this.writes = next;
		void next.catch((cause) => this.fail(new ModuleRuntimeFailure('execution_unknown', { cause })));
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
				(item.method === 'health' ? typeof message.value !== 'boolean' : message.value !== null)
			) {
				throw new ModuleRuntimeFailure('protocol_invalid');
			}
			clearTimeout(item.timer);
			this.pending.delete(message.id);
			if (message.ok) {
				item.resolve(message.value);
			} else {
				item.reject(new ModuleRuntimeFailure('execution_unknown'));
			}
			return;
		}
		if (
			message.kind !== 'host' ||
			Object.keys(message).length !== 3 ||
			message.id <= this.hostSequence ||
			this.hosts.size >= 32
		) {
			throw new ModuleRuntimeFailure('protocol_invalid');
		}
		this.hostSequence = message.id;
		const id = message.id;
		const task = Promise.resolve()
			.then(() => this.host(message.input))
			.then((value) => this.write({ kind: 'host.result', id, value }));
		this.hosts.add(task);
		void task.then(
			() => this.hosts.delete(task),
			(cause) => {
				this.hosts.delete(task);
				this.fail(new ModuleRuntimeFailure('execution_unknown', { cause }));
			},
		);
	}

	private control(method: string, deadline?: number): Promise<unknown> {
		if (this.failure || this.pending.size >= 8 || this.sequence >= Number.MAX_SAFE_INTEGER) {
			return Promise.reject(this.failure ?? new ModuleRuntimeFailure('unavailable'));
		}
		const id = ++this.sequence;
		const result = new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => this.fail(new ModuleRuntimeFailure('execution_unknown')), 15000);
			this.pending.set(id, { method, resolve, reject, timer });
		});
		void result.catch(() => undefined);
		void this.write(
			deadline === undefined ? { kind: 'control', id, method } : { kind: 'control', id, method, deadline },
		);
		return result;
	}

	async activate(): Promise<void> {
		if (this.closing) {
			throw new ModuleRuntimeFailure('unavailable');
		}
		await this.control('activate');
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
				failures.push(error);
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
		const remaining = await Promise.allSettled([...this.hosts, this.writes]);
		failures.push(...remaining.flatMap((item) => (item.status === 'rejected' ? [item.reason] : [])));
		if (this.failure) {
			failures.push(this.failure);
		}
		try {
			await removeModuleDirectory(this.root);
		} catch (cause) {
			throw new ModuleRuntimeFailure('cleanup_failed', {
				cause: new AggregateError([...failures, cause], 'Module files cleanup failed'),
			});
		}
		if (failures.length) {
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
					'--max-old-space-size=128',
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
