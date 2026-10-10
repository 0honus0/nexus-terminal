export interface AgentAppView {
	id: string;
	name: string;
	createdAt: number;
}

export interface AgentThreadView {
	id: string;
	appId: string;
	title: string;
	createdAt: number;
}
