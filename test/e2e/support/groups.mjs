import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(__dirname, '..');
const testsRoot = path.join(e2eRoot, 'tests');
const groupsRoot = path.join(e2eRoot, 'groups');
const settingsPath = path.join(groupsRoot, 'settings.json');
const timingsPath = path.join(groupsRoot, 'timings.json');
const projectNames = ['auth', 'http', 'websocket', 'ui', 'ssh', 'mobile'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonStable(file, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current === next) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, 'utf8');
  return true;
}

function parseArgs(argv) {
  const args = { command: argv[0] || 'help' };
  for (let index = 1; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) continue;
    const equalIndex = raw.indexOf('=');
    if (equalIndex > 2) {
      args[raw.slice(2, equalIndex)] = raw.slice(equalIndex + 1);
      continue;
    }
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function normalizedRelative(file) {
  return path.relative(e2eRoot, file).split(path.sep).join('/');
}

function discoverSpecs() {
  const specs = [];
  for (const project of projectNames) {
    const root = path.join(testsRoot, project);
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(absolute);
        else if (entry.isFile() && entry.name.endsWith('.spec.ts')) specs.push(normalizedRelative(absolute));
      }
    }
  }
  return specs.sort();
}

function familyFor(spec) {
  const [, project, filename = ''] = spec.split('/');
  if (project === 'ui') {
    if (
      /^(captcha|change-password|ip-blacklist|ip-whitelist|protected-navigation|session-lifecycle|ssh-key)/.test(
        filename,
      )
    ) {
      return 'ui:security';
    }
    if (/^(notification|proxy|system-settings|theme-switching)/.test(filename)) return 'ui:settings';
    return 'ui:data';
  }
  if (project !== 'ssh') return project;

  if (/^(file-manager|file-preview)/.test(filename)) return 'ssh:file-manager';
  if (/^(file-upload|cross-session-transfer)/.test(filename)) return 'ssh:file-transfer';
  if (/^progress-display/.test(filename)) return 'ssh:progress';
  if (/^(quick-command|command-history)/.test(filename)) return 'ssh:commands';
  if (/^(connection|reconnect)/.test(filename)) return 'ssh:connections';
  if (/^(terminal|panel-wheel)/.test(filename)) return 'ssh:terminal';
  if (/suspend-resume/.test(filename)) return 'ssh:suspend';
  if (/docker|protocol/.test(filename)) return 'ssh:protocol';
  return 'ssh:other';
}

function median(values) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function loadSettings() {
  const settings = readJson(settingsPath);
  if (settings.version !== 1) throw new Error(`Unsupported group settings version: ${settings.version}`);
  return settings;
}

function resolveWorkers(args, settings, specCount) {
  const raw = args.workers ?? process.env.E2E_GROUP_WORKERS ?? settings.workers;
  const workers = Number(raw);
  if (!Number.isInteger(workers) || workers < 1 || workers > specCount) {
    throw new Error(`workers must be an integer between 1 and ${specCount}; received ${raw}`);
  }
  return workers;
}

function loadTimings() {
  if (!fs.existsSync(timingsPath)) return { version: 1, specs: {} };
  const timings = readJson(timingsPath);
  if (timings.version !== 1 || typeof timings.specs !== 'object') {
    throw new Error('Invalid groups/timings.json');
  }
  return timings;
}

function buildDurationMap(specs, timings, settings) {
  const directlyTimed = new Map();
  for (const spec of specs) {
    const entry = timings.specs[spec];
    const samples = Array.isArray(entry?.samplesMs)
      ? entry.samplesMs.filter((value) => Number.isFinite(value) && value > 0)
      : [];
    const value = median(samples) ?? (Number.isFinite(entry?.medianMs) ? entry.medianMs : undefined);
    if (value) directlyTimed.set(spec, Math.round(value));
  }

  const globalMedian = median([...directlyTimed.values()]) ?? settings.defaultSpecDurationMs;
  const familyValues = new Map();
  for (const [spec, duration] of directlyTimed) {
    const family = familyFor(spec);
    if (!familyValues.has(family)) familyValues.set(family, []);
    familyValues.get(family).push(duration);
  }

  const durations = new Map();
  for (const spec of specs) {
    const direct = directlyTimed.get(spec);
    const familyMedian = median(familyValues.get(familyFor(spec)) || []);
    durations.set(spec, direct ?? familyMedian ?? globalMedian ?? settings.defaultSpecDurationMs);
  }
  return durations;
}

