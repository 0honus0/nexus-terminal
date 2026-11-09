import type { PluginCatalog, PluginCatalogEntry } from './plugin-types';

export interface PluginCatalogSource {
	source: string | null;
	catalog: PluginCatalog;
}

export interface PluginCatalogOption extends PluginCatalogSource {
	key: string;
	entry: PluginCatalogEntry;
}

export interface PluginCatalogGroup {
	id: string;
	options: PluginCatalogOption[];
	selected: PluginCatalogOption;
	needsVersionChoice: boolean;
}
