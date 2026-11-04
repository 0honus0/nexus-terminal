import type { StoredPluginManifest } from './plugin-storage.js';

export interface StoredPluginAgentContribution {
	role: string;
	toolNames: string[] | null;
	beforeStep: boolean;
	tools: { name: string; description: string }[];
}

export interface DecodedPluginPackage {
	agentContribution: StoredPluginAgentContribution | null;
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
