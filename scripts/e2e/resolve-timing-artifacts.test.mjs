import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTimingArtifacts } from './resolve-timing-artifacts.mjs';
import { waitForApplicationBuild } from './wait-for-build.mjs';

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

function job(suite, shard, attempt) {
	return {
		name: `Playwright ${suite} shard ${shard}`,
		run_attempt: attempt,
		started_at: timestamp(attempt, 0),
		completed_at: timestamp(attempt, 10),
		status: 'completed',
		conclusion: 'success',
	};
}

function artifact(id, suite, shard, attempt) {
	return {
		id,
		name: `e2e-timings-${suite}-${shard}-${attempt}`,
		expired: false,
		created_at: timestamp(attempt, 5),
	};
}

test('a partial rerun selects each latest job attempt and ignores superseded artifacts', async () => {
	const input = source(
		[job('backend', 1, 1), job('browser', 1, 2), job('browser', 2, 1)],
		[
			artifact(11, 'backend', 1, 1),
			artifact(12, 'browser', 1, 1),
			artifact(13, 'browser', 1, 2),
			artifact(14, 'browser', 2, 1),
			artifact(15, 'browser', 2, 2),
		],
	);
	assert.equal(await resolveTimingArtifacts(input), '11,13,14');
});

test('rerunning only the updater reuses successful earlier shard artifacts', async () => {
	const input = source(
		[
			{ ...job('backend', 1, 1), run_attempt: 2 },
			{ name: 'Update Playwright duration balance', run_attempt: 2 },
		],
		[artifact(11, 'backend', 1, 1)],
	);
	assert.equal(await resolveTimingArtifacts(input), '11');
});

test('a missing or expired artifact fails instead of falling back to stale observations', async () => {
	for (const artifacts of [[artifact(11, 'browser', 1, 1)], [{ ...artifact(12, 'browser', 1, 2), expired: true }]]) {
		await assert.rejects(
			resolveTimingArtifacts(source([job('browser', 1, 2)], artifacts)),
			/Missing timing artifact/,
		);
	}
});

test('failed, ambiguous or unidentified sources cannot update timing estimates', async () => {
	for (const jobs of [
		[],
		[{ ...job('backend', 1, 1), conclusion: 'failure' }],
		[{ ...job('backend', 1, 1), completed_at: undefined }],
		[job('backend', 1, 1), job('backend', 1, 1)],
	]) {
		await assert.rejects(resolveTimingArtifacts(source(jobs, [artifact(11, 'backend', 1, 1)])));
	}
	await assert.rejects(
		resolveTimingArtifacts(
			source([job('backend', 1, 1)], [artifact(11, 'backend', 1, 1), artifact(12, 'backend', 1, 1)]),
		),
		/Multiple artifacts for source job/,
	);
});

test('a failed shard rerun reuses the copied successful build without trusting its attempt', async () => {
	const input = source(
		[{ ...job('backend', 1, 1), name: 'Checks and format', run_attempt: 2 }],
		[
			{ ...artifact(11, 'backend', 1, 1), name: 'e2e-application-test-sha-1' },
			{ ...artifact(12, 'backend', 1, 2), name: 'e2e-application-test-sha-2' },
		],
	);
	assert.equal(await waitForApplicationBuild({ ...input, sha: 'test-sha' }), '11');
});

test('a full build rerun cannot use an earlier build artifact', async () => {
	const input = source(
		[{ ...job('backend', 1, 2), name: 'Checks and format' }],
		[{ ...artifact(11, 'backend', 1, 1), name: 'e2e-application-test-sha-1' }],
	);
	await assert.rejects(waitForApplicationBuild({ ...input, sha: 'test-sha' }), /Application artifact unavailable/);
});

test('API failures propagate without publishing partial IDs', async () => {
	const input = source([], []);
	const failure = new Error('API unavailable');
	input.github.paginate = async () => {
		throw failure;
	};
	await assert.rejects(resolveTimingArtifacts(input), (error) => error === failure);
});
