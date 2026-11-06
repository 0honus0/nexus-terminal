import { globSync, readFileSync } from 'node:fs';
import { basename, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { supportedLocales, defaultLocale } from '../src/app/i18n/locale-values.ts';

interface MessageTree {
	[key: string]: string | MessageTree;
}

const prefix = 'virtual:nexus-locale/';
const source = fileURLToPath(new URL('../src', import.meta.url));
const pattern =
	'{app/i18n/messages,app/pages/*/i18n,shared/*/i18n,features/*/i18n,features/*/next/i18n,runtimes/*/i18n}/*.json';

function merge(target: MessageTree, raw: unknown, keys: Set<string>, path: string, prefix = ''): void {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error(`Invalid translation namespace: ${path}:${prefix}`);
	}
	for (const [key, value] of Object.entries(raw)) {
		const full = prefix ? `${prefix}.${key}` : key;
		if (typeof value === 'string') {
			if (target[key] !== undefined) {
				throw new Error(`Duplicate translation key: ${path}:${full}`);
			}
			target[key] = value;
			keys.add(full);
		} else {
			const previous = target[key];
			if (typeof previous === 'string') {
				throw new Error(`Translation namespace collision: ${path}:${full}`);
			}
			const branch = previous ?? {};
			target[key] = branch;
			merge(branch, value, keys, path, full);
		}
	}
}

/** Vite emits one lazy chunk per language and validates all catalogs before application delivery. */
export function localeMessages(): Plugin {
	let catalogs: Map<string, MessageTree> | null = null;
	const paths = new Set<string>();
	const prepare = () => {
		if (catalogs !== null) {
			return catalogs;
		}
		const next = new Map(supportedLocales.map((locale) => [locale, { tree: {}, keys: new Set<string>() }]));
		paths.clear();
		for (const relative of globSync(pattern, { cwd: source })) {
			const path = resolve(source, relative);
			const locale = supportedLocales.find((value) => basename(path) === `${value}.json`);
			const catalog = locale === undefined ? undefined : next.get(locale);
			if (!catalog) {
				throw new Error(`Unsupported translation locale: ${path}`);
			}
			const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
			merge(catalog.tree, raw, catalog.keys, path);
			paths.add(path);
		}
		const reference = next.get(defaultLocale);
		if (!reference || reference.keys.size === 0) {
			throw new Error('Default translations are missing');
		}
		for (const [locale, catalog] of next) {
			const missing = [...reference.keys].filter((key) => !catalog.keys.has(key));
			const extra = [...catalog.keys].filter((key) => !reference.keys.has(key));
			if (missing.length || extra.length) {
				throw new Error(
					`Translation keys differ for ${locale}; missing: ${missing.join(', ')}; extra: ${extra.join(', ')}`,
				);
			}
		}
		catalogs = new Map([...next].map(([locale, catalog]) => [locale, catalog.tree]));
		return catalogs;
	};
	return {
		name: 'nexus-locale-messages',
		buildStart() {
			catalogs = null;
			prepare();
		},
		configureServer(server) {
			const changed = (path: string) => {
				if (!matchesGlob(relative(source, path), pattern)) return;
				catalogs = null;
				server.moduleGraph.invalidateAll();
				server.ws.send({ type: 'full-reload' });
			};
			server.watcher.on('add', changed).on('unlink', changed);
			server.httpServer?.once('close', () => {
				server.watcher.off('add', changed).off('unlink', changed);
			});
		},
		resolveId(id) {
			if (id.startsWith(prefix)) {
				return '\0' + id;
			}
		},
		load(id) {
			if (!id.startsWith('\0' + prefix)) {
				return;
			}
			const catalog = prepare().get(id.slice(prefix.length + 1));
			if (!catalog) {
				throw new Error(`Unsupported translation module: ${id}`);
			}
			for (const path of paths) {
				this.addWatchFile(path);
			}
			return `export default ${JSON.stringify(catalog)};`;
		},
		handleHotUpdate(context) {
			if (!paths.has(context.file)) {
				return;
			}
			catalogs = null;
			prepare();
			const modules = supportedLocales.flatMap((locale) => {
				const module = context.server.moduleGraph.getModuleById('\0' + prefix + locale);
				return module ? [module] : [];
			});
			for (const module of modules) {
				context.server.moduleGraph.invalidateModule(module);
			}
			return modules;
		},
	};
}
