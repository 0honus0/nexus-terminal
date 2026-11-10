import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const e2eRoot = path.join(repoRoot, 'tests/e2e');
const estimatesPath = path.join(scriptDir, 'duration-estimates.json');
const playwright = path.join(
	repoRoot,
	'tests/node_modules/.bin',
	process.platform === 'win32' ? 'playwright.cmd' : 'playwright',
);
const defaultDurationMs = 10_000;

function parseArgs(argv) {
	const args = { command: argv[0] ?? 'plan' };
	for (let index = 1; index < argv.length; index += 1) {
		const current = argv[index];
		if (!current.startsWith('--')) continue;
		const key = current.slice(2);
		const value = argv[index + 1];
		if (!value || value.startsWith('--')) {
			args[key] = true;
			continue;
		}
		args[key] = value;
		index += 1;
	}
	return args;
}

function resolveShardCount(raw, specCount) {
	const shardCount = Number(raw ?? process.env.E2E_SHARDS ?? 8);
	if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > specCount) {
		throw new Error(`--shards must be an integer between 1 and ${specCount}; received ${raw}`);
	}
	return shardCount;
}

function discoverSpecs() {
	const result = spawnSync(playwright, ['test', '--config', '../playwright.config.ts', '--list', '--reporter=json'], {
		cwd: e2eRoot,
		env: process.env,
		encoding: 'utf8',
		maxBuffer: Infinity,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error('Playwright discovery failed: ' + result.stderr + result.stdout);
	const report = JSON.parse(result.stdout);
	if (report.errors?.length) throw new AggregateError(report.errors, 'Playwright discovery reported errors');
	const specs = new Set();
	const pending = [...report.suites];
	while (pending.length) {
		const current = pending.pop();
		for (const spec of current.specs ?? []) specs.add('specs/' + spec.file);
		pending.push(...(current.suites ?? []));
	}
	if (!specs.size) throw new Error('Playwright discovered no tests');
	return [...specs].sort();
}

function median(values) {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function projectFor(spec) {
	return spec.split('/')[1];
}

function durationMap(specs) {
	const payload = JSON.parse(fs.readFileSync(estimatesPath, 'utf8'));
	if (payload.version !== 1 || typeof payload.specs !== 'object') {
		throw new Error(`Invalid duration estimates: ${estimatesPath}`);
	}

	const direct = new Map(
		Object.entries(payload.specs).filter(([, duration]) => Number.isFinite(duration) && duration > 0),
	);
	const globalMedian = median([...direct.values()]) ?? defaultDurationMs;
	const projectMedians = new Map();
	for (const project of new Set(specs.map(projectFor))) {
		projectMedians.set(
			project,
			median(
				specs
					.filter((spec) => projectFor(spec) === project)
					.map((spec) => direct.get(spec))
					.filter(Boolean),
			),
		);
	}

	return new Map(
		specs.map((spec) => [
			spec,
			Math.round(direct.get(spec) ?? projectMedians.get(projectFor(spec)) ?? globalMedian),
		]),
	);
}

function createPlan(shardCount, specs) {
	const durations = durationMap(specs);
	const shards = Array.from({ length: shardCount }, (_, index) => ({ id: index + 1, specs: [], totalMs: 0 }));
	const orderedSpecs = [...specs].sort(
		(left, right) => durations.get(right) - durations.get(left) || left.localeCompare(right),
	);

	for (const spec of orderedSpecs) {
		const target = [...shards].sort(
			(left, right) =>
				left.totalMs - right.totalMs || left.specs.length - right.specs.length || left.id - right.id,
		)[0];
		target.specs.push(spec);
		target.totalMs += durations.get(spec);
	}

	for (const shard of shards) shard.specs.sort();
	return { specs, shards };
}

function printPlan(plan) {
	for (const shard of plan.shards) {
		console.log(
			`[E2E shards] shard-${shard.id}: specs=${shard.specs.length} estimate=${(shard.totalMs / 1000).toFixed(1)}s`,
		);
	}
}

function prepareApplication() {
	// CI supplies this exact revision's artifact. Isolated lifetimes restart without recompiling.
	if (process.env.NEXUS_E2E_PREBUILT !== '1') {
		const built = spawnSync(
			process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
			['--filter', '@nexus-terminal/tests', 'build'],
			{
				cwd: repoRoot,
				stdio: 'inherit',
				env: process.env,
			},
		);
		if (built.error) throw built.error;
		if (built.status !== 0) throw new Error('E2E application build failed');
	}
	for (const file of [
		'backend/dist/bootstrap/create-app.js',
		'shared/dist/access/http.js',
		'frontend/dist/index.html',
		'frontend/dist/__e2e__/browser-clients.js',
		'frontend/dist/__e2e__/browser-terminal.js',
		'frontend/dist/__e2e__/browser-terminal.css',
	]) {
		if (!fs.existsSync(path.join(repoRoot, 'packages', file)))
			throw new Error('Missing E2E application build: ' + file);
	}
}

function run(plan, rawShard) {
	const shardId = Number(rawShard ?? process.env.E2E_SHARD);
	const shard = plan.shards.find((candidate) => candidate.id === shardId);
	if (!shard) throw new Error(`--shard must be between 1 and ${plan.shards.length}; received ${rawShard}`);

	console.log(
		`[E2E shards] running shard-${shard.id}/${plan.shards.length}: ${shard.specs.length} specs, estimated ${(shard.totalMs / 1000).toFixed(1)}s`,
	);
	// Each test owns its application's normal or explicitly asserted unknown
	// shutdown through the fixture. No product-specific process lifetimes here.
	const timingsPath = path.resolve(
		process.env.NEXUS_TEST_ARTIFACT_DIR ?? path.join(repoRoot, 'tests/.artifacts/browser'),
		'reports/spec-durations.json',
	);
	const result = spawnSync(playwright, ['test', '--config', '../playwright.config.ts', ...shard.specs], {
		cwd: e2eRoot,
		env: { ...process.env, E2E_SPEC_DURATIONS_PATH: timingsPath },
		stdio: 'inherit',
	});
	if (result.error) throw result.error;
	if (!fs.existsSync(timingsPath)) throw new Error(`Missing E2E duration record: ${timingsPath}`);
	process.exitCode = result.status ?? 1;
}

const args = parseArgs(process.argv.slice(2));

try {
	if (args.command === 'run') prepareApplication();
	const specs = discoverSpecs();
	const shardCount = resolveShardCount(args.shards, specs.length);
	const plan = createPlan(shardCount, specs);
	if (args.command === 'run') run(plan, args.shard);
	else if (args.command === 'plan') printPlan(plan);
	else throw new Error(`Unknown command: ${args.command}`);
} catch (error) {
	console.error(`[E2E shards] ${error?.stack ?? error}`);
	process.exitCode = 1;
}
