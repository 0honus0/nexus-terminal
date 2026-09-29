import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const estimatesPath = path.join(scriptDir, 'duration-estimates.json');
const specsRoot = path.join(repoRoot, 'tests/e2e/specs');
const smoothingWeight = 0.35;
const minimumChangeMs = 2_000;
const minimumChangeRatio = 0.05;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) args[key] = true;
    else {
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

function timingFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && entry.name === 'spec-durations.json') files.push(absolute);
    }
  }
  return files.sort();
}

function existingSpecs() {
  const specs = new Set();
  const stack = [specsRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
        specs.add(path.relative(path.join(repoRoot, 'tests/e2e'), absolute).split(path.sep).join('/'));
      }
    }
  }
  return specs;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function observedDurations(inputDirectory) {
  const valuesBySpec = new Map();
  for (const file of timingFiles(inputDirectory)) {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (payload.version !== 1 || typeof payload.specs !== 'object') throw new Error(`Invalid timing artifact: ${file}`);
    for (const [spec, duration] of Object.entries(payload.specs)) {
      if (!Number.isFinite(duration) || duration <= 0) continue;
      const values = valuesBySpec.get(spec) ?? [];
      values.push(Math.round(duration));
      valuesBySpec.set(spec, values);
    }
  }
  return new Map([...valuesBySpec].map(([spec, values]) => [spec, median(values)]));
}

function shouldUpdate(previous, next) {
  const difference = Math.abs(next - previous);
  return difference >= minimumChangeMs && difference / previous >= minimumChangeRatio;
}

const args = parseArgs(process.argv.slice(2));
const inputDirectory = path.resolve(args.input ?? 'e2e-timings');
if (!fs.existsSync(inputDirectory)) throw new Error(`Timing artifact directory does not exist: ${inputDirectory}`);

const payload = JSON.parse(fs.readFileSync(estimatesPath, 'utf8'));
if (payload.version !== 1 || typeof payload.specs !== 'object') throw new Error(`Invalid estimates: ${estimatesPath}`);
const observed = observedDurations(inputDirectory);
if (observed.size === 0) throw new Error(`No spec timings found under ${inputDirectory}`);
const specs = existingSpecs();

let changed = 0;
for (const spec of Object.keys(payload.specs)) {
  if (specs.has(spec)) continue;
  delete payload.specs[spec];
  changed += 1;
}
for (const [spec, duration] of observed) {
  if (!specs.has(spec)) throw new Error(`Timing artifact references unknown spec: ${spec}`);
  const previous = payload.specs[spec];
  if (!Number.isFinite(previous) || previous <= 0) {
    payload.specs[spec] = duration;
    changed += 1;
    continue;
  }
  const smoothed = Math.round(previous * (1 - smoothingWeight) + duration * smoothingWeight);
  if (!shouldUpdate(previous, smoothed)) continue;
  payload.specs[spec] = smoothed;
  changed += 1;
}

payload.specs = Object.fromEntries(Object.entries(payload.specs).sort(([left], [right]) => left.localeCompare(right)));
fs.writeFileSync(estimatesPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`[E2E timings] observed ${observed.size} specs; updated ${changed} estimates`);
