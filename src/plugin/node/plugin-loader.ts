import { randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CodedError } from '../../utils/error.js';
import type { InstalledPluginTarget, PluginModuleApi } from '../plugin-api.node.js';
import type { PluginScopeApi } from '../plugin-api.js';
import type { PluginIdentity } from '../plugin-dependencies.js';
import { PluginManifestSchema, type PluginManifest } from '../plugin-manifest-types.js';
import { checkPluginEnvironment, readPluginEnvironment } from './plugin-environment.js';

export interface PluginSource extends PluginIdentity {
	readonly authMethods: boolean;
	readonly directory: string;
	readonly entry: string;
}

interface LocalPluginPackage extends InstalledPluginTarget {
	readonly package: PluginManifest;
}

/** 解析本地包并验证安装身份。具体入口由使用方按运行环境检查。 */
export async function readPluginPackage(
	directory: string,
	installed?: InstalledPluginTarget,
): Promise<LocalPluginPackage> {
	const root = await realpath(directory);
	const manifest = parseManifest(await readFile(join(root, 'package.json'), 'utf8'));
	const unsupported = checkPluginEnvironment(manifest, readPluginEnvironment());
	if (unsupported) throw new CodedError(unsupported);

	const { name: pluginId, version } = manifest;
	if (installed && (pluginId !== installed.pluginId || version !== installed.version || root !== installed.directory))
		throw new CodedError('PLUGIN_INSTALLED_IDENTITY_MISMATCH');

	return { pluginId, version, directory: root, package: manifest };
}

/** Node 只选择后端入口；纯前端包交由浏览器加载。 */
export async function readPluginSource({ directory, package: manifest }: LocalPluginPackage): Promise<PluginSource> {
	const path = manifest.nexus.entry.backend;
	if (!path) throw new CodedError('PLUGIN_BACKEND_ENTRY_MISSING');

	return {
		id: manifest.name,
		directory,
		version: manifest.version,
		dependsOn: manifest.nexus.dependsOn ?? {},
		authMethods: manifest.nexus.authMethods === true,
		entry: await resolveEntry(directory, path),
	};
}

/** 校验本地清单和所声明的入口，用于安装及预览，不导入模块代码。 */
export async function inspectPluginPackage(
	directory: string,
	installed?: InstalledPluginTarget,
): Promise<LocalPluginPackage> {
	const target = await readPluginPackage(directory, installed);
	await checkPluginEntries(target);
	return target;
}

export async function checkPluginEntries({ directory, package: manifest }: LocalPluginPackage): Promise<void> {
	for (const path of Object.values(manifest.nexus.entry)) {
		if (path !== undefined) await resolveEntry(directory, path);
	}
}

async function resolveEntry(root: string, path: string): Promise<string> {
	if (isAbsolute(path)) throw new CodedError('PLUGIN_ENTRY_OUTSIDE');
	const candidate = resolve(root, path);
	assertInside(root, candidate);
	const entry = await realpath(candidate);
	assertInside(root, entry);
	if (!(await stat(entry)).isFile()) throw new CodedError('PLUGIN_ENTRY_INVALID');
	return entry;
}

function parseManifest(json: string): PluginManifest {
	let input: unknown;
	try {
		input = JSON.parse(json);
	} catch (cause) {
		throw new CodedError('PLUGIN_PACKAGE_INVALID', { cause });
	}

	const parsed = PluginManifestSchema.safeParse(input);
	if (!parsed.success) throw new CodedError('PLUGIN_PACKAGE_INVALID', { cause: parsed.error });
	return parsed.data;
}

function assertInside(root: string, entry: string): void {
	const path = relative(root, entry);
	if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
		throw new CodedError('PLUGIN_ENTRY_OUTSIDE');
	}
}

const roots = new Map<string, number>();
let sdkHook: ReturnType<typeof registerHooks> | undefined;

function bindSdk(directory: string, scope: PluginScopeApi): void {
	scope.signal.throwIfAborted();
	const root = pathToFileURL(directory + sep).href;
	roots.set(root, (roots.get(root) ?? 0) + 1);
	sdkHook ??= registerHooks({
		resolve(specifier, context, next) {
			const parent = context.parentURL;
			// 只向已登记的插件根交付公开 Node SDK。第三方依赖仍交给 Node。
			if (
				specifier === 'nexus-terminal/node' &&
				parent &&
				[...roots.keys()].some((key) => parent.startsWith(key))
			)
				return { url: import.meta.resolve('nexus-terminal/node'), shortCircuit: true };
			return next(specifier, context);
		},
	});
	scope.onDispose(() => {
		const remaining = (roots.get(root) ?? 1) - 1;
		if (remaining) roots.set(root, remaining);
		else roots.delete(root);
		if (roots.size === 0) {
			sdkHook?.deregister();
			sdkHook = undefined;
		}
	});
}

/** 使用 Node 的模块解析。实例重载重新导入入口，依赖继续使用 Node 的模块缓存。 */
export async function loadPlugin(source: PluginSource, scope: PluginScopeApi): Promise<PluginModuleApi> {
	bindSdk(source.directory, scope);
	const url = pathToFileURL(source.entry);
	url.searchParams.set('instance', randomUUID());
	const entry: unknown = await import(url.href);
	if (typeof entry !== 'object' || !entry || !('activate' in entry) || typeof entry.activate !== 'function') {
		throw new CodedError('PLUGIN_MODULE_ACTIVATE_MISSING');
	}
	if ('deactivate' in entry && typeof entry.deactivate !== 'function') {
		throw new CodedError('PLUGIN_MODULE_INVALID');
	}
	if ('migrations' in entry && entry.migrations !== undefined) {
		const provider = entry.migrations;
		if (
			!provider ||
			typeof provider !== 'object' ||
			!('getMigrations' in provider) ||
			typeof provider.getMigrations !== 'function'
		)
			throw new CodedError('PLUGIN_MIGRATIONS_INVALID');
	}
	return entry as PluginModuleApi;
}
