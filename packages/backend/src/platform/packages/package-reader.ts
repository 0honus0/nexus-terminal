/** Strict, inert archive facts; this capability never imports or executes package code. */
export interface ArchiveFile {
	path: string;
	bytes: Uint8Array;
	sha256: string;
}

export interface PackageReader {
	read(
		bytes: Uint8Array,
		limits: { maxEntries: number; maxExpandedBytes: number; maxFileBytes: number },
	): Promise<ArchiveFile[]>;
}

export interface SigningKey {
	id: string;
	publicKeyPem: string;
}

export interface PackageSignature {
	normalize(publicKeyPem: string): SigningKey;
	verify(publicKeyPem: string, domain: Uint8Array, parts: readonly Uint8Array[], signature: Uint8Array): boolean;
}

export class PackageFailure extends Error {
	constructor(
		readonly kind: 'invalid_archive' | 'limit_exceeded' | 'invalid_key' | 'invalid_signature',
		options?: ErrorOptions,
	) {
		super(kind, options);
		this.name = 'PackageFailure';
	}
}
