/** Storage commands are independent of public/application types. */
export interface CreateAppRecord {
	id: string;
	userId: number;
	name: string;
	createdAt: number;
}

export interface CreateThreadRecord {
	id: string;
	userId: number;
	appId: string;
	title: string;
	createdAt: number;
}

export interface AppRecord {
	id: string;
	userId: number;
	name: string;
	createdAt: number;
}

export interface ThreadRecord {
	id: string;
	userId: number;
	appId: string;
	title: string;
	createdAt: number;
}

export interface AgentScopeStorage {
	createApp(command: CreateAppRecord): Promise<AppRecord>;
	createThread(command: CreateThreadRecord): Promise<ThreadRecord | null>;
}
