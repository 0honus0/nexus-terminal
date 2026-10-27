import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const e2eRoot = path.join(repoRoot, 'tests/e2e');
const specsRoot = path.join(e2eRoot, 'specs');
const estimatesPath = path.join(scriptDir, 'duration-estimates.json');
const projectNames = ['auth', 'http', 'agent', 'websocket', 'ui', 'ssh', 'mobile'];
const suite = process.env.NEXUS_E2E_SUITE ?? 'all';
if (!['all', 'backend', 'browser'].includes(suite)) throw new Error('Invalid NEXUS_E2E_SUITE');
const backendSpecs = new Set(
	JSON.parse(fs.readFileSync(path.join(e2eRoot, 'backend-specs.json'), 'utf8')).map((spec) => 'specs/' + spec),
);
const defaultDurationMs = 10_000;
// Deliberate unknown descendant effects must retain their backend shutdown
// fence. Give that full E2E scenario its own application lifetime instead of
// trying to reset or force-close a backend with unconfirmed Run effects.
const isolatedUnknownSpec = 'specs/agent/preset-plugin.spec.ts';
const isolatedUnknownTitle =
	'Nexus Agent subagent lifecycle preserves tool batches and reclaims child Browser contexts';
const isolatedInvalidToolTitle =
	'installed Nexus Agent plugin uses the host-owned Agent surface and captures functional evidence';
const isolatedAcpSpec = 'specs/agent/ssh-acp-settings.spec.ts';
const isolatedAcpCancelledTitle =
	'SSH ACP settings product chain: cancelled inner permission without a Workspace profile';

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
	const specs = [];
	for (const project of projectNames) {
		const projectRoot = path.join(specsRoot, project);
		const stack = [projectRoot];
		while (stack.length > 0) {
			const current = stack.pop();
			for (const entry of fs
				.readdirSync(current, { withFileTypes: true })
				.sort((a, b) => b.name.localeCompare(a.name))) {
				const absolute = path.join(current, entry.name);
				if (entry.isDirectory()) stack.push(absolute);
				else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
					specs.push(path.relative(e2eRoot, absolute).split(path.sep).join('/'));
				}
			}
		}
	}
	return specs.filter((spec) => suite === 'all' || backendSpecs.has(spec) === (suite === 'backend')).sort();
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
	for (const project of projectNames) {
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

function createPlan(shardCount) {
	const specs = discoverSpecs();
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

function run(plan, rawShard) {
	const shardId = Number(rawShard ?? process.env.E2E_SHARD);
	const shard = plan.shards.find((candidate) => candidate.id === shardId);
	if (!shard) throw new Error(`--shard must be between 1 and ${plan.shards.length}; received ${rawShard}`);

	console.log(
		`[E2E shards] running shard-${shard.id}/${plan.shards.length}: ${shard.specs.length} specs, estimated ${(shard.totalMs / 1000).toFixed(1)}s`,
	);
	const playwright = path.join(
		e2eRoot,
		'node_modules',
		'.bin',
		process.platform === 'win32' ? 'playwright.cmd' : 'playwright',
	);
	// CI supplies this exact revision's artifact. Isolated lifetimes restart without recompiling.
	if (process.env.NEXUS_E2E_PREBUILT !== '1') {
		const built = spawnSync(
			process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
			['--filter', '@nexus-terminal/e2e', 'build'],
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
	]) {
		if (!fs.existsSync(path.join(repoRoot, 'packages', file)))
			throw new Error('Missing E2E application build: ' + file);
	}
	const isolatedPlugin = shard.specs.includes(isolatedUnknownSpec);
	const isolatedAcp = shard.specs.includes(isolatedAcpSpec);
	const suffixes = [
		'regular',
		...(isolatedPlugin ? ['invalid-tool', 'unknown'] : []),
		...(isolatedAcp ? ['acp-cancelled'] : []),
	];
	const isolatedTitles = [
		...(isolatedPlugin ? [isolatedInvalidToolTitle, isolatedUnknownTitle] : []),
		...(isolatedAcp ? [isolatedAcpCancelledTitle] : []),
	];
	const outcomes = [];
	const durations = [];
	const capturedLogs = [];
	for (const suffix of suffixes) {
		const selected =
			suffix === 'unknown'
				? [isolatedUnknownSpec, '--grep', isolatedUnknownTitle]
				: suffix === 'invalid-tool'
					? [isolatedUnknownSpec, '--grep', isolatedInvalidToolTitle]
					: suffix === 'acp-cancelled'
						? [isolatedAcpSpec, '--grep', isolatedAcpCancelledTitle]
						: [
								...shard.specs,
								...(isolatedTitles.length ? ['--grep-invert', isolatedTitles.join('|')] : []),
							];
		const timingsPath = path.join(e2eRoot, 'test-results', `spec-durations-${suffix}.json`);
		console.log(`[E2E shards] ${suffix}: ${selected.join(' ')}`);
		const result = spawnSync(playwright, ['test', ...selected, '--output', `test-results/${suffix}`], {
			cwd: e2eRoot,
			env: {
				...process.env,
				E2E_SPEC_DURATIONS_PATH: `test-results/spec-durations-${suffix}.json`,
				PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(e2eRoot, 'playwright-report', suffix),
			},
			stdio: 'inherit',
		});
		if (result.error) throw result.error;
		outcomes.push(result.status ?? 1);
		if (!fs.existsSync(timingsPath)) throw new Error(`Missing E2E duration record: ${timingsPath}`);
		durations.push(JSON.parse(fs.readFileSync(timingsPath, 'utf8')).specs);
		if (suffixes.length > 1 && suffix !== suffixes[suffixes.length - 1]) {
			// Playwright recreates the log directory on each new backend lifetime.
			// Preserve real failures and timing evidence from every earlier phase.
			const location = path.join(e2eRoot, '.tmp', `balanced-shard-${suffix}-logs`);
			fs.rmSync(location, { recursive: true, force: true });
			fs.cpSync(path.join(e2eRoot, 'logs'), location, { recursive: true });
			capturedLogs.push({ suffix, location });
		}
	}
	if (suffixes.length > 1) {
		for (const { suffix, location } of capturedLogs) {
			fs.cpSync(location, path.join(e2eRoot, 'logs', suffix), { recursive: true });
			fs.rmSync(location, { recursive: true, force: true });
		}
	}
	const merged = Object.assign({}, ...durations);
	for (const spec of [...(isolatedPlugin ? [isolatedUnknownSpec] : []), ...(isolatedAcp ? [isolatedAcpSpec] : [])]) {
		// Isolating one case must preserve all actual runs and their combined
		// timing, rather than overwriting the spec with the final phase's time.
		const timings = durations.map((part) => part[spec]).filter((value) => Number.isFinite(value));
		if (timings.length) {
			merged[spec] = timings.reduce((total, value) => total + value, 0);
		}
	}
	fs.writeFileSync(
		path.join(e2eRoot, 'test-results', 'spec-durations.json'),
		`${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), specs: merged }, null, 2)}\n`,
		'utf8',
	);
	process.exitCode = outcomes.every((status) => status === 0) ? 0 : 1;
}

const args = parseArgs(process.argv.slice(2));

try {
	const specs = discoverSpecs();
	const shardCount = resolveShardCount(args.shards, specs.length);
	const plan = createPlan(shardCount);
	if (args.command === 'run') run(plan, args.shard);
	else if (args.command === 'plan') printPlan(plan);
	else throw new Error(`Unknown command: ${args.command}`);
} catch (error) {
	console.error(`[E2E shards] ${error?.stack ?? error}`);
	process.exitCode = 1;
}