function createEmptyGroups(workers) {
  return Array.from({ length: workers }, (_, index) => ({
    id: index + 1,
    specs: [],
    families: new Set(),
    totalMs: 0,
  }));
}

function addSpec(group, spec, duration) {
  group.specs.push(spec);
  group.families.add(familyFor(spec));
  group.totalMs += duration;
}

function leastLoadedGroup(groups) {
  return [...groups].sort((a, b) => a.totalMs - b.totalMs || a.id - b.id)[0];
}

function buildCandidate(specs, durations, workers, settings) {
  const groups = createEmptyGroups(workers);
  const totalDuration = specs.reduce((sum, spec) => sum + durations.get(spec), 0);
  const target = totalDuration / workers;
  const families = new Map();

  for (const spec of specs) {
    const family = familyFor(spec);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(spec);
  }

  const orderedFamilies = [...families.entries()]
    .map(([name, familySpecs]) => ({
      name,
      specs: [...familySpecs].sort((a, b) => durations.get(b) - durations.get(a) || a.localeCompare(b)),
      totalMs: familySpecs.reduce((sum, spec) => sum + durations.get(spec), 0),
    }))
    .sort((a, b) => b.totalMs - a.totalMs || a.name.localeCompare(b.name));

  for (const family of orderedFamilies) {
    if (family.totalMs <= target * settings.familyWholeTargetRatio) {
      const group = leastLoadedGroup(groups);
      for (const spec of family.specs) addSpec(group, spec, durations.get(spec));
      continue;
    }

    for (const spec of family.specs) {
      const duration = durations.get(spec);
      const ranked = [...groups].sort((a, b) => {
        const score = (group) => {
          const affinityPenalty = group.families.has(family.name) ? 0 : target * 0.08;
          const projected = group.totalMs + duration;
          const overflowPenalty = Math.max(0, projected - target) * 0.2;
          return projected + affinityPenalty + overflowPenalty;
        };
        return score(a) - score(b) || a.id - b.id;
      });
      addSpec(ranked[0], spec, duration);
    }
  }

  for (const group of groups) {
    group.specs.sort((a, b) => familyFor(a).localeCompare(familyFor(b)) || a.localeCompare(b));
  }
  return groups;
}

