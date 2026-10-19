import type { AgentThreadView, AgentAppDefinitionView } from '@nexus-terminal/shared/agent/scope/model';
import type { AgentThread, AppDeclaration } from '../../scope/model/scope-types.js';

export function toDefinitionView(value: AppDeclaration): AgentAppDefinitionView {
	return {
		id: value.id,
		version: value.version,
		displayName: value.displayName,
		capabilities: value.capabilities.map((capability) => capability),
		defaultEnabled: value.defaultEnabled,
	};
}

export function toThreadView(value: AgentThread): AgentThreadView {
	return {
		id: value.id,
		appId: value.appId,
		title: value.title,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}
