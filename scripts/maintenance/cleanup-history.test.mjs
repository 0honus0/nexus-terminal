import assert from 'node:assert/strict';
import { test } from 'node:test';
import cleanup from './cleanup-history.mjs';

const digest = (value) => 'sha256:' + value.repeat(64);

function fixture(
	t,
	{
		absent = [],
		failure,
		active = false,
		freshStatus,
		moved = false,
		movedPackage = 'nexus-terminal',
		movedTag = 'latest',
		organization = false,
	} = {},
) {
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
	const catalogs = {
		'nexus-terminal': [
			{ id: 10, name: digest('1'), metadata: { container: { tags: ['latest', 'v2.0.0'] } } },
			{ id: 11, name: digest('2'), metadata: { container: { tags: ['dev'] } } },
			{ id: 12, name: digest('4'), metadata: { container: { tags: [] } } },
			{ id: 13, name: digest('5'), metadata: { container: { tags: [] } } },
			{ id: 14, name: digest('3'), metadata: { container: { tags: ['old', 'sha-old'] } } },
			{ id: 15, name: digest('6'), metadata: { container: { tags: ['main'] } } },
			{ id: 16, name: digest('7'), metadata: { container: { tags: [] } } },
		],
		'nexus-terminal-e2e-runner': [
			{ id: 20, name: digest('0'), metadata: { container: { tags: [] } } },
			{ id: 21, name: digest('a'), metadata: { container: { tags: ['latest'] } } },
			{ id: 22, name: digest('b'), metadata: { container: { tags: ['main'] } } },
			{ id: 23, name: digest('c'), metadata: { container: { tags: ['dev'] } } },
			{ id: 24, name: digest('d'), metadata: { container: { tags: [] } } },
			{ id: 25, name: digest('e'), metadata: { container: { tags: [] } } },
		],
	};
	const heads = Object.fromEntries(
		Object.entries(catalogs).map(([name, versions]) => [
			name,
			new Map(versions.flatMap((version) => version.metadata.container.tags.map((tag) => [tag, version.name]))),
		]),
	);
	const packageRepositories = { 'nexus-terminal': 1, 'nexus-terminal-e2e-runner': 1 };
	const packageRequests = [];

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
		rest: {
			repos: { get: async () => ({ data: { id: 1, owner: { type: organization ? 'Organization' : 'User' } } }) },
			actions,
		},

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
			assert.match(
				method,
				organization
					? /^GET \/orgs\/\{org\}\/packages\/container/
					: /^GET \/users\/\{username\}\/packages\/container/,
			);
			packageRequests.push(params.package_name);
			assert.ok(Object.hasOwn(catalogs, params.package_name));
			return catalogs[params.package_name];
		},

		async request(route, params) {
			packageRequests.push(params.package_name);
			assert.ok(Object.hasOwn(catalogs, params.package_name));
			if (route.startsWith('GET ')) {
				assert.match(
					route,
					organization
						? /^GET \/orgs\/\{org\}\/packages\/container/
						: /^GET \/users\/\{username\}\/packages\/container/,
				);
				if (absent.includes('package:' + params.package_name))
					throw Object.assign(new Error('Package absent'), { status: 404 });
				return { data: { repository: { id: packageRepositories[params.package_name] } } };
			}
			assert.match(
				route,
				organization
					? /^DELETE \/orgs\/\{org\}\/packages\/container/
					: /^DELETE \/users\/\{username\}\/packages\/container/,
			);
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
		const packageName = url.pathname.split('/')[3];
		assert.ok(Object.hasOwn(catalogs, packageName));
		const id = url.pathname.split('/').at(-1);
		if (options.method === 'HEAD') {
			const changed = moved && packageName === movedPackage && id === movedTag && calls.includes('artifact:30');
			const current = changed ? digest('f') : heads[packageName].get(id);
			return new Response(null, current ? { headers: { 'docker-content-digest': current } } : { status: 404 });
		}
		const product = packageName === 'nexus-terminal';
		if (product && (id === digest('1') || id === digest('2')))
			return Response.json({ manifests: [{ digest: digest('4') }, { digest: digest('5') }] });
		if (product && id === digest('6')) return Response.json({ manifests: [{ digest: digest('7') }] });
		if (!product && [digest('a'), digest('b'), digest('c')].includes(id))
			return Response.json({ manifests: [{ digest: digest('d') }, { digest: digest('e') }] });
		if ((product ? [digest('4'), digest('5'), digest('7')] : [digest('d'), digest('e')]).includes(id))
			return Response.json({ config: { digest: digest(id === digest('5') ? '9' : '8') } });
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
		catalogs,
		heads,
		packageRepositories,
		packageRequests,

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

test('both fixed packages keep main/dev/latest roots and only their own manifest closure', async (t) => {
	const f = fixture(t);
	f.catalogs['nexus-terminal-e2e-runner'].push({
		id: 26,
		name: digest('4'),
		metadata: { container: { tags: ['sha-obsolete'] } },
	});
	await cleanup(f.args);
	assert.deepEqual(f.calls, ['artifact:30', 'run:3', 'cache:40', 'image:14', 'image:20', 'image:26']);
	assert.deepEqual(new Set(f.packageRequests), new Set(['nexus-terminal', 'nexus-terminal-e2e-runner']));
	assert.equal(f.count('Runner image versions'), '2');
	for (const packageName of ['nexus-terminal', 'nexus-terminal-e2e-runner']) {
		for (const tag of ['main', 'dev', 'latest']) {
			assert.ok(f.logs.some((line) => line.startsWith(`Keep ${packageName}:${tag}: `)));
		}
	}
});

test('an optional protected tag need not have been published in either package', async (t) => {
	const f = fixture(t);
	for (const packageName of ['nexus-terminal', 'nexus-terminal-e2e-runner']) {
		f.catalogs[packageName] = f.catalogs[packageName].filter(
			(version) => !version.metadata.container.tags.includes('main'),
		);
		f.heads[packageName].delete('main');
	}
	await cleanup(f.args);
	assert.deepEqual(f.calls, ['artifact:30', 'run:3', 'cache:40', 'image:14', 'image:16', 'image:20']);
});

test('a main-only package keeps its current image while other old versions remain eligible', async (t) => {
	const f = fixture(t);
	const name = 'nexus-terminal-e2e-runner';
	for (const version of f.catalogs[name]) {
		version.metadata.container.tags = version.metadata.container.tags.filter((tag) => tag === 'main');
	}
	f.heads[name].delete('latest');
	f.heads[name].delete('dev');
	await cleanup(f.args);
	assert.ok(!f.calls.includes('image:22'));
	assert.ok(!f.calls.includes('image:24'));
	assert.ok(!f.calls.includes('image:25'));
	assert.ok(f.calls.includes('image:21'));
	assert.ok(f.calls.includes('image:23'));
});

test('multiple protected tags sharing one digest retain that version and its aliases', async (t) => {
	const f = fixture(t);
	const name = 'nexus-terminal';
	for (const version of f.catalogs[name]) {
		version.metadata.container.tags = version.id === 10 ? ['main', 'dev', 'latest', 'v2.0.0'] : [];
	}
	for (const tag of ['main', 'dev', 'latest']) f.heads[name].set(tag, digest('1'));
	await cleanup(f.args);
	assert.ok(!f.calls.includes('image:10'));
	assert.ok(!f.calls.includes('image:12'));
	assert.ok(!f.calls.includes('image:13'));
	assert.ok(f.calls.includes('image:11'));
	assert.ok(f.calls.includes('image:15'));
	assert.ok(f.calls.includes('image:16'));
});

for (const packageName of ['nexus-terminal', 'nexus-terminal-e2e-runner']) {
	test(`a package linked to another repository stops all deletion: ${packageName}`, async (t) => {
		const f = fixture(t);
		f.packageRepositories[packageName] = 2;
		await assert.rejects(cleanup(f.args), /not linked to this repository/);
		assert.deepEqual(f.calls, []);
	});

	test(`an existing package without any protected root stops all deletion: ${packageName}`, async (t) => {
		const f = fixture(t);
		for (const version of f.catalogs[packageName]) version.metadata.container.tags = [];
		await assert.rejects(cleanup(f.args), /No main\/dev\/latest root/);
		assert.deepEqual(f.calls, []);
	});
}

test('organization packages use their scoped package endpoints', async (t) => {
	const f = fixture(t, { organization: true });
	await cleanup(f.args);
	assert.deepEqual(f.calls, ['artifact:30', 'run:3', 'cache:40', 'image:14', 'image:20']);
});

test('an absent runner package is skipped without targeting another package', async (t) => {
	const f = fixture(t, { absent: ['package:nexus-terminal-e2e-runner'] });
	await cleanup(f.args);
	assert.deepEqual(f.calls, ['artifact:30', 'run:3', 'cache:40', 'image:14']);
	assert.equal(f.count('Runner image versions'), '0');
});

test('runner channel movement stops deletion before any package version is removed', async (t) => {
	const f = fixture(t, { moved: true, movedPackage: 'nexus-terminal-e2e-runner' });
	await assert.rejects(cleanup(f.args), /A channel moved/);
	assert.deepEqual(f.calls, ['artifact:30', 'run:3', 'cache:40']);
});

test('publishing a previously absent protected tag invalidates the deletion plan', async (t) => {
	const f = fixture(t, { moved: true, movedTag: 'main' });
	f.catalogs['nexus-terminal'] = f.catalogs['nexus-terminal'].filter((version) => version.id !== 15);
	f.heads['nexus-terminal'].delete('main');
	await assert.rejects(cleanup(f.args), /A channel moved/);
	assert.deepEqual(f.calls, ['artifact:30', 'run:3', 'cache:40']);
});

test('inconsistent duplicated protected tags are rejected before deletion', async (t) => {
	const f = fixture(t);
	f.catalogs['nexus-terminal'][4].metadata.container.tags.push('main');
	await assert.rejects(cleanup(f.args), /Ambiguous nexus-terminal:main/);
	assert.deepEqual(f.calls, []);
});

test('failure to inspect a retained runner manifest stops all deletion', async (t) => {
	const f = fixture(t);
	const registryFetch = globalThis.fetch;
	t.mock.method(globalThis, 'fetch', (value, options) => {
		if (new URL(value).pathname.endsWith('/nexus-terminal-e2e-runner/manifests/' + digest('d'))) {
			return Promise.resolve(new Response(null, { status: 503 }));
		}
		return registryFetch(value, options);
	});
	await assert.rejects(cleanup(f.args), /Cannot inspect retained manifest/);
	assert.deepEqual(f.calls, []);
});