function groupFiles() {
  if (!fs.existsSync(groupsRoot)) return [];
  return fs
    .readdirSync(groupsRoot)
    .map((name) => {
      const match = /^group-(\d+)\.json$/.exec(name);
      return match ? { id: Number(match[1]), path: path.join(groupsRoot, name) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);
}

function loadExistingAssignment(specs, workers) {
  const files = groupFiles();
  if (files.length !== workers || files.some((file, index) => file.id !== index + 1)) return null;

  const groups = [];
  const assigned = [];
  for (const file of files) {
    const value = readJson(file.path);
    if (value.version !== 1 || value.group !== file.id || value.workers !== workers || !Array.isArray(value.specs))
      return null;
    groups.push({ id: file.id, specs: [...value.specs] });
    assigned.push(...value.specs);
  }

  const expected = [...specs].sort();
  const actual = [...assigned].sort();
  if (expected.length !== actual.length || expected.some((spec, index) => spec !== actual[index])) return null;
  if (new Set(actual).size !== actual.length) return null;
  return groups;
}

function withLoads(groups, durations) {
  return groups.map((group) => ({
    ...group,
    totalMs: group.specs.reduce((sum, spec) => sum + (durations.get(spec) || 0), 0),
  }));
}

function maxLoad(groups) {
  return Math.max(...groups.map((group) => group.totalMs));
}

function minLoad(groups) {
  return Math.min(...groups.map((group) => group.totalMs));
}

function chooseAssignment(specs, durations, workers, settings, force) {
  const candidate = buildCandidate(specs, durations, workers, settings);
  const existingRaw = loadExistingAssignment(specs, workers);
  if (force || !existingRaw)
    return { groups: candidate, reason: existingRaw ? 'forced' : 'new-or-worker-count-changed' };

  const existing = withLoads(existingRaw, durations);
  const currentMax = maxLoad(existing);
  const currentMin = minLoad(existing);
  const candidateMax = maxLoad(candidate);
  const improvementPercent = currentMax > 0 ? ((currentMax - candidateMax) / currentMax) * 100 : 0;
  const imbalanceMs = currentMax - currentMin;

  if (
    improvementPercent < settings.rebalance.minImprovementPercent &&
    imbalanceMs < settings.rebalance.minImbalanceMs
  ) {
    return { groups: existing, reason: `kept-existing (${improvementPercent.toFixed(1)}% predicted improvement)` };
  }

  return { groups: candidate, reason: `rebalanced (${improvementPercent.toFixed(1)}% predicted improvement)` };
}

function serializeGroup(group, workers) {
  return {
    version: 1,
    group: group.id,
    workers,
    specs: group.specs,
  };
}

function generate(args) {
  const specs = discoverSpecs();
  const settings = loadSettings();
  const workers = resolveWorkers(args, settings, specs.length);
  const timings = loadTimings();
  const durations = buildDurationMap(specs, timings, settings);
  const force = args.force === true || args.force === 'true';
  const selected = chooseAssignment(specs, durations, workers, settings, force);

  let changed = false;
  for (const file of groupFiles()) {
    if (file.id > workers) {
      fs.rmSync(file.path, { force: true });
      changed = true;
    }
  }
  for (const group of selected.groups) {
    changed =
      writeJsonStable(path.join(groupsRoot, `group-${group.id}.json`), serializeGroup(group, workers)) || changed;
  }

  const loaded = withLoads(selected.groups, durations);
  console.log(
    `[E2E groups] workers=${workers} specs=${specs.length} ${selected.reason}${changed ? ' changed' : ' unchanged'}`,
  );
  for (const group of loaded) {
    const families = [...new Set(group.specs.map(familyFor))].join(', ');
    console.log(
      `[E2E groups] group-${group.id}: specs=${group.specs.length} estimate=${Math.round(group.totalMs / 100) / 10}s families=${families}`,
    );
  }
}

function check(args) {
  const specs = discoverSpecs();
  const settings = loadSettings();
  const workers = resolveWorkers(args, settings, specs.length);
  const files = groupFiles();
  const errors = [];

  if (files.length !== workers) errors.push(`expected ${workers} group files, found ${files.length}`);
  const seen = new Map();
  for (const file of files) {
    if (file.id > workers) errors.push(`stale group file: ${path.basename(file.path)}`);
    const value = readJson(file.path);
    if (value.version !== 1) errors.push(`${path.basename(file.path)} has unsupported version`);
    if (value.group !== file.id) errors.push(`${path.basename(file.path)} has group=${value.group}`);
    if (value.workers !== workers)
      errors.push(`${path.basename(file.path)} has workers=${value.workers}, expected ${workers}`);
    if (!Array.isArray(value.specs)) {
      errors.push(`${path.basename(file.path)} specs must be an array`);
      continue;
    }
    for (const spec of value.specs) {
      if (!seen.has(spec)) seen.set(spec, []);
      seen.get(spec).push(file.id);
    }
  }

  for (const spec of specs) {
    const owners = seen.get(spec) || [];
    if (owners.length === 0) errors.push(`missing spec: ${spec}`);
    if (owners.length > 1) errors.push(`duplicate spec: ${spec} in groups ${owners.join(',')}`);
  }
  for (const spec of seen.keys()) {
    if (!specs.includes(spec)) errors.push(`stale spec path: ${spec}`);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`[E2E groups] ${error}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`[E2E groups] check passed: ${specs.length} specs assigned exactly once across ${workers} groups`);
  return true;
}

function matrix(args) {
  const specs = discoverSpecs();
  const settings = loadSettings();
  const workers = resolveWorkers(args, settings, specs.length);
  process.stdout.write(
    JSON.stringify({
      include: Array.from({ length: workers }, (_, index) => ({ group: index + 1 })),
    }),
  );
}

async function runGroup(args) {
  const specs = discoverSpecs();
  const settings = loadSettings();
  const workers = resolveWorkers(args, settings, specs.length);
  const groupId = Number(args.group ?? process.env.E2E_GROUP);
  if (!Number.isInteger(groupId) || groupId < 1 || groupId > workers) {
    throw new Error(`--group must be between 1 and ${workers}`);
  }
  if (!check({ workers: String(workers) })) throw new Error('group validation failed');

  const group = readJson(path.join(groupsRoot, `group-${groupId}.json`));
  const timingsOutput = path.join(e2eRoot, '.tmp', `spec-timings-group-${groupId}.json`);
  console.log(`[E2E groups] running group-${groupId}/${workers} with ${group.specs.length} specs`);
  const detached = process.platform !== 'win32';
  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', ...group.specs], {
    cwd: e2eRoot,
    detached,
    env: {
      ...process.env,
      E2E_GROUP_ID: String(groupId),
      E2E_GROUP_WORKERS: String(workers),
      E2E_TIMINGS_OUTPUT: timingsOutput,
    },
    stdio: 'inherit',
  });

  let receivedSignal;
  let forceKillTimer;
  const killChildTree = (signal) => {
    try {
      if (detached && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  };
  const forwardSignal = (signal) => {
    if (receivedSignal) return;
    receivedSignal = signal;
    killChildTree(signal);
    forceKillTimer = setTimeout(() => killChildTree('SIGKILL'), 5_000);
    forceKillTimer.unref();
  };
  const handleSigint = () => forwardSignal('SIGINT');
  const handleSigterm = () => forwardSignal('SIGTERM');
  process.once('SIGINT', handleSigint);
  process.once('SIGTERM', handleSigterm);

  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  }).finally(() => {
    if (forceKillTimer) clearTimeout(forceKillTimer);
    process.removeListener('SIGINT', handleSigint);
    process.removeListener('SIGTERM', handleSigterm);
  });

  const signalNumber = {
    SIGINT: 2,
    SIGTERM: 15,
  }[receivedSignal ?? result.signal];
  process.exitCode = signalNumber ? 128 + signalNumber : (result.code ?? 1);
}

function collectJsonFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current).sort().reverse()) stack.push(path.join(current, entry));
    } else if (stat.isFile() && current.endsWith('.json')) {
      files.push(current);
    }
  }
  return files.sort();
}

function updateTimings(args) {
  const inputDir = args['input-dir'];
  if (!inputDir) throw new Error('--input-dir is required');
  const absoluteInput = path.resolve(process.cwd(), inputDir);
  const files = collectJsonFiles(absoluteInput);
  if (files.length === 0) throw new Error(`no JSON timing artifacts found under ${absoluteInput}`);

  const specs = discoverSpecs();
  const specSet = new Set(specs);
  const settings = loadSettings();
  const current = loadTimings();
  const observed = new Map();

  for (const file of files) {
    let payload;
    try {
      payload = readJson(file);
    } catch {
      continue;
    }
    if (payload?.version !== 1 || typeof payload?.specs !== 'object') continue;
    for (const [spec, duration] of Object.entries(payload.specs)) {
      if (!specSet.has(spec) || !Number.isFinite(duration) || duration <= 0) continue;
      if (!observed.has(spec)) observed.set(spec, []);
      observed.get(spec).push(Math.round(duration));
    }
  }
  if (observed.size === 0) throw new Error('no valid spec timings were found in input artifacts');

  const nextSpecs = {};
  for (const spec of specs) {
    const oldSamples = Array.isArray(current.specs[spec]?.samplesMs) ? current.specs[spec].samplesMs : [];
    const newSamples = observed.get(spec) || [];
    const samplesMs = [...oldSamples, ...newSamples]
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(-settings.timingWindow);
    if (samplesMs.length === 0) continue;
    nextSpecs[spec] = { samplesMs, medianMs: median(samplesMs) };
  }

  const changed = writeJsonStable(timingsPath, { version: 1, specs: nextSpecs });
  console.log(
    `[E2E groups] timings ${changed ? 'updated' : 'unchanged'}: observed=${observed.size} window=${settings.timingWindow}`,
  );
}

function help() {
  console.log(
    `Usage:\n  node support/groups.mjs generate [--workers N] [--force]\n  node support/groups.mjs check [--workers N]\n  node support/groups.mjs matrix [--workers N]\n  node support/groups.mjs run --group N [--workers N]\n  node support/groups.mjs update-timings --input-dir PATH`,
  );
}

const args = parseArgs(process.argv.slice(2));
try {
  switch (args.command) {
    case 'generate':
      generate(args);
      break;
    case 'check':
      check(args);
      break;
    case 'matrix':
      matrix(args);
      break;
    case 'run':
      await runGroup(args);
      break;
    case 'update-timings':
      updateTimings(args);
      break;
    default:
      help();
  }
} catch (error) {
  console.error(`[E2E groups] ${error?.stack || error}`);
  process.exitCode = 1;
}
