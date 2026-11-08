import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { findArtifactForJob } from './job-artifacts.mjs';

// Reuse the installed library rather than maintaining a second polling/backoff loop.
const requireFromBackend = createRequire(new URL('../../packages/backend/package.json', import.meta.url));
const { default: pRetry, AbortError } = await import(pathToFileURL(requireFromBackend.resolve('p-retry')).href);

class BuildPending extends Error {}

export async function waitForTestArtifact({ github, owner, repo, runId, sha, kind }) {
	if (kind !== 'application' && kind !== 'plugin-candidates') throw new Error('Unknown test artifact kind');
	let lastState = '';
	return pRetry(
		async () => {
			const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
				owner,
				repo,
				run_id: runId,
				filter: 'latest',
				per_page: 100,
			});
			const builds = jobs.filter((job) => job.name === 'Checks and format');
			if (builds.length > 1) throw new AbortError('Multiple application build jobs in the current run');
			const build = builds[0];
			if (!build) throw new BuildPending('Application build job is not registered yet');
			// A full rerun selects its new build attempt. Rerunning only a failed shard
			// can reuse the successful build job from the previous attempt of this run.
			const namePrefix = `e2e-${kind}-${sha}-`;
			const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
				owner,
				repo,
				run_id: runId,
				per_page: 100,
			});
			const artifact = findArtifactForJob({ job: build, artifacts, namePrefix });
			if (artifact) {
				console.log(`[E2E build] using ${artifact.name} (artifact ${artifact.id})`);
				return String(artifact.id);
			}
			if (build.status === 'completed') {
				throw new AbortError(`${kind} artifact unavailable after build job concluded: ${build.conclusion}`);
			}
			const state = `attempt ${build.run_attempt}: ${build.status}`;
			if (state !== lastState) {
				console.log(`[E2E build] waiting for ${state}`);
				lastState = state;
			}
			throw new BuildPending('Application artifact has not been uploaded yet');
		},
		{
			retries: Number.POSITIVE_INFINITY,
			maxTimeout: 5_000,

			// The existing Actions job timeout owns the deadline. Retry only readiness,
			// never a permission error, missing completed build, or another API failure.
			shouldRetry: ({ error }) => error instanceof BuildPending,
		},
	);
}
