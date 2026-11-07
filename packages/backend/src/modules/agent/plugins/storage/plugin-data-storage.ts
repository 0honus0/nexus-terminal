export interface StoredPluginDataRecord {
	key: string;
	revision: number;
	documentJson: string | null;
}

export interface StoredPluginDataPage {
	items: { key: string; revision: number; deleted: boolean }[];
	nextCursor: string | null;
}
