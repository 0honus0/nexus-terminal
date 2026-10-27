/** Manual repository maintenance. No product data or unrelated packages are touched. */
export default async function cleanup({ github, context, core }) {
	const { owner, repo } = context.repo;
	const repository = await github.rest.repos.get({ owner, repo });
	const organization = repository.data.owner.type === 'Organization';
	const packageOwner = organization ? { org: owner } : { username: owner };
	const packageRoute = organization ? '/orgs/{org}' : '/users/{username}';
	const packagePath = `${packageRoute}/packages/container/{package_name}/versions`;
	const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, { owner, repo, per_page: 100 });
	const currentRun = Number(context.runId);
	const activeRuns = runs.filter((run) => run.id !== currentRun && run.status !== 'completed');
	for (const run of activeRuns) core.info(`Keep active run ${run.id}: ${run.status}`);

	async function versions(packageName) {
		try {
			return await github.paginate(`GET ${packagePath}`, {
				...packageOwner,
				package_name: packageName,
				per_page: 100,
			});
		} catch (error) {
			if (error.status === 404) return [];
			throw error;
		}
	}

	const productVersions = await versions('nexus-terminal');
	const runnerVersions = await versions('nexus-terminal-e2e-runner');
	const channelVersions = new Map();
	for (const tag of ['latest', 'dev']) {
		const version = productVersions.find((item) => item.metadata.container.tags.includes(tag));
		if (!version) throw new Error(`Missing ${tag} image; refusing to clean without both channel roots.`);
		channelVersions.set(tag, version);
	}

	const image = `${owner.toLowerCase()}/nexus-terminal`;
	const tokenResponse = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${image}:pull`, {
		headers: {
			Authorization: `Basic ${Buffer.from(`${context.actor}:${process.env.GITHUB_TOKEN}`).toString('base64')}`,
		},
	});
	if (!tokenResponse.ok) throw new Error(`Registry authentication failed: HTTP ${tokenResponse.status}`);
	const { token } = await tokenResponse.json();
	if (typeof token !== 'string' || !token) throw new Error('Registry did not return a pull token.');
	core.setSecret(token);
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
	};
	const retainedDigests = new Set();
	const retainedRevisions = new Set();

	async function retainManifest(digest) {
		if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid manifest digest.');
		if (retainedDigests.has(digest)) return;
		retainedDigests.add(digest);
		const response = await fetch(`https://ghcr.io/v2/${image}/manifests/${digest}`, { headers });
		if (!response.ok) throw new Error(`Cannot inspect retained manifest: HTTP ${response.status}`);
		const manifest = await response.json();
		if (Array.isArray(manifest.manifests)) {
			for (const child of manifest.manifests) await retainManifest(child.digest);
		} else if (manifest.config?.digest) {
			if (!/^sha256:[a-f0-9]{64}$/.test(manifest.config.digest)) throw new Error('Invalid config digest.');
			const configResponse = await fetch(`https://ghcr.io/v2/${image}/blobs/${manifest.config.digest}`, {
				headers,
			});
			if (!configResponse.ok)
				throw new Error(`Cannot inspect retained image config: HTTP ${configResponse.status}`);
			const config = await configResponse.json();
			const revision = config.config?.Labels?.['org.opencontainers.image.revision'];
			if (typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision)) retainedRevisions.add(revision);
		} else {
			throw new Error('Unrecognized retained manifest; refusing partial retention.');
		}
	}

	for (const version of channelVersions.values()) await retainManifest(version.name);

	// Refresh channel roots before each image deletion, including children shared by two versions.
	async function verifyChannels() {
		for (const [tag, version] of channelVersions) {
			const response = await fetch(`https://ghcr.io/v2/${image}/manifests/${tag}`, { method: 'HEAD', headers });
			if (!response.ok || response.headers.get('docker-content-digest') !== version.name) {
				throw new Error('A channel moved during cleanup. Stop and rerun against the new images.');
			}
		}
	}

	await verifyChannels();
	const retainedRuns = new Set([currentRun, ...activeRuns.map((run) => run.id)]);
	for (const run of runs) {
		if (retainedRevisions.has(run.head_sha) && run.conclusion === 'success') retainedRuns.add(run.id);
	}
	// A timing-only bot commit may separate a published revision from its verified E2E source.
	const newestGreenE2e = runs.find((run) => run.path === '.github/workflows/e2e.yml' && run.conclusion === 'success');
	if (newestGreenE2e) retainedRuns.add(newestGreenE2e.id);
	const artifacts = await github.paginate(github.rest.actions.listArtifactsForRepo, { owner, repo, per_page: 100 });
	const caches = await github.paginate(github.rest.actions.getActionsCacheList, { owner, repo, per_page: 100 });
	const obsoleteImages = productVersions.filter((version) => !retainedDigests.has(version.name));
	const obsoleteRuns = runs.filter((run) => !retainedRuns.has(run.id));
	const obsoleteArtifacts = artifacts.filter((artifact) => !retainedRuns.has(artifact.workflow_run?.id));
	core.info(
		`Plan: delete ${obsoleteImages.length} product versions, ${runnerVersions.length} runner versions, ${obsoleteRuns.length} runs, ${obsoleteArtifacts.length} artifacts and ${caches.length} caches.`,
	);
	for (const [tag, version] of channelVersions) core.info(`Keep ${tag}: ${version.name}`);

	let deletedArtifacts = 0;
	let deletedRuns = 0;
	for (const artifact of obsoleteArtifacts) {
		const runId = artifact.workflow_run?.id;
		if (!runId) {
			core.info(`Keep artifact ${artifact.id}: owning run is unavailable.`);
			continue;
		}
		const fresh = await github.rest.actions.getWorkflowRun({ owner, repo, run_id: runId });
		if (fresh.data.status !== 'completed') {
			core.info(`Keep artifact ${artifact.id}: run ${runId} is ${fresh.data.status}.`);
			continue;
		}
		await github.rest.actions.deleteArtifact({ owner, repo, artifact_id: artifact.id });
		deletedArtifacts += 1;
	}
	for (const run of obsoleteRuns) {
		const fresh = await github.rest.actions.getWorkflowRun({ owner, repo, run_id: run.id });
		if (fresh.data.status !== 'completed') {
			core.info(`Keep restarted run ${run.id}: ${fresh.data.status}`);
			continue;
		}
		await github.rest.actions.deleteWorkflowRun({ owner, repo, run_id: run.id });
		deletedRuns += 1;
	}
	const freshRuns = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
		owner,
		repo,
		per_page: 100,
	});
	const hasActiveRuns = freshRuns.some((run) => run.id !== currentRun && run.status !== 'completed');
	const removableCaches = hasActiveRuns ? [] : caches;
	const removableImages = hasActiveRuns ? [] : obsoleteImages;
	const removableRunnerVersions = hasActiveRuns ? [] : runnerVersions;
	if (hasActiveRuns) core.info('Other runs are active; keep image versions and Actions caches for this cleanup.');
	for (const cache of removableCaches) {
		await github.rest.actions.deleteActionsCacheById({ owner, repo, cache_id: cache.id });
	}
	for (const [packageName, candidates] of [
		['nexus-terminal', removableImages],
		['nexus-terminal-e2e-runner', removableRunnerVersions],
	]) {
		for (const version of candidates) {
			await verifyChannels();
			await github.request(`DELETE ${packagePath}/{package_version_id}`, {
				...packageOwner,
				package_name: packageName,
				package_version_id: version.id,
			});
		}
	}
	await verifyChannels();
	await core.summary
		.addHeading('Manual cleanup complete')
		.addRaw(
			'Kept latest/dev and all referenced platform/attestation manifests, their successful runs, the newest successful E2E and this cleanup run. Removed eligible completed runs/artifacts. Active or restarted runs and their artifacts were retained; image versions and caches were retained when other runs were active.\n',
		)
		.addTable([
			['Deleted resource', 'Count'],
			['Product image versions', String(removableImages.length)],
			['Runner image versions', String(removableRunnerVersions.length)],
			['Actions runs', String(deletedRuns)],
			['Artifacts', String(deletedArtifacts)],
			['Actions caches', String(removableCaches.length)],
		])
		.write();
}
