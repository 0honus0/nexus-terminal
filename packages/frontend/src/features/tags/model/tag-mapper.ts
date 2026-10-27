import type { TargetTagView } from '@nexus-terminal/shared/targets/tags/model';
import type { TargetTagCreateRequest, TargetTagRenameRequest } from '@nexus-terminal/shared/targets/tags/http';
import type { TagSummary } from './tag-types';

export function toTagSummary(value: TargetTagView): TagSummary {
	return {
		id: value.id,
		name: value.name,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toTagCreate(name: string): TargetTagCreateRequest {
	return { name: name.trim() };
}

export function toTagRename(version: number, name: string): TargetTagRenameRequest {
	return { version, name: name.trim() };
}
