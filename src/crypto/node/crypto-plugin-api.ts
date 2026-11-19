import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { LogApi } from '../../log/node/log-api.js';
import { CodedError } from '../../utils/error.js';
import { AuthenticationError, InvalidEnvelopeError } from './crypto-error.js';

/** 用途由调用方提供；所有者身份由宿主固定，不允许通过 context 替换。 */
const CryptoContextSchema = z.string().optional();

export const CryptoOptionsSchema = z.discriminatedUnion('mode', [
	z.strictObject({ mode: z.literal('local'), context: CryptoContextSchema }),
	z.strictObject({
		mode: z.literal('password'),
		password: z.string().min(1).max(1024),
		context: CryptoContextSchema,
	}),
]);

export type CryptoOptions = z.infer<typeof CryptoOptionsSchema>;

/** 只公开可处理的稳定标识，不包含内部 Error、cause、stack 或密钥状态。 */
export const PluginCryptoErrorCodeSchema = z.enum([
	'INVALID_INPUT',
	'INVALID_OPTIONS',
	'INVALID_ENVELOPE',
	'AUTHENTICATION_FAILED',
	'UNAVAILABLE',
	'CANCELLED',
	'INTERNAL_ERROR',
]);

export type PluginCryptoErrorCode = z.infer<typeof PluginCryptoErrorCodeSchema>;

export const PluginCryptoFailureSchema = z.strictObject({
	code: PluginCryptoErrorCodeSchema,
	/** 与宿主本地失败日志关联；取消时不生成。 */
	correlationId: z.uuid().optional(),
});

export type PluginCryptoFailure = z.infer<typeof PluginCryptoFailureSchema>;

/** ctx.app.crypto 契约，身份由宿主绑定。
 * 密码模式可跨实例解密，仍要求相同所有者、密码和 context。
 * 已知失败与未知异常均在宿主边界转成失败结果，由插件决定如何展示。
 * 插件取消后返回 CANCELLED，不交付运算结果，不代表已经终止底层运算。
 */
export interface PluginCryptoApi {
	encrypt(plaintext: Uint8Array, options: CryptoOptions): Promise<Result<Uint8Array, PluginCryptoFailure>>;

	decrypt(envelope: Uint8Array, options: CryptoOptions): Promise<Result<Uint8Array, PluginCryptoFailure>>;
}

export type CryptoOperation = 'encrypt' | 'decrypt';

type RunCrypto = (operation: CryptoOperation, input: Uint8Array, options: CryptoOptions) => Promise<Uint8Array>;

/** 插件调用边界：绑定身份与生命周期，记录失败，转换公开结果；不持有密钥。 */
export class PluginCrypto implements PluginCryptoApi {
	readonly #runCrypto: RunCrypto;
	readonly #ownerId: string;
	readonly #signal: AbortSignal;
	readonly #log: Pick<LogApi, 'report'>;

	constructor(runCrypto: RunCrypto, ownerId: string, signal: AbortSignal, log: Pick<LogApi, 'report'>) {
		this.#runCrypto = runCrypto;
		this.#ownerId = ownerId;
		this.#signal = signal;
		this.#log = log;
	}

	encrypt(plaintext: Uint8Array, options: CryptoOptions): Promise<Result<Uint8Array, PluginCryptoFailure>> {
		return this.#run('encrypt', plaintext, options);
	}

	decrypt(envelope: Uint8Array, options: CryptoOptions): Promise<Result<Uint8Array, PluginCryptoFailure>> {
		return this.#run('decrypt', envelope, options);
	}

	async #run(
		operation: CryptoOperation,
		input: Uint8Array,
		options: CryptoOptions,
	): Promise<Result<Uint8Array, PluginCryptoFailure>> {
		if (this.#signal.aborted) return err({ code: 'CANCELLED' });
		try {
			const validated = this.#validateRequest(input, options);
			const result = await this.#runCrypto(operation, input, validated);
			return this.#acceptResult(result);
		} catch (cause) {
			return this.#failure(operation, cause);
		}
	}

	#validateRequest(input: Uint8Array, options: CryptoOptions): CryptoOptions {
		// 插件是运行时边界，TS 类型不能约束 JS 调用；只在这里校验输入，不让 Buffer 隐式接受字符串等值。
		if (!(input instanceof Uint8Array)) throw new CodedError('INVALID_INPUT');
		const parsed = CryptoOptionsSchema.safeParse(options);
		// 不保留带密码的原始选项或 Zod 错误；返回经过校验的选项快照。
		if (!parsed.success) throw new CodedError('INVALID_OPTIONS');
		// 校验可执行外部 getter，结束后仍须复核插件是否已被卸载。
		this.#signal.throwIfAborted();
		return parsed.data;
	}

	#acceptResult(result: Uint8Array): Result<Uint8Array, PluginCryptoFailure> {
		// 运算成功不代表调用方仍存在；插件可在等待期间卸载，迟到结果必须擦除。
		if (this.#signal.aborted) {
			result.fill(0);
			return err({ code: 'CANCELLED' });
		}
		return ok(result);
	}

	#failure(operation: CryptoOperation, cause: unknown): Result<never, PluginCryptoFailure> {
		// 取消由作用域确定；不把第三方同名错误或异常文案当作取消依据。
		if (this.#signal.aborted || (cause instanceof CodedError && cause.code === 'CANCELLED'))
			return err({ code: 'CANCELLED' });
		// 仅业务边界将内部语义转换成公开错误码；不按原生错误文案或第三方同名 code 分类。
		let code: PluginCryptoFailure['code'] = 'INTERNAL_ERROR';
		if (cause instanceof InvalidEnvelopeError) code = 'INVALID_ENVELOPE';
		else if (cause instanceof AuthenticationError) code = 'AUTHENTICATION_FAILED';
		else if (cause instanceof CodedError) {
			const parsed = PluginCryptoErrorCodeSchema.safeParse(cause.code);
			if (parsed.success) code = parsed.data;
		}
		const correlationId = randomUUID();
		this.#log.report({
			source: 'app.crypto',
			pluginId: this.#ownerId,
			level: code === 'INTERNAL_ERROR' ? 'error' : 'warn',
			code: operation === 'encrypt' ? 'CRYPTO_ENCRYPT_FAILED' : 'CRYPTO_DECRYPT_FAILED',
			correlationId,
			params: { operation, errorCode: code },
			cause,
		});
		// 不传递原始 Error、cause、stack、密码、密钥或运算数据。
		return err({ code, correlationId });
	}
}
