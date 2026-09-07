import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(e2eRoot, '../..');
const screenshotRoot = path.resolve(process.argv[2] || path.join(e2eRoot, '.tmp', 'functional-screenshots'));
const reportPath = path.resolve(
  process.argv[3] || path.join(e2eRoot, '.tmp', 'functional-screenshot-verification.json'),
);
const canonicalRoot = path.resolve(process.argv[4] || path.join(repoRoot, 'doc', 'imgs', 'e2e'));

const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const sourceSha = git('rev-parse', 'HEAD');
const specFiles = git('ls-tree', '-r', '--name-only', 'HEAD', 'test/e2e/tests')
  .split('\n')
  .filter((file) => /\.spec\.[cm]?[jt]sx?$/.test(file));

const declarationPattern = /\bcaptureFunctionalScreenshot\s*\(\s*[^,\n]+,\s*(["'])([^"'\n]+)\1/g;
const expectedOwners = new Map();
for (const file of specFiles) {
  const source = execFileSync('git', ['show', `HEAD:${file}`], { cwd: repoRoot, encoding: 'utf8' });
  for (const match of source.matchAll(declarationPattern)) {
    const filename = match[2];
    const previous = expectedOwners.get(filename);
    if (previous) throw new Error(`Duplicate functional screenshot declaration ${filename}: ${previous}, ${file}`);
    expectedOwners.set(filename, file);
  }
}

const expected = [...expectedOwners.keys()].sort();
const actual = fs.existsSync(screenshotRoot)
  ? fs
      .readdirSync(screenshotRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
      .map((entry) => entry.name)
      .sort()
  : [];

const missing = expected.filter((name) => !actual.includes(name));
const unexpected = actual.filter((name) => !expectedOwners.has(name));
const failures = [];
if (missing.length) failures.push(`Missing functional screenshots: ${missing.join(', ')}`);
if (unexpected.length) failures.push(`Unexpected functional screenshots: ${unexpected.join(', ')}`);

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function inspectPng(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('invalid PNG signature/IHDR');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width <= 0 || height <= 0) throw new Error(`invalid PNG dimensions ${width}x${height}`);
  return {
    width,
    height,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

const files = [];
for (const filename of actual) {
  const generatedPath = path.join(screenshotRoot, filename);
  let generated;
  try {
    generated = inspectPng(generatedPath);
  } catch (error) {
    failures.push(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  const canonicalPath = path.join(canonicalRoot, filename);
  let canonical = null;
  if (fs.existsSync(canonicalPath)) {
    try {
      const inspected = inspectPng(canonicalPath);
      canonical = {
        width: inspected.width,
        height: inspected.height,
        sha256: inspected.sha256,
        dimensionsMatch: inspected.width === generated.width && inspected.height === generated.height,
      };
      if (!canonical.dimensionsMatch) {
        failures.push(
          `${filename}: canonical dimensions changed from ${inspected.width}x${inspected.height} to ${generated.width}x${generated.height}`,
        );
      }
    } catch (error) {
      failures.push(`canonical ${filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  files.push({
    filename,
    owner: expectedOwners.get(filename) ?? null,
    ...generated,
    canonical,
  });
}

const report = {
  sourceSha,
  expectedCount: expected.length,
  actualCount: actual.length,
  missing,
  unexpected,
  failures,
  files,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length) {
  for (const failure of failures) console.error(failure);
  console.error(`Functional screenshot verification failed; report: ${reportPath}`);
  process.exit(1);
}

console.log(`Verified ${actual.length}/${expected.length} functional screenshots for ${sourceSha}.`);
console.log(`Verification report: ${reportPath}`);
