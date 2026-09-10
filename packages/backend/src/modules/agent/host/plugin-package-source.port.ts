export interface PluginPackageSource {
  sizeBytes: number;
  source: AsyncIterable<Uint8Array>;
}

export interface PluginPackageSourcePort {
  open(userId: number, artifactAppId: string, artifactId: string): Promise<PluginPackageSource>;
}
