import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt } from 'node:crypto';
import * as ScryptModule from 'scrypt-kdf';
import { AuthenticationError, InvalidEnvelopeError } from './crypto-error.js';

export type CryptoCredentials =
	{ readonly mode: 'key'; readonly key: Uint8Array } | { readonly mode: 'password'; readonly password: string };

/** 无状态的算法能力；失败通过异常上抛，不在内部记录日志或包装 Result。 */
export interface CryptoEngineApi {
	generateKey(): Uint8Array;

	deriveKey(master: Uint8Array, context: string): Uint8Array;

	encrypt(plaintext: Uint8Array, credentials: CryptoCredentials, context: string): Promise<Uint8Array>;

	decrypt(envelope: Uint8Array, credentials: CryptoCredentials, context: string): Promise<Uint8Array>;

	/** scrypt-kdf：logN=17、r=8、p=1；参数和随机盐随哈希保存，结果编码为 Base64。 */
	hash(value: string): Promise<string>;

	verify(hash: string, value: string): Promise<boolean>;
}

/** Node/OpenSSL 执行加密，scrypt-kdf 负责哈希；调用方输入不被修改。
 * 接收已在外部调用边界校验的参数；算法参数交由库检查，原生执行异常直接上抛。
 * 成功返回即遵循库契约，不以输出长度或真假值再次判断成功，空明文也是合法结果。
 */
export class CryptoEngine implements CryptoEngineApi {
	generateKey(): Uint8Array {
		return randomBytes(keyLength);
	}

	deriveKey(master: Uint8Array, context: string): Uint8Array {
		return new Uint8Array(hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(context), keyLength));
	}

	async encrypt(plaintext: Uint8Array, credentials: CryptoCredentials, context: string): Promise<Uint8Array> {
		const plain = Buffer.from(plaintext);
		let key: Buffer | undefined;
		try {
			const header = createEnvelopeHeader(credentials.mode);
			key = await resolveEncryptionKey(credentials, header.salt);
			return encryptPayload(plain, key, header, context);
		} finally {
			plain.fill(0);
			key?.fill(0);
		}
	}

	async decrypt(envelope: Uint8Array, credentials: CryptoCredentials, context: string): Promise<Uint8Array> {
		const input = Buffer.from(envelope);
		let key: Buffer | undefined;
		try {
			const parsed = parseEnvelope(input, credentials.mode);
			key = await resolveEncryptionKey(credentials, parsed.salt);
			return decryptPayload(parsed, key, context);
		} finally {
			input.fill(0);
			key?.fill(0);
		}
	}

	async hash(value: string): Promise<string> {
		// 固定参数下库执行异常向上抛，由操作边界兜底。
		const result = await Scrypt.kdf(value, hashParameters);
		try {
			return Buffer.from(result.buffer, result.byteOffset, result.byteLength).toString('base64');
		} finally {
			result.fill(0);
		}
	}

	async verify(hash: string, value: string): Promise<boolean> {
		// 库检查 Base64、存储长度及 KDF 参数；格式错误原样上抛，密码或校验和不匹配返回 false。
		return Scrypt.verify(hash, value);
	}
}

// 密文格式：magic | mode | salt | nonce | tag | ciphertext。
// header 同时参与 GCM 认证，编码与解析共享下面的布局定义。
const envelopeFormat = {
	magic: Buffer.from('NXC1'),
	saltLength: 16,
	nonceLength: 12,
	tagLength: 16,
	modes: { key: 0, password: 1 },
} as const;

const saltOffset = envelopeFormat.magic.length + 1;
const nonceOffset = saltOffset + envelopeFormat.saltLength;
const tagOffset = nonceOffset + envelopeFormat.nonceLength;
const ciphertextOffset = tagOffset + envelopeFormat.tagLength;

interface EnvelopeHeader {
	readonly header: Buffer;
	readonly salt: Buffer;
	readonly nonce: Buffer;
}

