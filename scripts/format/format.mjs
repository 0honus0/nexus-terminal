#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const check = process.argv.includes('--check');
const targets = process.argv.slice(2).filter((argument) => argument !== '--check');
if (!targets.length) targets.push('.');

/** Resolve the tools from this package, independent of the consuming repository's dependencies. */
function run(packageName, executable, arguments_) {
	const root = dirname(require.resolve(`${packageName}/package.json`));
	const result = spawnSync(process.execPath, [join(root, executable), ...arguments_], {
		stdio: 'inherit',
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

// Apply declaration spacing first; Prettier preserves those blank lines and formats the result.
run('eslint', 'bin/eslint.js', [...(check ? [] : ['--fix']), ...targets]);
run('prettier', 'bin/prettier.cjs', [check ? '--check' : '--write', '--ignore-unknown', ...targets]);
