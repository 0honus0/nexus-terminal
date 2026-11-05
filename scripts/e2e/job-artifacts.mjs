export function findArtifactForJob({ job, artifacts, namePrefix }) {
	// GitHub copies successful jobs into reruns with a new run_attempt and ID,
	// but keeps their original execution times. Match the actual upload lifetime.
	if (job.started_at === null && job.status !== 'completed') return undefined;
	const started = Date.parse(job.started_at);
	const completed = job.status === 'completed' ? Date.parse(job.completed_at) : Infinity;
	if (!Number.isFinite(started) || completed < started || Number.isNaN(completed)) {
		throw new Error(`Invalid artifact source job lifetime: ${job.name}`);
	}
	const matches = artifacts.filter((artifact) => {
		if (artifact.expired || !artifact.name.startsWith(namePrefix)) return false;
		if (!/^[1-9]\d*$/.test(artifact.name.slice(namePrefix.length))) return false;
		const created = Date.parse(artifact.created_at);
		if (!Number.isFinite(created)) throw new Error(`Invalid artifact creation time: ${artifact.name}`);
		return created >= started && created <= completed;
	});
	if (matches.length > 1) throw new Error(`Multiple artifacts for source job: ${job.name}`);
	return matches[0];
}
