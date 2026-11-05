import { findArtifactForJob } from './job-artifacts.mjs';

export async function resolveTimingArtifacts({ github, owner, repo, runId }) {
	const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
		owner,
		repo,
		run_id: runId,
		filter: 'latest',
		per_page: 100,
	});
	const sources = new Map();
	for (const job of jobs) {
		const match = /^Playwright (backend|browser) shard ([1-9]\d*)$/.exec(job.name);
		if (!match) continue;
		if (job.status !== 'completed' || job.conclusion !== 'success') {
			throw new Error(`Timing source job did not succeed: ${job.name}`);
		}
		const prefix = `e2e-timings-${match[1]}-${match[2]}-`;
		if (sources.has(prefix)) throw new Error(`Duplicate timing source job: ${job.name}`);
		sources.set(prefix, job);
	}
	if (sources.size === 0) throw new Error('No successful Playwright timing source jobs found');
	const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
		owner,
		repo,
		run_id: runId,
		per_page: 100,
	});
	const ids = [];
	for (const [namePrefix, job] of sources) {
		const artifact = findArtifactForJob({ job, artifacts, namePrefix });
		if (!artifact) throw new Error(`Missing timing artifact for source job: ${job.name}`);
		ids.push(artifact.id);
		console.log(`[E2E timings] using ${artifact.name} (artifact ${artifact.id})`);
	}
	return ids.join(',');
}
