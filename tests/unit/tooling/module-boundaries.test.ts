import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Graph, alg } from '@dagrejs/graphlib';
import ts from 'typescript';
import { parse } from 'vue/compiler-sfc';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** 忽略擦除的类型导入；普通导入和转出都参与运行时依赖图。 */
function runtimeImport(node: ts.Statement): string | undefined {
	if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
	if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return;

	if (ts.isExportDeclaration(node)) {
		const items = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : [];
		if (node.isTypeOnly || (items.length && items.every((item) => item.isTypeOnly))) return;
	} else {
		const clause = node.importClause;
		const named = clause?.namedBindings;
		const items = named && ts.isNamedImports(named) ? named.elements : [];
		if (clause?.isTypeOnly || (!clause?.name && items.length && items.every((item) => item.isTypeOnly))) return;
	}
	return node.moduleSpecifier.text;
}

function moduleName(path: string): string | undefined {
	return /^src\/(?!sdk\/|utils\/)([^/]+)\//u.exec(path)?.[1];
}

test('TS 和 Vue 脚本遵循模块 API，宿主不依赖测试夹具，浏览器不引用 Node 实现', async () => {
	const files = new Set(
		(await readdir(join(root, 'src'), { recursive: true }))
			.filter((file) => /\.(ts|vue)$/u.test(file) && !file.endsWith('.d.ts'))
			.map((file) => join(root, 'src', file)),
	);
	const graph = new Graph({ directed: true });
	const builtinImports = new Map<string, string[]>();
	const violations: string[] = [];

	const label = (file: string) => relative(root, file).split(sep).join('/');

	for (const file of files) {
		const text = await readFile(file, 'utf8');
		const from = label(file);
		const descriptor = file.endsWith('.vue') ? parse(text, { filename: file }).descriptor : undefined;
		const script = descriptor ? [descriptor.script?.content, descriptor.scriptSetup?.content].join('\n') : text;
		const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		// 夹具不能由宿主加载，包括仅在开发模式下执行的动态导入。
		for (const { fileName } of ts.preProcessFile(script, true, true).importedFiles) {
			if (!fileName.startsWith('.')) continue;
			const to = label(join(dirname(file), fileName));
			if (to.startsWith('tests/')) violations.push(`${from} → ${to}`);
		}
		graph.setNode(from);
		for (const statement of ast.statements) {
			const specifier = runtimeImport(statement);
			if (specifier?.startsWith('node:')) {
				const imports = builtinImports.get(from) ?? [];
				imports.push(specifier);
				builtinImports.set(from, imports);
			}
			if (!specifier?.startsWith('.')) continue;

			const base = join(dirname(file), specifier);
			const target = [base, base.replace(/\.js$/u, '.ts'), base + '.ts', join(base, 'index.ts')].find(
				(candidate) => files.has(candidate),
			);
			if (!target) continue;
			const to = label(target);
			graph.setEdge(from, to);
			const owner = moduleName(from);
			const imported = moduleName(to);
			if (owner && imported && owner !== imported && !/(?:-api(?:\.(?:node|browser))?|-types)\.ts$/u.test(to)) {
				violations.push(`${from} → ${to}`);
			}
		}
	}

	assert.deepEqual(alg.findCycles(graph), []);
	assert.deepEqual(violations, []);
	const browser = alg.preorder(graph, ['src/app/browser/main.ts', 'src/sdk/browser/index.ts']);
	assert.deepEqual(
		browser.filter((path) => path.includes('/node/') || path.endsWith('.node.ts')),
		[],
	);
	assert.deepEqual(
		browser.flatMap((path) => builtinImports.get(path) ?? []),
		[],
	);
});
