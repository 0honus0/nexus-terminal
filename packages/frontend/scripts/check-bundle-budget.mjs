import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const assets = path.join(dist, 'assets');
const kib = (value) => `${(value / 1024).toFixed(1)} KiB`;

const requireSingleAsset = (pattern, label) => {
  const matches = fs.readdirSync(assets).filter((name) => pattern.test(name));
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one matching asset, found ${matches.length}.`);
  return matches[0];
};

const assertRawBudget = (pattern, label, maxBytes) => {
  const asset = requireSingleAsset(pattern, label);
  const size = fs.statSync(path.join(assets, asset)).size;
  if (size > maxBytes) throw new Error(`${label} is ${kib(size)}, exceeding the ${kib(maxBytes)} budget (${asset}).`);
  console.log(`${label}: ${kib(size)} / ${kib(maxBytes)} raw`);
};

const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const initialJs = [
  ...indexHtml.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"/g),
  ...indexHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g),
].map((match) => match[1]);
const uniqueInitialJs = [...new Set(initialJs)];
const initialGzipBytes = uniqueInitialJs.reduce(
  (total, asset) => total + gzipSync(fs.readFileSync(path.join(assets, asset))).byteLength,
  0,
);
const INITIAL_JS_GZIP_BUDGET = 260 * 1024;
if (initialGzipBytes > INITIAL_JS_GZIP_BUDGET) {
  throw new Error(
    `Initial JavaScript is ${kib(initialGzipBytes)} gzip, exceeding the ${kib(INITIAL_JS_GZIP_BUDGET)} budget.`,
  );
}
console.log(`Initial JavaScript: ${kib(initialGzipBytes)} / ${kib(INITIAL_JS_GZIP_BUDGET)} gzip`);

assertRawBudget(/^WorkspaceView-[^.]+\.js$/, 'Workspace route chunk', 100 * 1024);
assertRawBudget(/^session-[^.]+\.js$/, 'Workspace runtime core chunk', 80 * 1024);
assertRawBudget(/^WorkspaceSessionSurface-[^.]+\.js$/, 'Workspace session surface chunk', 150 * 1024);

const forbiddenInitialAssets = /(?:MonacoEditor|TerminalView|WorkspaceView|WorkspaceSessionSurface|iconv-lite-umd)-/;
const eagerHeavyAsset = uniqueInitialJs.find((asset) => forbiddenInitialAssets.test(asset));
if (eagerHeavyAsset) throw new Error(`Heavy lazy asset was pulled into initial preload: ${eagerHeavyAsset}`);

console.log('Frontend bundle budget check passed.');
