export class ArtifactClient {
  constructor(private readonly endpoint = process.env.NEXUS_ARTIFACT_ENDPOINT ?? '') {}
  isConfigured(): boolean {
    return Boolean(this.endpoint);
  }
}
