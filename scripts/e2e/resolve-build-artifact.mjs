import { findArtifactForJob } from './job-artifacts.mjs';

export async function resolveBuildArtifact({ github, owner, repo, runId, sha, kind }) {
	if (kind !== 'application' && kind !== 'plugin-candidates') throw new Error('Unknown test artifact kind');
	const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
		owner,
		repo,
		run_id: runId,
		filter: 'latest',
		per_page: 100,
	});
	const builds = jobs.filter((job) => job.name === 'Checks and format');
	if (builds.length !== 1 || builds[0].status !== 'completed' || builds[0].conclusion !== 'success') {
		throw new Error('One successful application build job is required');
	}
	const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
		owner,
		repo,
		run_id: runId,
		per_page: 100,
	});
	const artifact = findArtifactForJob({ job: builds[0], artifacts, namePrefix: `e2e-${kind}-${sha}-` });
	if (!artifact) throw new Error(`${kind} artifact unavailable for the successful build job`);
	console.log(`[Test build] using ${artifact.name} (artifact ${artifact.id})`);
	return String(artifact.id);
}
