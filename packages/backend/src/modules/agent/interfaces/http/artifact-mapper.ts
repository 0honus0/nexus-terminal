import type { ArtifactRecord } from '../../artifacts/model/artifact-types.js';
import type { AgentArtifactView } from '@nexus-terminal/shared/agent/artifacts/model';

export function toArtifactView(value: ArtifactRecord): AgentArtifactView {
	return {
		id: value.id,
		appId: value.appId,
		name: value.name,
		mediaType: value.mediaType,
		kind: value.kind,
		sizeBytes: value.sizeBytes,
		sha256: value.sha256,
		status: value.status,
		retained: value.retained,
		version: value.version,
		createdAt: value.createdAt,
		readyAt: value.readyAt,
		expiresAt: value.expiresAt,
		deletedAt: value.deletedAt,
	};
}
