export interface AgentApp {
	id: string;
	name: string;
	createdAt: number;
}

export interface AgentThread {
	id: string;
	appId: string;
	title: string;
	createdAt: number;
}
