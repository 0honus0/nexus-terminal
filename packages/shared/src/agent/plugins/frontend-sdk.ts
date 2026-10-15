import type { AgentPluginFrontendInput, AgentPluginFrontendResult } from './frontend-events.js';
import type { AgentRunEventsResponse } from '../runs/http.js';

export interface AgentPluginRunSubscription {
	id: string;
	closed: Promise<void>;
}

export interface AgentPluginFrontendSdk {
	protocolVersion: 1;
	request(input: AgentPluginFrontendInput): Promise<AgentPluginFrontendResult>;
	agent: {
		runs: {
			subscribe(
				runId: string,
				after: number,
				onEvents: (page: AgentRunEventsResponse) => void | Promise<void>,
				onFailure: (error: Error) => void | Promise<void>,
			): AgentPluginRunSubscription;
			unsubscribe(id: string): Promise<void>;
		};
	};
	close(): Promise<void>;
}
