import type { ArtifactPort } from '../../../modules/agent/ai/artifact.port';
import type {
  AppIntentArtifactAccessPort,
  AppIntentArtifactReadRange,
  AppIntentArtifactView,
} from '../../../modules/agent/host/app-intent-artifact.port';

export class AppIntentArtifactAdapter implements AppIntentArtifactAccessPort {
  constructor(private readonly artifacts: ArtifactPort) {}

  async getOwned(userId: number, ownerAppId: string, artifactId: string): Promise<AppIntentArtifactView | null> {
    const artifact = await this.artifacts.get({ userId, appId: ownerAppId }, artifactId);
    if (!artifact || artifact.status !== 'ready' || !artifact.sha256) return null;
    return {
      id: artifact.id,
      appId: artifact.appId,
      originalName: artifact.originalName,
      mediaType: artifact.mediaType,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    };
  }

  readOwned(
    userId: number,
    ownerAppId: string,
    artifactId: string,
    range: AppIntentArtifactReadRange,
  ): AsyncIterable<Uint8Array> {
    return this.artifacts.read({ userId, appId: ownerAppId }, artifactId, range);
  }
}
