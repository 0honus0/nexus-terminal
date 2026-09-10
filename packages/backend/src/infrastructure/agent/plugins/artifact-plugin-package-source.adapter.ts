import type { ArtifactPort } from '../../../modules/agent/ai/artifact.port';
import type {
  PluginPackageSource,
  PluginPackageSourcePort,
} from '../../../modules/agent/host/plugin-package-source.port';

const READ_CHUNK_BYTES = 8 * 1024 * 1024;

export class ArtifactPluginPackageSourceAdapter implements PluginPackageSourcePort {
  constructor(private readonly artifacts: ArtifactPort) {}

  async open(userId: number, artifactAppId: string, artifactId: string): Promise<PluginPackageSource> {
    if (!artifactAppId || Buffer.byteLength(artifactAppId, 'utf8') > 256) throw new Error('VALIDATION_FAILED');
    const scope = { userId, appId: artifactAppId };
    const artifact = await this.artifacts.get(scope, artifactId);
    if (!artifact || artifact.status !== 'ready') throw new Error('PLUGIN_ARTIFACT_NOT_READY');
    const sizeBytes = artifact.sizeBytes;
    const source = async function* (): AsyncIterable<Uint8Array> {
      for (let start = 0; start < sizeBytes; start += READ_CHUNK_BYTES) {
        const endInclusive = Math.min(sizeBytes - 1, start + READ_CHUNK_BYTES - 1);
        for await (const chunk of artifacts.read(scope, artifactId, { start, endInclusive })) yield chunk;
      }
    };
    const artifacts = this.artifacts;
    return { sizeBytes, source: source() };
  }
}
