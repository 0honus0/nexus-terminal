import type { StoredPluginPackageReference } from './plugin-composition-storage.js';

export interface StoredPluginAppExecution {
	package: StoredPluginPackageReference;
	codeDependencies: StoredPluginPackageReference[];
	handler: string;
}
