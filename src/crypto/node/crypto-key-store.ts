import { randomUUID } from 'node:crypto';
import { link, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { CryptoEngineApi } from './crypto-engine.js';
import { CodedError } from '../../utils/error.js';

const keyFileName = 'instance.key';
const keyLength = 32;
const keyDomain = 'nexus.encryption.key.v1';

type KeyState =
	| { readonly status: 'idle' }
	| { readonly status: 'loading'; readonly pending: Promise<void> }
	| { readonly status: 'ready'; readonly key: Uint8Array }
	| { readonly status: 'closed' };

/** 模块内部资源：独占实例密钥状态、文件发布、派生密钥登记与关闭处理。 */
export class CryptoKeyStore {
	readonly #path: string;
	readonly #crypto: CryptoEngineApi;
	readonly #derivedKeys = new Set<Uint8Array>();

	readonly #onAbort = () => this.close();

	#signal: AbortSignal | undefined;
	#state: KeyState = { status: 'idle' };

	constructor(directory: string, crypto: CryptoEngineApi) {
		this.#path = join(directory, keyFileName);
		this.#crypto = crypto;
	}

	async initialize(signal: AbortSignal): Promise<void> {
		if (!this.#signal) {
			this.#assertOpen();
			// 并发调用和重试复用首次初始化绑定的服务信号。
			this.#signal = signal;
			signal.addEventListener('abort', this.#onAbort, { once: true });
			if (signal.aborted) this.close();
		}
		this.#assertOpen();
		if (this.#state.status === 'ready') return;
		let pending: Promise<void>;
		if (this.#state.status === 'loading') {
			pending = this.#state.pending;
		} else {
			pending = this.#load();
			this.#state = { status: 'loading', pending };
		}
		await pending;
		this.#assertOpen();
	}

	assertReady(): void {
		this.#requireKey();
	}

	deriveKey(ownerId: string): Uint8Array {
		const master = this.#requireKey();
		const key = this.#crypto.deriveKey(master, JSON.stringify([keyDomain, ownerId]));
		this.#derivedKeys.add(key);
		return key;
	}

	releaseKey(key: Uint8Array): void {
		key.fill(0);
		this.#derivedKeys.delete(key);
	}

	close(): void {
		if (this.#state.status === 'closed') return;
		if (this.#state.status === 'ready') this.#state.key.fill(0);
		this.#state = { status: 'closed' };
		this.#signal?.removeEventListener('abort', this.#onAbort);
		for (const key of this.#derivedKeys) key.fill(0);
		this.#derivedKeys.clear();
	}

	#assertOpen(): void {
		// 状态检查保护资源生命周期，不属于算法参数检查；每次异步 I/O 后都要复核。
		if (this.#signal?.aborted) throw new CodedError('CANCELLED', { cause: this.#signal.reason });
		if (this.#state.status === 'closed') {
			throw new CodedError('UNAVAILABLE', { cause: new Error('ENCRYPTION_CLOSED') });
		}
	}

	#requireKey(): Uint8Array {
		this.#assertOpen();
		if (this.#state.status !== 'ready') {
			throw new CodedError('UNAVAILABLE', { cause: new Error('ENCRYPTION_NOT_READY') });
		}
		return this.#state.key;
	}

	async #load(): Promise<void> {
		let key: Uint8Array | undefined;
		try {
			key = await this.#readOrCreate();
			this.#assertOpen();
			this.#state = { status: 'ready', key };
		} catch (cause) {
			key?.fill(0);
			if (this.#state.status !== 'closed') this.#state = { status: 'idle' };
			// TODO(error): 文件和初始化失败的统一处理；保留原生原因，不自动重试。
			throw cause;
		}
	}

	async #readOrCreate(): Promise<Uint8Array> {
		try {
			return await this.#read();
		} catch (cause) {
			if (!hasFileCode(cause, 'ENOENT')) throw cause;
		}
		this.#assertOpen();
		await this.#publish();
		this.#assertOpen();
		return this.#read();
	}

	async #read(): Promise<Uint8Array> {
		const key = await readFile(this.#path);
		try {
			this.#assertOpen();
			// 文件属于持久化输入，必须校验实例密钥长度；HKDF 接受任意长度，无法代替此检查。
			if (key.length !== keyLength) {
				throw new CodedError('UNAVAILABLE', { cause: new Error('ENCRYPTION_KEY_INVALID') });
			}
			return key;
		} catch (cause) {
			key.fill(0);
			throw cause;
		}
	}

	/** 完整写入、同步并关闭后原子发布；多实例竞争时读取获胜文件，不覆盖已有身份。 */
	async #publish(): Promise<void> {
		const path = `${this.#path}.${randomUUID()}.tmp`;
		const key = this.#crypto.generateKey();
		const failures: unknown[] = [];
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		let created = false;
		try {
			this.#assertOpen();
			// generateKey 的长度由算法实现保证，不再重复校验可信返回值。
			handle = await open(path, 'wx', 0o600);
			created = true;
			this.#assertOpen();
			await handle.writeFile(key);
			this.#assertOpen();
			await handle.sync();
			this.#assertOpen();
			await handle.close();
			handle = undefined;
			this.#assertOpen();
			try {
				await link(path, this.#path);
			} catch (cause) {
				if (!hasFileCode(cause, 'EEXIST')) throw cause;
			}
		} catch (cause) {
			failures.push(cause);
		} finally {
			key.fill(0);
			try {
				await handle?.close();
			} catch (cause) {
				failures.push(cause);
			}
			if (created) {
				try {
					await unlink(path);
				} catch (cause) {
					failures.push(cause);
				}
			}
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			// TODO(error): 统一主操作和清理同时失败的表达，不丢失任一原因。
			throw new AggregateError(failures, 'ENCRYPTION_KEY_PUBLISH_FAILED');
		}
	}
}

function hasFileCode(cause: unknown, code: string): boolean {
	return cause instanceof Error && 'code' in cause && cause.code === code;
}
