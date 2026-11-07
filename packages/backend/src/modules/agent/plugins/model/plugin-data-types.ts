export interface PluginDataRecord {
	key: string;
	revision: number;
	documentJson: string | null;
}

export interface PluginDataPage {
	items: { key: string; revision: number; deleted: boolean }[];
	nextCursor: string | null;
}
