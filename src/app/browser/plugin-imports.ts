import * as vue from 'vue';
import * as i18n from 'vue-i18n';
import * as sdk from '../../sdk/browser/index.js';
import * as ui from '../../sdk/browser/ui-api.js';

/** 已发布的 ESM 产物通过标准 import map 共享宿主模块，作用域为当前页面。 */
export function installPluginImports(): void {
	const key = Symbol.for('nexus-terminal.browser.modules');
	const global = globalThis as typeof globalThis & { [key: symbol]: unknown };
	if (global[key]) return;

	const modules = Object.freeze({
		vue,
		'vue-i18n': i18n,
		'nexus-terminal/browser': sdk,
		'nexus-terminal/browser/ui': ui,
	});
	Object.defineProperty(global, key, { value: modules });
	const imports = Object.fromEntries(
		Object.entries(modules).map(([name, namespace]) => {
			const exports = Object.keys(namespace).filter(
				(key) => key !== 'default' && /^[a-zA-Z_$][\w$]*$/u.test(key),
			);
			const source = [
				`const namespace = globalThis[Symbol.for('nexus-terminal.browser.modules')][${JSON.stringify(name)}];`,
				...exports.map((key) => `export const ${key} = namespace.${key};`),
				...('default' in namespace ? ['export default namespace.default;'] : []),
			].join('\n');
			return [name, URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))];
		}),
	);
	const script = document.createElement('script');
	script.type = 'importmap';
	script.textContent = JSON.stringify({ imports });
	document.head.append(script);
}
