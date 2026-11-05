import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTimingArtifacts } from './resolve-timing-artifacts.mjs';

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
		status: 'completed',
		conclusion: 'success',
	};
}

function artifact(id, suite, shard, attempt) {
	return { id, name: `e2e-timings-${suite}-${shard}-${attempt}`, expired: false };
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
		[job('backend', 1, 1), { name: 'Update Playwright duration balance', run_attempt: 2 }],
		[artifact(11, 'backend', 1, 1)],
	);
	assert.equal(await resolveTimingArtifacts(input), '11');
});

test('a missing or expired artifact fails instead of falling back to stale observations', async () => {
	for (const artifacts of [[artifact(11, 'browser', 1, 1)], [{ ...artifact(12, 'browser', 1, 2), expired: true }]]) {
		await assert.rejects(
			resolveTimingArtifacts(source([job('browser', 1, 2)], artifacts)),
			/Expected one available timing artifact/,
		);
	}
});

test('failed, ambiguous or unidentified sources cannot update timing estimates', async () => {
	for (const jobs of [
		[],
		[{ ...job('backend', 1, 1), conclusion: 'failure' }],
		[{ ...job('backend', 1, 1), run_attempt: undefined }],
		[job('backend', 1, 1), job('backend', 1, 1)],
	]) {
		await assert.rejects(resolveTimingArtifacts(source(jobs, [artifact(11, 'backend', 1, 1)])));
	}
	await assert.rejects(
		resolveTimingArtifacts(
			source([job('backend', 1, 1)], [artifact(11, 'backend', 1, 1), artifact(12, 'backend', 1, 1)]),
		),
		/Expected one available timing artifact/,
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
