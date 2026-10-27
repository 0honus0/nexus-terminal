import type { AgentBrowserTarget } from './browser-model.js';

export interface AgentBrowserUpdateRequest {
	expectedVersion: number;
	targets: AgentBrowserTarget[];
}
