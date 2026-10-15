import { createHash, createPublicKey, verify } from 'node:crypto';
import { PackageFailure } from '../package-reader.js';
import type { PackageSignature, SigningKey } from '../package-reader.js';

export class NativePackageSignature implements PackageSignature {
	normalize(publicKeyPem: string): SigningKey {
		if (Buffer.byteLength(publicKeyPem, 'utf8') > 16384) {
			throw new PackageFailure('invalid_key');
		}
		try {
			const key = createPublicKey(publicKeyPem);
			if (key.asymmetricKeyType !== 'ed25519') {
				throw new PackageFailure('invalid_key');
			}
			const der = key.export({ type: 'spki', format: 'der' });
			return {
				id: 'ed25519:' + createHash('sha256').update(der).digest('hex'),
				publicKeyPem: key.export({ type: 'spki', format: 'pem' }).toString(),
			};
		} catch (cause) {
			throw new PackageFailure('invalid_key', { cause });
		}
	}

	verify(publicKeyPem: string, domain: Uint8Array, parts: readonly Uint8Array[], signature: Uint8Array): boolean {
		if (signature.byteLength !== 64) {
			throw new PackageFailure('invalid_signature');
		}
		const normalized = this.normalize(publicKeyPem);
		const chunks: Uint8Array[] = [domain];
		for (let index = 0; index < parts.length; index++) {
			if (index) {
				chunks.push(Uint8Array.of(0));
			}
			const part = parts[index];
			if (part === undefined) {
				throw new PackageFailure('invalid_signature');
			}
			chunks.push(part);
		}
		try {
			return verify(null, Buffer.concat(chunks), normalized.publicKeyPem, signature);
		} catch (cause) {
			throw new PackageFailure('invalid_signature', { cause });
		}
	}
}
