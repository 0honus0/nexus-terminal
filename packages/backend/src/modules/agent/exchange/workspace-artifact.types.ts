import type { ArtifactRef } from '../ai/artifact.port';

export interface WorkspaceArtifactExportInput {
  workspaceId: string;
  targetPluginId: string;
  path: string;
  name: string;
  mediaType: string;
}

export interface WorkspaceArtifactImportInput {
  workspaceId: string;
  targetPluginId: string;
  path: string;
  artifactId: string;
}

export interface WorkspaceArtifactImportResult {
  artifact: ArtifactRef;
  workspaceId: string;
  targetPluginId: string;
  path: string;
  writtenBytes: number;
}
