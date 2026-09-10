import type { ArtifactRef } from '../../ai/artifact.port';

export interface WorkspaceArtifactExportInput {
  environmentId: string;
  targetPluginId: string;
  path: string;
  name: string;
  mediaType: string;
}

export interface WorkspaceArtifactImportInput {
  environmentId: string;
  targetPluginId: string;
  path: string;
  artifactId: string;
}

export interface WorkspaceArtifactImportResult {
  artifact: ArtifactRef;
  environmentId: string;
  targetPluginId: string;
  path: string;
  writtenBytes: number;
}
