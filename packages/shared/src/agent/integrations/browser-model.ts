export interface AgentBrowserEndpoint {
	url: string;
	priority: number;
	allowPlaintext: boolean;
	verifyTls: boolean;
}

export interface AgentBrowserTarget {
	id: string;
	endpoints: AgentBrowserEndpoint[];
	allowedUrlPatterns: string[];
}

export interface AgentBrowserConfiguration {
	version: number;
	targets: AgentBrowserTarget[];
}

export interface AgentBrowserSessionView {
	sessionId: string;
	targetId: string;
	targetVersion: number;
	runId: string;
	createdAt: number;
}

export interface AgentBrowserSnapshot {
	snapshotId: string;
	url: string;
	title: string;
	nodes: {
		ref: string;
		parentRef: string | null;
		tag: string;
		text: string;
		attributes: { name: string; value: string }[];
	}[];
	truncated: boolean;
}
