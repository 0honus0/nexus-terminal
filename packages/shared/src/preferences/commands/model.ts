export interface QuickCommand {
	id: number;
	version: number;
	name: string | null;
	command: string;
	usageCount: number;
	variables: Record<string, string>;
	tagIds: number[];
	createdAt: number;
	updatedAt: number;
}

export interface QuickCommandTag {
	id: number;
	version: number;
	name: string;
	createdAt: number;
	updatedAt: number;
}
