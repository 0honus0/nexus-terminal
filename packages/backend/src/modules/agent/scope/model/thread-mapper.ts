import type { ThreadRecord } from '../storage/scope-storage.js';
import type { AgentThread } from './scope-types.js';

export function fromThreadRecord(value: ThreadRecord): AgentThread {
	return {
		id: value.id,
		appId: value.appId,
		title: value.title,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}
