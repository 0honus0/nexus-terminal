export interface AppIntentArtifactView {
  id: string;
  appId: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}

export interface AppIntentArtifactReadRange {
  start: number;
  endInclusive: number;
}

export interface AppIntentArtifactAccessPort {
  getOwned(userId: number, ownerAppId: string, artifactId: string): Promise<AppIntentArtifactView | null>;
  readOwned(
    userId: number,
    ownerAppId: string,
    artifactId: string,
    range: AppIntentArtifactReadRange,
  ): AsyncIterable<Uint8Array>;
}
