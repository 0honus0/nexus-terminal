import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolveTimingArtifacts } from '../../../../scripts/e2e/resolve-timing-artifacts.mjs';
import { resolveBuildArtifact } from '../../../../scripts/e2e/resolve-build-artifact.mjs';

function timestamp(attempt, minute) {
	return new Date(Date.UTC(2026, 10, 5, attempt, minute)).toISOString();
}

function source(jobs, artifacts) {
	const listJobsForWorkflowRun = Symbol('jobs');
	const listWorkflowRunArtifacts = Symbol('artifacts');
	return {
		owner: 'owner',
		repo: 'repo',
		runId: 123,
		github: {
			rest: { actions: { listJobsForWorkflowRun, listWorkflowRunArtifacts } },

			async paginate(endpoint, options) {
				assert.equal(options.run_id, 123);
				assert.equal(options.owner, 'owner');
				assert.equal(options.repo, 'repo');
				if (endpoint === listJobsForWorkflowRun) {
					assert.equal(options.filter, 'latest');
					return jobs;
				}
				assert.equal(endpoint, listWorkflowRunArtifacts);
				return artifacts;
			},
		},
	};
}

function job(shard, attempt) {
	return {
		name: `Tests shard ${shard}`,
		run_attempt: attempt,
		started_at: timestamp(attempt, 0),
		completed_at: timestamp(attempt, 10),
		status: 'completed',
		conclusion: 'success',
	};
}

function artifact(id, shard, attempt) {
	return {
		id,
		name: `test-layers-${shard}-${attempt}`,
		expired: false,
		created_at: timestamp(attempt, 5),
	};
}

test('a partial rerun selects each latest job attempt and ignores superseded artifacts', async () => {
	const input = source(
		[job(1, 1), job(2, 2), job(3, 1)],
		[artifact(11, 1, 1), artifact(12, 2, 1), artifact(13, 2, 2), artifact(14, 3, 1), artifact(15, 3, 2)],
	);
	assert.equal(await resolveTimingArtifacts(input), '11,13,14');
});

test('rerunning only the updater reuses successful earlier shard artifacts', async () => {
	const input = source(
		[
			{ ...job(1, 1), run_attempt: 2 },
			{ name: 'Finalize test reports', run_attempt: 2 },
		],
		[artifact(11, 1, 1)],
	);
	assert.equal(await resolveTimingArtifacts(input), '11');
});

test('a missing or expired artifact fails instead of falling back to stale observations', async () => {
	for (const artifacts of [[artifact(11, 2, 1)], [{ ...artifact(12, 2, 2), expired: true }]]) {
		await assert.rejects(resolveTimingArtifacts(source([job(2, 2)], artifacts)), /Missing timing artifact/);
	}
});

test('failed, ambiguous or unidentified sources cannot update timing estimates', async () => {
	for (const jobs of [
		[],
		[{ ...job(1, 1), conclusion: 'failure' }],
		[{ ...job(1, 1), completed_at: undefined }],
		[job(1, 1), job(1, 1)],
	]) {
		await assert.rejects(resolveTimingArtifacts(source(jobs, [artifact(11, 1, 1)])));
	}
	await assert.rejects(
		resolveTimingArtifacts(source([job(1, 1)], [artifact(11, 1, 1), artifact(12, 1, 1)])),
		/Multiple artifacts for source job/,
	);
});

test('a failed shard rerun reuses the copied successful build without trusting its attempt', async () => {
	const input = source(
		[{ ...job(1, 1), name: 'Checks and format', run_attempt: 2 }],
		[
			{ ...artifact(11, 1, 1), name: 'e2e-application-test-sha-1' },
			{ ...artifact(12, 1, 2), name: 'e2e-application-test-sha-2' },
		],
	);
	assert.equal(await resolveBuildArtifact({ ...input, sha: 'test-sha', kind: 'application' }), '11');
});

test('a full build rerun cannot use an earlier build artifact', async () => {
	const input = source(
		[{ ...job(1, 2), name: 'Checks and format' }],
		[{ ...artifact(11, 1, 1), name: 'e2e-application-test-sha-1' }],
	);
	await assert.rejects(
		resolveBuildArtifact({ ...input, sha: 'test-sha', kind: 'application' }),
		/application artifact unavailable/,
	);
});

test('API failures propagate without publishing partial IDs', async () => {
	const input = source([], []);
	const failure = new Error('API unavailable');
	input.github.paginate = async () => {
		throw failure;
	};
	await assert.rejects(resolveTimingArtifacts(input), (error) => error === failure);
	await assert.rejects(
		resolveBuildArtifact({ ...input, sha: 'test-sha', kind: 'application' }),
		(error) => error === failure,
	);
});

test('test environments reuse only the original successful environment job artifact on partial reruns', async () => {
	const environment = { ...job(1, 1), name: 'Prepare shared test runner image', run_attempt: 2 };
	const artifacts = [
		{ ...artifact(31, 1, 1), name: 'test-environment-test-sha-1' },
		{ ...artifact(32, 1, 2), name: 'test-environment-test-sha-2' },
	];
	assert.equal(
		await resolveBuildArtifact({ ...source([environment], artifacts), sha: 'test-sha', kind: 'environment' }),
		'31',
	);
	await assert.rejects(
		resolveBuildArtifact({
			...source(
				[{ ...environment, started_at: timestamp(2, 0), completed_at: timestamp(2, 10) }],
				artifacts.slice(0, 1),
			),
			sha: 'test-sha',
			kind: 'environment',
		}),
		/environment artifact unavailable/,
	);
	await assert.rejects(
		resolveBuildArtifact({
			...source([{ ...environment, conclusion: 'failure' }], artifacts),
			sha: 'test-sha',
			kind: 'environment',
		}),
		/One successful application build job is required/,
	);
});

// Job dependencies replace readiness polling; source failure must not start shard work.
test('artifact resolution rejects missing, pending, failed or ambiguous build jobs immediately', async () => {
	const build = { ...job(1, 1), name: 'Checks and format' };
	for (const jobs of [
		[],
		[{ ...build, status: 'in_progress' }],
		[{ ...build, conclusion: 'failure' }],
		[build, build],
	]) {
		await assert.rejects(
			resolveBuildArtifact({ ...source(jobs, []), sha: 'test-sha', kind: 'application' }),
			/One successful application build job is required/,
		);
	}
});
