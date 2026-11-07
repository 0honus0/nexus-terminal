import type { AgentRunUsageView } from '../runs/model.js';
import type { AgentThreadToolsResponse } from '../tools/http.js';
import type { AgentToolCallDetails } from '../tools/model.js';
import type {
	AgentMemoryListQuery,
	AgentMemoryListResponse,
	AgentMemoryResponse,
	AgentMemoryReviewRequest,
} from '../memory/http.js';
import type {
	AgentArtifactBeginRequest,
	AgentArtifactVersionRequest,
	AgentArtifactRetainRequest,
	AgentArtifactResponse,
	AgentArtifactListResponse,
	AgentArtifactAttachResponse,
	AgentArtifactDeleteResponse,
} from '../artifacts/http.js';
import type { AgentArtifactKind } from '../artifacts/values.js';

/** All identities and the source App come from the authenticated frontend grant. */
export type AgentPluginUiInput =
	| { method: 'agent.runs.usage'; params: { runId: string } }
	| { method: 'agent.tools.list'; params: { threadId: string; before: string | null; limit: number } }
	| { method: 'agent.tools.details'; params: { runId: string; toolId: string } }
	| { method: 'agent.memories.list'; params: AgentMemoryListQuery }
	| { method: 'agent.memories.get'; params: { memoryId: string } }
	| { method: 'agent.memories.review'; params: { memoryId: string; input: AgentMemoryReviewRequest } }
	| {
			method: 'agent.artifacts.list';
			params: {
				retained: boolean | null;
				kind: AgentArtifactKind | null;
				q: string;
				offset: number;
				limit: number;
			};
	  }
	| { method: 'agent.artifacts.get'; params: { artifactId: string } }
	| { method: 'agent.artifacts.begin'; params: AgentArtifactBeginRequest }
	| { method: 'agent.artifacts.retain'; params: { artifactId: string; input: AgentArtifactRetainRequest } }
	| { method: 'agent.artifacts.delete'; params: { artifactId: string; input: AgentArtifactVersionRequest } }
	| {
			method: 'agent.artifacts.attach';
			params: { artifactId: string; expectedVersion: number; threadId: string; runId: string | null };
	  }
	| {
			method: 'agent.artifacts.readRange';
			params: { artifactId: string; expectedVersion: number; start: number; endInclusive: number };
	  };

export interface AgentPluginArtifactRange {
	artifactId: string;
	start: number;
	endInclusive: number;
	dataBase64: string;
	version: number;
	totalBytes: number;
}

export type AgentPluginUiResult = { appId: string } & (
	| { method: 'agent.runs.usage'; value: AgentRunUsageView }
	| { method: 'agent.tools.list'; value: AgentThreadToolsResponse }
	| { method: 'agent.tools.details'; value: AgentToolCallDetails }
	| { method: 'agent.memories.list'; value: AgentMemoryListResponse }
	| { method: 'agent.memories.get' | 'agent.memories.review'; value: AgentMemoryResponse }
	| { method: 'agent.artifacts.list'; value: AgentArtifactListResponse }
	| {
			method: 'agent.artifacts.get' | 'agent.artifacts.begin' | 'agent.artifacts.retain';
			value: AgentArtifactResponse;
	  }
	| { method: 'agent.artifacts.delete'; value: AgentArtifactDeleteResponse }
	| { method: 'agent.artifacts.attach'; value: AgentArtifactAttachResponse }
	| { method: 'agent.artifacts.readRange'; value: AgentPluginArtifactRange }
);