interface ParsedEnvelope extends EnvelopeHeader {
	readonly tag: Buffer;
	readonly ciphertext: Buffer;
}

function createEnvelopeHeader(mode: CryptoCredentials['mode']): EnvelopeHeader {
	const salt = randomBytes(envelopeFormat.saltLength);
	const nonce = randomBytes(envelopeFormat.nonceLength);
	const header = Buffer.concat([envelopeFormat.magic, Buffer.from([envelopeFormat.modes[mode]]), salt, nonce]);
	return { header, salt, nonce };
}

function encodeEnvelope(header: EnvelopeHeader, tag: Buffer, ciphertext: Buffer): Buffer {
	return Buffer.concat([header.header, tag, ciphertext]);
}

/** 返回的片段仅借用本次输入副本；调用方在运算结束后统一清零。 */
function parseEnvelope(input: Buffer, mode: CryptoCredentials['mode']): ParsedEnvelope {
	// 必要的协议解析：Node crypto 不认识 NXC1 布局，须先确认分段长度、格式标识及模式。
	if (
		input.length < ciphertextOffset ||
		!input.subarray(0, envelopeFormat.magic.length).equals(envelopeFormat.magic) ||
		input[envelopeFormat.magic.length] !== envelopeFormat.modes[mode]
	) {
		throw new InvalidEnvelopeError();
	}
	return {
		header: input.subarray(0, tagOffset),
		salt: input.subarray(saltOffset, nonceOffset),
		nonce: input.subarray(nonceOffset, tagOffset),
		tag: input.subarray(tagOffset, ciphertextOffset),
		ciphertext: input.subarray(ciphertextOffset),
	};
}

function encryptPayload(plaintext: Buffer, key: Buffer, envelope: EnvelopeHeader, context: string): Buffer {
	const cipher = createCipheriv('aes-256-gcm', key, envelope.nonce);
	cipher.setAAD(Buffer.concat([envelope.header, Buffer.from(context)]));
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	return encodeEnvelope(envelope, cipher.getAuthTag(), ciphertext);
}

/** GCM final 成功前的明文不可交付，成功或失败都清理中间明文。 */
function decryptPayload(envelope: ParsedEnvelope, key: Buffer, context: string): Buffer {
	let partial: Buffer | undefined;
	let final: Buffer | undefined;
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, envelope.nonce);
		decipher.setAAD(Buffer.concat([envelope.header, Buffer.from(context)]));
		decipher.setAuthTag(envelope.tag);
		partial = decipher.update(envelope.ciphertext);
		try {
			// 必须完成 GCM 认证后才能交付 update 产生的明文；final 返回空字节同样表示成功。
			final = decipher.final();
		} catch (cause) {
			throw new AuthenticationError(cause);
		}
		return Buffer.concat([partial, final]);
	} finally {
		partial?.fill(0);
		final?.fill(0);
	}
}

const keyLength = 32;

/** 在第一个异步等待前复制本地密钥或提交密码，避免调用方修改影响本次运算。 */
async function resolveEncryptionKey(credentials: CryptoCredentials, salt: Buffer): Promise<Buffer> {
	return credentials.mode === 'key' ? Buffer.from(credentials.key) : derivePasswordKey(credentials.password, salt);
}

// scrypt-kdf 4 的运行入口默认导出类，声明却导出命名函数；仅在此适配包的声明差异。
const Scrypt = Reflect.get(ScryptModule, 'default') as Pick<typeof ScryptModule, 'kdf' | 'verify'>;

const hashParameters = { logN: 17, r: 8, p: 1 } as const;

const encryptionKeyParameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

/** 显式适配 Node 回调接口，避免 promisify 对 scrypt 重载的类型推导问题。 */
function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password, salt, keyLength, encryptionKeyParameters, (error, key) => {
			if (error) {
				reject(error);
			} else {
				resolve(key);
			}
		});
	});
}
