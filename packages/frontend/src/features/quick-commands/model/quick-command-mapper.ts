import type { QuickCommand, QuickCommandTag } from '@nexus-terminal/shared/preferences/commands/model';
import type { QuickCommandSummary, QuickCommandTagSummary } from './quick-command-types';

export function fromCommand(value: QuickCommand): QuickCommandSummary {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		command: value.command,
		usageCount: value.usageCount,
		variables: Object.fromEntries(Object.entries(value.variables).map(([key, entry]) => [key, entry])),
		tagIds: value.tagIds.map((id) => id),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function fromCommandTag(value: QuickCommandTag): QuickCommandTagSummary {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}
