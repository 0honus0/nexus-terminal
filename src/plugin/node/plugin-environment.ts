/// <reference path="./npm-install-checks.d.ts" />

import { familySync } from 'detect-libc';
import { checkEngine, checkPlatform } from 'npm-install-checks';
import satisfies from 'semver/functions/satisfies.js';
import hostPackage from '../../../package.json' with { type: 'json' };
import type { PluginManifest } from '../plugin-manifest-types.js';

export interface PluginEnvironment {
	readonly os: string;
	readonly arch: string;
	readonly node: string;
	readonly abi: string;
	readonly libc?: 'glibc' | 'musl';
}

export function readPluginEnvironment(): PluginEnvironment {
	const libc = familySync();
	return {
		os: process.platform,
		arch: process.arch,
		node: process.versions.node,
		abi: process.versions.modules,
		...(libc === 'glibc' || libc === 'musl' ? { libc } : {}),
	};
}

/** 安装规划和实际加载使用相同的宿主版本、平台和 Node 引擎要求。 */
export function checkPluginEnvironment(
	manifest: PluginManifest,
	environment: PluginEnvironment,
): 'PLUGIN_SDK_INCOMPATIBLE' | 'PLUGIN_ENVIRONMENT_UNSUPPORTED' | undefined {
	if (!satisfies(hostPackage.version, manifest.peerDependencies['nexus-terminal'])) return 'PLUGIN_SDK_INCOMPATIBLE';
	if (manifest.libc && !environment.libc) return 'PLUGIN_ENVIRONMENT_UNSUPPORTED';

	try {
		checkPlatform(manifest, false, {
			os: environment.os,
			cpu: environment.arch,
			// 空覆盖值会让 npm 检查器回退到当前机器，显式保留未知的 libc。
			libc: environment.libc ?? 'unknown',
		});
		// 宿主通过 Node 加载已交付的包。npm 引擎不参与运行。
		checkEngine(manifest, undefined, environment.node);
	} catch (cause) {
		if (cause instanceof Error && 'code' in cause && (cause.code === 'EBADPLATFORM' || cause.code === 'EBADENGINE'))
			return 'PLUGIN_ENVIRONMENT_UNSUPPORTED';
		throw cause;
	}
}
