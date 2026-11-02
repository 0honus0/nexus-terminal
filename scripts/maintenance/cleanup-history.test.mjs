import assert from 'node:assert/strict';
import { test } from 'node:test';
import cleanup from './cleanup-history.mjs';

const digest = (value) => 'sha256:' + value.repeat(64);

function fixture(t, { absent = [], failure, active = false, freshStatus, moved = false } = {}) {
	const calls = [];
	const logs = [];
	let rows;
	const runs = [
		{ id: 900, status: 'in_progress' },
		{ id: 1, status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40) },
		{
			id: 2,
			status: 'completed',
			conclusion: 'success',
			head_sha: 'b'.repeat(40),
			path: '.github/workflows/e2e.yml',
		},
		{ id: 3, status: 'completed', conclusion: 'failure', head_sha: 'c'.repeat(40) },
		...(active ? [{ id: 4, status: 'in_progress' }] : []),
	];
	const products = [
		{ id: 10, name: digest('1'), metadata: { container: { tags: ['latest'] } } },
		{ id: 11, name: digest('2'), metadata: { container: { tags: ['dev'] } } },
		{ id: 12, name: digest('4'), metadata: { container: { tags: [] } } },
		{ id: 13, name: digest('5'), metadata: { container: { tags: [] } } },
		{ id: 14, name: digest('3'), metadata: { container: { tags: ['old'] } } },
	];

	const remove = async (key) => {
		calls.push(key);
		const status = absent.includes(key) ? 404 : failure?.key === key ? failure.status : null;
		if (status) throw Object.assign(new Error('Fixture GitHub failure'), { status });
	};

	const actions = {
		listWorkflowRunsForRepo() {},

		listArtifactsForRepo() {},

		getActionsCacheList() {},

		async getWorkflowRun({ run_id: id }) {
			if (absent.includes('read:' + id)) throw Object.assign(new Error('Run absent'), { status: 404 });
			return { data: { ...runs.find((run) => run.id === id), ...(freshStatus ? { status: freshStatus } : {}) } };
		},

		deleteArtifact: ({ artifact_id: id }) => remove('artifact:' + id),

		deleteWorkflowRun: ({ run_id: id }) => remove('run:' + id),

		deleteActionsCacheById: ({ cache_id: id }) => remove('cache:' + id),
	};
	let listedRuns = 0;
	const github = {
		rest: { repos: { get: async () => ({ data: { owner: { type: 'User' } } }) }, actions },

		async paginate(method, params) {
			if (method === actions.listWorkflowRunsForRepo) {
				listedRuns++;
				return listedRuns > 1 && freshStatus
					? runs.map((run) => (run.id === 3 ? { ...run, status: freshStatus } : run))
					: runs;
			}
			if (method === actions.listArtifactsForRepo)
				return [
					{ id: 30, workflow_run: { id: 3 } },
					{ id: 31, workflow_run: { id: 1 } },
					{ id: 32, workflow_run: { id: active ? 4 : 2 } },
					{ id: 33 },
				];
			if (method === actions.getActionsCacheList) return [{ id: 40 }];
			assert.match(method, /^GET \/users\/\{username\}\/packages\/container/);
			return params.package_name === 'nexus-terminal' ? products : [{ id: 20 }];
		},

		async request(route, params) {
			assert.match(route, /^DELETE \/users\/\{username\}\/packages\/container/);
			assert.equal(params.request.retries, 0, 'package deletes cannot retry behind the channel guard');
			return remove('image:' + params.package_version_id);
		},
	};
	const summary = {
		addHeading() {
			return summary;
		},

		addRaw() {
			return summary;
		},

		addTable(value) {
			rows = value;
			return summary;
		},

		async write() {},
	};
	const core = {
		info: (text) => logs.push(text),

		setSecret() {},

		summary,
	};
	t.mock.method(globalThis, 'fetch', async (value, options) => {
		const url = new URL(value);
		if (url.pathname === '/token') return Response.json({ token: 'fixture-token' });
		if (options.method === 'HEAD') {
			const tag = url.pathname.split('/').at(-1);
			const changed = moved && calls.includes('artifact:30');
			return new Response(null, {
				headers: { 'docker-content-digest': changed ? digest('f') : digest(tag === 'latest' ? '1' : '2') },
			});
		}
		const id = url.pathname.split('/').at(-1);
		if (id === digest('1') || id === digest('2'))
			return Response.json({ manifests: [{ digest: digest('4') }, { digest: digest('5') }] });
		if (id === digest('4') || id === digest('5'))
			return Response.json({ config: { digest: digest(id === digest('4') ? '8' : '9') } });
		assert.ok(id === digest('8') || id === digest('9'));
		return Response.json({
			config: { Labels: id === digest('8') ? { 'org.opencontainers.image.revision': 'a'.repeat(40) } : {} },
		});
	});
	return {
		args: {
			github,
			core,
			context: { repo: { owner: 'fixture', repo: 'nexus-terminal' }, actor: 'fixture', runId: 900 },
		},
		calls,
		logs,

		count(name) {
			return rows.find((row) => row[0] === name)?.[1];
		},
	};
}

test('retains channels, shared platform/attestation manifests and successful evidence', async (t) => {
	const f = fixture(t);
	await cleanup(f.args);
	assert.deepEqual(f.calls, ['artifact:30', 'run:3', 'cache:40', 'image:14', 'image:20']);
	assert.equal(f.count('Product image versions'), '1');
	assert.equal(f.count('Already absent (not counted as deleted)'), '0');
});

test('404 after a delete continues all resource kinds without inflating deleted counts', async (t) => {
	const f = fixture(t, { absent: ['artifact:30', 'run:3', 'cache:40', 'image:14', 'image:20'] });
	await cleanup(f.args);
	assert.equal(f.calls.length, 5);
	for (const name of [
		'Product image versions',
		'Runner image versions',
		'Actions runs',
		'Artifacts',
		'Actions caches',
	])
		assert.equal(f.count(name), '0');
	assert.equal(f.count('Already absent (not counted as deleted)'), '5');
});

for (const status of [403, 500]) {
	test(`permanent/exhausted HTTP ${status} stops cleanup and preserves the original error`, async (t) => {
		const f = fixture(t, { failure: { key: 'artifact:30', status } });
		await assert.rejects(cleanup(f.args), { status });
		assert.deepEqual(f.calls, ['artifact:30']);
	});
}

test('missing run metadata keeps its unverifiable artifact and continues independent cleanup', async (t) => {
	const f = fixture(t, { absent: ['read:3'] });
	await cleanup(f.args);
	assert.deepEqual(f.calls, ['cache:40', 'image:14', 'image:20']);
	assert.ok(f.logs.some((text) => text.includes('no longer available for verification')));
});

test('active runs and artifacts are retained and image/cache deletion is deferred', async (t) => {
	const f = fixture(t, { active: true });
	await cleanup(f.args);
	assert.deepEqual(f.calls, ['artifact:30', 'run:3']);
});

test('a restarted run is rechecked and protects its artifact, images and caches', async (t) => {
	const f = fixture(t, { freshStatus: 'in_progress' });
	await cleanup(f.args);
	assert.deepEqual(f.calls, []);
});

test('channel movement still stops before any package version deletion', async (t) => {
	const f = fixture(t, { moved: true });
	await assert.rejects(cleanup(f.args), /A channel moved/);
	assert.deepEqual(f.calls, ['artifact:30', 'run:3', 'cache:40']);
});
