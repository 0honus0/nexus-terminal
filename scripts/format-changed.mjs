import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const mode = process.argv.includes('--check') ? '--check' : '--write';
const supported = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.md', '.vue', '.yml', '.yaml']);

function gitFiles(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || 'Failed to read changed files from git.\n');
    process.exit(result.status ?? 1);
  }
  return result.stdout.split('\0').filter(Boolean);
}

const files = new Set([
  ...gitFiles(['diff', '--name-only', '--diff-filter=ACMR', '-z', 'HEAD', '--']),
  ...gitFiles(['ls-files', '--others', '--exclude-standard', '-z']),
]);

const formattable = [...files]
  .filter((file) => existsSync(file) && supported.has(path.extname(file).toLowerCase()))
  .sort();

if (formattable.length === 0) {
  console.log('No changed Prettier-supported files.');
  process.exit(0);
}

const prettierBin = path.resolve('node_modules/prettier/bin/prettier.cjs');
if (!existsSync(prettierBin)) {
  console.error('Prettier is not installed at the repository root. Run npm ci first.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [prettierBin, mode, ...formattable], { stdio: 'inherit' });
process.exit(result.status ?? 1);
