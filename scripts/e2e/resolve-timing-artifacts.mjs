export async function resolveTimingArtifacts({ github, owner, repo, runId }) {
	const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
		owner,
		repo,
		run_id: runId,
		filter: 'latest',
		per_page: 100,
	});
	const names = new Set();
	for (const job of jobs) {
		const match = /^Playwright (backend|browser) shard ([1-9]\d*)$/.exec(job.name);
		if (!match) continue;
		if (job.status !== 'completed' || job.conclusion !== 'success') {
			throw new Error(`Timing source job did not succeed: ${job.name}`);
		}
		if (!Number.isSafeInteger(job.run_attempt) || job.run_attempt < 1) {
			throw new Error(`Timing source job has no valid attempt: ${job.name}`);
		}
		const name = `e2e-timings-${match[1]}-${match[2]}-${job.run_attempt}`;
		if (names.has(name)) throw new Error(`Duplicate timing source job: ${job.name}`);
		names.add(name);
	}
	if (names.size === 0) throw new Error('No successful Playwright timing source jobs found');
	const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
		owner,
		repo,
		run_id: runId,
		per_page: 100,
	});
	const ids = [];
	for (const name of names) {
		const matches = artifacts.filter((artifact) => artifact.name === name && !artifact.expired);
		if (matches.length !== 1) throw new Error(`Expected one available timing artifact: ${name}`);
		ids.push(matches[0].id);
		console.log(`[E2E timings] using ${name} (artifact ${matches[0].id})`);
	}
	return ids.join(',');
}
