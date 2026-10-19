export interface PluginSdkAssets {
	read(path: string): Promise<Uint8Array | null>;
}
