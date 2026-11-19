/** 密文格式无法解析；只标识内部语义，由调用边界决定对外错误码。 */
export class InvalidEnvelopeError extends Error {
	override readonly name = 'InvalidEnvelopeError';

	constructor() {
		super('CRYPTO_ENVELOPE_INVALID');
	}
}

/** GCM 认证失败；保留原始原因，不依赖 OpenSSL 文案进行分类。 */
export class AuthenticationError extends Error {
	override readonly name = 'AuthenticationError';

	constructor(cause: unknown) {
		super('CRYPTO_AUTHENTICATION_FAILED', { cause });
	}
}
