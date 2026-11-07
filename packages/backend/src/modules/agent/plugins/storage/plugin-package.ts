import type { StoredPluginManifest } from './plugin-storage.js';

export interface DecodedPluginPackage {
	manifest: StoredPluginManifest;
	publisherKeyId: string;
	signatureValid: boolean;
	files: { path: string; sizeBytes: number; sha256: string; bytes: Uint8Array }[];
}

export interface PluginPackageDecoder {
	decode(bytes: Uint8Array, resolveKey: (id: string) => string | null): Promise<DecodedPluginPackage>;
}

export class PluginPackageFailure extends Error {
	constructor(options?: ErrorOptions) {
		super('Invalid plugin package', options);
		this.name = 'PluginPackageFailure';
	}
}
