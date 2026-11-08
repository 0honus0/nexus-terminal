import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolveTimingArtifacts } from '../../../../scripts/e2e/resolve-timing-artifacts.mjs';
import { waitForTestArtifact } from '../../../../scripts/e2e/wait-for-build.mjs';

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
		name: `e2e-timings-${shard}-${attempt}`,
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
			{ name: 'Update Playwright duration balance', run_attempt: 2 },
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
	assert.equal(await waitForTestArtifact({ ...input, sha: 'test-sha', kind: 'application' }), '11');
});

test('a full build rerun cannot use an earlier build artifact', async () => {
	const input = source(
		[{ ...job(1, 2), name: 'Checks and format' }],
		[{ ...artifact(11, 1, 1), name: 'e2e-application-test-sha-1' }],
	);
	await assert.rejects(
		waitForTestArtifact({ ...input, sha: 'test-sha', kind: 'application' }),
		/application artifact unavailable/,
	);
});

test('plugin candidates follow the original build lifetime on partial reruns and reject stale full reruns', async () => {
	const artifacts = [
		{ ...artifact(21, 1, 1), name: 'e2e-plugin-candidates-test-sha-1' },
		{ ...artifact(22, 1, 2), name: 'e2e-plugin-candidates-test-sha-2' },
	];
	const input = source([{ ...job(1, 1), name: 'Checks and format', run_attempt: 2 }], artifacts);
	assert.equal(await waitForTestArtifact({ ...input, sha: 'test-sha', kind: 'plugin-candidates' }), '21');
	await assert.rejects(
		waitForTestArtifact({
			...source([{ ...job(1, 2), name: 'Checks and format' }], artifacts.slice(0, 1)),
			sha: 'test-sha',
			kind: 'plugin-candidates',
		}),
		/plugin-candidates artifact unavailable/,
	);
});

test('API failures propagate without publishing partial IDs', async () => {
	const input = source([], []);
	const failure = new Error('API unavailable');
	input.github.paginate = async () => {
		throw failure;
	};
	await assert.rejects(resolveTimingArtifacts(input), (error) => error === failure);
});
