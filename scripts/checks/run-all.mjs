#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const checks = [
  ['Frontend ESLint', ['run', 'lint:frontend']],
  ['Agent ESLint', ['run', 'lint:agent']],
  ['Frontend type check', ['--filter', '@nexus-terminal/frontend', 'exec', 'vue-tsc', '--noEmit']],
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
