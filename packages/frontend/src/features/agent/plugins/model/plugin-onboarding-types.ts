import type { PluginManifest, PluginPackageInstallation, PluginAppBinding } from './plugin-types';
import type { PluginInstallPlan } from './plugin-install-plan-types';

export interface PluginEnablePlan {
	packages: (
		| { kind: 'installed'; installation: PluginPackageInstallation; manifest: PluginManifest }
		| { kind: 'plan'; plan: PluginInstallPlan }
	)[];
	bindings: PluginAppBinding[];
	ready: boolean;
}
