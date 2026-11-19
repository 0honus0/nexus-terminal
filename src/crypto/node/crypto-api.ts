import { CryptoEngine, type CryptoCredentials } from './crypto-engine.js';
import { PluginCrypto, type CryptoOperation, type CryptoOptions, type PluginCryptoApi } from './crypto-plugin-api.js';
import { CryptoKeyStore } from './crypto-key-store.js';
import type { LogApi } from '../../log/node/log-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';

const dataDomain = 'nexus.encryption.data.v1';

export interface CryptoApiOptions {
	readonly directory: string;
	readonly services: { readonly log: Pick<LogApi, 'report'> };
}

interface CryptoRequest {
	readonly credentials: CryptoCredentials;
	readonly context: string;
}

/** 应用策略：隔离所有者并协调运算结果与密钥释放；外部参数由调用边界校验。 */
export class CryptoApi {
	readonly #crypto = new CryptoEngine();
	readonly #keys: CryptoKeyStore;
	readonly #log: Pick<LogApi, 'report'>;

	constructor({ directory, services }: CryptoApiOptions) {
		this.#keys = new CryptoKeyStore(directory, this.#crypto);
		this.#log = services.log;
	}

	/** 启动入口负责等待初始化；并发调用复用同一次加载，失败后可显式重试。 */
	initialize(signal: AbortSignal): Promise<void> {
		return this.#keys.initialize(signal);
	}

	/** 本体认证使用，插件 SDK 只包含已绑定的加解密能力。 */
	hash(value: string): Promise<string> {
		return this.#crypto.hash(value);
	}

	verify(hash: string, value: string): Promise<boolean> {
		return this.#crypto.verify(hash, value);
	}

	/** 由可信宿主提供身份，交付绑定本次作用域的加解密能力。 */
	bind(ownerId: string, scope: PluginScopeApi): PluginCryptoApi {
		return new PluginCrypto(
			(operation, input, options) => this.#run(operation, ownerId, input, options),
			ownerId,
			scope.signal,
			this.#log,
		);
	}

	/** 同步撤销能力并清零自有密钥；在途 I/O 自行排空并清理，不会重新激活服务。 */
	close(): void {
		this.#keys.close();
	}

	async #run(
		operation: CryptoOperation,
		ownerId: string,
		input: Uint8Array,
		options: CryptoOptions,
	): Promise<Uint8Array> {
		const request = this.#prepareRequest(ownerId, options);
		try {
			const result = await this.#crypto[operation](input, request.credentials, request.context);
			return this.#acceptResult(result);
		} finally {
			this.#releaseCredentials(request.credentials);
		}
	}

	#prepareRequest(ownerId: string, options: CryptoOptions): CryptoRequest {
		this.#keys.assertReady();
		// 身份隔离不能退化到空所有者；ownerId 由可信宿主提供，不能由插件选项覆盖。
		if (typeof ownerId !== 'string' || ownerId.length === 0) throw new TypeError('ENCRYPTION_OWNER_INVALID');
		const context = JSON.stringify([dataDomain, ownerId, options.context ?? null]);
		const credentials: CryptoCredentials =
			options.mode === 'password'
				? { mode: 'password', password: options.password }
				: { mode: 'key', key: this.#keys.deriveKey(ownerId) };
		return { credentials, context };
	}

	#acceptResult(result: Uint8Array): Uint8Array {
		try {
			// 异步运算结束后复核资源归属；服务可能已关闭，迟到明文必须擦除而非交付。
			this.#keys.assertReady();
			return result;
		} catch (cause) {
			result.fill(0);
			throw cause;
		}
	}

	#releaseCredentials(credentials: CryptoCredentials): void {
		if (credentials.mode === 'key') this.#keys.releaseKey(credentials.key);
	}
}
