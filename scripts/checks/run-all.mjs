#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const layout = spawnSync(process.execPath, ['scripts/checks/test-layout.mjs'], { stdio: 'inherit' });
if (layout.status !== 0) process.exit(layout.status ?? 1);

const checks = [
	// Backend check builds Shared declarations before either consumer checks its imports.
	['Backend type check', ['--filter', '@nexus-terminal/backend', 'check']],
	[
		'Test source and configuration types',
		['--filter', '@nexus-terminal/frontend', 'exec', 'vue-tsc', '--noEmit', '-p', '../../tests/tsconfig.json'],
	],
	// The format gate reuses this exact full-source content cache.
	['Repository ESLint', ['run', 'format:spacing:check']],
	['Frontend type check', ['--filter', '@nexus-terminal/frontend', 'check']],
];

for (const [name, args] of checks) {
	process.stdout.write(`\n==> ${name}\n`);
	const result = spawnSync('pnpm', args, {
		cwd: process.cwd(),
		env: process.env,
		stdio: 'inherit',
	});

	if (result.error) {
		console.error(`Unable to start ${name}: ${result.error.message}`);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write('\nAll repository checks passed.\n');
