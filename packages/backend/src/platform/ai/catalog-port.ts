/** Validated remote catalog facts; vendor JSON remains in the technical Adapter. */
export const MODELS_DEV_CATALOG_URL = 'https://models.dev/api.json?type=all';

export interface CatalogModelCapabilities {
	contextWindow: number;
	maxOutputTokens: number;
	supportsTools?: boolean;
	supportsImageInput?: boolean;
	supportsFileInput?: boolean;
	reasoningEfforts?: ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[];
}

export interface CatalogEntry {
	providerId: string;
	modelId: string;
	capabilities: CatalogModelCapabilities;
}

export type CatalogFetchResult =
	| { status: 'updated'; sourceRevision: string | null; entries: CatalogEntry[] }
	| { status: 'not-modified'; sourceRevision: string | null };

export interface ModelCatalogPort {
	fetch(revision: string | null, signal: AbortSignal): Promise<CatalogFetchResult>;
}

export class CatalogFailure extends Error {
	constructor(
		readonly kind: 'http' | 'network' | 'response_invalid' | 'too_large' | 'cleanup_failed',
		readonly status?: number,
		options?: ErrorOptions,
	) {
		super('Catalog fetch: ' + kind, options);
		this.name = 'CatalogFailure';
	}
}
