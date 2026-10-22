export interface ConversationMemory {
	id: string;
	appId: string;
	content: string;
	version: number;
	expiresAt: number | null;
}

export interface ConversationMemoryPage {
	items: ConversationMemory[];
	hasMore: boolean;
}
