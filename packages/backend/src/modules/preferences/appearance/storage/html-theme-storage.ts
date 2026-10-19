export interface StoredHtmlTheme {
	name: string;
	version: number;
	content: string;
	updatedAt: number;
}

export interface StoredHtmlThemeListing {
	name: string;
	version: number;
	updatedAt: number;
}

export interface StoredHtmlThemeFacts {
	current: StoredHtmlTheme | null;
	count: number;
}

export interface HtmlThemeAuthorization {
	sessionDigest: string;
	admit(userId: number | null): void;
}

export interface HtmlThemeWrite {
	action: 'create' | 'update' | 'delete';
	userId: number;
	name: string;
	content: string | null;
}

export interface HtmlThemeStorage {
	list(userId: number): Promise<StoredHtmlThemeListing[]>;
	get(userId: number, name: string): Promise<StoredHtmlTheme | null>;
	write(
		command: HtmlThemeWrite,
		authorization: HtmlThemeAuthorization,
		admit: (facts: StoredHtmlThemeFacts) => void,
	): Promise<StoredHtmlTheme | null>;
}
