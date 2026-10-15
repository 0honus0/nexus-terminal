export interface StoredBrowserEndpoint {
	url: string;
	priority: number;
	allowPlaintext: boolean;
	verifyTls: boolean;
}

export interface StoredBrowserTarget {
	id: string;
	endpoints: StoredBrowserEndpoint[];
	allowedUrlPatterns: string[];
}

export interface StoredBrowserConfiguration {
	version: number;
	targets: StoredBrowserTarget[];
}

export interface BrowserStorage {
	get(userId: number): Promise<StoredBrowserConfiguration>;
	update(
		userId: number,
		digest: string,
		version: number,
		targets: StoredBrowserTarget[],
		admit: (identityUserId: number | null) => void,
	): Promise<StoredBrowserConfiguration>;
}

export class BrowserStorageRefusal extends Error {
	constructor(readonly code: 'version_conflict') {
		super(code);
	}
}
