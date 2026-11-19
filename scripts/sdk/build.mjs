import { execFileSync } from 'node:child_process';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';
import ts from 'typescript';
import { build } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = join(root, 'dist/sdk');
const declarations = join(root, 'dist/sdk-declarations');
const host = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const entries = Object.entries(host.exports).map(([key, value]) => [key.slice(2), value]);
const exports = Object.fromEntries(
	entries.map(([name]) => ['./' + name, { types: './' + name + '.d.ts', import: './' + name + '.js' }]),
);

function external(id) {
	return !isAbsolute(id) && !id.startsWith('.') && !id.startsWith('\0');
}

await build({
	configFile: false,
	root,
	publicDir: false,
	plugins: [vue()],
	build: {
		outDir: directory,
		emptyOutDir: true,
		target: 'es2022',
		lib: {
			entry: Object.fromEntries(entries.map(([name, file]) => [name, join(root, file)])),
			formats: ['es'],

			fileName: (_format, name) => name + '.js',

			cssFileName: 'ui',
		},
		rolldownOptions: { external },
	},
});

try {
	execFileSync('pnpm', ['exec', 'vue-tsc', '-p', 'scripts/sdk/tsconfig.json'], { cwd: root, stdio: 'inherit' });
	// 独立打包各声明入口，公开签名引用的内部类型留在同一份声明里。
	for (const [name, file] of entries) {
		const types = await rollup({
			input: join(declarations, file.replace(/^\.\/src\//u, '').replace(/\.ts$/u, '.d.ts')),
			external,
			plugins: [
				{
					name: 'sdk-css-declaration',

					resolveId(id) {
						return id.endsWith('.css') ? '\0sdk-css' : undefined;
					},

					load(id) {
						return id === '\0sdk-css' ? 'export {};' : undefined;
					},
				},
				dts(),
			],
		});
		try {
			await types.write({ file: join(directory, name + '.d.ts'), format: 'es' });
		} finally {
			await types.close();
		}
	}
} finally {
	await rm(declarations, { recursive: true, force: true });
}

// UI 在宿主中复用样式。交付的 SDK 包只提供编译和导入所需的文件。
await rm(join(directory, 'ui.css'), { force: true });
const peers = new Set();
const definitions = new Set();
const files = (await readdir(directory, { recursive: true })).filter((file) => /\.(?:js|d\.ts)$/u.test(file));
for (const file of files) {
	const source = await readFile(join(directory, file), 'utf8');
	for (const { fileName } of ts.preProcessFile(source, true, file.endsWith('.js')).importedFiles) {
		if (!external(fileName)) continue;
		if (fileName.startsWith('node:')) {
			definitions.add('@types/node');
			continue;
		}
		const name = fileName
			.split('/')
			.slice(0, fileName.startsWith('@') ? 2 : 1)
			.join('/');
		if (!host.dependencies[name]) throw new Error('SDK dependency is missing from the host package: ' + name);
		const types = '@types/' + name.replace(/^@/u, '').replace('/', '__');
		if (file.endsWith('.d.ts') && host.devDependencies[types]) definitions.add(types);
		// DefinitelyTyped provides declarations for modules referred to only as types.
		else peers.add(name);
	}
}
const manifest = {
	name: host.name,
	version: host.version,
	private: true,
	type: 'module',
	engines: host.engines,
	exports,
	peerDependencies: Object.fromEntries([...peers].sort().map((name) => [name, host.dependencies[name]])),
	dependencies: Object.fromEntries([...definitions].sort().map((name) => [name, host.devDependencies[name]])),
};
await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
