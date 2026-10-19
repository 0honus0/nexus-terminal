export interface CatalogRepository {
	owner: string;
	repository: string;
	ref: string;
	path: string;
}

export interface CatalogEntry {
	name: string;
	regularFile: boolean;
	url: string | null;
}

export interface HtmlThemeCatalog {
	list(repository: CatalogRepository, signal: AbortSignal): Promise<CatalogEntry[]>;
	read(url: string, signal: AbortSignal): Promise<string>;
}
